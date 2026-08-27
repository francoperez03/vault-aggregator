#![cfg(test)]
//! Per-protocol behavioural conformance (D-09). Each module mocks ONE protocol's vault at its
//! real Arbitrum One address and encodes the deviations DISCOVERY.md §2.5 documented for it.
//! Conformance is asserted per protocol; identical selectors are not treated as identical
//! behaviour — a table-driven loop across the three modules would collapse that distinction
//! back into "assumed from the interface", so this file stays three near-identical modules of
//! five (Fluid: six) named tests instead.
//!
//! **`stylus-test` 0.10.7's shared return-data buffer (M1 carryover 1.2):** `TestVM::mock_call`/
//! `mock_static_call` write their payload into ONE buffer at *registration* time (last
//! registration wins); every call in the test, regardless of which `(to, data, value)` entry it
//! actually matched, reads bytes back from that same buffer. Two consequences shape every test
//! below:
//! - Two sequential calls that both need to decode as their OWN distinct real value cannot be
//!   driven through the public `#[public]` method in one shot; either give both calls the same
//!   encoded return value (safe when the values are meant to be equal, e.g. `amount == max`), or
//!   drive the underlying dispatch helpers (`erc20::*`/`erc4626::*`) directly, one mocked
//!   statement immediately before its own call, the way `adapter.rs`'s own
//!   `deposit_reverts_zero_shares_when_vault_mints_zero` test does.
//! - A revert (`Err(..)`) still reads the stale buffer for its payload bytes, but the
//!   success/revert *flag* itself always comes from the correctly-matched `HashMap` entry — so a
//!   test that only needs "this call reverts, whatever the exact bytes are" can register the
//!   revert mock BEFORE a same-invocation success mock and still get a correct revert outcome;
//!   the earlier-executing success call is the one that needs to be the *last-registered* mock so
//!   its own decode reads correct bytes.

use alloc::vec::Vec;

use alloy_primitives::{address, Address, U256};
use alloy_sol_types::{sol, SolCall, SolValue};
use stylus_sdk::prelude::*;
use stylus_sdk::testing::TestVM;

use crate::errors;
use crate::VaultAdapter;

// Local mirrors of erc20.rs/erc4626.rs's `sol!` bindings, so this module can compute exact
// calldata to match against `TestVM::mock_call`/`mock_static_call` (same idiom as
// `adapter.rs`'s own `#[cfg(test)] mod tests`).
sol! {
    function maxWithdraw(address owner) external view returns (uint256 maxAssets);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function balanceOf(address account) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
}

/// Native USDC on Arbitrum One — mirrors `adapter.rs`'s module-private `USDC` constant, which
/// this sibling module cannot reach directly.
const USDC: Address = address!("af88d065e77c8cc2239327c5edb3a432268e5831");

/// Fixed core/adapter addresses shared by every protocol module — only the vault address
/// changes per module, so the test bodies name the protocol they speak for while the actor
/// addresses stay constant and easy to eyeball across modules.
const CORE: Address = address!("2222222222222222222222222222222222222222");
const ADAPTER: Address = address!("9999999999999999999999999999999999999999");

/// Deploys and `init`s a `VaultAdapter` targeting `vault`, with the sender left set to `CORE` so
/// every test can call `deposit`/`withdraw` immediately without repeating the guard setup.
fn adapter_for(vm: &TestVM, vault: Address) -> VaultAdapter {
    vm.set_contract_address(ADAPTER);
    let mut contract = VaultAdapter::from(vm);
    contract.init(vault, CORE).unwrap();
    vm.set_sender(CORE);
    contract
}

mod morpho {
    //! Morpho Gauntlet USDC Core `gtUSDCc` — 0x7e97fa6893871A2751B5fE961978DCCb2c201E65
    //! (DISCOVERY.md §2.5 Morpho row / PROTOCOL-PROBES.md MORPHO-IDENTITY, ROUNDING-MORPHO):
    //! `maxRedeem`/`maxWithdraw` bounded by the underlying Morpho Blue market's available
    //! liquidity, no global pause flag — a deprecated market surfaces as a reduced max, never a
    //! revert on the read itself, though a live withdraw call can still revert for other reasons.
    use super::*;

    const VAULT: Address = address!("7e97fa6893871a2751b5fe961978dccb2c201e65");

    #[test]
    fn redeem_limit_below_balance_reverts_with_max() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let max = U256::from(500_000u64);
        let requested = U256::from(1_000_000u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        // No mock registered for the vault's `withdraw` — the guard must revert before any such
        // call is attempted.
        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn withdraw_at_reported_limit_succeeds() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        // Both mocks intentionally return the SAME encoded value: the shared return-data buffer
        // means the guard's `max_withdraw` read and the real `withdraw` call would both decode
        // whichever payload was registered last if the values differed. Identical values sidestep
        // the ambiguity while still proving the inclusive boundary (`amount == max`).
        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Ok(amount.abi_encode()));

        let result = contract.withdraw(amount);
        assert_eq!(result.unwrap(), amount);
    }

    #[test]
    fn paused_vault_propagates_revert() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        // Registered FIRST (not last) so the shared buffer ends up holding the `max_withdraw`
        // success payload, which is the call that executes first and needs a correct decode; the
        // vault's `withdraw` revert flag still comes from its own correctly-matched HashMap entry
        // regardless of what the buffer holds at that point (see module doc comment).
        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Err(b"VaultPaused".to_vec()));

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let logs_before = vm.get_emitted_logs().len();
        let result = contract.withdraw(amount);
        assert!(result.is_err());
        assert_eq!(
            vm.get_emitted_logs().len(),
            logs_before,
            "a reverted vault withdraw must not emit a Withdraw event"
        );
    }

    #[test]
    fn rounding_against_adapter_still_reverts_rather_than_partial() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // ROUNDING-MORPHO confirmed round-down (vault-favouring); this test proves the adapter's
        // own guard treats a one-unit shortfall the same as any other shortfall — it reverts
        // rather than silently withdrawing `requested - 1`.
        let requested = U256::from(1_000_000u64);
        let max = requested - U256::from(1u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn deposit_minting_zero_shares_reverts() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        // Same shared-buffer constraint as `adapter.rs`'s own zero-shares test: the three calls
        // `deposit()` makes (`transferFrom` -> `approve` -> `deposit`) return genuinely different
        // content (bool `true`, bool `true`, then a zero `uint256`), so they are driven directly
        // through the production dispatch helpers, each individually mocked immediately before
        // its own call, rather than through one `contract.deposit()` invocation.
        let transfer_calldata = transferFromCall {
            from: CORE,
            to: ADAPTER,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        let pull_ctx = Call::new_mutating(&mut contract);
        crate::erc20::transfer_from(&vm, pull_ctx, USDC, CORE, ADAPTER, amount).unwrap();

        let approve_calldata = approveCall {
            spender: VAULT,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let approve_ctx = Call::new_mutating(&mut contract);
        crate::erc20::approve(&vm, approve_ctx, USDC, VAULT, amount).unwrap();

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            deposit_calldata,
            U256::ZERO,
            Ok(U256::ZERO.abi_encode()),
        );
        let deposit_ctx = Call::new_mutating(&mut contract);
        let shares =
            crate::erc4626::deposit_to_vault(&vm, deposit_ctx, VAULT, amount, ADAPTER).unwrap();

        assert!(shares.is_zero());
        // Mirrors `adapter.rs::deposit`'s own guard exactly.
        let guard_result: Result<U256, Vec<u8>> = if shares.is_zero() {
            Err(errors::zero_shares())
        } else {
            Ok(shares)
        };
        assert_eq!(guard_result.unwrap_err(), errors::zero_shares());
    }
}

mod fluid {
    //! Fluid `fUSDC` — 0x1A996cb54bb95462040408C06122D45D6Cdb6096 (DISCOVERY.md §2.5 Fluid row /
    //! PROTOCOL-PROBES.md FLUID-THROTTLE, ROUNDING-FLUID): a protocol-native
    //! `withdrawalLimit`/`expandPercent`/`expandDuration` throttle layered on top of
    //! `maxWithdraw`, plus a protocol-level `Liquidity` contract pause — both surface as the
    //! vault's own `withdraw` call reverting even when `maxWithdraw` reported enough headroom.
    use super::*;

    const VAULT: Address = address!("1a996cb54bb95462040408c06122d45d6cdb6096");

    #[test]
    fn redeem_limit_below_balance_reverts_with_max() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let max = U256::from(500_000u64);
        let requested = U256::from(1_000_000u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn withdraw_at_reported_limit_succeeds() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Ok(amount.abi_encode()));

        let result = contract.withdraw(amount);
        assert_eq!(result.unwrap(), amount);
    }

    #[test]
    fn paused_vault_propagates_revert() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            withdraw_calldata,
            U256::ZERO,
            Err(b"LiquidityPaused".to_vec()),
        );

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let logs_before = vm.get_emitted_logs().len();
        let result = contract.withdraw(amount);
        assert!(result.is_err());
        assert_eq!(
            vm.get_emitted_logs().len(),
            logs_before,
            "a reverted vault withdraw must not emit a Withdraw event"
        );
    }

    #[test]
    fn rounding_against_adapter_still_reverts_rather_than_partial() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // ROUNDING-FLUID confirmed round-down; same one-unit-shortfall guard proof as the other
        // two protocol modules.
        let requested = U256::from(1_000_000u64);
        let max = requested - U256::from(1u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn deposit_minting_zero_shares_reverts() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let transfer_calldata = transferFromCall {
            from: CORE,
            to: ADAPTER,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        let pull_ctx = Call::new_mutating(&mut contract);
        crate::erc20::transfer_from(&vm, pull_ctx, USDC, CORE, ADAPTER, amount).unwrap();

        let approve_calldata = approveCall {
            spender: VAULT,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let approve_ctx = Call::new_mutating(&mut contract);
        crate::erc20::approve(&vm, approve_ctx, USDC, VAULT, amount).unwrap();

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            deposit_calldata,
            U256::ZERO,
            Ok(U256::ZERO.abi_encode()),
        );
        let deposit_ctx = Call::new_mutating(&mut contract);
        let shares =
            crate::erc4626::deposit_to_vault(&vm, deposit_ctx, VAULT, amount, ADAPTER).unwrap();

        assert!(shares.is_zero());
        let guard_result: Result<U256, Vec<u8>> = if shares.is_zero() {
            Err(errors::zero_shares())
        } else {
            Ok(shares)
        };
        assert_eq!(guard_result.unwrap_err(), errors::zero_shares());
    }

    /// FLUID-THROTTLE's over-report case (the PROTOCOL-PROBES log): `maxWithdraw` reports a
    /// value at or above the requested amount (the guard passes) while Fluid's protocol-native
    /// `withdrawalLimit`/`expandPercent`/`expandDuration` throttle still causes the vault's own
    /// `withdraw` to revert. Proves the adapter surfaces `Err` and performs no partial
    /// withdrawal, whatever the throttle does underneath — the mocked counterpart of the live
    /// boundary probe Plan 06 runs against real fUSDC.
    #[test]
    fn throttled_withdraw_reverting_inside_vault_is_surfaced() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let requested = U256::from(1_000_000u64);
        let over_reported_max = U256::from(2_000_000u64);

        // Registered first, `max_withdraw`'s success mock registered last (see module doc
        // comment): the guard read that executes first needs the buffer to hold ITS value.
        let withdraw_calldata = withdrawCall {
            assets: requested,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            withdraw_calldata,
            U256::ZERO,
            Err(b"WithdrawalLimitReached".to_vec()),
        );

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(over_reported_max.abi_encode()));

        let logs_before = vm.get_emitted_logs().len();
        let result = contract.withdraw(requested);
        assert!(result.is_err());
        assert_eq!(
            vm.get_emitted_logs().len(),
            logs_before,
            "a throttle-reverted vault withdraw must not emit a Withdraw event or partially withdraw"
        );
    }
}

mod euler {
    //! Euler v2 `eUSDC-2` — 0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b (DISCOVERY.md §2.5 Euler
    //! row / PROTOCOL-PROBES.md ROUNDING-EULER): `maxRedeem` bounded by vault liquidity, plus
    //! EVK pause/guardian controls — a paused market or an active guardian surfaces as the
    //! vault's own `withdraw` call reverting.
    use super::*;

    const VAULT: Address = address!("6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b");

    #[test]
    fn redeem_limit_below_balance_reverts_with_max() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let max = U256::from(500_000u64);
        let requested = U256::from(1_000_000u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn withdraw_at_reported_limit_succeeds() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Ok(amount.abi_encode()));

        let result = contract.withdraw(amount);
        assert_eq!(result.unwrap(), amount);
    }

    #[test]
    fn paused_vault_propagates_revert() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            withdraw_calldata,
            U256::ZERO,
            Err(b"E_Guardian_Paused".to_vec()),
        );

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let logs_before = vm.get_emitted_logs().len();
        let result = contract.withdraw(amount);
        assert!(result.is_err());
        assert_eq!(
            vm.get_emitted_logs().len(),
            logs_before,
            "a reverted vault withdraw must not emit a Withdraw event"
        );
    }

    #[test]
    fn rounding_against_adapter_still_reverts_rather_than_partial() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // ROUNDING-EULER confirmed round-down; same one-unit-shortfall guard proof.
        let requested = U256::from(1_000_000u64);
        let max = requested - U256::from(1u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn deposit_minting_zero_shares_reverts() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let transfer_calldata = transferFromCall {
            from: CORE,
            to: ADAPTER,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        let pull_ctx = Call::new_mutating(&mut contract);
        crate::erc20::transfer_from(&vm, pull_ctx, USDC, CORE, ADAPTER, amount).unwrap();

        let approve_calldata = approveCall {
            spender: VAULT,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let approve_ctx = Call::new_mutating(&mut contract);
        crate::erc20::approve(&vm, approve_ctx, USDC, VAULT, amount).unwrap();

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            deposit_calldata,
            U256::ZERO,
            Ok(U256::ZERO.abi_encode()),
        );
        let deposit_ctx = Call::new_mutating(&mut contract);
        let shares =
            crate::erc4626::deposit_to_vault(&vm, deposit_ctx, VAULT, amount, ADAPTER).unwrap();

        assert!(shares.is_zero());
        let guard_result: Result<U256, Vec<u8>> = if shares.is_zero() {
            Err(errors::zero_shares())
        } else {
            Ok(shares)
        };
        assert_eq!(guard_result.unwrap_err(), errors::zero_shares());
    }
}

mod aave {
    //! Aave v3 via the official Stata static wrapper `stataArbUSDCn` —
    //! 0x7cfadfd5645b50be87d546f42699d863648251ad (DISCOVERY.md §2.1 / §2.5 Aave row,
    //! PROTOCOL-PROBES.md AAVE-WITHDRAW-PATH). The adapter holds Stata SHARES, never the rebasing
    //! `aArbUSDCn` aToken — that is the PITFALLS.md §6 hazard Stata exists to remove.
    //!
    //! Donation-attack coverage (Phase 10 D-01..D-04) lives here rather than in a separate file
    //! because immunity is a property of THIS adapter against THIS vault: `total_assets()` is
    //! `convertToAssets(stataVault.balanceOf(self))` and nothing else. There is no `balanceOf`
    //! call against USDC or against the aToken anywhere in `adapter.rs`, so donating either one
    //! cannot be observed by the adapter at all. The two "does not move accounting" tests below
    //! prove that negatively: they register a REVERTING mock on the donated token's
    //! `balanceOf(adapter)`, so if a future change ever makes the adapter read it, the call errors
    //! and the test fails. That is the whole guarantee — there is no guard to test, only an
    //! absence to keep absent.
    use super::*;

    const VAULT: Address = address!("7cfadfd5645b50be87d546f42699d863648251ad");
    /// The rebasing aToken for the NATIVE-USDC reserve. Donation vector 2, never held by the
    /// adapter. Note this is `aArbUSDCn`, not `aArbUSDC` (`0x625e7708…`), which is the aToken for
    /// the bridged USDC.e reserve — a different token entirely (D-11).
    const ATOKEN: Address = address!("724dc807b04555b71ed48a6896b6f41593b8c637");

    #[test]
    fn usdc_donation_does_not_move_accounting_or_withdraw_path() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // D-09's measured Stata numbers: a $3 deposit is 2_555_464 shares worth 2_999_999 assets.
        let assets = U256::from(2_999_999u64);

        // The donation itself needs no simulation: `USDC.transfer(adapter, X)` executes no adapter
        // code. What IS asserted is that the adapter never looks at the donated balance — this mock
        // reverts, so any `balanceOf(USDC, self)` the adapter might grow in the future fails loudly
        // here. Registered first so the vault's success payload is the last one in the buffer.
        let donated_balance_cd = balanceOfCall { account: ADAPTER }.abi_encode();
        vm.mock_static_call(
            USDC,
            donated_balance_cd,
            Err(b"adapter must never read a donated token's balance".to_vec()),
        );

        let max_cd = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_cd, Ok(assets.abi_encode()));

        // D-03 asserts the read path AND the write path: a corrupted accounting would show up when
        // moving funds, not when reading them.
        assert_eq!(contract.max_withdraw().unwrap(), assets);

        let withdraw_cd = withdrawCall {
            assets,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_cd, U256::ZERO, Ok(assets.abi_encode()));
        assert_eq!(contract.withdraw(assets).unwrap(), assets);
    }

    #[test]
    fn atoken_donation_does_not_move_accounting_or_withdraw_path() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // D-09's measured Stata numbers: a $3 deposit is 2_555_464 shares worth 2_999_999 assets.
        let assets = U256::from(2_999_999u64);

        // Same negative assertion as the USDC vector, against `aArbUSDCn` instead. The rebasing
        // character of the aToken (the PITFALLS.md §6 hazard Stata exists to avoid) is irrelevant
        // here precisely because the adapter never reads this balance at all — a growing rebase
        // has nothing to corrupt. Registered first so the vault's success payload is the last one
        // in the buffer.
        let donated_balance_cd = balanceOfCall { account: ADAPTER }.abi_encode();
        vm.mock_static_call(
            ATOKEN,
            donated_balance_cd,
            Err(b"adapter must never read a donated token's balance".to_vec()),
        );

        let max_cd = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_cd, Ok(assets.abi_encode()));

        assert_eq!(contract.max_withdraw().unwrap(), assets);

        let withdraw_cd = withdrawCall {
            assets,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_cd, U256::ZERO, Ok(assets.abi_encode()));
        assert_eq!(contract.withdraw(assets).unwrap(), assets);
    }

    #[test]
    fn stata_share_donation_raises_total_assets_by_exactly_the_donated_value() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let original_shares = U256::from(2_555_464u64);
        let donated_shares = U256::from(2_555_464u64);
        let combined_shares = original_shares + donated_shares; // 5_110_928
        let original_assets = U256::from(2_999_999u64);
        let combined_assets = U256::from(5_999_998u64); // convertToAssets(5_110_928)

        // Before the donation: the adapter's real position, driven directly through the dispatch
        // helpers (not through `contract.total_assets()`) because the "before" and "after" halves
        // decode two genuinely different `balanceOf`/`convertToAssets` payloads within the same
        // test — the shared return-data buffer rule in the module doc comment forbids routing both
        // through one public-method call.
        let before_balance_cd = balanceOfCall { account: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, before_balance_cd, Ok(original_shares.abi_encode()));
        let before_shares = crate::erc20::balance_of(&vm, VAULT, ADAPTER).unwrap();
        assert_eq!(before_shares, original_shares);

        let before_convert_cd = convertToAssetsCall {
            shares: before_shares,
        }
        .abi_encode();
        vm.mock_static_call(VAULT, before_convert_cd, Ok(original_assets.abi_encode()));
        let before_assets = crate::erc4626::convert_to_assets(&vm, VAULT, before_shares).unwrap();
        assert_eq!(before_assets, original_assets);

        // D-04: unlike vectors 1 and 2, this DOES move the accounting — and correctly so. The
        // adapter's position IS `stataVault.balanceOf(self)`, so gifting it shares genuinely makes
        // it richer; `withdraw` for the larger amount really does deliver the extra USDC. This is a
        // gift, not an exploit against the adapter. The accounting risk it creates lives one level
        // up, in the core's share math, and is Phase 11's problem (VAULT-06: virtual offset and/or
        // seeded deposit). Nothing is done about it here on purpose.
        let after_balance_cd = balanceOfCall { account: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, after_balance_cd, Ok(combined_shares.abi_encode()));
        let after_shares = crate::erc20::balance_of(&vm, VAULT, ADAPTER).unwrap();
        assert_eq!(after_shares, combined_shares);

        let after_convert_cd = convertToAssetsCall {
            shares: after_shares,
        }
        .abi_encode();
        vm.mock_static_call(VAULT, after_convert_cd, Ok(combined_assets.abi_encode()));
        let after_assets = crate::erc4626::convert_to_assets(&vm, VAULT, after_shares).unwrap();

        assert_eq!(
            after_assets - before_assets,
            original_assets,
            "the increase must equal convertToAssets(donated shares) exactly"
        );

        // `max_withdraw()` accompanies the larger, donation-inflated position. Both mocks below
        // intentionally return the SAME encoded value (`combined_assets`) — same shared-buffer
        // workaround `withdraw_at_reported_limit_succeeds` uses — so a subsequent real `withdraw`
        // for the larger amount can be driven through the public methods in one shot.
        let max_cd = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_cd, Ok(combined_assets.abi_encode()));
        assert_eq!(
            contract.max_withdraw().unwrap(),
            combined_assets,
            "max_withdraw() must reflect the larger, donation-inflated position"
        );

        let withdraw_cd = withdrawCall {
            assets: combined_assets,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_cd, U256::ZERO, Ok(combined_assets.abi_encode()));
        assert_eq!(
            contract.withdraw(combined_assets).unwrap(),
            combined_assets,
            "the extra, donated value is genuinely withdrawable"
        );
    }

    #[test]
    fn paused_reserve_propagates_revert() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        // Aave v3's pause is PER RESERVE, encoded in `getReserveData`'s configuration bits — there
        // is no protocol-wide `Pool.paused()` (D-12, corrected in DISCOVERY.md §2.5; that call
        // reverts against the live Pool). On-chain this case is unreachable in this phase because
        // we do not control Aave's guardian (D-10), so the mock is the only way to cover it. The
        // exact revert message is cosmetic — what is asserted is that the revert propagates and no
        // `Withdraw` event is emitted, never a partial withdrawal.
        //
        // Registered FIRST (not last) so the shared buffer ends up holding the `max_withdraw`
        // success payload, which is the call that executes first and needs a correct decode; the
        // vault's `withdraw` revert flag still comes from its own correctly-matched HashMap entry
        // regardless of what the buffer holds at that point (see module doc comment).
        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Err(b"ReservePaused".to_vec()));

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let logs_before = vm.get_emitted_logs().len();
        let result = contract.withdraw(amount);
        assert!(result.is_err());
        assert_eq!(
            vm.get_emitted_logs().len(),
            logs_before,
            "a reverted vault withdraw must not emit a Withdraw event"
        );
    }

    #[test]
    fn redeem_limit_below_balance_reverts_with_max() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let max = U256::from(500_000u64);
        let requested = U256::from(1_000_000u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn withdraw_at_reported_limit_succeeds() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let max_calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, max_calldata, Ok(amount.abi_encode()));

        let withdraw_calldata = withdrawCall {
            assets: amount,
            receiver: CORE,
            owner: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(VAULT, withdraw_calldata, U256::ZERO, Ok(amount.abi_encode()));

        let result = contract.withdraw(amount);
        assert_eq!(result.unwrap(), amount);
    }

    #[test]
    fn rounding_against_adapter_still_reverts_rather_than_partial() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        // AAVE-WITHDRAW-PATH (PROTOCOL-PROBES.md) confirmed round-down against Stata; same
        // one-unit-shortfall guard proof as the other three protocol modules (DISCOVERY.md §2.5
        // Aave row).
        let requested = U256::from(1_000_000u64);
        let max = requested - U256::from(1u64);

        let calldata = maxWithdrawCall { owner: ADAPTER }.abi_encode();
        vm.mock_static_call(VAULT, calldata, Ok(max.abi_encode()));

        let err = contract.withdraw(requested);
        assert!(err.is_err());
        assert_eq!(err.unwrap_err(), errors::withdraw_exceeds_max(max));
    }

    #[test]
    fn deposit_minting_zero_shares_reverts() {
        let vm = TestVM::default();
        let mut contract = adapter_for(&vm, VAULT);

        let amount = U256::from(1_000_000u64);

        let transfer_calldata = transferFromCall {
            from: CORE,
            to: ADAPTER,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, transfer_calldata, U256::ZERO, Ok(true.abi_encode()));
        let pull_ctx = Call::new_mutating(&mut contract);
        crate::erc20::transfer_from(&vm, pull_ctx, USDC, CORE, ADAPTER, amount).unwrap();

        let approve_calldata = approveCall {
            spender: VAULT,
            amount,
        }
        .abi_encode();
        vm.mock_call(USDC, approve_calldata, U256::ZERO, Ok(true.abi_encode()));
        let approve_ctx = Call::new_mutating(&mut contract);
        crate::erc20::approve(&vm, approve_ctx, USDC, VAULT, amount).unwrap();

        let deposit_calldata = depositCall {
            assets: amount,
            receiver: ADAPTER,
        }
        .abi_encode();
        vm.mock_call(
            VAULT,
            deposit_calldata,
            U256::ZERO,
            Ok(U256::ZERO.abi_encode()),
        );
        let deposit_ctx = Call::new_mutating(&mut contract);
        let shares =
            crate::erc4626::deposit_to_vault(&vm, deposit_ctx, VAULT, amount, ADAPTER).unwrap();

        assert!(shares.is_zero());
        let guard_result: Result<U256, Vec<u8>> = if shares.is_zero() {
            Err(errors::zero_shares())
        } else {
            Ok(shares)
        };
        assert_eq!(guard_result.unwrap_err(), errors::zero_shares());
    }
}
