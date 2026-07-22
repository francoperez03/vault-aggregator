//! `VaultAdapter`'s single public-methods impl block (the entrypoint macro forbids more than one
//! per contract type, M1 carryover): `init`, `deposit`, `withdraw`, `total_assets`, `max_withdraw`
//! — the D-03 four-function surface plus one-shot `init`. Guard-before-mutate convention matches
//! `cfp-faucet/src/faucet.rs`: every mutating method calls private `Result`-returning guards
//! first, before any state write or external call.

use alloc::vec::Vec;

use alloy_primitives::{address, Address, U256};
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

use crate::erc20;
use crate::erc4626;
use crate::errors;
use crate::VaultAdapter;

/// Native USDC on Arbitrum One (D-02: the aggregator is USDC-only). Compile-time constant, not
/// a stored field or constructor argument — every deployed instance targets the same USDC.
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");

sol! {
    event Initialized(address indexed vault, address indexed core);
    event Deposit(uint256 assets, uint256 shares);
    event Withdraw(uint256 assets, uint256 shares);
}

#[public]
impl VaultAdapter {
    /// Sets `vault`/`core` once. Not a constructor-time init (D-04: the interim core is an EOA
    /// operating the adapter directly, not a factory-deployed contract) and there is no setter
    /// for either field afterwards (D-01: immutable config after this call).
    pub fn init(&mut self, vault: Address, core: Address) -> Result<(), Vec<u8>> {
        if self.initialized.get() {
            return Err(errors::already_initialized());
        }
        if vault.is_zero() {
            return Err(errors::zero_address());
        }
        if core.is_zero() {
            return Err(errors::zero_address());
        }

        self.vault.set(vault);
        self.core.set(core);
        self.initialized.set(true);

        self.vm().log(Initialized { vault, core });
        Ok(())
    }

    /// Reads the adapter's own USDC-denominated position: `convertToAssets(balanceOf(adapter))`.
    /// Public view, no `only_core` gate (D-03: views are public).
    pub fn total_assets(&self) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        let self_addr = self.vm().contract_address();
        let shares = erc20::balance_of(self.vm(), self.vault.get(), self_addr)?;
        erc4626::convert_to_assets(self.vm(), self.vault.get(), shares)
    }

    /// Reads the vault's `maxWithdraw(adapter)`, USDC-denominated. Per FLUID-THROTTLE
    /// (`docs/PROTOCOL-PROBES.md`), this interface answer is not unconditionally trustworthy on
    /// Fluid — callers should not treat it as a hard ceiling without a live boundary check.
    pub fn max_withdraw(&self) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        self.compute_max_withdraw()
    }

    /// Reverts unless the caller is the address fixed at `init`.
    fn only_core(&self) -> Result<(), Vec<u8>> {
        if self.vm().msg_sender() != self.core.get() {
            return Err(errors::not_core());
        }
        Ok(())
    }

    /// Reverts unless `init` has been called, so an uninitialised adapter can never dispatch a
    /// call against `address(0)`.
    fn ensure_initialized(&self) -> Result<(), Vec<u8>> {
        if !self.initialized.get() {
            return Err(errors::not_initialized());
        }
        Ok(())
    }

    /// Single source of truth for the vault's asset-exact withdrawable ceiling — factored out so
    /// `max_withdraw()`'s view and `withdraw()`'s guard can never drift from each other
    /// (PROTOCOL-PROBES.md's WITHDRAW-PATH verdict: `maxWithdraw()` is available directly on all
    /// three Phase 9 production vaults, no `redeem()`+`convertToShares` fallback needed).
    fn compute_max_withdraw(&self) -> Result<U256, Vec<u8>> {
        let self_addr = self.vm().contract_address();
        erc4626::max_withdraw(self.vm(), self.vault.get(), self_addr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::{SolCall, SolValue};
    use stylus_sdk::testing::TestVM;

    // Local mirrors of erc20.rs/erc4626.rs's `sol!` bindings, so this module can compute exact
    // calldata to match against `TestVM::mock_static_call` without depending on those modules'
    // private generated types (same idiom as `cfp-faucet/src/faucet.rs`'s test-local `mint` mirror).
    sol! {
        function balanceOf(address account) external view returns (uint256);
        function convertToAssets(uint256 shares) external view returns (uint256 assets);
        function maxWithdraw(address owner) external view returns (uint256 maxAssets);
    }

    fn vault_addr() -> Address {
        Address::from([0x11; 20])
    }

    fn core_addr() -> Address {
        Address::from([0x22; 20])
    }

    fn contract_addr() -> Address {
        Address::from([0x99; 20])
    }

    fn deploy(vm: &TestVM) -> VaultAdapter {
        vm.set_contract_address(contract_addr());
        VaultAdapter::from(vm)
    }

    // --- init ---

    #[test]
    fn init_succeeds_and_sets_storage() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        assert!(contract.init(vault_addr(), core_addr()).is_ok());
        assert_eq!(contract.vault.get(), vault_addr());
        assert_eq!(contract.core.get(), core_addr());
        assert!(contract.initialized.get());
    }

    #[test]
    fn init_twice_reverts_already_initialized() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        assert!(contract.init(vault_addr(), core_addr()).is_ok());
        let err = contract.init(vault_addr(), core_addr());
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::already_initialized());
    }

    #[test]
    fn init_zero_vault_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        let err = contract.init(Address::ZERO, core_addr());
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::zero_address());
    }

    #[test]
    fn init_zero_core_reverts() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);

        let err = contract.init(vault_addr(), Address::ZERO);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::zero_address());
    }

    // --- views ---

    #[test]
    fn total_assets_before_init_reverts_not_initialized() {
        let vm = TestVM::default();
        let contract = deploy(&vm);

        let err = contract.total_assets();
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::not_initialized());
    }

    #[test]
    fn total_assets_after_init_returns_mocked_value() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        let shares = U256::from(961_766u64);
        let assets = U256::from(999_999u64);

        let balance_calldata = balanceOfCall {
            account: contract_addr(),
        }
        .abi_encode();
        vm.mock_static_call(vault_addr(), balance_calldata, Ok(shares.abi_encode()));

        let convert_calldata = convertToAssetsCall { shares }.abi_encode();
        vm.mock_static_call(vault_addr(), convert_calldata, Ok(assets.abi_encode()));

        let result = contract.total_assets();
        assert_eq!(result.unwrap(), assets);
    }

    #[test]
    fn max_withdraw_after_init_returns_mocked_value() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        let max = U256::from(6_783_400u64);
        let calldata = maxWithdrawCall {
            owner: contract_addr(),
        }
        .abi_encode();
        vm.mock_static_call(vault_addr(), calldata, Ok(max.abi_encode()));

        let result = contract.max_withdraw();
        assert_eq!(result.unwrap(), max);
    }

    // --- only_core ---

    #[test]
    fn only_core_rejects_non_core_sender() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        vm.set_sender(Address::from([0x33; 20]));
        let err = contract.only_core();
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::not_core());
    }

    #[test]
    fn only_core_allows_core_sender() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        vm.set_sender(core_addr());
        assert!(contract.only_core().is_ok());
    }
}
