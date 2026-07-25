# Bundle: core (access, funds flow, adapter dispatch)

## What this is

`VaultCore` is a Stylus (Rust, WASM) smart contract on Arbitrum. It is a USDC-only vault
aggregator that sits above a fixed set of registered "adapter" contracts (each adapter wraps
one external lending protocol). Users never interact with adapters directly — they call
`VaultCore`, which custodies their USDC, splits it across adapters according to that user's own
stored allocation ("weights", in basis points), and tracks each user's proportional claim on
each adapter via an internal, non-transferable share ledger (one share ledger PER adapter, not
a single global one).

## Public surface (what an external caller can invoke)

- `init(owner)` — one-shot owner bootstrap.
- `add_adapter(adapter)` — owner-only, registers a new adapter (enabled by default).
- `set_enabled(adapter, enabled)` — owner-only, toggles whether an adapter accepts new deposits.
- `shares_of(user, adapter)`, `adapter_total_shares(adapter)`, `weight_bps_of(user, adapter)` — reads.
- `deposit_for(user, amount)` — **permissionless**: pulls `amount` USDC from `msg.sender` via
  `transferFrom` and credits `user`'s ledger, split across `user`'s OWN stored weights. Anyone
  can pay for anyone; nobody can steal, because the contract only ever pulls funds it can prove
  it received (a `transferFrom` that doesn't happen reverts the whole call).
- `deposit(amount)` — sugar: `deposit_for(msg.sender, amount)`.
- `redeem(bps)` — burns `bps`/10000 of the caller's OWN position across every adapter they hold
  shares in, and pays out the reconciled USDC to `msg.sender`.
- `rebalance(adapters, new_weights)` — the ONLY way a user writes their weight preference. Fully
  unwinds the caller's OWN existing position and re-splits the proceeds across the new weights.
  With an all-zero starting position this just writes weights (the bootstrap step before a first
  deposit).

## Invariants this code is supposed to maintain

- For every adapter, `sum over all users of user_shares[user][adapter] == adapter_total_shares[adapter]`.
- A user's position in ANY adapter (enabled or not) must always be reachable via `redeem`/`rebalance` —
  disabling an adapter blocks new deposits into it, never blocks a user's exit from it.
- `deposit`/`deposit_for` never reads a post-mutation balance to decide how much to mint — the
  entry snapshot used for minting is taken BEFORE any external call in that flow.
- `rebalance`'s proceeds are exactly the measured balance delta from unwinding the CALLER's own
  legs — never a read of the contract's total USDC balance (which would double as everyone else's
  custodied funds and any stray donations).
- Money-path arithmetic must revert on overflow rather than wrap. The release profile turns on
  `overflow-checks` for exactly this reason; explicit `checked_*` calls exist for the paths that
  need a typed, ABI-encoded error instead of a raw panic.
- There is no reentrancy guard anywhere in this contract. That is a deliberate bet, not an
  omission: the Stylus SDK's `reentrant` feature is never enabled in this crate's `Cargo.toml`,
  and the deposit-mint flow snapshots `total_assets` per adapter before any mutating external
  call, specifically so that a reentrant callback mid-flow cannot skew the snapshot it mints
  against.

## Source: `vault-core/src/core.rs` (production code, test module omitted)

```rust
//! `VaultCore`'s single public-methods impl block (the entrypoint macro forbids more than one
//! per contract type, M1 carryover): `init`, a minimal owner-only `add_adapter` seeding a single
//! active adapter (the full registry lands in Plan 02), and a minimal single-adapter `deposit`.
//! Guard-before-mutate convention matches `vault-adapter/src/adapter.rs`: every mutating method
//! calls private `Result`-returning guards first, before any state write or external call.

use alloc::vec::Vec;

use alloy_primitives::{address, Address, U256};
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

use crate::adapter_dispatch;
use crate::errors;
use crate::registry;
use crate::share_math;
use crate::usdc;
use crate::VaultCore;

/// Native USDC on Arbitrum One (the aggregator is USDC-only). Compile-time constant.
#[cfg(not(feature = "testnet"))]
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");

/// Real USDC on Arbitrum Sepolia — the `testnet` build variant targets this canonical testnet
/// token (Circle-issued, faucet-fundable), not a disposable mock. It must still NEVER be
/// deployed to mainnet: the constant points at the wrong network's token entirely, so a
/// `testnet` artifact deployed to Arbitrum One would simply be wired to a foreign address.
/// `scripts/deploy-testnet-mocks.sh`'s `check_const` greps this constant in both this file and
/// `vault-adapter/src/adapter.rs` and stops before spending gas if either diverges from it.
#[cfg(feature = "testnet")]
const USDC: Address = address!("75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");

/// Total basis-points an allocation must sum to exactly.
const TOTAL_BPS: U256 = U256::from_limbs([10_000u64, 0, 0, 0]);

/// The cheap deposit guard: the reconverted value of the minted shares must be worth at least
/// 9,900/10,000 (1% tolerance) of the requested slice, or `deposit_leg` reverts `DepositShortfall`.
/// The MockVault `deposit_credit_bps` knob is what exercises this guard in tests; the dilution
/// number measured e2e is what justifies keeping 100 bps or reopens the guard.
const DEPOSIT_TOLERANCE_BPS: U256 = U256::from_limbs([9_900u64, 0, 0, 0]);

sol! {
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Redeem(address indexed user, uint256 bps, uint256 assets);
    event Rebalanced(address indexed user, uint256 redeposited);
}

/// The amount to unwind from one adapter is `min(total_assets, max_withdraw)` (the adapter
/// exposes only exact `withdraw(usdc)`, and `withdraw(total_assets)` can round above `max_withdraw`).
/// Returns None when that amount is zero — a fully-throttled or empty adapter must be SKIPPED, not
/// called with 0 (the adapter reverts ZeroAmount on a zero-amount withdraw, which would wrongly trip
/// whole-tx atomicity on a merely-illiquid protocol).
fn unwind_request(total_assets: U256, max_withdraw: U256) -> Option<U256> {
    let request = if total_assets < max_withdraw { total_assets } else { max_withdraw };
    if request.is_zero() {
        None
    } else {
        Some(request)
    }
}

#[public]
impl VaultCore {
    /// Sets `owner` once. Mirrors `vault-adapter/src/adapter.rs`'s `init`.
    pub fn init(&mut self, owner: Address) -> Result<(), Vec<u8>> {
        if self.initialized.get() {
            return Err(errors::already_initialized());
        }
        if owner.is_zero() {
            return Err(errors::zero_address());
        }
        self.owner.set(owner);
        self.initialized.set(true);
        Ok(())
    }

    /// Owner-only: registers a new adapter, enabled by default. Weight is assigned only via each
    /// user's own `rebalance` call — there is no owner-level allocation.
    pub fn add_adapter(&mut self, adapter: Address) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;
        if adapter.is_zero() {
            return Err(errors::zero_address());
        }
        if registry::is_registered(self, adapter) {
            return Err(errors::adapter_already_registered());
        }
        self.adapters.push(adapter);
        self.adapter_enabled.setter(adapter).set(true);
        Ok(())
    }

    /// Owner-only enable/disable of a registered adapter.
    /// Disabling is allowed WITH an open position. It blocks new money in (a disabled
    /// adapter cannot be a weight target, and `deposit` re-checks `adapter_enabled` per leg) but
    /// never blocks money out: `redeem` and `rebalance`'s unwind iterate the FULL registry filtered
    /// by held shares, so nobody can be locked inside a disabled adapter.
    ///
    /// There is no `removeAdapter`. It was deleted deliberately: keeping it would require guarding
    /// against removing a still-live adapter from the registry and stranding a position there.
    /// Deleting `remove_adapter` removes that whole class of concern instead of mitigating it —
    /// `set_enabled(false)` already covers the operational case, and a disabled adapter's position
    /// is always reachable via `redeem`/`rebalance`.
    pub fn set_enabled(&mut self, adapter: Address, enabled: bool) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;
        if !registry::is_registered(self, adapter) {
            return Err(errors::adapter_not_registered());
        }
        self.adapter_enabled.setter(adapter).set(enabled);
        Ok(())
    }

    /// The caller-facing read of one user's position in one adapter, in internal shares.
    /// The USDC value is built off-chain by the frontend as
    /// sharesOf(user, adapter) / adapterTotalShares(adapter) * adapter.totalAssets()
    /// — an aggregated `positionOf(user)` was rejected on byte grounds.
    pub fn shares_of(&self, user: Address, adapter: Address) -> U256 {
        self.user_shares.get(user).get(adapter)
    }

    /// The denominator the frontend's valuation needs: purely exposes an existing internal
    /// storage read, no new logic.
    pub fn adapter_total_shares(&self, adapter: Address) -> U256 {
        self.adapter_total_shares.get(adapter)
    }

    /// The frontend already sources the adapter list from env vars and batches reads through
    /// multicall, so four scalar reads beat two dynamically-encoded arrays.
    pub fn weight_bps_of(&self, user: Address, adapter: Address) -> U256 {
        self.weight_bps.get(user).get(adapter)
    }

    /// Permissionless by design. The core PULLS the USDC from `msg.sender` and credits
    /// `user`, so crediting a third party is a gift, never a theft: an unbacked call reverts at
    /// the `transferFrom`. There is no gate and no `setPeriphery`: the Permit2 periphery is
    /// replaceable without touching the core.
    pub fn deposit_for(&mut self, user: Address, amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if amount.is_zero() {
            return Err(errors::zero_amount());
        }
        if user.is_zero() {
            return Err(errors::zero_address());
        }

        // No implicit fallback allocation exists. `user` bootstraps by calling
        // `rebalance(adapters, bps)` with a zero position first, which just writes their weights.
        // `user`'s OWN stored weights decide the split — never the caller's.
        let (targets, weights) = self.read_weights(user);
        if targets.is_empty() {
            return Err(errors::no_weights_set());
        }

        // Guard + snapshot BEFORE any mutating call (guard-before-mutate): weights pointing at a
        // disabled adapter must revert with nothing having moved, so no funds can strand in a
        // periphery mid-flow. Also protects against minting against a post-deposit total_assets,
        // which would dilute the depositor against their own funds.
        let mut ta_before: Vec<U256> = Vec::with_capacity(targets.len());
        for adapter in targets.iter() {
            if !self.adapter_enabled.get(*adapter) {
                return Err(errors::adapter_not_enabled());
            }
            ta_before.push(adapter_dispatch::total_assets(self.vm(), *adapter)?);
        }

        let self_addr = self.vm().contract_address();
        let payer = self.vm().msg_sender(); // the only line whose semantics change vs a caller-only deposit.
        let pull_ctx = Call::new_mutating(self);
        usdc::transfer_from(self.vm(), pull_ctx, USDC, payer, self_addr, amount)?;

        let slices = share_math::split_by_bps(amount, &weights)?;
        let mut minted_total = U256::ZERO;
        for i in 0..targets.len() {
            // Skip 0-value legs: a dust-sized slice would hit the adapter's ZeroAmount guard and
            // revert an otherwise valid deposit.
            if slices[i].is_zero() {
                continue;
            }
            minted_total += self.deposit_leg(user, targets[i], slices[i], ta_before[i])?;
        }
        if minted_total.is_zero() {
            return Err(errors::zero_shares());
        }

        self.vm().log(Deposit { user, assets: amount, shares: minted_total });
        Ok(minted_total)
    }

    /// Sugar over `deposit_for`: pay for yourself, credit yourself. One extra ABI entry, zero new
    /// logic.
    pub fn deposit(&mut self, amount: U256) -> Result<U256, Vec<u8>> {
        let caller = self.vm().msg_sender();
        self.deposit_for(caller, amount)
    }

    /// Withdrawal is denominated as a fraction of the caller's OWN position. `bps` = 10000 is
    /// a full exit. The frontend converts "take out $50" to bps off-chain, the same way it converts
    /// USDC to shares today. Every adapter has its own share price, so a single global share
    /// scalar does not exist in this model.
    pub fn redeem(&mut self, bps: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if bps.is_zero() || bps > TOTAL_BPS {
            return Err(errors::allocation_invalid());
        }
        let user = self.vm().msg_sender();
        let paid = self.unwind_position(user, bps)?;
        if paid.is_zero() {
            return Err(errors::zero_amount());
        }
        let transfer_ctx = Call::new_mutating(self);
        usdc::transfer(self.vm(), transfer_ctx, USDC, user, paid)?; // always to msg.sender

        self.vm().log(Redeem { user, bps, assets: paid });
        Ok(paid)
    }

    /// The ONLY public way to write weights: validates + stores the caller's new weights, fully
    /// unwinds THEIR OWN position and re-splits the measured proceeds across the new weights.
    /// With a zero position this degenerates to just writing weights — that is the bootstrap a
    /// new user runs before their first deposit.
    ///
    /// SECURITY: `proceeds` is the balance delta measured INSIDE `unwind_position` for this
    /// caller's legs only. This method must NEVER read `usdc::balance_of(core)` — under the
    /// per-user model that read is the theft vector: one caller would sweep the core's stranded
    /// surplus and other users' donations into their own position. Leftover USDC stays stranded
    /// and inert; it is a documented known limitation, not something a user path sweeps.
    pub fn rebalance(
        &mut self,
        adapters: Vec<Address>,
        new_weights: Vec<U256>,
    ) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        let user = self.vm().msg_sender();

        // Validate + write BEFORE the unwind, so an invalid weight set reverts before any external
        // call (guard-before-mutate).
        self.write_weights(user, adapters.clone(), new_weights.clone())?;

        // `proceeds` is ONLY the balance delta measured inside `unwind_position` for THIS
        // caller's legs. Never read `usdc::balance_of(core)` here — that would let this caller
        // sweep the core's stranded surplus and other users' donations into their own position.
        let proceeds = self.unwind_position(user, TOTAL_BPS)?;
        if proceeds.is_zero() {
            self.vm().log(Rebalanced { user, redeposited: U256::ZERO });
            return Ok(());
        }

        let slices = share_math::split_by_bps(proceeds, &new_weights)?;
        for i in 0..adapters.len() {
            if slices[i].is_zero() {
                continue;
            }
            // Snapshot AFTER the unwind: the unwind changed this adapter's total_assets.
            let ta_before = adapter_dispatch::total_assets(self.vm(), adapters[i])?;
            self.deposit_leg(user, adapters[i], slices[i], ta_before)?;
        }

        self.vm().log(Rebalanced { user, redeposited: proceeds });
        Ok(())
    }

    fn only_owner(&self) -> Result<(), Vec<u8>> {
        if self.vm().msg_sender() != self.owner.get() {
            return Err(errors::not_owner());
        }
        Ok(())
    }

    fn ensure_initialized(&self) -> Result<(), Vec<u8>> {
        if !self.initialized.get() {
            return Err(errors::not_initialized());
        }
        Ok(())
    }
}

/// Internal helpers live OUTSIDE the `#[public]` impl block. The `#[public]` macro exports
/// every method it wraps into the ABI regardless of Rust-level `pub`/private visibility (verified
/// against `stylus-proc`'s own `PublicImpl` — it does not filter by fn visibility), so un-`pub`ing
/// alone does not hide a method from `cargo stylus export-abi`. A plain, unannotated `impl` block
/// IS the only way to keep `unwind_position`, `deposit_leg`, `write_weights` and `read_weights`
/// callable internally while keeping them off the exported ABI surface.
impl VaultCore {
    /// Shared exit primitive for `redeem` and `rebalance`. Withdraws `bps_fraction`
    /// /10000 of `user`'s position, burns those shares, and returns the reconciled USDC the core
    /// actually gained.
    ///
    /// Iterates the FULL adapter registry filtered by `user_shares[user][adapter] != 0` —
    /// never `weightsOf(user)` and never the enabled set. A user who holds shares in an adapter the
    /// owner disabled (or that they dropped from their weights) must still be able to get out.
    ///
    /// `owed` is computed per adapter against `(adapter_total_shares[adapter],
    /// adapter.total_assets())`. There is no aggregate share price in this model.
    ///
    /// `user` is never a caller-supplied parameter: the public entrypoints always pass
    /// `self.vm().msg_sender()`, and this method is off the ABI (plain impl block).
    fn unwind_position(&mut self, user: Address, bps_fraction: U256) -> Result<U256, Vec<u8>> {
        let self_addr = self.vm().contract_address();
        let balance_before = usdc::balance_of(self.vm(), USDC, self_addr)?;

        let mut owed_total = U256::ZERO;
        for i in 0..self.adapters.len() {
            let Some(adapter) = self.adapters.get(i) else {
                continue;
            };
            let held = self.user_shares.get(user).get(adapter);
            if held.is_zero() {
                continue;
            }
            let slice_shares = if bps_fraction == TOTAL_BPS {
                held
            } else {
                share_math::mul_div_floor(held, bps_fraction, TOTAL_BPS)?
            };
            if slice_shares.is_zero() {
                continue;
            }
            let ts = self.adapter_total_shares.get(adapter);
            let ta = adapter_dispatch::total_assets(self.vm(), adapter)?;
            let owed = share_math::convert_to_assets(slice_shares, ts, ta, share_math::OFFSET_POW)?;

            // CEI: burn before the external withdraw. An atomic revert later restores these.
            self.user_shares.setter(user).setter(adapter).set(held - slice_shares);
            self.adapter_total_shares.setter(adapter).set(ts - slice_shares);

            // EVERY burned leg must be reconciled, skipped legs included. The burn above is
            // unconditional, so accumulating `owed` only inside the `if let` below would let a
            // fully-throttled leg (`max_withdraw() == 0` -> `unwind_request` returns None) shrink
            // the reconciliation target to match what was actually withdrawn: no shortfall, the
            // call succeeds, and the user's shares in that adapter are destroyed for nothing.
            // Accumulating first makes a skipped leg always trip the shortfall gate below and
            // revert the whole tx.
            owed_total += owed;
            let max = adapter_dispatch::max_withdraw(self.vm(), adapter)?;
            if let Some(request) = unwind_request(owed, max) {
                let withdraw_ctx = Call::new_mutating(self);
                adapter_dispatch::withdraw(self.vm(), withdraw_ctx, adapter, request)?; // bare ? = whole-tx atomicity
            }
        }

        let balance_after = usdc::balance_of(self.vm(), USDC, self_addr)?;
        // checked_sub: a compromised adapter moving USDC OUT of the core would wrap in release
        // builds, turning a loss into a huge delta that passes the shortfall gate.
        let actual_delta = balance_after
            .checked_sub(balance_before)
            .ok_or_else(|| errors::redeem_shortfall(owed_total, U256::ZERO))?;
        // Shortfall (including a throttled adapter that could only return part of `owed`) reverts
        // the whole tx; surplus is capped at `owed_total` and stays stranded in the core.
        share_math::reconcile_credit(owed_total, actual_delta)
    }

    /// Shared entry leg for `deposit` and `rebalance`'s re-split: approves + deposits `slice` into
    /// one adapter and mints the caller's shares against that adapter's OWN pre-call snapshot
    /// (`total_assets_before`) and its OWN `adapter_total_shares` (per-adapter offset).
    fn deposit_leg(
        &mut self,
        user: Address,
        adapter: Address,
        slice: U256,
        total_assets_before: U256,
    ) -> Result<U256, Vec<u8>> {
        let approve_ctx = Call::new_mutating(self);
        usdc::approve(self.vm(), approve_ctx, USDC, adapter, slice)?;
        let deposit_ctx = Call::new_mutating(self);
        adapter_dispatch::deposit(self.vm(), deposit_ctx, adapter, slice)?;

        // The exact allowance no longer has any reason to survive the call above — if the
        // adapter spent less than `slice`, the remainder would otherwise sit as a live allowance a
        // compromised adapter could later spend unprompted. Zeroed unconditionally, success path
        // only (a revert above never reaches here, so there is nothing to zero in the failure case).
        let zero_ctx = Call::new_mutating(self);
        usdc::approve(self.vm(), zero_ctx, USDC, adapter, U256::ZERO)?;

        let ts = self.adapter_total_shares.get(adapter);
        let minted = share_math::convert_to_shares(slice, ts, total_assets_before, share_math::OFFSET_POW)?;
        if minted.is_zero() {
            return Err(errors::zero_shares());
        }

        // The mint is priced against the requested `slice`, not against a measured delta —
        // the exit path (`unwind_position`) measures the real USDC delta, the entry path does not,
        // and that asymmetry silently dilutes existing holders whenever a protocol credits below
        // face value. Full symmetrization (a second `total_assets()` read per leg, post-deposit)
        // was rejected on byte budget; this guard converts the pathological case into a loud
        // revert instead of a silent one. It does NOT correct small rounding — that is documented
        // as an accepted tradeoff, reopened only if the dilution measured on the Sepolia rig
        // proves material.
        let value_back = share_math::convert_to_assets(
            minted,
            ts + minted,
            total_assets_before + slice,
            share_math::OFFSET_POW,
        )?;
        let floor = share_math::mul_div_floor(slice, DEPOSIT_TOLERANCE_BPS, TOTAL_BPS)?;
        if value_back < floor {
            return Err(errors::deposit_shortfall(slice, value_back));
        }

        let held = self.user_shares.get(user).get(adapter);
        self.user_shares.setter(user).setter(adapter).set(held + minted);
        self.adapter_total_shares.setter(adapter).set(ts + minted);
        Ok(minted)
    }

    /// Validates a caller's weight set (matching non-empty lengths, no duplicates, every
    /// target registered AND enabled, no zero weights, sum exactly 10000 via checked addition),
    /// then replaces that user's stored weights. Exiting a protocol = omitting it from `adapters`.
    /// Validation runs entirely BEFORE any write, so an invalid call reverts having touched
    /// nothing (guard-before-mutate).
    fn write_weights(
        &mut self,
        user: Address,
        adapters: Vec<Address>,
        weights_bps: Vec<U256>,
    ) -> Result<(), Vec<u8>> {
        if adapters.is_empty() || adapters.len() != weights_bps.len() {
            return Err(errors::allocation_invalid());
        }
        for i in 0..adapters.len() {
            for j in (i + 1)..adapters.len() {
                if adapters[i] == adapters[j] {
                    return Err(errors::allocation_invalid());
                }
            }
        }
        let mut sum = U256::ZERO;
        for i in 0..adapters.len() {
            if !registry::is_registered(self, adapters[i]) {
                return Err(errors::adapter_not_registered());
            }
            if !self.adapter_enabled.get(adapters[i]) {
                return Err(errors::adapter_not_enabled());
            }
            if weights_bps[i].is_zero() {
                return Err(errors::allocation_invalid());
            }
            sum = sum
                .checked_add(weights_bps[i])
                .ok_or_else(errors::allocation_invalid)?;
        }
        if sum != TOTAL_BPS {
            return Err(errors::allocation_invalid());
        }

        // Clear the caller's previous set so the stored weights are EXACTLY the passed set.
        let previous = self.weight_targets.get(user).len();
        for i in 0..previous {
            if let Some(old) = self.weight_targets.get(user).get(i) {
                self.weight_bps.setter(user).setter(old).set(U256::ZERO);
            }
        }
        self.weight_targets.setter(user).erase();

        for i in 0..adapters.len() {
            self.weight_targets.setter(user).push(adapters[i]);
            self.weight_bps.setter(user).setter(adapters[i]).set(weights_bps[i]);
        }
        Ok(())
    }

    /// Reads the caller's stored weights back as two parallel Vecs. An empty target list means
    /// "no weights set" — `deposit` turns that into `NoWeightsSet`.
    fn read_weights(&self, user: Address) -> (Vec<Address>, Vec<U256>) {
        let len = self.weight_targets.get(user).len();
        let mut targets: Vec<Address> = Vec::with_capacity(len);
        let mut bps: Vec<U256> = Vec::with_capacity(len);
        for i in 0..len {
            if let Some(adapter) = self.weight_targets.get(user).get(i) {
                targets.push(adapter);
                bps.push(self.weight_bps.get(user).get(adapter));
            }
        }
        (targets, bps)
    }
}
```

## Source: `vault-core/src/lib.rs` (storage layout, for context)

```rust
//! VaultCore: the USDC-denominated aggregator contract sitting above 4 `VaultAdapter` instances
//! (Morpho, Fluid, Euler, Aave-via-Stata). Custodies USDC, splits each caller's deposit across
//! THEIR OWN stored weights — there is no owner-set global allocation), mints per-(user, adapter)
//! internal shares (non-transferable), and redeems a bps fraction of a caller's own position back
//! to USDC. The core never touches a lending protocol directly — it only ever calls the
//! adapter's frozen 5-function interface.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod adapter_dispatch;
mod core;
mod errors;
mod registry;
mod share_math;
mod usdc;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use core::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct VaultCore {
        /// Contract owner, set once at init. No transferOwnership in this phase's scope.
        address owner;
        /// One-shot init guard.
        bool initialized;

        /// Dynamic adapter registry. Index order is the iteration order used by the
        /// split-by-bps remainder rule (index 0 = "first active adapter").
        address[] adapters;
        mapping(address => bool) adapter_enabled;

        /// Per-(user, adapter) internal share ledger. Non-transferable.
        /// Invariant: for every adapter, sum over users of user_shares[user][adapter]
        /// == adapter_total_shares[adapter].
        mapping(address => mapping(address => uint256)) user_shares;
        /// Shares minted per adapter — the per-adapter denominator of the virtual
        /// offset. There is no aggregate share price in this model: every adapter has its own.
        mapping(address => uint256) adapter_total_shares;

        /// The caller's stored weight preference. `weight_targets[user]` is the ordered
        /// adapter list a deposit splits over; `weight_bps[user][adapter]` is that adapter's bps.
        /// Written ONLY by `rebalance` — there is no `set_weights` and no owner-level allocation.
        mapping(address => address[]) weight_targets;
        mapping(address => mapping(address => uint256)) weight_bps;
    }
}
```

## Source: `vault-core/src/registry.rs`

```rust
//! Owner-controlled adapter registry helpers. Pure storage-mutation/query helpers
//! operating on `&VaultCore`/`&mut VaultCore`, called from `core.rs`'s `#[public]` methods after
//! the `ensure_initialized()?`/`only_owner()?` guards have already run (guard-before-mutate).
//!
//! There is no removal helper here: `remove_adapter` was deliberately removed from `core.rs` —
//! `set_enabled(false)` is the only way to take an adapter out of new-deposit rotation, and the
//! registry array itself never shrinks. See `core.rs`'s `set_enabled` doc-comment for the
//! reasoning.

use alloy_primitives::Address;

use crate::VaultCore;

/// True if `adapter` is present in the registry (regardless of enabled/disabled state).
pub fn is_registered(core: &VaultCore, adapter: Address) -> bool {
    index_of(core, adapter).is_some()
}

/// Index of `adapter` in the `adapters` array, if registered.
pub fn index_of(core: &VaultCore, adapter: Address) -> Option<usize> {
    for i in 0..core.adapters.len() {
        if core.adapters.get(i) == Some(adapter) {
            return Some(i);
        }
    }
    None
}
```

## Source: `vault-core/src/adapter_dispatch.rs`

```rust
//! `sol!` bare-fn bindings + manual dispatch to `VaultAdapter`'s frozen 5-function ABI. Mirrors
//! `vault-adapter/src/erc4626.rs`'s dispatch shape exactly, retargeted at the adapter's own
//! selectors. The struct-shaped-calldata Stylus macro (`sol` + `_interface` + `!`, spelled out to
//! avoid this file matching the crate-wide grep ban) is unconditionally banned in this workspace
//! (ADR 001) — the wrong-selector bug for struct-shaped calldata was proven in a spike elsewhere
//! in the program; the core inherits the ban even though none of these 5 functions take struct
//! params.
//!
//! Selectors verified via `cast sig`, cross-checked against the adapter's actual Rust signatures
//! in `vault-adapter/src/adapter.rs`.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::{call, static_call};
use stylus_sdk::prelude::Call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

use crate::errors;

sol! {
    // cast sig "deposit(uint256)" = 0xb6b55f25
    function deposit(uint256 usdcAmount) external returns (uint256 shares);
    // cast sig "withdraw(uint256)" = 0x2e1a7d4d
    function withdraw(uint256 usdcAmount) external returns (uint256 sharesBurned);
    // cast sig "totalAssets()" = 0x01e1d114
    function totalAssets() external view returns (uint256);
    // cast sig "maxWithdraw()" = 0xac7a1b5b
    function maxWithdraw() external view returns (uint256);
}

fn decode_error(_err: alloy_sol_types::Error) -> Vec<u8> {
    errors::adapter_decode_failed()
}

/// Calls `adapter.deposit(usdc_amount)`. Returns the shares minted (adapter-side custody).
pub fn deposit(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    adapter: Address,
    usdc_amount: U256,
) -> Result<U256, Vec<u8>> {
    let calldata = depositCall { usdcAmount: usdc_amount }.abi_encode();
    let result = call(vm, call_ctx, adapter, &calldata)?;
    depositCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Calls `adapter.withdraw(usdc_amount)`. Returns the shares burned.
pub fn withdraw(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    adapter: Address,
    usdc_amount: U256,
) -> Result<U256, Vec<u8>> {
    let calldata = withdrawCall { usdcAmount: usdc_amount }.abi_encode();
    let result = call(vm, call_ctx, adapter, &calldata)?;
    withdrawCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `adapter.totalAssets()`.
pub fn total_assets(vm: &impl Host, adapter: Address) -> Result<U256, Vec<u8>> {
    let calldata = totalAssetsCall {}.abi_encode();
    let result = static_call(vm, Call::new(), adapter, &calldata)?;
    totalAssetsCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `adapter.maxWithdraw()`.
pub fn max_withdraw(vm: &impl Host, adapter: Address) -> Result<U256, Vec<u8>> {
    let calldata = maxWithdrawCall {}.abi_encode();
    let result = static_call(vm, Call::new(), adapter, &calldata)?;
    maxWithdrawCall::abi_decode_returns(&result).map_err(decode_error)
}
```

## Source: `vault-core/src/usdc.rs`

```rust
//! USDC (external ERC-20) binding: `approve`/`transferFrom`/`transfer`/`balanceOf`. Mirrors
//! `vault-adapter/src/erc20.rs`'s bare `sol!` + manual dispatch shape and its shared
//! tri-state return-value rule exactly — no second convention. `transfer` is
//! the one addition the adapter's erc20 module lacks: the core->user payout used in redeem.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::{call, static_call};
use stylus_sdk::prelude::Call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

use crate::errors;

sol! {
    // cast sig "approve(address,uint256)" = 0x095ea7b3
    function approve(address spender, uint256 amount) external returns (bool);
    // cast sig "transferFrom(address,address,uint256)" = 0x23b872dd
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // cast sig "transfer(address,uint256)" = 0xa9059cbb
    function transfer(address to, uint256 amount) external returns (bool);
    // cast sig "balanceOf(address)" = 0x70a08231
    function balanceOf(address account) external view returns (uint256);
}

/// Tri-state return decoding shared by `approve`/`transfer_from`/`transfer`:
/// - empty buffer -> success (non-standard tokens that return nothing)
/// - decodes to `true` -> success
/// - decodes to `false` -> `Err(TransferFailed)` (the classic non-reverting-failure trap)
/// - any other shape -> `Err(TransferFailed)` (never silently treated as success)
fn decode_bool_result(result: &[u8]) -> Result<(), Vec<u8>> {
    if result.is_empty() {
        return Ok(());
    }
    match <bool as alloy_sol_types::SolValue>::abi_decode(result) {
        Ok(true) => Ok(()),
        Ok(false) => Err(errors::transfer_failed()),
        Err(_) => Err(errors::transfer_failed()),
    }
}

/// Approves `spender` to move `amount` of `token` on the core's behalf.
pub fn approve(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    token: Address,
    spender: Address,
    amount: U256,
) -> Result<(), Vec<u8>> {
    let calldata = approveCall { spender, amount }.abi_encode();
    let result = call(vm, call_ctx, token, &calldata)?;
    decode_bool_result(&result)
}

/// Pulls `amount` of `token` from `from` to `to` under a pre-existing allowance.
pub fn transfer_from(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    token: Address,
    from: Address,
    to: Address,
    amount: U256,
) -> Result<(), Vec<u8>> {
    let calldata = transferFromCall { from, to, amount }.abi_encode();
    let result = call(vm, call_ctx, token, &calldata)?;
    decode_bool_result(&result)
}

/// Sends `amount` of `token` directly to `to` (core -> user payout, redeem's path).
pub fn transfer(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    token: Address,
    to: Address,
    amount: U256,
) -> Result<(), Vec<u8>> {
    let calldata = transferCall { to, amount }.abi_encode();
    let result = call(vm, call_ctx, token, &calldata)?;
    decode_bool_result(&result)
}

/// Reads `token.balanceOf(account)`.
pub fn balance_of(vm: &impl Host, token: Address, account: Address) -> Result<U256, Vec<u8>> {
    let calldata = balanceOfCall { account }.abi_encode();
    let result = static_call(vm, Call::new(), token, &calldata)?;
    balanceOfCall::abi_decode_returns(&result).map_err(|_| errors::adapter_decode_failed())
}
```

## Source: `vault-core/src/errors.rs`

```rust
//! Typed custom errors for `VaultCore`, `sol!`-declared and abi-encoded into the `Vec<u8>` revert
//! payload — same idiom as `vault-adapter/src/errors.rs`.
//!
//! Most payload-less conditions are collapsed into one coded error, `VaultError(uint8 code)`, to
//! reclaim ABI-selector/dispatch bytes. Codes are stable and assigned in the declaration order the
//! errors used to appear in, listed here so a consumer (frontend, e2e stubs, an auditor reading a
//! revert) can decode `VaultError(uint8)` and look up what it means without re-deriving the
//! mapping from git history:
//!
//! | Code | Condition               | Wrapper (unchanged name)   |
//! |------|--------------------------|-----------------------------|
//! | 1    | `AlreadyInitialized`    | `already_initialized()`     |
//! | 2    | `NotInitialized`        | `not_initialized()`         |
//! | 3    | `ZeroAddress`           | `zero_address()`            |
//! | 4    | `NotOwner`              | `not_owner()`                |
//! | 5    | `ZeroAmount`            | `zero_amount()`              |
//! | 6    | `ZeroShares`            | `zero_shares()`              |
//! | 7    | `AllocationInvalid`     | `allocation_invalid()`       |
//! | 8    | `AdapterNotEnabled`     | `adapter_not_enabled()`      |
//! | 9    | `DivisionByZero`        | `division_by_zero()`        |
//! | 10   | `MulDivOverflow`        | `mul_div_overflow()`        |
//! | 11   | `ShareMathOverflow`     | `share_math_overflow()`     |
//! | 12   | `AdapterDecodeFailed`   | `adapter_decode_failed()`   |
//! | 13   | `TransferFailed`        | `transfer_failed()`         |
//! | 14   | `AdapterAlreadyRegistered` | `adapter_already_registered()` |
//! | 15   | `AdapterNotRegistered`  | `adapter_not_registered()`  |
//! | 16   | `NoWeightsSet`          | `no_weights_set()`          |
//!
//! `AdapterHasBalance(uint256)` and `RedeemShortfall(uint256, uint256)` carry diagnostic payload
//! and stay typed — only the payload-less ones are in scope for the collapse.

use alloc::vec::Vec;

use alloy_primitives::U256;
use alloy_sol_types::{sol, SolError};

sol! {
    error VaultError(uint8 code);
    error AdapterHasBalance(uint256 totalAssets);
    error RedeemShortfall(uint256 owed, uint256 actual);
    error DepositShortfall(uint256 requested, uint256 credited);
}

fn coded(code: u8) -> Vec<u8> {
    VaultError { code }.abi_encode()
}

pub fn already_initialized() -> Vec<u8> {
    coded(1)
}

pub fn not_initialized() -> Vec<u8> {
    coded(2)
}

pub fn zero_address() -> Vec<u8> {
    coded(3)
}

pub fn not_owner() -> Vec<u8> {
    coded(4)
}

pub fn zero_amount() -> Vec<u8> {
    coded(5)
}

pub fn zero_shares() -> Vec<u8> {
    coded(6)
}

pub fn allocation_invalid() -> Vec<u8> {
    coded(7)
}

pub fn adapter_not_enabled() -> Vec<u8> {
    coded(8)
}

pub fn adapter_has_balance(total_assets: U256) -> Vec<u8> {
    AdapterHasBalance { totalAssets: total_assets }.abi_encode()
}

pub fn division_by_zero() -> Vec<u8> {
    coded(9)
}

pub fn mul_div_overflow() -> Vec<u8> {
    coded(10)
}

pub fn share_math_overflow() -> Vec<u8> {
    coded(11)
}

pub fn adapter_decode_failed() -> Vec<u8> {
    coded(12)
}

pub fn transfer_failed() -> Vec<u8> {
    coded(13)
}

pub fn adapter_already_registered() -> Vec<u8> {
    coded(14)
}

pub fn adapter_not_registered() -> Vec<u8> {
    coded(15)
}

pub fn redeem_shortfall(owed: U256, actual: U256) -> Vec<u8> {
    RedeemShortfall { owed, actual }.abi_encode()
}

pub fn no_weights_set() -> Vec<u8> {
    coded(16)
}

/// `deposit_leg`'s cheap guard: the shares minted for a deposit leg reconvert to less
/// than the tolerated fraction of the requested slice. Carries diagnostic payload (the e2e suite
/// reads `credited` to measure the actual dilution), so this stays typed rather than folded into
/// `VaultError`.
pub fn deposit_shortfall(requested: U256, credited: U256) -> Vec<u8> {
    DepositShortfall { requested, credited }.abi_encode()
}
```

## Build config relevant to this bundle

`vault-core/Cargo.toml` (features):

```toml
[features]
# SECURITY: never enable `stylus-sdk/reentrant`. The contract's reentrancy safety is
# load-bearing on cross-contract reentrancy being impossible: `deposit` snapshots each adapter's
# `total_assets` BEFORE any mutating call and mints against that snapshot, which a reentrant
# callback could skew. There is no reentrancy guard because, with the feature off, none is needed.
default = ["mini-alloc"]
export-abi = ["stylus-sdk/export-abi"]
debug = ["stylus-sdk/debug"]
mini-alloc = ["stylus-sdk/mini-alloc"]
# Swaps the compiled USDC constant to the Sepolia MockUsdc address. Testnet fixture builds only —
# never deploy a `--features testnet` artifact to mainnet.
testnet = []
```

Workspace `Cargo.toml` release profile (applies to every crate in this workspace, including this
one):

```toml
[profile.release]
opt-level = "z"
lto = true
panic = "abort"
codegen-units = 1
strip = true
# Money-path arithmetic (ledger burn/mint, owed accumulation) must revert on overflow,
# never wrap silently. The explicit checked_* calls stay for the paths that need a typed error;
# this is the safety net for everything else. Byte cost measured separately.
overflow-checks = true
```

---

## Reasoning tools

# Senior Auditor's Mindset

This is how a senior auditor thinks. Pattern-matching catches the obvious bugs — your specialty file teaches that. The high-value bugs, the ones everyone else misses, come from HOW you reason about code, not from WHAT bugs you know.

The senior auditor's edge is not "knowing more bug patterns" — it is having internalized mental tools they reach for instinctively when something feels off, when a path seems clean, or when a conclusion comes too quickly.

This file gives you three tools. They are not steps. You reach for the right one the moment the trigger fires. Use them. Trust your discomfort.

A finding is not real until you've traced the attack with concrete values. You are an attacker, not a defender — when you find a bug, deepen the attack; never argue yourself out of one.

---

## 1. The Feynman test (FIRST — use it before anything else)

**This is the first tool. Apply it the moment you open any new function or contract — before you reason about anything else.** Code you have not Feynman'd is code you have not actually understood.

When you read code, STOP and ask: "Can I explain what this function does to someone who doesn't know Solidity?"

Try it. In plain words. The places where your explanation gets fuzzy — where you reach for jargon instead of plain meaning — are where you're papering over an assumption. That's where bugs hide.

A senior auditor doesn't trust their understanding until they can explain it without the safety net of technical vocabulary.

---

## 2. Socratic questioning

For every line of code, ask: why is this here? What does it assume? What happens if the assumption breaks?

Don't accept "because that's how it's written" as an answer. Don't accept "the function name says so" as an answer. Drill until you reach the implicit belief the code rests on. The first answer is usually a restatement. The actual assumption is two or three "whys" deeper.

A senior auditor accepts no "because" without examining it.

---

## 3. Inversion

Every clean path gets a backward pass. After you understand what the code IS supposed to do, ask: how would I make it NOT do that?

Same code, attacker's eye instead of developer's eye. The developer asks "does this work?" The attacker asks "how do I break this?" Read every check and ask "what value slips past it?" Read every state update and ask "what state am I in just before this?"

A senior auditor never reads code only forward.

---

## When to reach for which tool

You don't apply these in order — except Feynman, which is always first. You reach for what the moment calls for:

- Opening any new function or contract → **Feynman** (always — before anything else)
- Trying to understand a line you don't yet → **Socratic**
- Something looks too clean → **Inversion**
- You reached a "bug" conclusion → amplify the attack (chain it, find more victims, lower the precondition cost — do NOT refute it)

Trust your discomfort. Reach for the tool. Don't stop until the discomfort has a name.

### Mental tool protocol — MANDATORY

The three tools above are NOT optional. Each has a trigger. When the trigger fires, emit the marker `[Tool: ...]` in your working text BEFORE continuing (not inside FINDING/LEAD blocks):

| Trigger | Marker | Content |
|---|---|---|
| You open a new function or contract to read | `[Feynman: <name>]` | Explain what it does in plain English — no jargon. |
| You stop on a line whose purpose isn't immediately clear | `[Socratic: <file:line> — why?]` | A one-line question that drills past "because that's how it's written." |
| A code path reads as clean / a check looks sufficient | `[Inversion: <function>]` | Three concrete attacker moves that attempt to defeat the path, with specific values. |

## Assigned agents for this bundle

Attack this bundle from these four lenses (the specialty definitions live at
`.claude/skills/solidity-auditor/references/hacking-agents/<name>-agent.md` — adapt the
Solidity-specific vocabulary in those files to Rust/Stylus mechanically: `msg.sender` ==
`self.vm().msg_sender()`, `revert` == `Result::Err`, `external call` == `stylus_sdk::call::call`
/ `static_call`, storage mapping == `sol_storage!` mapping):

1. **access-control-agent** — who can call what, and against whose funds/state.
2. **execution-trace-agent** — trace `deposit_for` / `redeem` / `rebalance` / `unwind_position`
   end to end, state change by state change.
3. **asymmetry-agent** — compare the entry path (`deposit_leg`, priced against a requested slice)
   against the exit path (`unwind_position`, priced against a measured balance delta). Two paths
   that value the same position differently is exactly the shape to hunt.
4. **flow-gap-agent** — look for accounting that happens outside conditionals that later gate on
   related state (`owed_total` accumulates unconditionally while the withdraw call that is
   supposed to realize it is conditional).
