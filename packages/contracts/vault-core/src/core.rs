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
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");

/// Total basis-points an allocation must sum to exactly (D-06).
const TOTAL_BPS: U256 = U256::from_limbs([10_000u64, 0, 0, 0]);

sol! {
    event Initialized(address indexed owner);
    event Deposit(address indexed user, uint256 assets, uint256 shares);
    event AdapterAdded(address indexed adapter);
    event AdapterEnabled(address indexed adapter, bool enabled);
    event AdapterRemoved(address indexed adapter);
    event AllocationSet(address[] adapters, uint256[] weightsBps);
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

    /// Owner-only: sets the global bps allocation (D-06). Validates BEFORE any write: matching
    /// lengths, non-empty, no duplicates, every target registered+enabled, no zero weights, and
    /// the sum is exactly 10000 (checked addition). Then clears bps for every currently-enabled
    /// adapter and writes the new set, so the on-chain allocation is exactly the passed set.
    pub fn set_allocation(
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

    /// Minimal single-adapter deposit: pulls `amount` USDC from the caller, routes it to the
    /// single active adapter (index 0), and mints offset-based shares. Full bps-weighted
    /// multi-adapter split lands in Plan 02.
    pub fn deposit(&mut self, amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        if amount.is_zero() {
            return Err(errors::zero_amount());
        }
        if self.adapters.is_empty() {
            return Err(errors::adapter_not_enabled());
        }
        let adapter = self.adapters.get(0).ok_or_else(errors::adapter_not_enabled)?;
        if !self.adapter_enabled.get(adapter) {
            return Err(errors::adapter_not_enabled());
        }

        // Snapshot total_assets BEFORE any external mutating call (Pitfall 2/T-11-02): reading it
        // after the deposit lands would dilute the depositor against their own contribution.
        let total_assets_before = adapter_dispatch::total_assets(self.vm(), adapter)?;

        let user = self.vm().msg_sender();
        let self_addr = self.vm().contract_address();

        let pull_ctx = Call::new_mutating(self);
        usdc::transfer_from(self.vm(), pull_ctx, USDC, user, self_addr, amount)?;

        let approve_ctx = Call::new_mutating(self);
        usdc::approve(self.vm(), approve_ctx, USDC, adapter, amount)?;

        // Bare `?`: any adapter revert reverts the whole tx atomically (D-09), Stylus/EVM
        // call-frame semantics give this for free, no manual rollback needed.
        let deposit_ctx = Call::new_mutating(self);
        adapter_dispatch::deposit(self.vm(), deposit_ctx, adapter, amount)?;

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
}
