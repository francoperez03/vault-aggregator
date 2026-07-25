//! `sol!` bare-fn bindings + manual dispatch to `VaultAdapter`'s frozen 5-function ABI. Mirrors
//! `vault-adapter/src/erc4626.rs`'s dispatch shape exactly, retargeted at the adapter's own
//! selectors. The struct-shaped-calldata Stylus macro (`sol` + `_interface` + `!`, spelled out to
//! avoid this file matching the crate-wide grep ban) is unconditionally banned in this workspace
//! (ADR 001) — the wrong-selector bug for struct-shaped calldata, proven in M1's Permit2 spike;
//! the core inherits the ban even though none of these 5 functions take struct params.
//!
//! Selectors verified via `cast sig` (11-RESEARCH.md §Pattern 1, cross-checked against the
//! adapter's actual Rust signatures in `vault-adapter/src/adapter.rs`).

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

/// Shared decode-failure mapping for all four dispatch fns below: any ABI-decode error on an
/// adapter's return bytes becomes `AdapterDecodeFailed` (errors.rs code 12) rather than a raw
/// `alloy_sol_types::Error` leaking into `VaultCore`'s public `Result<_, Vec<u8>>` surface.
fn decode_error(_err: alloy_sol_types::Error) -> Vec<u8> {
    errors::adapter_decode_failed()
}

/// Calls `adapter.deposit(usdc_amount)`. Returns the shares minted (adapter-side custody, D-02).
/// Mutating (`call::call`, not `static_call`): the adapter moves USDC and updates its own share
/// ledger, so this must run inside a real `MutatingCallContext`, matching the guard-before-mutate
/// convention `core.rs::deposit_leg` calls it under.
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

/// Calls `adapter.withdraw(usdc_amount)`. Returns the shares burned. Mutating, same reasoning as
/// `deposit` above — `core.rs::unwind_position` calls this only after `unwind_request` has already
/// clamped the request to `min(total_assets, max_withdraw)` (D-09b), so a throttled adapter is
/// never asked for more than it can currently pay.
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

/// Reads `adapter.totalAssets()`. View dispatch (`static_call`, no `MutatingCallContext` needed):
/// this and `max_withdraw` below are the only two adapter reads the core needs, taken as a snapshot
/// immediately before each mutating leg so share-price math is never priced off stale state
/// (Phase 09 view-vs-mutating dispatch split, mirrored from `permit2.rs`).
pub fn total_assets(vm: &impl Host, adapter: Address) -> Result<U256, Vec<u8>> {
    let calldata = totalAssetsCall {}.abi_encode();
    let result = static_call(vm, Call::new(), adapter, &calldata)?;
    totalAssetsCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `adapter.maxWithdraw()`. View dispatch — the FLUID-THROTTLE finding (Phase 09) proved a
/// live adapter's withdrawable ceiling can sit far below its `total_assets`, so every unwind must
/// clamp its withdraw request against this value instead of assuming full liquidity.
pub fn max_withdraw(vm: &impl Host, adapter: Address) -> Result<U256, Vec<u8>> {
    let calldata = maxWithdrawCall {}.abi_encode();
    let result = static_call(vm, Call::new(), adapter, &calldata)?;
    maxWithdrawCall::abi_decode_returns(&result).map_err(decode_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::SolValue;
    use stylus_sdk::testing::TestVM;

    fn adapter_addr() -> Address {
        Address::from([0x11; 20])
    }

    // --- selector cross-checks (11-RESEARCH.md §Pattern 1, cast sig values) ---

    #[test]
    fn deposit_selector_matches_cast_sig() {
        let calldata = depositCall {
            usdcAmount: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0xb6, 0xb5, 0x5f, 0x25]);
    }

    #[test]
    fn withdraw_selector_matches_cast_sig() {
        let calldata = withdrawCall {
            usdcAmount: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0x2e, 0x1a, 0x7d, 0x4d]);
    }

    #[test]
    fn total_assets_selector_matches_cast_sig() {
        let calldata = totalAssetsCall {}.abi_encode();
        assert_eq!(&calldata[0..4], &[0x01, 0xe1, 0xd1, 0x14]);
    }

    #[test]
    fn max_withdraw_selector_matches_cast_sig() {
        let calldata = maxWithdrawCall {}.abi_encode();
        assert_eq!(&calldata[0..4], &[0xac, 0x7a, 0x1b, 0x5b]);
    }

    // --- dispatch / mock_call behaviour ---

    #[test]
    fn deposit_returns_mocked_shares() {
        let vm = TestVM::default();
        let calldata = depositCall {
            usdcAmount: U256::from(1_000_000u64),
        }
        .abi_encode();
        let mocked_shares = U256::from(961_766u64);
        vm.mock_call(
            adapter_addr(),
            calldata,
            U256::ZERO,
            Ok(mocked_shares.abi_encode()),
        );

        let result = deposit(&vm, MockMutatingCtx, adapter_addr(), U256::from(1_000_000u64));
        assert_eq!(result.unwrap(), mocked_shares);
    }

    #[test]
    fn deposit_propagates_revert() {
        let vm = TestVM::default();
        let calldata = depositCall {
            usdcAmount: U256::from(1_000_000u64),
        }
        .abi_encode();
        vm.mock_call(
            adapter_addr(),
            calldata,
            U256::ZERO,
            Err(b"AdapterPaused".to_vec()),
        );

        let result = deposit(&vm, MockMutatingCtx, adapter_addr(), U256::from(1_000_000u64));
        assert!(result.is_err());
    }

    #[test]
    fn withdraw_returns_mocked_shares_burned() {
        let vm = TestVM::default();
        let calldata = withdrawCall {
            usdcAmount: U256::from(500_000u64),
        }
        .abi_encode();
        let mocked = U256::from(480_000u64);
        vm.mock_call(adapter_addr(), calldata, U256::ZERO, Ok(mocked.abi_encode()));

        let result = withdraw(&vm, MockMutatingCtx, adapter_addr(), U256::from(500_000u64));
        assert_eq!(result.unwrap(), mocked);
    }

    #[test]
    fn total_assets_returns_mocked_value() {
        let vm = TestVM::default();
        let calldata = totalAssetsCall {}.abi_encode();
        let mocked = U256::from(35_779_340u64);
        vm.mock_static_call(adapter_addr(), calldata, Ok(mocked.abi_encode()));

        let result = total_assets(&vm, adapter_addr());
        assert_eq!(result.unwrap(), mocked);
    }

    #[test]
    fn max_withdraw_returns_mocked_value() {
        let vm = TestVM::default();
        let calldata = maxWithdrawCall {}.abi_encode();
        let mocked = U256::from(6_783_400u64);
        vm.mock_static_call(adapter_addr(), calldata, Ok(mocked.abi_encode()));

        let result = max_withdraw(&vm, adapter_addr());
        assert_eq!(result.unwrap(), mocked);
    }

    /// Minimal `MutatingCallContext` for unit-testing dispatch helpers outside a `#[public]`
    /// contract (no `TopLevelStorage` implementor available at this layer) — mirrors
    /// `vault-adapter/src/erc4626.rs`'s own test fixture.
    #[derive(Clone)]
    struct MockMutatingCtx;

    impl stylus_sdk::stylus_core::calls::CallContext for MockMutatingCtx {
        fn gas(&self) -> u64 {
            u64::MAX
        }
    }

    unsafe impl MutatingCallContext for MockMutatingCtx {
        fn value(&self) -> U256 {
            U256::ZERO
        }
    }
}
