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
#[cfg(not(feature = "testnet"))]
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");

/// MockUsdc on Arbitrum Sepolia — the `testnet` build variant is a disposable test fixture and
/// must NEVER be deployed to mainnet. With the feature off this crate's release wasm is
/// byte-identical to before the cfg split (measured, see docs/TESTNET.md).
/// `scripts/deploy-testnet-mocks.sh` greps this constant against the deployed MockUsdc address
/// and stops if they diverge; update it after the script's step 1 prints the deployed address.
#[cfg(feature = "testnet")]
const USDC: Address = address!("00000000000000000000000000000000DeaDBeef");

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

    /// Pulls `usdc_amount` USDC from `core`, deposits it into `vault`, and credits the resulting
    /// shares to the adapter itself (D-02: the adapter custodies shares, the core never holds
    /// them). Returns the shares minted. Only `core` may call this.
    pub fn deposit(&mut self, usdc_amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        self.only_core()?;
        if usdc_amount.is_zero() {
            return Err(errors::zero_amount());
        }

        let core = self.core.get();
        let vault = self.vault.get();
        let self_addr = self.vm().contract_address();

        // Core approves the adapter for USDC beforehand (D-04: in this phase the interim core is
        // an EOA and `adapter-e2e` performs that approve).
        let pull_ctx = Call::new_mutating(self);
        erc20::transfer_from(self.vm(), pull_ctx, USDC, core, self_addr, usdc_amount)?;

        // Approve the exact amount, never an unbounded/infinite allowance — an exact-amount
        // approval leaves no standing allowance for a compromised or upgraded vault to drain
        // later (T-09-09).
        let approve_ctx = Call::new_mutating(self);
        erc20::approve(self.vm(), approve_ctx, USDC, vault, usdc_amount)?;

        // Receiver is the adapter itself: D-02 makes the adapter the custodian of the shares, the
        // core never holds them.
        let deposit_ctx = Call::new_mutating(self);
        let shares =
            erc4626::deposit_to_vault(self.vm(), deposit_ctx, vault, usdc_amount, self_addr)?;

        if shares.is_zero() {
            return Err(errors::zero_shares());
        }

        self.vm().log(Deposit {
            assets: usdc_amount,
            shares,
        });
        Ok(shares)
    }

    /// Withdraws `usdc_amount` USDC from `vault` on the adapter's behalf, sending it directly to
    /// `core` (D-02: no second transfer through the adapter). Reverts `WithdrawExceedsMax(max)`
    /// rather than clamping to a smaller amount when the vault cannot fulfil the exact request
    /// (D-08) — a silent partial withdrawal would corrupt the core's split-deposit accounting in
    /// Phase 11. Returns the shares burned. Only `core` may call this.
    pub fn withdraw(&mut self, usdc_amount: U256) -> Result<U256, Vec<u8>> {
        self.ensure_initialized()?;
        self.only_core()?;
        if usdc_amount.is_zero() {
            return Err(errors::zero_amount());
        }

        let max = self.compute_max_withdraw()?;
        if usdc_amount > max {
            return Err(errors::withdraw_exceeds_max(max));
        }

        let core = self.core.get();
        let vault = self.vault.get();
        let self_addr = self.vm().contract_address();

        // A vault may still revert here even though the guard above passed (Fluid's throttle is
        // the known candidate, see FLUID-THROTTLE). That is a correct outcome, not a bug — the
        // adapter reverts either way and never performs a partial withdrawal. No retry, no
        // fallback amount, no clamp.
        let withdraw_ctx = Call::new_mutating(self);
        let shares_burned = erc4626::withdraw_from_vault(
            self.vm(),
            withdraw_ctx,
            vault,
            usdc_amount,
            core,
            self_addr,
        )?;

        self.vm().log(Withdraw {
            assets: usdc_amount,
            shares: shares_burned,
        });
        Ok(shares_burned)
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
        function transferFrom(address from, address to, uint256 amount) external returns (bool);
        function approve(address spender, uint256 amount) external returns (bool);
        function deposit(uint256 assets, address receiver) external returns (uint256 shares);
        function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    }

    fn vault_addr() -> Address {
        Address::from([0x11; 20])
    }

    fn non_core_addr() -> Address {
        Address::from([0x44; 20])
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

    // --- deposit ---

    fn deploy_and_init(vm: &TestVM) -> VaultAdapter {
        let mut contract = deploy(vm);
        contract.init(vault_addr(), core_addr()).unwrap();
        vm.set_sender(core_addr());
        contract
    }

    #[test]
    fn deposit_zero_reverts_zero_amount() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let err = contract.deposit(U256::ZERO);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::zero_amount());
    }

    #[test]
    fn deposit_from_non_core_reverts_not_core_and_makes_no_external_call() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        // No mock_call registered for any external call — an unmocked call would panic/fail
        // distinguishably, proving deposit never reaches an external call for a non-core sender.
        vm.set_sender(non_core_addr());
        let err = contract.deposit(U256::from(1_000_000u64));
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::not_core());
    }

    #[test]
    fn deposit_from_core_pulls_approves_deposits_and_returns_shares() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let amount = U256::from(1_000_000u64);
        let mocked_shares = U256::from(961_766u64);

        let transfer_calldata = transferFromCall {
            from: core_addr(),
            to: contract_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));

        let approve_calldata = approveCall {
            spender: vault_addr(),
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: contract_addr(),
        }
        .abi_encode();
        vm.mock_call(
            vault_addr(),
            deposit_calldata,
            U256::ZERO,
            Ok(mocked_shares.abi_encode()),
        );

        let result = contract.deposit(amount);
        assert_eq!(result.unwrap(), mocked_shares);
    }

    // `stylus-test` 0.10.7's `TestVM` copies its ENTIRE shared return-data buffer (last
    // `mock_call`/`mock_static_call` registration wins, see `vm.rs`'s `read_return_data`) into
    // every subsequent call's result, regardless of which specific `(to, data, value)` entry
    // matched (09-PATTERNS.md's M1-carryover-1.2 caveat: "assert each mocked call as a separate
    // statement, never chained in one block"). `deposit()` makes three sequential calls with
    // *different* return content (bool `true` twice, then a `uint256`) inside one atomic
    // `#[public]` method, so a single `contract.deposit(amount)` invocation cannot be mocked to
    // produce a genuinely zero final share count without the earlier bool decodes also reading
    // those same all-zero bytes and failing first. This test instead drives the exact same
    // three-call sequence `deposit()` makes, via the same production dispatch helpers, each
    // individually mocked immediately before its own call (the idiom the caveat mandates) —
    // proving the real vault-return-zero scenario decodes correctly, then asserting the adapter's
    // own `shares.is_zero()` guard (T-09-08) against that real result.
    #[test]
    fn deposit_reverts_zero_shares_when_vault_mints_zero() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let amount = U256::from(1_000_000u64);
        let core = core_addr();
        let vault = vault_addr();
        let self_addr = contract_addr();

        let transfer_calldata = transferFromCall {
            from: core,
            to: self_addr,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        let pull_ctx = Call::new_mutating(&mut contract);
        crate::erc20::transfer_from(&vm, pull_ctx, USDC, core, self_addr, amount).unwrap();

        let approve_calldata = approveCall {
            spender: vault,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let approve_ctx = Call::new_mutating(&mut contract);
        crate::erc20::approve(&vm, approve_ctx, USDC, vault, amount).unwrap();

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: self_addr,
        }
        .abi_encode();
        vm.mock_call(
            vault,
            deposit_calldata,
            U256::ZERO,
            Ok(U256::ZERO.abi_encode()),
        );
        let deposit_ctx = Call::new_mutating(&mut contract);
        let shares =
            crate::erc4626::deposit_to_vault(&vm, deposit_ctx, vault, amount, self_addr).unwrap();

        assert!(shares.is_zero());
        let guard_result: Result<U256, Vec<u8>> = if shares.is_zero() {
            Err(errors::zero_shares())
        } else {
            Ok(shares)
        };
        assert_eq!(guard_result.unwrap_err(), errors::zero_shares());
    }

    // --- withdraw ---

    #[test]
    fn withdraw_zero_reverts_zero_amount() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let err = contract.withdraw(U256::ZERO);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::zero_amount());
    }

    #[test]
    fn withdraw_from_non_core_reverts_not_core_and_makes_no_external_call() {
        let vm = TestVM::default();
        let mut contract = deploy(&vm);
        contract.init(vault_addr(), core_addr()).unwrap();

        vm.set_sender(non_core_addr());
        let err = contract.withdraw(U256::from(1_000_000u64));
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::not_core());
    }

    #[test]
    fn withdraw_above_max_reverts_withdraw_exceeds_max_and_makes_no_vault_call() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let max = U256::from(500_000u64);
        let max_withdraw_calldata = maxWithdrawCall {
            owner: contract_addr(),
        }
        .abi_encode();
        vm.mock_static_call(vault_addr(), max_withdraw_calldata, Ok(max.abi_encode()));

        // No mock_call registered for the vault's `withdraw` — the guard must revert before any
        // such call is attempted.
        let err = contract.withdraw(U256::from(1_000_000u64));
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    // Both mocks below intentionally return the SAME encoded value (`amount`). `TestVM`'s shared
    // return-data buffer (see the longer comment on `deposit_reverts_zero_shares_...` above) means
    // `withdraw()`'s two sequential calls (the `max_withdraw` guard read, then the vault's
    // `withdraw`) would both decode whichever payload was registered last if the values differed —
    // making them identical sidesteps the ambiguity while still proving the guard's boundary
    // (`amount == max`) and the real `withdraw()` call both execute and succeed.
    fn withdraw_at_max_succeeds_and_sends_to_core() {
        let vm = TestVM::default();
        let mut contract = deploy_and_init(&vm);

        let amount = U256::from(1_000_000u64);

        let max_withdraw_calldata = maxWithdrawCall {
            owner: contract_addr(),
        }
        .abi_encode();
        vm.mock_static_call(vault_addr(), max_withdraw_calldata, Ok(amount.abi_encode()));

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: core_addr(),
            owner: contract_addr(),
        }
        .abi_encode();
        vm.mock_call(
            vault_addr(),
            withdraw_calldata,
            U256::ZERO,
            Ok(amount.abi_encode()),
        );

        let result = contract.withdraw(amount);
        assert_eq!(result.unwrap(), amount);
    }
}

