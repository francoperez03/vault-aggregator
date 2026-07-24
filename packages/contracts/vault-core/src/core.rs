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

/// Native USDC on Arbitrum One (D-02: the aggregator is USDC-only). Compile-time constant.
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

/// Total basis-points an allocation must sum to exactly (D-06).
const TOTAL_BPS: U256 = U256::from_limbs([10_000u64, 0, 0, 0]);

/// WR-02's cheap deposit guard: the reconverted value of the minted shares must be worth at least
/// 9,900/10,000 (1% tolerance) of the requested slice, or `deposit_leg` reverts `DepositShortfall`.
/// The MockVault `deposit_credit_bps` knob (Plan 03) is what exercises this guard in tests; the
/// dilution number measured e2e (Plan 08) is what justifies keeping 100 bps or reopens the guard.
const DEPOSIT_TOLERANCE_BPS: U256 = U256::from_limbs([9_900u64, 0, 0, 0]);

sol! {
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Redeem(address indexed user, uint256 bps, uint256 assets);
    event Rebalanced(address indexed user, uint256 redeposited);
}

/// D-09b: the amount to unwind from one adapter is `min(total_assets, max_withdraw)` (the adapter
/// exposes only exact `withdraw(usdc)`, and `withdraw(total_assets)` can round above `max_withdraw`).
/// Returns None when that amount is zero — a fully-throttled or empty adapter must be SKIPPED, not
/// called with 0 (the adapter reverts ZeroAmount on a zero-amount withdraw, which would wrongly trip
/// D-10 atomicity on a merely-illiquid protocol).
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
    /// user's own `rebalance` call (D-01/D-02) — there is no owner-level allocation. D-07 dynamic
    /// registry.
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
    /// D-11: disabling is allowed WITH an open position. It blocks new money in (a disabled
    /// adapter cannot be a weight target, and `deposit` re-checks `adapter_enabled` per leg) but
    /// never blocks money out: `redeem` and `rebalance`'s unwind iterate the FULL registry filtered
    /// by held shares, so nobody can be locked inside a disabled adapter.
    ///
    /// There is no `removeAdapter`. Tier 2 (Phase 13 D-18 spike) deleted it deliberately: the guard
    /// it used to carry (WR-01, "don't strand a position by removing a still-live adapter from the
    /// registry") only exists because the function existed. Deleting `remove_adapter` retires the
    /// WR-01 finding instead of mitigating it — `set_enabled(false)` already covers the operational
    /// case, and D-11 guarantees a disabled adapter's position is always reachable via `redeem`/
    /// `rebalance`. This is the exact text Phase 13b's security checklist cites for WR-01's status.
    pub fn set_enabled(&mut self, adapter: Address, enabled: bool) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;
        if !registry::is_registered(self, adapter) {
            return Err(errors::adapter_not_registered());
        }
        self.adapter_enabled.setter(adapter).set(enabled);
        Ok(())
    }

    /// D-08: the caller-facing read of one user's position in one adapter, in internal shares.
    /// The USDC value is built off-chain by the frontend as
    /// sharesOf(user, adapter) / adapterTotalShares(adapter) * adapter.totalAssets()
    /// — an aggregated `positionOf(user)` was rejected on byte grounds.
    pub fn shares_of(&self, user: Address, adapter: Address) -> U256 {
        self.user_shares.get(user).get(adapter)
    }

    /// The denominator the frontend's valuation needs (D-20, F14 blocking): purely exposes an
    /// existing internal storage read, no new logic.
    pub fn adapter_total_shares(&self, adapter: Address) -> U256 {
        self.adapter_total_shares.get(adapter)
    }

    /// D-08 + F14 D-23/D-25: the frontend already sources the adapter list from env vars and
    /// batches reads through multicall, so four scalar reads beat two dynamically-encoded arrays.
    /// Replaces the old `weightsOf(user) -> (address[], uint256[])`.
    pub fn weight_bps_of(&self, user: Address, adapter: Address) -> U256 {
        self.weight_bps.get(user).get(adapter)
    }

    /// D-19: permissionless by design. The core PULLS the USDC from `msg.sender` and credits
    /// `user`, so crediting a third party is a gift, never a theft: an unbacked call reverts at
    /// the `transferFrom`. This is deliberately NOT CoinFlip's gated `betFor` — there a fabricated
    /// bet is bounded by the pool and settled by VRF; here the ledger is title over other users'
    /// custodied USDC, so no address gets the privilege of declaring an `amount` the core
    /// believes. There is no gate and no `setPeriphery`: the Permit2 periphery is replaceable
    /// without touching the core.
    pub fn deposit_for(&mut self, user: Address, amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if amount.is_zero() {
            return Err(errors::zero_amount());
        }
        if user.is_zero() {
            return Err(errors::zero_address());
        }

        // D-01: no implicit fallback allocation exists. `user` bootstraps by calling
        // `rebalance(adapters, bps)` with a zero position first, which just writes their weights.
        // `user`'s OWN stored weights decide the split — never the caller's.
        let (targets, weights) = self.read_weights(user);
        if targets.is_empty() {
            return Err(errors::no_weights_set());
        }

        // Guard + snapshot BEFORE any mutating call (guard-before-mutate): T-13-06/D-19 residual
        // risk #2 requires that weights pointing at a disabled adapter revert with nothing having
        // moved, so no funds can strand in a periphery mid-flow. Also protects against minting
        // against a post-deposit total_assets, which would dilute the depositor against their own
        // funds.
        let mut ta_before: Vec<U256> = Vec::with_capacity(targets.len());
        for adapter in targets.iter() {
            if !self.adapter_enabled.get(*adapter) {
                return Err(errors::adapter_not_enabled());
            }
            ta_before.push(adapter_dispatch::total_assets(self.vm(), *adapter)?);
        }

        let self_addr = self.vm().contract_address();
        let payer = self.vm().msg_sender(); // T-13-05: the only line whose semantics change vs the old caller-only deposit.
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

    /// D-07: withdrawal is denominated as a fraction of the caller's OWN position. `bps` = 10000 is
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
        usdc::transfer(self.vm(), transfer_ctx, USDC, user, paid)?; // always to msg.sender (F12 D-02)

        self.vm().log(Redeem { user, bps, assets: paid });
        Ok(paid)
    }

    /// VAULT-03, user-scoped. The ONLY public way to write weights (D-02): validates + stores the
    /// caller's new weights, fully unwinds THEIR OWN position (D-09) and re-splits the measured
    /// proceeds across the new weights. With a zero position this degenerates to just writing
    /// weights — that is the D-01 bootstrap a new user runs before their first deposit.
    ///
    /// SECURITY (D-10): `proceeds` is the balance delta measured INSIDE `unwind_position` for this
    /// caller's legs only. This method must NEVER read `usdc::balance_of(core)` — the old
    /// owner-only rebalance did exactly that (F12, `core.rs:323`), and under the per-user model that
    /// read is the theft vector: one caller would sweep the core's stranded surplus (F12 D-07 caps)
    /// and other users' donations into their own position. Leftover USDC stays stranded and inert;
    /// it is a documented known issue for the Phase 13 checklist, not something a user path sweeps.
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

        // D-10: `proceeds` is ONLY the balance delta measured inside `unwind_position` for THIS
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

/// D-13: internal helpers live OUTSIDE the `#[public]` impl block. The `#[public]` macro exports
/// every method it wraps into the ABI regardless of Rust-level `pub`/private visibility (verified
/// against `stylus-proc`'s own `PublicImpl` — it does not filter by fn visibility), so un-`pub`ing
/// alone does not hide a method from `cargo stylus export-abi`. A plain, unannotated `impl` block
/// IS the only way to keep `unwind_position`, `deposit_leg`, `write_weights` and `read_weights`
/// callable internally while keeping them off the exported ABI surface.
impl VaultCore {
    /// Shared exit primitive for `redeem` and `rebalance` (D-07/D-09). Withdraws `bps_fraction`
    /// /10000 of `user`'s position, burns those shares, and returns the reconciled USDC the core
    /// actually gained.
    ///
    /// D-11: iterates the FULL adapter registry filtered by `user_shares[user][adapter] != 0` —
    /// never `weightsOf(user)` and never the enabled set. A user who holds shares in an adapter the
    /// owner disabled (or that they dropped from their weights) must still be able to get out.
    ///
    /// D-06: `owed` is computed per adapter against `(adapter_total_shares[adapter],
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
            // revert the whole tx (D-09/KI-02, inherited F12 D-06 atomicity).
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
        // the whole tx; surplus is capped at `owed_total` and stays stranded in the core (D-10).
        share_math::reconcile_credit(owed_total, actual_delta)
    }

    /// Shared entry leg for `deposit` and `rebalance`'s re-split: approves + deposits `slice` into
    /// one adapter and mints the caller's shares against that adapter's OWN pre-call snapshot
    /// (`total_assets_before`) and its OWN `adapter_total_shares` (D-06 per-adapter offset).
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

        // WR-03: the exact allowance no longer has any reason to survive the call above — if the
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

        // WR-02: the mint is priced against the requested `slice`, not against a measured delta —
        // the exit path (`unwind_position`) measures the real USDC delta, the entry path does not,
        // and that asymmetry silently dilutes existing holders whenever a protocol credits below
        // face value. Full symmetrization (a second `total_assets()` read per leg, post-deposit)
        // was rejected on byte budget (D-13/Phase 13 D-18 spike); this guard converts the
        // pathological case into a loud revert instead of a silent one. It does NOT correct small
        // rounding — that is documented as accepted-with-reason (Phase 13's checklist), reopened
        // only if the dilution measured on the Sepolia rig (Plan 08) proves material.
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

    /// D-04: validates a caller's weight set (matching non-empty lengths, no duplicates, every
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
    /// "no weights set" — `deposit` turns that into `NoWeightsSet` (D-01).
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

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::{SolCall, SolValue};
    use stylus_sdk::testing::TestVM;

    // Local mirrors of adapter_dispatch.rs/usdc.rs's `sol!` bindings, so this module can compute
    // exact calldata to match against `TestVM::mock_call`/`mock_static_call` without depending on
    // those modules' private generated types (same idiom as `vault-adapter/src/adapter.rs`'s test
    // module).
    sol! {
        function totalAssets() external view returns (uint256);
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function deposit(uint256 usdcAmount) external returns (uint256 shares);
        function withdraw(uint256 usdcAmount) external returns (uint256 sharesBurned);
        function transfer(address to, uint256 amount) external returns (bool);
        function balanceOf(address account) external view returns (uint256);
        function maxWithdraw() external view returns (uint256);
    }

    fn owner_addr() -> Address {
        Address::from([0x22; 20])
    }

    fn user_addr() -> Address {
        Address::from([0x33; 20])
    }

    fn non_owner_addr() -> Address {
        Address::from([0x44; 20])
    }

    fn attacker_addr() -> Address {
        Address::from([0x66; 20])
    }

    fn victim_addr() -> Address {
        Address::from([0x77; 20])
    }

    fn adapter_addr() -> Address {
        Address::from([0x11; 20])
    }

    fn contract_addr() -> Address {
        Address::from([0x99; 20])
    }

    fn deploy(vm: &TestVM) -> VaultCore {
        vm.set_contract_address(contract_addr());
        VaultCore::from(vm)
    }

    fn deploy_and_init(vm: &TestVM) -> VaultCore {
        let mut contract = deploy(vm);
        vm.set_sender(owner_addr());
        contract.init(owner_addr()).unwrap();
        contract
    }

    // --- init ---

    #[test]
    fn init_succeeds_and_sets_storage() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        assert!(contract.init(owner_addr()).is_ok());
        assert_eq!(contract.owner.get(), owner_addr());
        assert!(contract.initialized.get());
    }

    #[test]
    fn init_twice_reverts_already_initialized() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        contract.init(owner_addr()).unwrap();
        let err = contract.init(owner_addr());
        assert_eq!(err.unwrap_err(), errors::already_initialized());
    }

    #[test]
    fn init_zero_owner_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        let err = contract.init(Address::ZERO);
        assert_eq!(err.unwrap_err(), errors::zero_address());
    }

    // --- add_adapter ---

    #[test]
    fn add_adapter_owner_only() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(non_owner_addr());
        let err = contract.add_adapter(adapter_addr());
        assert_eq!(err.unwrap_err(), errors::not_owner());
    }

    #[test]
    fn add_adapter_succeeds_for_owner() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(owner_addr());
        assert!(contract.add_adapter(adapter_addr()).is_ok());
        assert!(contract.adapter_enabled.get(adapter_addr()));
    }

    // --- deposit ---

    fn deploy_init_and_seed_adapter(vm: &TestVM) -> VaultCore {
        let mut contract = deploy_and_init(vm);
        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_addr()).unwrap();
        contract
    }

    #[test]
    fn deposit_zero_reverts_zero_amount() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(user_addr());
        let err = contract.deposit(U256::ZERO);
        assert_eq!(err.unwrap_err(), errors::zero_amount());
    }

    #[test]
    fn deposit_without_weights_reverts_no_weights_set() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        // D-01: no USDC mock is registered at all (no `transferFrom` mock on `USDC`). `deposit`
        // reads the caller's weights and reverts `NoWeightsSet` BEFORE ever calling
        // `usdc::transfer_from` — if the guard order regressed and the pull ran first, this call
        // would panic on an unmocked external call instead of returning a clean `Err`, so a normal
        // `Err(NoWeightsSet)` here is itself the proof that the revert precedes the pull.
        vm.set_sender(user_addr());
        let err = contract.deposit(U256::from(1_000_000u64));
        assert_eq!(err.unwrap_err(), errors::no_weights_set());
    }

    #[test]
    fn deposit_mints_nonzero_shares() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        contract
            .write_weights(user_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);

        let total_assets_calldata = totalAssetsCall {}.abi_encode();
        vm.mock_static_call(adapter_addr(), total_assets_calldata, Ok(U256::ZERO.abi_encode()));

        let transfer_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));

        let approve_calldata = approveCall {
            spender: adapter_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));

        let deposit_calldata = depositCall { usdcAmount: amount }.abi_encode();
        vm.mock_call(adapter_addr(), deposit_calldata, U256::ZERO, Ok(amount.abi_encode()));

        vm.set_sender(user_addr());
        let shares = contract.deposit(amount).unwrap();
        assert!(!shares.is_zero());
        assert_eq!(contract.shares_of(user_addr(), adapter_addr()), shares);
        assert_eq!(contract.adapter_total_shares.get(adapter_addr()), shares);
    }

    // --- deposit_leg: WR-02 cheap guard + WR-03 allowance zeroing ---

    #[test]
    fn deposit_leg_accepts_full_credit() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        contract
            .write_weights(user_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let transfer_calldata = transferFromCall { from: user_addr(), to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), amount);
        let zero_approve = approveCall { spender: adapter_addr(), amount: U256::ZERO }.abi_encode();
        vm.mock_call(USDC, zero_approve, U256::ZERO, Ok(true.abi_encode()));

        vm.set_sender(user_addr());
        let shares = contract.deposit(amount).unwrap();
        assert!(!shares.is_zero());
    }

    /// WR-02: an adapter that credits (reconverts to) less than 99% of the requested slice must
    /// revert `DepositShortfall`, not mint the shortchanged shares. Modeled the same way the
    /// mandatory inflation test models a donation: `total_assets` jumps far above what the slice
    /// alone would justify, driving the reconverted value under the tolerance floor.
    #[test]
    fn deposit_leg_reverts_when_credit_falls_below_tolerance() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        contract
            .write_weights(attacker_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();
        contract
            .write_weights(victim_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        // Seed a tiny share count via a 1-wei deposit (same shape as the mandatory inflation test).
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let seed_deposit = U256::from(1u64);
        let seed_transfer = transferFromCall { from: attacker_addr(), to: contract_addr(), amount: seed_deposit }.abi_encode();
        vm.mock_call(USDC, seed_transfer, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), seed_deposit);
        let zero_approve_seed = approveCall { spender: adapter_addr(), amount: U256::ZERO }.abi_encode();
        vm.mock_call(USDC, zero_approve_seed, U256::ZERO, Ok(true.abi_encode()));
        vm.set_sender(attacker_addr());
        contract.deposit(seed_deposit).unwrap();

        // A large donation-inflated `total_assets` makes the next deposit's reconverted value fall
        // far below the 99% floor.
        let donation = U256::from(1_000_000_000_000u64);
        let normal_deposit = U256::from(1_000_000u64);
        let victim_transfer = transferFromCall { from: victim_addr(), to: contract_addr(), amount: normal_deposit }.abi_encode();
        vm.mock_call(USDC, victim_transfer, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), normal_deposit);
        mock_total_assets(&vm, adapter_addr(), donation);

        vm.set_sender(victim_addr());
        let err = contract.deposit(normal_deposit);
        assert!(err.is_err());
    }

    /// WR-03: `deposit_leg` must actually issue `approve(adapter, 0)` after the adapter's deposit
    /// call. TestVM's `perform_mocked_call` returns `Ok(Vec::new())` (decodes as success, T-09-05's
    /// tri-state rule) for any call with NO matching mock registration, so a plain "does the call
    /// succeed" assertion can't distinguish "the zeroing call happened" from "it was silently
    /// skipped" — both look like success. The proof used here: register ONLY the zero-amount
    /// `approve` mock to return `false` (which `decode_bool_result` turns into `TransferFailed`).
    /// If `deposit_leg` regressed and stopped issuing that call, this mock is simply never hit and
    /// the deposit succeeds normally; the assertion below only holds if the zeroing call is
    /// actually made.
    #[test]
    fn deposit_leg_leaves_zero_allowance() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        contract
            .write_weights(user_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let transfer_calldata = transferFromCall { from: user_addr(), to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));

        let approve_calldata = approveCall { spender: adapter_addr(), amount }.abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let deposit_calldata = depositCall { usdcAmount: amount }.abi_encode();
        vm.mock_call(adapter_addr(), deposit_calldata, U256::ZERO, Ok(amount.abi_encode()));

        let zero_approve = approveCall { spender: adapter_addr(), amount: U256::ZERO }.abi_encode();
        vm.mock_call(USDC, zero_approve, U256::ZERO, Ok(false.abi_encode()));

        vm.set_sender(user_addr());
        let err = contract.deposit(amount);
        assert_eq!(err.unwrap_err(), errors::transfer_failed());
    }

    // --- deposit_for (D-19 permissionless intake) ---

    #[test]
    fn deposit_for_credits_the_target_not_the_payer() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        let payer = attacker_addr();
        let credited = victim_addr();
        contract
            .write_weights(credited, alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let transfer_calldata = transferFromCall { from: payer, to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), amount);

        vm.set_sender(payer);
        let shares = contract.deposit_for(credited, amount).unwrap();
        assert!(!shares.is_zero());
        assert_eq!(contract.shares_of(credited, adapter_addr()), shares);
        assert_eq!(contract.shares_of(payer, adapter_addr()), U256::ZERO);
    }

    #[test]
    fn deposit_for_uses_the_targets_weights_not_the_callers() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm); // seeds payer weights 6000/4000
        let payer = user_addr();
        let credited = non_owner_addr();
        contract
            .write_weights(
                credited,
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(2_000u64), U256::from(8_000u64)],
            )
            .unwrap();

        let amount = U256::from(1_000u64);
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        let transfer_calldata = transferFromCall { from: payer, to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        // credited's weights [2000,8000] -> slices [200,800], not payer's [6000,4000].
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(200u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(800u64));

        vm.set_sender(payer);
        contract.deposit_for(credited, amount).unwrap();
        assert!(!contract.shares_of(credited, adapter_addr()).is_zero());
        assert!(!contract.shares_of(credited, adapter_two_addr()).is_zero());
        assert_eq!(contract.shares_of(payer, adapter_addr()), U256::ZERO);
        assert_eq!(contract.shares_of(payer, adapter_two_addr()), U256::ZERO);
    }

    #[test]
    fn deposit_for_zero_user_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(user_addr());
        let err = contract.deposit_for(Address::ZERO, U256::from(1_000_000u64));
        assert_eq!(err.unwrap_err(), errors::zero_address());
    }

    #[test]
    fn deposit_for_with_no_weights_on_target_reverts_no_weights_set() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(user_addr());
        let err = contract.deposit_for(non_owner_addr(), U256::from(1_000_000u64));
        assert_eq!(err.unwrap_err(), errors::no_weights_set());
    }

    /// D-19 residual risk #2 (T-13-06): weights pointing at a disabled adapter must revert BEFORE
    /// any transfer — no unmocked `transferFrom` call is registered here, so if the guard order
    /// regressed and the pull ran first, this would panic on an unmocked external call instead of
    /// returning a clean `Err`.
    #[test]
    fn deposit_for_toward_disabled_adapter_reverts_before_any_transfer() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        let credited = victim_addr();
        contract
            .write_weights(credited, alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        vm.set_sender(owner_addr());
        contract.set_enabled(adapter_addr(), false).unwrap();

        vm.set_sender(attacker_addr());
        let err = contract.deposit_for(credited, U256::from(1_000_000u64));
        assert_eq!(err.unwrap_err(), errors::adapter_not_enabled());
    }

    // --- registry: add / remove / enable-disable ---

    fn adapter_two_addr() -> Address {
        Address::from([0x12; 20])
    }

    fn mock_total_assets(vm: &TestVM, adapter: Address, value: U256) {
        let calldata = totalAssetsCall {}.abi_encode();
        vm.mock_static_call(adapter, calldata, Ok(value.abi_encode()));
    }

    #[test]
    fn registry_add_owner_only() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(non_owner_addr());
        let err = contract.add_adapter(adapter_addr());
        assert_eq!(err.unwrap_err(), errors::not_owner());

        vm.set_sender(owner_addr());
        assert!(contract.add_adapter(adapter_addr()).is_ok());
    }

    #[test]
    fn registry_add_rejects_duplicate() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(owner_addr());
        let err = contract.add_adapter(adapter_addr());
        assert_eq!(err.unwrap_err(), errors::adapter_already_registered());
    }

    /// D-11 (T-12.1-20): `set_enabled(false)` is allowed WITH an open position, and disabling only
    /// blocks NEW money into that adapter — it must never trap a user's existing position. Three
    /// independent scenarios, each with its OWN fresh `TestVM`/deploy: composing them against a
    /// single contract instance sequentially would let an earlier scenario's CEI burn (which lands
    /// in TestVM's in-memory storage even when the top-level call later returns `Err` — see
    /// `redeem_zero_delta_reverts_shortfall`'s note above) leak into the next scenario's setup.
    #[test]
    fn disabled_adapter_blocks_deposits_but_never_traps_a_position() {
        // --- Scenario 1: disabling WITH an open position succeeds (the guard removed by D-11);
        // a subsequent deposit whose weights include the now-disabled adapter reverts. ---
        {
            let vm = TestVM::default();
            let mut contract = deploy_init_and_seed_adapter(&vm);
            let minted = deposit_amount(&vm, &mut contract, U256::from(1_000_000u64));
            assert!(!minted.is_zero()); // position > 0 before disabling

            vm.set_sender(owner_addr());
            assert!(contract.set_enabled(adapter_addr(), false).is_ok());

            vm.set_sender(user_addr());
            let err = contract.deposit(U256::from(1_000u64));
            assert_eq!(err.unwrap_err(), errors::adapter_not_enabled());
        }

        // --- Scenario 2: `redeem` still reaches a disabled adapter and burns the user's shares
        // there (`unwind_position` iterates the FULL registry filtered by held shares, never the
        // enabled set). ---
        {
            let vm = TestVM::default();
            let mut contract = deploy_init_and_seed_adapter(&vm);
            deposit_amount(&vm, &mut contract, U256::from(1_000_000u64));

            vm.set_sender(owner_addr());
            contract.set_enabled(adapter_addr(), false).unwrap();

            // Same shared-balance-buffer limitation as `redeem_zero_delta_reverts_shortfall`: the
            // final delta check collapses and the call returns `Err`, but the CEI burn earlier in
            // the same call still lands — what this proves is that the disabled adapter's leg was
            // actually reached, not the exact payout (that lives on the Sepolia rig, KI-03).
            mock_total_assets(&vm, adapter_addr(), U256::from(1_000_000u64));
            mock_max_withdraw(&vm, adapter_addr(), U256::from(1_000_000u64));
            mock_adapter_withdraw_leg(&vm, adapter_addr(), U256::from(1_000_000u64));
            let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
            vm.mock_static_call(USDC, balance_calldata, Ok(U256::ZERO.abi_encode()));

            vm.set_sender(user_addr());
            let _ = contract.redeem(TOTAL_BPS); // expected Err per the buffer limitation above
            assert_eq!(contract.shares_of(user_addr(), adapter_addr()), U256::ZERO);
        }

        // --- Scenario 3: a `rebalance` whose new weights OMIT the disabled adapter still unwinds
        // the user's old position there (same shared `unwind_position` primitive as redeem). ---
        {
            let vm = TestVM::default();
            let mut contract = deploy_init_and_seed_two_adapters(&vm); // seeds a1/a2, weights 6000/4000
            let user = user_addr();

            mock_total_assets(&vm, adapter_addr(), U256::ZERO);
            mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
            let amount = U256::from(100u64);
            let transfer_calldata = transferFromCall { from: user, to: contract_addr(), amount }.abi_encode();
            vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
            mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(60u64));
            mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(40u64));
            vm.set_sender(user);
            contract.deposit(amount).unwrap();
            assert!(!contract.shares_of(user, adapter_addr()).is_zero());

            vm.set_sender(owner_addr());
            contract.set_enabled(adapter_addr(), false).unwrap();

            // New weights target ONLY adapter_two -- adapter_addr is omitted entirely from the new
            // set. The unwind step of rebalance must still reach it (registry-filtered-by-shares,
            // D-11), even though it is neither enabled nor present in the new weights.
            mock_total_assets(&vm, adapter_addr(), U256::from(60u64));
            mock_max_withdraw(&vm, adapter_addr(), U256::from(60u64));
            mock_adapter_withdraw_leg(&vm, adapter_addr(), U256::from(60u64));
            mock_total_assets(&vm, adapter_two_addr(), U256::from(40u64));
            mock_max_withdraw(&vm, adapter_two_addr(), U256::from(40u64));
            mock_adapter_withdraw_leg(&vm, adapter_two_addr(), U256::from(40u64));
            let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
            vm.mock_static_call(USDC, balance_calldata, Ok(U256::ZERO.abi_encode()));

            vm.set_sender(user);
            let _ = contract.rebalance(alloc::vec![adapter_two_addr()], alloc::vec![U256::from(10_000u64)]);
            // Same shared-buffer limitation as scenario 2: the re-split may error on the delta
            // check, but the CEI burn of the old, now-omitted adapter_addr position lands anyway.
            assert_eq!(contract.shares_of(user, adapter_addr()), U256::ZERO);
        }
    }

    // --- deposit: multi-adapter atomic split ---

    fn deploy_init_and_seed_two_adapters(vm: &TestVM) -> VaultCore {
        let mut contract = deploy_and_init(vm);
        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_addr()).unwrap();
        contract.add_adapter(adapter_two_addr()).unwrap();
        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
            )
            .unwrap();
        contract
    }

    /// Mocks USDC `transferFrom`/`approve` to succeed and `adapter.deposit(usdcAmount)` to return
    /// `usdcAmount` shares, for `adapter` and the given slice. Per Pitfall 3, the exact returned
    /// payload doesn't matter past decode-success (TestVM's shared return-data buffer means only
    /// the LAST registration's bytes are actually returned); the split routing itself is proven at
    /// the `share_math::split_by_bps` unit level, not by distinct per-adapter mocked returns here.
    fn mock_adapter_deposit_leg(vm: &TestVM, adapter: Address, slice: U256) {
        let approve_calldata = approveCall { spender: adapter, amount: slice }.abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));

        let deposit_calldata = depositCall { usdcAmount: slice }.abi_encode();
        vm.mock_call(adapter, deposit_calldata, U256::ZERO, Ok(slice.abi_encode()));
    }

    #[test]
    fn deposit_splits_across_caller_weights() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        // Same-value mocks across both adapters (Pitfall 3): the numeric assertion below only
        // needs each leg's minted shares to be nonzero, not a per-adapter split proof.
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);

        let amount = U256::from(100u64);
        let transfer_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));

        // amount=100, weights [6000,4000] -> slices [60,40], no remainder.
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(60u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(40u64));

        vm.set_sender(user_addr());
        let shares = contract.deposit(amount).unwrap();
        assert!(!shares.is_zero());
        assert!(!contract.shares_of(user_addr(), adapter_addr()).is_zero());
        assert!(!contract.shares_of(user_addr(), adapter_two_addr()).is_zero());
    }

    #[test]
    fn deposit_reverts_on_adapter_failure() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);

        let amount = U256::from(100u64);
        let transfer_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));

        // First adapter's leg succeeds; the second adapter's deposit reverts (D-09: whole tx
        // must unwind, no partial accounting).
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(60u64));
        let approve_two_calldata = approveCall {
            spender: adapter_two_addr(),
            amount: U256::from(40u64),
        }
        .abi_encode();
        vm.mock_call(USDC, approve_two_calldata, U256::ZERO, Ok(true.abi_encode()));
        let deposit_two_calldata = depositCall {
            usdcAmount: U256::from(40u64),
        }
        .abi_encode();
        vm.mock_call(
            adapter_two_addr(),
            deposit_two_calldata,
            U256::ZERO,
            Err(b"AdapterPaused".to_vec()),
        );

        vm.set_sender(user_addr());
        let err = contract.deposit(amount);
        assert!(err.is_err());
        assert!(contract.shares_of(user_addr(), adapter_addr()).is_zero());
        assert!(contract.shares_of(user_addr(), adapter_two_addr()).is_zero());
    }

    /// A slice that rounds to zero must be skipped, not routed as `deposit(0)`/`withdraw(0)` (some
    /// adapters revert on a zero-value call — routing it would be a self-inflicted DoS). Under the
    /// per-user model a caller only ever splits across THEIR OWN weight targets, so this is
    /// exercised with a dust-sized amount whose bps-weighted slice floors to 0 for one leg.
    /// `adapter_two`'s deposit(0) is mocked to REVERT: if the `slice.is_zero()` skip regressed, the
    /// whole deposit would revert instead of succeeding with only `adapter_addr()`'s leg filled.
    ///
    /// Mock ordering follows Pitfall 3 (TestVM's shared return-data buffer): the LAST-registered
    /// mock's bytes are what every call reads back, so the value the math/bool-decodes depend on
    /// (the good adapter's leg) is registered last; the adapter_two revert mock is registered
    /// earlier and is only ever hit if the skip regresses.
    #[test]
    fn zero_slice_leg_is_skipped_on_deposit() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_two_addr()).unwrap();
        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(9_999u64), U256::from(1u64)],
            )
            .unwrap();

        // amount=1: slice for adapter_two = floor(1*1/10000) = 0; remainder (1) goes to slot 0.
        let amount = U256::from(1u64);

        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let transfer_from_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_from_calldata, U256::ZERO, Ok(true.abi_encode()));
        let deposit_zero = depositCall { usdcAmount: U256::ZERO }.abi_encode();
        vm.mock_call(adapter_two_addr(), deposit_zero, U256::ZERO, Err(b"ZeroDeposit".to_vec()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), amount); // registered last -> return buffer

        vm.set_sender(user_addr());
        let shares = contract.deposit(amount).unwrap();
        assert!(!shares.is_zero());
        assert!(!contract.shares_of(user_addr(), adapter_addr()).is_zero());
        assert!(contract.shares_of(user_addr(), adapter_two_addr()).is_zero());
    }

    // --- redeem ---

    fn mock_adapter_withdraw_leg(vm: &TestVM, adapter: Address, slice: U256) {
        let withdraw_calldata = withdrawCall { usdcAmount: slice }.abi_encode();
        vm.mock_call(adapter, withdraw_calldata, U256::ZERO, Ok(slice.abi_encode()));
    }

    fn mock_usdc_transfer(vm: &TestVM, to: Address, amount: U256) {
        let transfer_calldata = transferCall { to, amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
    }

    /// Deposits `amount` for `user_addr()` against a single seeded adapter (100% weight, written
    /// via `write_weights`), mocking the pre-deposit `total_assets()` at zero. Returns the shares
    /// minted.
    fn deposit_amount(vm: &TestVM, contract: &mut VaultCore, amount: U256) -> U256 {
        contract
            .write_weights(user_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();
        mock_total_assets(vm, adapter_addr(), U256::ZERO);

        let transfer_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(vm, adapter_addr(), amount);

        vm.set_sender(user_addr());
        contract.deposit(amount).unwrap()
    }

    /// D-05/D-06 wiring proof, NOT a full happy-path proof. `redeem` now measures
    /// `usdc::balance_of(core)` twice (before/after the withdraw loop) — per 12-RESEARCH.md
    /// Pitfall 1, `stylus-test`'s shared return-data buffer means TWO distinct registrations for
    /// the identical `(USDC, balanceOf(core))` key cannot coexist inside one top-level call, so a
    /// genuine non-zero `actual_delta` cannot be constructed here. Registering ONE value makes
    /// both reads observe the same bytes -> `actual_delta == 0` -> `reconcile_credit` MUST revert
    /// with `RedeemShortfall` for any `owed > 0` (D-06). This proves the wiring (balance_of is
    /// called, its result feeds reconcile_credit, a measured shortfall reverts the whole tx); the
    /// happy-path exact/surplus payout math is proven by share_math's pure `reconcile_credit`
    /// tests (Plan 01) and by Phase 13's live fork tests, not by TestVM here.
    #[test]
    fn redeem_zero_delta_reverts_shortfall() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        let amount = U256::from(1_000_000u64);
        let shares_minted = deposit_amount(&vm, &mut contract, amount);
        assert!(!shares_minted.is_zero());

        // Position now worth `amount`. Single-value mocks only (Pitfall 1): one `balanceOf(core)`
        // registration, registered last so it wins the shared buffer for both before/after reads.
        mock_adapter_withdraw_leg(&vm, adapter_addr(), amount);
        mock_usdc_transfer(&vm, user_addr(), amount);
        mock_total_assets(&vm, adapter_addr(), amount);
        mock_max_withdraw(&vm, adapter_addr(), amount);
        let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
        vm.mock_static_call(USDC, balance_calldata, Ok(amount.abi_encode()));

        vm.set_sender(user_addr());
        let err = contract.redeem(TOTAL_BPS); // full exit
        assert!(err.is_err()); // actual_delta == 0 < owed -> D-06 shortfall revert
        // Shares are already burned (CEI runs before the external calls/revert), but per
        // Stylus/EVM call-frame semantics the whole tx (including the burn) unwinds on Err — this
        // in-memory `contract` value reflects only the pre-revert mutation, not what a real chain
        // would persist. Nothing further to assert on state here.
    }

    #[test]
    fn redeem_bps_out_of_range_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(user_addr());
        let err = contract.redeem(U256::ZERO);
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());

        let err = contract.redeem(U256::from(10_001u64));
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());
    }

    #[test]
    fn two_users_shares_are_independent() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        contract
            .write_weights(user_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();
        contract
            .write_weights(non_owner_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        // User A deposits (fresh top-level call, fresh mocks).
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let amount_a = U256::from(1_000_000u64);
        let transfer_a_calldata = transferFromCall {
            from: user_addr(),
            to: contract_addr(),
            amount: amount_a,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_a_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), amount_a);
        vm.set_sender(user_addr());
        let shares_a = contract.deposit(amount_a).unwrap();

        // User B deposits (separate top-level call, sidesteps the shared return-data buffer).
        mock_total_assets(&vm, adapter_addr(), amount_a);
        let amount_b = U256::from(2_000_000u64);
        let transfer_b_calldata = transferFromCall {
            from: non_owner_addr(),
            to: contract_addr(),
            amount: amount_b,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_b_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), amount_b);
        vm.set_sender(non_owner_addr());
        let shares_b = contract.deposit(amount_b).unwrap();

        assert!(!shares_a.is_zero());
        assert!(!shares_b.is_zero());
        assert_eq!(contract.shares_of(user_addr(), adapter_addr()), shares_a);
        assert_eq!(contract.shares_of(non_owner_addr(), adapter_addr()), shares_b);
        assert_eq!(contract.adapter_total_shares.get(adapter_addr()), shares_a + shares_b);
    }

    /// VAULT-02 criterion 2, non-negotiable (T-12.1-19): two users with DIFFERENT weights deposit
    /// into the SAME two adapters, ending up with distinguishable, non-proportionate positions; A's
    /// full `redeem` only ever touches A's own ledger entries, leaving B's position byte-for-byte
    /// unchanged.
    ///
    /// NOTE (KI-03/T-12.1-21): the EXACT USDC amount A receives on `redeem` is NOT provable under
    /// `stylus-test` 0.10.7 — the before/after `usdc::balance_of(core)` reads inside
    /// `unwind_position` share one return-data buffer per top-level call (the same limitation
    /// `redeem_zero_delta_reverts_shortfall` documents above), so they always collapse to the SAME
    /// value and the call returns a shortfall `Err` regardless of what value is registered. Because
    /// the CEI burn happens BEFORE that final balance-delta check, the in-memory ledger still
    /// reflects the burn even though the call errors — that is exactly what this test proves: the
    /// SHARE LEDGER is independent per user (criterion 2), not the payout amount. The exact payout
    /// is verified against the Sepolia rig instead, the same split F12 already adopted for
    /// `redeem`'s happy path.
    #[test]
    fn two_users_with_different_weights_redeem_only_their_own_position() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm); // seeds A = [a1,a2]=[6000,4000]
        let user_a = user_addr();
        let user_b = non_owner_addr();

        contract
            .write_weights(
                user_b,
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(2_000u64), U256::from(8_000u64)],
            )
            .unwrap();

        // User A deposits (top-level call 1, fresh mocks). amount=1000, weights [6000,4000] ->
        // slices [600,400], no remainder.
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        let amount_a = U256::from(1_000u64);
        let transfer_a = transferFromCall { from: user_a, to: contract_addr(), amount: amount_a }.abi_encode();
        vm.mock_call(USDC, transfer_a, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(600u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(400u64));
        vm.set_sender(user_a);
        contract.deposit(amount_a).unwrap();

        // User B deposits (top-level call 2, fresh mocks, different weights). amount=2000, weights
        // [2000,8000] -> slices [400,1600]. `total_assets` reflects A's real post-deposit state
        // (no yield: adapter total_assets == cumulative USDC actually deposited).
        mock_total_assets(&vm, adapter_addr(), U256::from(600u64));
        mock_total_assets(&vm, adapter_two_addr(), U256::from(400u64));
        let amount_b = U256::from(2_000u64);
        let transfer_b = transferFromCall { from: user_b, to: contract_addr(), amount: amount_b }.abi_encode();
        vm.mock_call(USDC, transfer_b, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(400u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(1_600u64));
        vm.set_sender(user_b);
        contract.deposit(amount_b).unwrap();

        let a1_shares_a = contract.shares_of(user_a, adapter_addr());
        let a2_shares_a = contract.shares_of(user_a, adapter_two_addr());
        let a1_shares_b = contract.shares_of(user_b, adapter_addr());
        let a2_shares_b = contract.shares_of(user_b, adapter_two_addr());
        assert!(!a1_shares_a.is_zero());
        assert!(!a2_shares_a.is_zero());
        assert!(!a1_shares_b.is_zero());
        assert!(!a2_shares_b.is_zero());
        // Different weights -> different per-adapter proportions (A is 3:2 a1:a2, B is 1:4).
        assert_ne!(a1_shares_a * a2_shares_b, a2_shares_a * a1_shares_b);

        // User A redeems full (top-level call 3, fresh mocks). No-yield invariant (adapter
        // total_shares == cumulative deposited * OFFSET_POW) makes `owed` per leg resolve to
        // EXACTLY the original deposited slice (600, 400), independent of B's position. Per the
        // mandatory note above, the exact USDC amount A actually receives is NOT asserted here —
        // that verification lives on the Sepolia rig, not under TestVM.
        mock_total_assets(&vm, adapter_addr(), U256::from(1_000u64));
        mock_total_assets(&vm, adapter_two_addr(), U256::from(2_000u64));
        mock_max_withdraw(&vm, adapter_addr(), U256::from(600u64));
        mock_max_withdraw(&vm, adapter_two_addr(), U256::from(400u64));
        mock_adapter_withdraw_leg(&vm, adapter_addr(), U256::from(600u64));
        mock_adapter_withdraw_leg(&vm, adapter_two_addr(), U256::from(400u64));
        let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
        vm.mock_static_call(USDC, balance_calldata, Ok(U256::ZERO.abi_encode()));

        vm.set_sender(user_a);
        let _ = contract.redeem(TOTAL_BPS); // expected Err per the mandatory note above

        assert_eq!(contract.shares_of(user_a, adapter_addr()), U256::ZERO);
        assert_eq!(contract.shares_of(user_a, adapter_two_addr()), U256::ZERO);
        // B's position is untouched: exactly the same values recorded before A's redeem.
        assert_eq!(contract.shares_of(user_b, adapter_addr()), a1_shares_b);
        assert_eq!(contract.shares_of(user_b, adapter_two_addr()), a2_shares_b);
    }

    // --- D-06 MANDATORY inflation-attack test, re-run per-adapter ---

    /// 1-wei deposit + large direct donation to the adapter/protocol (never routed through
    /// `core.deposit()`, so it mints no core shares) + a normal second depositor must still get
    /// non-zero, proportionate shares. This is the empirical proof of D-06's PER-ADAPTER
    /// virtual-offset anti-inflation formula (success criterion 4, T-12.1-18): `owed`/`minted` are
    /// computed against `(adapter_total_shares[adapter], adapter.total_assets())`, never an
    /// aggregate pool-wide total, so a single adapter can be targeted for the whole attack.
    ///
    /// Structured as 2 separate top-level `deposit()` calls (Pitfall 3): each call's mocks are
    /// registered with `total_assets` LAST, so its bytes win TestVM's shared return-data buffer
    /// for every decode inside that call — the only way to get a deterministic `total_assets`
    /// read per top-level call under this TestVM version's known limitation.
    #[test]
    fn inflation_attack_per_adapter_second_depositor_gets_nonzero_proportionate_shares() {
        let vm = TestVM::default();
        let mut core = deploy_init_and_seed_adapter(&vm);
        core.write_weights(attacker_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();
        core.write_weights(victim_addr(), alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        // Step 1: attacker deposits 1 wei (smallest possible unit). `total_assets` is registered
        // FIRST here (unlike step 3 below): a literal zero as the LAST-registered mock would
        // decode as `false` for the bool-returning transferFrom/approve calls sharing the same
        // TestVM return-data buffer (Pitfall 3) and break the deposit; the deposit-leg mocks
        // (nonzero content) safely win the buffer instead, which is enough since this step only
        // needs `attacker_shares` to come out non-zero, not an exact total_assets value.
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        let attacker_deposit = U256::from(1u64);
        let attacker_transfer_calldata = transferFromCall {
            from: attacker_addr(),
            to: contract_addr(),
            amount: attacker_deposit,
        }
        .abi_encode();
        vm.mock_call(USDC, attacker_transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), attacker_deposit);

        vm.set_sender(attacker_addr());
        core.deposit(attacker_deposit).unwrap();
        let attacker_shares = core.shares_of(attacker_addr(), adapter_addr());
        assert!(!attacker_shares.is_zero());

        // Step 2: the attacker donates a large amount directly to the adapter/protocol (bypassing
        // core.deposit() entirely, so no new core shares are minted), inflating the pool. Modeled
        // by jumping the adapter's mocked total_assets() far above the 1-wei deposit.
        let donation = U256::from(1_000_000_000_000u64);

        // Step 3: a normal second depositor deposits a realistic amount.
        let normal_deposit = U256::from(1_000_000u64); // 1 USDC, 6 decimals.
        let victim_transfer_calldata = transferFromCall {
            from: victim_addr(),
            to: contract_addr(),
            amount: normal_deposit,
        }
        .abi_encode();
        vm.mock_call(USDC, victim_transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), normal_deposit);
        mock_total_assets(&vm, adapter_addr(), donation); // donation-inflated value, registered last.

        // Phase 13 Plan 02 (WR-02) supersedes this scenario's original T-12.1-18 outcome: at this
        // extreme a ratio (donation 1e12 against attacker_shares/OFFSET both ~1e6), the anti-
        // inflation formula still floors to a NON-ZERO mint (no theft-of-funds path opens), but the
        // reconverted value is far below the 99%-of-slice floor — this is exactly the "adapter
        // credits shares worth materially less than the slice" condition WR-02 exists to catch, so
        // the deposit reverts `DepositShortfall` instead of silently accepting the diluted mint.
        // Reverting is STRICTLY BETTER for the victim than 12.1's original behavior: only gas is
        // lost, not principal into a diluted position.
        vm.set_sender(victim_addr());
        let err = core.deposit(normal_deposit);
        assert!(err.is_err(), "WR-02 must revert a deposit this heavily diluted by a donation-inflated ratio");
    }

    // --- rebalance (VAULT-03, user-scoped) ---

    fn mock_max_withdraw(vm: &TestVM, adapter: Address, value: U256) {
        let calldata = maxWithdrawCall {}.abi_encode();
        vm.mock_static_call(adapter, calldata, Ok(value.abi_encode()));
    }

    #[test]
    fn rebalance_rejects_invalid_weights() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        vm.set_sender(user_addr());
        let err = contract.rebalance(
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(3_000u64)], // sums to 9000, not 10000
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());
    }

    #[test]
    fn rebalance_reverts_on_unwind_leg_failure() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);
        let user = user_addr();

        // Bootstrap a real position: user deposits per the seeded 60/40 weights (fresh top-level
        // call, own mocks).
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        let amount = U256::from(100u64);
        let transfer_calldata = transferFromCall { from: user, to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(60u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(40u64));
        vm.set_sender(user);
        contract.deposit(amount).unwrap();

        // Rebalance (separate top-level call): unwind_position's withdraw leg for adapter_addr
        // (the caller's own, live position) reverts, so the whole rebalance must revert (D-09/D-10
        // atomicity) — this is the unwind of the caller's OWN position, not an owner-driven pool.
        mock_total_assets(&vm, adapter_addr(), U256::from(60u64));
        mock_max_withdraw(&vm, adapter_addr(), U256::from(60u64));
        let withdraw_calldata = withdrawCall { usdcAmount: U256::from(60u64) }.abi_encode();
        vm.mock_call(adapter_addr(), withdraw_calldata, U256::ZERO, Err(b"WithdrawExceedsMax".to_vec()));

        vm.set_sender(user);
        let err = contract.rebalance(
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(5_000u64), U256::from(5_000u64)],
        );
        assert!(err.is_err());
    }

    /// D-12 (T-12.1-19, owner variant): the owner has NO lever over other users' positions.
    /// Calling `rebalance` as the owner only ever touches the OWNER's own (here: zero) position --
    /// another user's shares must be untouched, byte-for-byte, after the owner's call.
    #[test]
    fn owner_rebalance_does_not_move_another_users_position() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm); // seeds a1/a2, user weights 6000/4000
        let user = user_addr();

        // The user deposits a real position (top-level call 1, fresh mocks).
        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        let amount = U256::from(100u64);
        let transfer_calldata = transferFromCall { from: user, to: contract_addr(), amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        mock_adapter_deposit_leg(&vm, adapter_addr(), U256::from(60u64));
        mock_adapter_deposit_leg(&vm, adapter_two_addr(), U256::from(40u64));
        vm.set_sender(user);
        contract.deposit(amount).unwrap();

        let user_a1_before = contract.shares_of(user, adapter_addr());
        let user_a2_before = contract.shares_of(user, adapter_two_addr());
        assert!(!user_a1_before.is_zero());
        assert!(!user_a2_before.is_zero());

        // The owner calls rebalance (separate top-level call, own zero position -- no external
        // calls needed: `unwind_position` finds zero held shares for the owner in both adapters and
        // `proceeds` is zero, so `rebalance` returns early after writing the owner's own weights).
        vm.set_sender(owner_addr());
        contract
            .rebalance(
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(5_000u64), U256::from(5_000u64)],
            )
            .unwrap();

        assert_eq!(contract.shares_of(user, adapter_addr()), user_a1_before);
        assert_eq!(contract.shares_of(user, adapter_two_addr()), user_a2_before);
    }

    /// The pure half of the CR-01 guarantee: a fully-throttled leg (`max_withdraw() == 0`) yields
    /// `None`, i.e. the external `withdraw` is SKIPPED while the burn above it in `unwind_position`
    /// still lands. `unwind_position` therefore accumulates `owed_total` BEFORE this call, so the
    /// skipped leg still trips the shortfall gate and reverts the whole tx.
    ///
    /// The end-to-end half (redeem with `total_assets() > 0` and `max_withdraw() == 0` reverting
    /// `RedeemShortfall`) is NOT constructible under `stylus-test` 0.10.7 and deliberately has no
    /// test here — see KI-04 in `docs/known-issues.md` for the proof and for the Sepolia rig test
    /// that covers it (`throttled_adapter_reverts_whole_redeem_and_burns_nothing`).
    #[test]
    fn unwind_request_skips_zero_and_throttled() {
        assert_eq!(unwind_request(U256::ZERO, U256::ZERO), None);
        assert_eq!(unwind_request(U256::from(100u64), U256::ZERO), None); // fully throttled -> skip
        assert_eq!(
            unwind_request(U256::from(50u64), U256::from(100u64)),
            Some(U256::from(50u64))
        );
        assert_eq!(
            unwind_request(U256::from(100u64), U256::from(50u64)),
            Some(U256::from(50u64))
        );
    }

    // --- write_weights / read_weights / shares_of / weights_of (D-04/D-08, Plan 02) ---

    #[test]
    fn weights_sum_must_be_exactly_10000() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(3_999u64)], // sums to 9999
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_001u64)], // sums to 10001
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());

        assert!(contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
            )
            .is_ok());
    }

    #[test]
    fn weights_reject_duplicate_target() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), adapter_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());
    }

    #[test]
    fn weights_reject_zero_weight() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(10_000u64), U256::ZERO],
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());
    }

    #[test]
    fn weights_reject_length_mismatch_and_empty() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());

        let err = contract.write_weights(user_addr(), alloc::vec![], alloc::vec![]);
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());
    }

    #[test]
    fn weights_reject_unregistered_target() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        let unregistered = Address::from([0x55; 20]);
        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), unregistered],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::adapter_not_registered());
    }

    #[test]
    fn weights_reject_disabled_target() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        vm.set_sender(owner_addr());
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        contract.set_enabled(adapter_two_addr(), false).unwrap();

        let err = contract.write_weights(
            user_addr(),
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::adapter_not_enabled());
    }

    #[test]
    fn weight_bps_of_round_trips_what_was_written() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
            )
            .unwrap();

        assert_eq!(contract.weight_bps_of(user_addr(), adapter_addr()), U256::from(6_000u64));
        assert_eq!(contract.weight_bps_of(user_addr(), adapter_two_addr()), U256::from(4_000u64));
    }

    #[test]
    fn weights_rewrite_clears_the_omitted_adapter() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
            )
            .unwrap();

        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr()],
                alloc::vec![U256::from(10_000u64)],
            )
            .unwrap();

        assert_eq!(contract.weight_bps_of(user_addr(), adapter_addr()), U256::from(10_000u64));
        assert_eq!(
            contract.weight_bps.get(user_addr()).get(adapter_two_addr()),
            U256::ZERO
        );
    }

    #[test]
    fn weight_bps_of_two_users_are_independent() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        contract
            .write_weights(
                user_addr(),
                alloc::vec![adapter_addr()],
                alloc::vec![U256::from(10_000u64)],
            )
            .unwrap();
        contract
            .write_weights(
                non_owner_addr(),
                alloc::vec![adapter_two_addr()],
                alloc::vec![U256::from(10_000u64)],
            )
            .unwrap();

        assert_eq!(contract.weight_bps_of(user_addr(), adapter_addr()), U256::from(10_000u64));
        assert_eq!(contract.weight_bps_of(non_owner_addr(), adapter_two_addr()), U256::from(10_000u64));
        assert_eq!(contract.weight_bps_of(user_addr(), adapter_two_addr()), U256::ZERO);
        assert_eq!(contract.weight_bps_of(non_owner_addr(), adapter_addr()), U256::ZERO);
    }

    #[test]
    fn shares_of_is_zero_without_position() {
        let vm = TestVM::default();
        let contract = deploy_init_and_seed_two_adapters(&vm);

        assert_eq!(contract.shares_of(user_addr(), adapter_addr()), U256::ZERO);
    }
}
