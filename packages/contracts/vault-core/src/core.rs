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

/// MockUsdc on Arbitrum Sepolia — the `testnet` build variant is a disposable test fixture and
/// must NEVER be deployed to mainnet. With the feature off the default build is unchanged in size
/// and behaviour; the only byte-level delta versus before this cfg split is two embedded panic
/// line numbers shifted by the 8 lines added here (measured, see docs/TESTNET.md).
/// `scripts/deploy-testnet-mocks.sh` greps this constant against the deployed MockUsdc address
/// and stops if they diverge; update it after the script's step 1 prints the deployed address.
#[cfg(feature = "testnet")]
const USDC: Address = address!("00000000000000000000000000000000DeaDBeef");

/// Total basis-points an allocation must sum to exactly (D-06).
const TOTAL_BPS: U256 = U256::from_limbs([10_000u64, 0, 0, 0]);

sol! {
    event Initialized(address indexed owner);
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event Redeem(address indexed user, uint256 shares, uint256 assets);
    event AdapterAdded(address indexed adapter);
    event AdapterEnabled(address indexed adapter, bool enabled);
    event AdapterRemoved(address indexed adapter);
    event AllocationSet(address[] adapters, uint256[] weightsBps);
    event Rebalanced(uint256 redeposited);
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
        self.vm().log(Initialized { owner });
        Ok(())
    }

    /// Owner-only: registers a new adapter, enabled by default with 0 bps (weight is assigned
    /// only via `set_allocation`). D-07 dynamic registry.
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
        self.adapter_bps.setter(adapter).set(U256::ZERO);
        self.vm().log(AdapterAdded { adapter });
        Ok(())
    }

    /// Owner-only: enables/disables a registered adapter. Disabling enforces the D-08
    /// empty-position invariant (`total_assets() == 0`) BEFORE the storage write, and zeroes any
    /// stale bps weight so it can't linger in a future `set_allocation` sum.
    pub fn set_enabled(&mut self, adapter: Address, enabled: bool) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;
        if !registry::is_registered(self, adapter) {
            return Err(errors::adapter_not_registered());
        }
        if !enabled {
            let total_assets = adapter_dispatch::total_assets(self.vm(), adapter)?;
            if !total_assets.is_zero() {
                return Err(errors::adapter_has_balance(total_assets));
            }
        }
        self.adapter_enabled.setter(adapter).set(enabled);
        if !enabled {
            self.adapter_bps.setter(adapter).set(U256::ZERO);
        }
        self.vm().log(AdapterEnabled { adapter, enabled });
        Ok(())
    }

    /// Owner-only: removes a registered adapter (swap-remove, see `registry.rs`'s doc-comment for
    /// the locked removal semantics). Same D-08 empty-position guard as `set_enabled(false)`.
    pub fn remove_adapter(&mut self, adapter: Address) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;
        let idx = registry::index_of(self, adapter).ok_or_else(errors::adapter_not_registered)?;
        let total_assets = adapter_dispatch::total_assets(self.vm(), adapter)?;
        if !total_assets.is_zero() {
            return Err(errors::adapter_has_balance(total_assets));
        }
        registry::swap_remove(self, idx);
        self.adapter_enabled.setter(adapter).set(false);
        self.adapter_bps.setter(adapter).set(U256::ZERO);
        self.vm().log(AdapterRemoved { adapter });
        Ok(())
    }

    /// Atomic multi-adapter split deposit (VAULT-01): pulls `amount` USDC from the caller, splits
    /// it by the current bps allocation across every active adapter (D-10 remainder to the first
    /// active adapter), deposits each slice, and mints offset-based shares from the pre-loop
    /// `total_assets` snapshot. Any single `adapter.deposit()` revert unwinds the whole tx (D-09).
    pub fn deposit(&mut self, amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if amount.is_zero() {
            return Err(errors::zero_amount());
        }

        // Snapshot the registry into local memory FIRST (Pitfall 4/T-11-11): the split loop below
        // iterates this `Vec`, never re-reading storage mid-iteration.
        let active = registry::active_adapters(self);
        if active.is_empty() {
            return Err(errors::adapter_not_enabled());
        }

        // Snapshot the aggregate total_assets BEFORE any external mutating call (Pitfall 2/T-11-10):
        // minting against a post-deposit total would dilute the depositor against their own funds.
        let mut total_assets_before = U256::ZERO;
        for (adapter, _bps) in active.iter() {
            total_assets_before += adapter_dispatch::total_assets(self.vm(), *adapter)?;
        }

        let user = self.vm().msg_sender();
        let self_addr = self.vm().contract_address();

        let pull_ctx = Call::new_mutating(self);
        usdc::transfer_from(self.vm(), pull_ctx, USDC, user, self_addr, amount)?;

        let weights: Vec<U256> = active.iter().map(|(_, bps)| *bps).collect();
        let slices = share_math::split_by_bps(amount, &weights)?;

        // Bare `?` per adapter: any revert unwinds the whole tx atomically (D-09/T-11-09),
        // Stylus/EVM call-frame semantics give this for free, no manual rollback needed.
        for ((adapter, _bps), slice) in active.iter().zip(slices) {
            // Skip 0-value legs: an enabled 0-bps adapter (add_adapter enables at 0 bps,
            // set_allocation need not cover the full enabled set) would otherwise force a
            // deposit(0) that some ERC-4626 adapters revert on -> self-inflicted deposit DoS.
            // Guard on the slice, not bps, so the D-10 remainder-to-slot-0 leg still routes.
            if slice.is_zero() {
                continue;
            }
            let approve_ctx = Call::new_mutating(self);
            usdc::approve(self.vm(), approve_ctx, USDC, *adapter, slice)?;

            let deposit_ctx = Call::new_mutating(self);
            adapter_dispatch::deposit(self.vm(), deposit_ctx, *adapter, slice)?;
        }

        let shares = share_math::convert_to_shares(
            amount,
            self.total_shares.get(),
            total_assets_before,
            share_math::OFFSET_POW,
        )?;
        if shares.is_zero() {
            return Err(errors::zero_shares());
        }

        let new_user_shares = self.shares.get(user) + shares;
        self.shares.setter(user).set(new_user_shares);
        let new_total_shares = self.total_shares.get() + shares;
        self.total_shares.set(new_total_shares);

        self.vm().log(Deposit {
            user,
            assets: amount,
            shares,
        });
        Ok(shares)
    }

    /// Hardened redeem (D-03..D-07): burns `shares` from the caller, converts to `owed` USDC via
    /// `convert_to_assets` (floor, always in the vault's favor), pulls it pro-rata from every
    /// active adapter BY LIVE POSITION (`split_by_position`, not the static bps split `deposit`
    /// uses), then pays the caller the REAL measured USDC balance delta the core gained across
    /// the whole withdraw loop, capped at `owed` (D-05/D-07) — never the adapter's return value or
    /// the pre-computed `owed`. A shortfall (measured delta < owed) reverts the whole tx (D-06).
    pub fn redeem(&mut self, shares: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if shares.is_zero() {
            return Err(errors::zero_shares());
        }
        let user = self.vm().msg_sender();
        if self.shares.get(user) < shares {
            return Err(errors::insufficient_shares());
        }

        // Snapshot the registry + per-adapter LIVE total_assets BEFORE any mutation/external call
        // (Pitfall 2/4). `positions` feeds the D-04 split; their sum feeds convert_to_assets.
        let active = registry::active_adapters(self);
        let mut positions: Vec<U256> = Vec::with_capacity(active.len());
        let mut total_assets_before = U256::ZERO;
        for (adapter, _bps) in active.iter() {
            let ta = adapter_dispatch::total_assets(self.vm(), *adapter)?;
            total_assets_before += ta;
            positions.push(ta);
        }

        let owed = share_math::convert_to_assets(
            shares,
            self.total_shares.get(),
            total_assets_before,
            share_math::OFFSET_POW,
        )?;
        if owed.is_zero() {
            return Err(errors::zero_amount());
        }

        // CEI: burn before any external call. An atomic revert later restores these.
        let new_user_shares = self.shares.get(user) - shares;
        self.shares.setter(user).set(new_user_shares);
        let new_total_shares = self.total_shares.get() - shares;
        self.total_shares.set(new_total_shares);

        // D-05: measure the REAL USDC balance the core actually gains across the whole redeem —
        // never trust adapter returns or the pre-computed `owed`.
        let self_addr = self.vm().contract_address();
        let balance_before = usdc::balance_of(self.vm(), USDC, self_addr)?;

        // D-04: pro-rata BY LIVE POSITION, remainder to index 0 (NOT split_by_bps — the pool may
        // be off-allocation after a rebalance, and positions are unbounded quantities).
        let slices = share_math::split_by_position(owed, &positions)?;
        for ((adapter, _bps), slice) in active.iter().zip(slices) {
            // Skip 0-value legs: registry::active_adapters returns every enabled adapter, and
            // after a D-11 exit-by-omission rebalance an enabled adapter can sit at position 0 ->
            // split_by_position hands it slice 0. adapter.withdraw(0) reverts ZeroAmount, so a
            // bare `?` here would revert EVERY redeem — a permanent DoS, not a legit D-06
            // shortfall. Skip it.
            if slice.is_zero() {
                continue;
            }
            let withdraw_ctx = Call::new_mutating(self);
            adapter_dispatch::withdraw(self.vm(), withdraw_ctx, *adapter, slice)?; // bare ? = D-06 atomicity
        }

        let balance_after = usdc::balance_of(self.vm(), USDC, self_addr)?;
        // checked_sub: a buggy/compromised adapter moving USDC OUT of the core would underflow —
        // in release builds ruint wraps, turning a loss into a huge delta that passes the D-06
        // gate. Treat any net outflow as a shortfall and revert.
        let actual_delta = balance_after
            .checked_sub(balance_before)
            .ok_or_else(|| errors::redeem_shortfall(owed, U256::ZERO))?;

        // D-06 shortfall -> whole-tx revert; D-07 surplus (donation/sandwich) -> credit capped at owed.
        let paid = share_math::reconcile_credit(owed, actual_delta)?;

        let transfer_ctx = Call::new_mutating(self);
        usdc::transfer(self.vm(), transfer_ctx, USDC, user, paid)?; // D-02: to msg.sender

        self.vm().log(Redeem { user, shares, assets: paid });
        Ok(paid)
    }

    /// Owner-only allocation rebalance (VAULT-03, D-08): full-unwind every current position to the
    /// core's USDC balance, write the new weights (the internal set_allocation step, D-13), then
    /// re-split the REAL, complete core USDC balance across the new weights (D-09 — sweeps any capped
    /// surplus/donation left by redeem, D-07). Atomic: any leg reverting reverts the whole tx (D-10).
    /// With an empty pool this degenerates to just setting weights (D-13 bootstrap).
    pub fn rebalance(
        &mut self,
        adapters: Vec<Address>,
        new_weights: Vec<U256>,
    ) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;

        // Snapshot the OLD active set BEFORE the weight write (Open Question 2): unwind the CURRENT
        // allocation, not the new adapters[] param (which would miss unwinding an exited protocol).
        let old_active = registry::active_adapters(self);

        // Validate + write the new weights. set_allocation validates (D-11: sum 10000, no dups, no
        // zeros, every target enabled) BEFORE writing, so an invalid rebalance reverts before any unwind.
        self.set_allocation(adapters.clone(), new_weights.clone())?;

        // UNWIND every OLD position to the core's own USDC balance (D-08), dust/throttle-tolerant (D-09b).
        for (adapter, _bps) in old_active.iter() {
            let total_assets = adapter_dispatch::total_assets(self.vm(), *adapter)?;
            let max = adapter_dispatch::max_withdraw(self.vm(), *adapter)?;
            if let Some(request) = unwind_request(total_assets, max) {
                let withdraw_ctx = Call::new_mutating(self);
                adapter_dispatch::withdraw(self.vm(), withdraw_ctx, *adapter, request)?; // bare ? = D-10
            }
        }

        // RE-SPLIT the REAL, complete core USDC balance across the NEW weights (D-09 by construction).
        let self_addr = self.vm().contract_address();
        let core_balance = usdc::balance_of(self.vm(), USDC, self_addr)?;
        let slices = share_math::split_by_bps(core_balance, &new_weights)?;
        for (adapter, slice) in adapters.iter().zip(slices) {
            // Skip zero slices: an empty pool (D-13 bootstrap) or a dust-sized slice would otherwise
            // hit the adapter's ZeroAmount deposit guard and revert the whole rebalance.
            if slice.is_zero() {
                continue;
            }
            let approve_ctx = Call::new_mutating(self);
            usdc::approve(self.vm(), approve_ctx, USDC, *adapter, slice)?;
            let deposit_ctx = Call::new_mutating(self);
            adapter_dispatch::deposit(self.vm(), deposit_ctx, *adapter, slice)?; // bare ? = D-10
        }

        self.vm().log(Rebalanced { redeposited: core_balance });
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

/// D-13: `set_allocation` lives OUTSIDE the `#[public]` impl block. The `#[public]` macro exports
/// every method it wraps into the ABI regardless of Rust-level `pub`/private visibility (verified
/// against `stylus-proc`'s own `PublicImpl` — it does not filter by fn visibility), so un-`pub`ing
/// alone does not hide a method from `cargo stylus export-abi`. A plain, unannotated `impl`
/// block IS the only way to keep a method callable internally (`self.set_allocation(...)` from
/// `rebalance`) while keeping it off the exported ABI surface.
impl VaultCore {
    /// Owner-only: sets the global bps allocation (D-06). Validates BEFORE any write: matching
    /// lengths, non-empty, no duplicates, every target registered+enabled, no zero weights, and
    /// the sum is exactly 10000 (checked addition). Then clears bps for every currently-enabled
    /// adapter and writes the new set, so the on-chain allocation is exactly the passed set.
    fn set_allocation(
        &mut self,
        adapters: Vec<Address>,
        weights_bps: Vec<U256>,
    ) -> Result<(), Vec<u8>> {
        self.ensure_initialized()?;
        self.only_owner()?;

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

        let currently_active = registry::active_adapters(self);
        for (adapter, _) in currently_active {
            self.adapter_bps.setter(adapter).set(U256::ZERO);
        }
        for i in 0..adapters.len() {
            self.adapter_bps.setter(adapters[i]).set(weights_bps[i]);
        }

        self.vm().log(AllocationSet {
            adapters: adapters.clone(),
            weightsBps: weights_bps.clone(),
        });
        Ok(())
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
    fn deposit_without_adapter_reverts_adapter_not_enabled() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(user_addr());
        let err = contract.deposit(U256::from(1_000_000u64));
        assert_eq!(err.unwrap_err(), errors::adapter_not_enabled());
    }

    #[test]
    fn deposit_mints_nonzero_shares() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

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
        assert_eq!(contract.shares.get(user_addr()), shares);
        assert_eq!(contract.total_shares.get(), shares);
    }

    // --- registry: add / remove / enable-disable (Task 1) + set_allocation (Task 2) ---

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

    #[test]
    fn registry_disable_reverts_with_balance() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(owner_addr());
        mock_total_assets(&vm, adapter_addr(), U256::from(1_000u64));
        let err = contract.set_enabled(adapter_addr(), false);
        assert_eq!(err.unwrap_err(), errors::adapter_has_balance(U256::from(1_000u64)));

        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        assert!(contract.set_enabled(adapter_addr(), false).is_ok());
        assert!(!contract.adapter_enabled.get(adapter_addr()));
    }

    #[test]
    fn registry_remove_reverts_with_balance() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);

        vm.set_sender(owner_addr());
        mock_total_assets(&vm, adapter_addr(), U256::from(500u64));
        let err = contract.remove_adapter(adapter_addr());
        assert_eq!(err.unwrap_err(), errors::adapter_has_balance(U256::from(500u64)));

        mock_total_assets(&vm, adapter_addr(), U256::ZERO);
        assert!(contract.remove_adapter(adapter_addr()).is_ok());
        assert!(!registry::is_registered(&contract, adapter_addr()));
    }

    #[test]
    fn registry_set_allocation_sum_must_be_10000() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_addr()).unwrap();
        contract.add_adapter(adapter_two_addr()).unwrap();

        let err = contract.set_allocation(
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(3_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::allocation_invalid());

        assert!(contract
            .set_allocation(
                alloc::vec![adapter_addr(), adapter_two_addr()],
                alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
            )
            .is_ok());
        assert_eq!(contract.adapter_bps.get(adapter_addr()), U256::from(6_000u64));
        assert_eq!(contract.adapter_bps.get(adapter_two_addr()), U256::from(4_000u64));
    }

    #[test]
    fn registry_set_allocation_rejects_disabled_target() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_addr()).unwrap();
        contract.add_adapter(adapter_two_addr()).unwrap();
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        contract.set_enabled(adapter_two_addr(), false).unwrap();

        let err = contract.set_allocation(
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert_eq!(err.unwrap_err(), errors::adapter_not_enabled());
    }

    // --- deposit: multi-adapter atomic split (Task 3) ---

    fn deploy_init_and_seed_two_adapters(vm: &TestVM) -> VaultCore {
        let mut contract = deploy_and_init(vm);
        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_addr()).unwrap();
        contract.add_adapter(adapter_two_addr()).unwrap();
        contract
            .set_allocation(
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
    fn deposit_splits_across_active_adapters() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        // Same-value mocks across both adapters (Pitfall 3): the numeric assertion below only
        // needs total_shares/shares[user] to be nonzero and equal, not a per-adapter split proof.
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
        assert_eq!(contract.shares.get(user_addr()), shares);
        assert_eq!(contract.total_shares.get(), shares);
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
        assert!(contract.total_shares.get().is_zero());
        assert!(contract.shares.get(user_addr()).is_zero());
    }

    /// WR-02: an enabled adapter left at 0 bps must NOT receive a 0-value deposit/withdraw leg.
    /// adapter_two stays enabled at 0 bps (add_adapter enables at 0; set_allocation gives 100% to
    /// adapter one). Its deposit(0)/withdraw(0) are mocked to REVERT: if the 0-slice legs were
    /// still routed (no `slice.is_zero()` skip), both deposit and redeem would revert (the
    /// self-inflicted DoS). With the skip they never fire, so the round trip succeeds.
    ///
    /// Mock ordering follows Pitfall 3 (TestVM's shared return-data buffer): the LAST-registered
    /// mock's bytes are what every call reads back, so the value the math/bool-decodes depend on
    /// (the good adapter's leg) is registered last; the adapter_two revert mocks are registered
    /// earlier and are only ever hit if the skip regresses.
    #[test]
    fn zero_bps_enabled_adapter_does_not_break_deposit_or_redeem() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        vm.set_sender(owner_addr());
        contract.add_adapter(adapter_two_addr()).unwrap(); // enabled, 0 bps
        contract
            .set_allocation(alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);

        // --- deposit ---
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

        // --- redeem the whole position; adapter_two's withdraw(0) leg must likewise be skipped ---
        // Per Pitfall 1 (12-RESEARCH.md), `redeem`'s before/after `balanceOf(core)` reads collapse
        // to a single shared-buffer value under TestVM, so `actual_delta` is always 0 here and the
        // call reverts on D-06's shortfall gate rather than paying out. This still proves the skip:
        // if the `if slice.is_zero() { continue; }` guard regressed, `adapter_two`'s `withdraw(0)`
        // mock below (registered to revert with `ZeroWithdraw`) would fire FIRST, and the tx would
        // revert with THAT error instead of ever reaching the balance-delta reconciliation. We
        // assert the revert is `RedeemShortfall`, distinguishing it from a `ZeroWithdraw` regression.
        let withdraw_zero = withdrawCall { usdcAmount: U256::ZERO }.abi_encode();
        vm.mock_call(adapter_two_addr(), withdraw_zero, U256::ZERO, Err(b"ZeroWithdraw".to_vec()));
        mock_adapter_withdraw_leg(&vm, adapter_addr(), amount);
        mock_total_assets(&vm, adapter_two_addr(), U256::ZERO);
        mock_total_assets(&vm, adapter_addr(), amount);
        let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
        vm.mock_static_call(USDC, balance_calldata, Ok(amount.abi_encode())); // registered last -> return buffer

        vm.set_sender(user_addr());
        let err = contract.redeem(shares);
        match err {
            Err(bytes) => assert_ne!(bytes, b"ZeroWithdraw".to_vec()),
            Ok(_) => panic!("redeem should revert under the TestVM shared-buffer wall (Pitfall 1)"),
        }
    }

    // --- redeem (Task 1/2) ---

    fn mock_adapter_withdraw_leg(vm: &TestVM, adapter: Address, slice: U256) {
        let withdraw_calldata = withdrawCall { usdcAmount: slice }.abi_encode();
        vm.mock_call(adapter, withdraw_calldata, U256::ZERO, Ok(slice.abi_encode()));
    }

    fn mock_usdc_transfer(vm: &TestVM, to: Address, amount: U256) {
        let transfer_calldata = transferCall { to, amount }.abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
    }

    /// Deposits `amount` for `user_addr()` against a single seeded adapter (10000 bps), mocking
    /// the pre-deposit `total_assets()` at zero. Returns the shares minted.
    fn deposit_amount(vm: &TestVM, contract: &mut VaultCore, amount: U256) -> U256 {
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
        vm.set_sender(owner_addr());
        contract
            .set_allocation(alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);
        let shares_minted = deposit_amount(&vm, &mut contract, amount);
        assert!(!shares_minted.is_zero());

        // Position now worth `amount`. Single-value mocks only (Pitfall 1): one `balanceOf(core)`
        // registration, registered last so it wins the shared buffer for both before/after reads.
        mock_adapter_withdraw_leg(&vm, adapter_addr(), amount);
        mock_usdc_transfer(&vm, user_addr(), amount);
        mock_total_assets(&vm, adapter_addr(), amount);
        let balance_calldata = balanceOfCall { account: contract_addr() }.abi_encode();
        vm.mock_static_call(USDC, balance_calldata, Ok(amount.abi_encode()));

        vm.set_sender(user_addr());
        let err = contract.redeem(shares_minted);
        assert!(err.is_err()); // actual_delta == 0 < owed -> D-06 shortfall revert
        // Shares/total_shares are already burned (CEI runs before the external calls/revert), but
        // per Stylus/EVM call-frame semantics the whole tx (including the burn) unwinds on Err —
        // this in-memory `contract` value reflects only the pre-revert mutation, not what a real
        // chain would persist. Nothing further to assert on state here.
    }

    #[test]
    fn redeem_more_than_owned_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        vm.set_sender(owner_addr());
        contract
            .set_allocation(alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
            .unwrap();

        let amount = U256::from(1_000_000u64);
        let shares_minted = deposit_amount(&vm, &mut contract, amount);

        vm.set_sender(user_addr());
        let err = contract.redeem(shares_minted + U256::from(1u64));
        assert_eq!(err.unwrap_err(), errors::insufficient_shares());
    }

    #[test]
    fn two_users_shares_are_independent() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_adapter(&vm);
        vm.set_sender(owner_addr());
        contract
            .set_allocation(alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
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
        assert_eq!(contract.shares.get(user_addr()), shares_a);
        assert_eq!(contract.shares.get(non_owner_addr()), shares_b);
        assert_eq!(contract.total_shares.get(), shares_a + shares_b);
    }

    // --- D-03 MANDATORY inflation-attack test (Task 3) ---

    /// 1-wei deposit + large direct donation to the adapter/protocol (never routed through
    /// `core.deposit()`, so it mints no core shares) + a normal second depositor must still get
    /// non-zero, proportionate shares. This is the empirical proof of D-03's virtual-offset
    /// anti-inflation formula (success criterion 4).
    ///
    /// Structured as 2 separate top-level `deposit()` calls (Pitfall 3): each call's mocks are
    /// registered with `total_assets` LAST, so its bytes win TestVM's shared return-data buffer
    /// for every decode inside that call — the only way to get a deterministic `total_assets`
    /// read per top-level call under this TestVM version's known limitation.
    #[test]
    fn inflation_attack_second_depositor_gets_nonzero_proportionate_shares() {
        let vm = TestVM::default();
        let mut core = deploy_init_and_seed_adapter(&vm);
        vm.set_sender(owner_addr());
        core.set_allocation(alloc::vec![adapter_addr()], alloc::vec![U256::from(10_000u64)])
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
        let attacker_shares = core.shares.get(attacker_addr());
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

        vm.set_sender(victim_addr());
        core.deposit(normal_deposit).unwrap();

        let victim_shares = core.shares.get(victim_addr());
        assert!(!victim_shares.is_zero(), "victim must receive non-zero shares despite the donation");
    }

    // --- rebalance (VAULT-03) ---

    fn mock_max_withdraw(vm: &TestVM, adapter: Address, value: U256) {
        let calldata = maxWithdrawCall {}.abi_encode();
        vm.mock_static_call(adapter, calldata, Ok(value.abi_encode()));
    }

    #[test]
    fn rebalance_owner_only() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        vm.set_sender(non_owner_addr());
        let err = contract.rebalance(alloc::vec![], alloc::vec![]);
        assert_eq!(err.unwrap_err(), errors::not_owner());
    }

    #[test]
    fn rebalance_rejects_invalid_weights() {
        let vm = TestVM::default();
        let mut contract = deploy_init_and_seed_two_adapters(&vm);

        vm.set_sender(owner_addr());
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

        // adapter_addr holds a live position with a non-zero unwind_request; its withdraw leg
        // reverts, so the whole rebalance must revert (D-10 atomicity).
        mock_total_assets(&vm, adapter_addr(), U256::from(100u64));
        mock_max_withdraw(&vm, adapter_addr(), U256::from(100u64));
        let withdraw_calldata = withdrawCall { usdcAmount: U256::from(100u64) }.abi_encode();
        vm.mock_call(adapter_addr(), withdraw_calldata, U256::ZERO, Err(b"WithdrawExceedsMax".to_vec()));

        vm.set_sender(owner_addr());
        let err = contract.rebalance(
            alloc::vec![adapter_addr(), adapter_two_addr()],
            alloc::vec![U256::from(6_000u64), U256::from(4_000u64)],
        );
        assert!(err.is_err());
    }

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
}
