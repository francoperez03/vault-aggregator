//! USDC (external ERC-20) binding: `approve`/`transferFrom`/`balanceOf` (T-09-05).
//!
//! Same bare `alloy_sol_types::sol!` + manual `stylus_sdk::call::call`/`static_call` dispatch
//! shape as `erc4626.rs` — no second convention, no SafeERC20-style abstraction beyond the one
//! shared return-decoding rule below (09-RESEARCH.md "Don't Hand-Roll"). The adapter is a client
//! of external USDC, not an ERC-20 implementer, so this module has no storage of its own.
//!
//! **Return-value handling is the security-relevant part of this module** (T-09-05, unchecked
//! external call return values). USDC-family tokens are non-standard in two classic ways: some
//! return nothing on success (empty calldata, no revert), some return `bool` and *can* return
//! `false` on a failed-but-non-reverting transfer. `decode_bool_result` below is the single
//! shared tri-state rule both `approve` and `transfer_from` apply, so a future third caller can't
//! drift from it.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::{call, static_call};
use stylus_sdk::prelude::Call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    // cast sig "approve(address,uint256)" = 0x095ea7b3
    function approve(address spender, uint256 amount) external returns (bool);
    // cast sig "transferFrom(address,address,uint256)" = 0x23b872dd
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // cast sig "balanceOf(address)" = 0x70a08231
    function balanceOf(address account) external view returns (uint256);
}

/// Tri-state return decoding shared by `approve`/`transfer_from` (T-09-05):
/// - empty buffer -> success (non-standard tokens that return nothing)
/// - decodes to `true` -> success
/// - decodes to `false` -> `Err("TransferFailed")` (the classic non-reverting-failure trap)
/// - any other shape -> `Err("TransferFailed")` (never silently treated as success)
fn decode_bool_result(result: &[u8]) -> Result<(), Vec<u8>> {
    if result.is_empty() {
        return Ok(());
    }
    match <bool as alloy_sol_types::SolValue>::abi_decode(result) {
        Ok(true) => Ok(()),
        Ok(false) => Err(b"TransferFailed".to_vec()),
        Err(_) => Err(b"TransferFailed".to_vec()),
    }
}

/// Approves `spender` to move `amount` of `token` on the adapter's behalf.
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

/// Reads `token.balanceOf(account)`.
pub fn balance_of(vm: &impl Host, token: Address, account: Address) -> Result<U256, Vec<u8>> {
    let calldata = balanceOfCall { account }.abi_encode();
    let result = static_call(vm, Call::new(), token, &calldata)?;
    balanceOfCall::abi_decode_returns(&result).map_err(|_| b"AbiDecodeFailed".to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::SolValue;
    use stylus_sdk::testing::TestVM;

    fn token_addr() -> Address {
        Address::from([0x44; 20])
    }

    fn spender_addr() -> Address {
        Address::from([0x55; 20])
    }

    fn from_addr() -> Address {
        Address::from([0x66; 20])
    }

    fn to_addr() -> Address {
        Address::from([0x77; 20])
    }

    /// Minimal `MutatingCallContext` for unit-testing dispatch helpers outside a `#[public]`
    /// contract (no `TopLevelStorage` implementor available at this layer) — mirrors the
    /// `MyContract` test fixture in `stylus-sdk`'s own `call/mod.rs` unit tests.
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

    // --- selector cross-checks (docs/PROTOCOL-PROBES.md, cast sig values) ---

    #[test]
    fn approve_selector_matches_cast_sig() {
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0x09, 0x5e, 0xa7, 0xb3]);
    }

    #[test]
    fn transfer_from_selector_matches_cast_sig() {
        let calldata = transferFromCall {
            from: from_addr(),
            to: to_addr(),
            amount: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0x23, 0xb8, 0x72, 0xdd]);
    }

    #[test]
    fn balance_of_selector_matches_cast_sig() {
        let calldata = balanceOfCall { account: from_addr() }.abi_encode();
        assert_eq!(&calldata[0..4], &[0x70, 0xa0, 0x82, 0x31]);
    }

    // --- return-shape handling (T-09-05) ---

    #[test]
    fn approve_returns_true_is_ok() {
        let vm = TestVM::default();
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(true.abi_encode()));

        let result = approve(
            &vm,
            MockMutatingCtx,
            token_addr(),
            spender_addr(),
            U256::from(1_000u64),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn transfer_from_returns_false_is_err() {
        let vm = TestVM::default();
        let calldata = transferFromCall {
            from: from_addr(),
            to: to_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(false.abi_encode()));

        let result = transfer_from(
            &vm,
            MockMutatingCtx,
            token_addr(),
            from_addr(),
            to_addr(),
            U256::from(1_000u64),
        );
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), b"TransferFailed".to_vec());
    }

    #[test]
    fn transfer_from_returns_empty_is_ok() {
        let vm = TestVM::default();
        let calldata = transferFromCall {
            from: from_addr(),
            to: to_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(Vec::new()));

        let result = transfer_from(
            &vm,
            MockMutatingCtx,
            token_addr(),
            from_addr(),
            to_addr(),
            U256::from(1_000u64),
        );
        assert!(result.is_ok());
    }

    #[test]
    fn transfer_from_propagates_revert() {
        let vm = TestVM::default();
        let calldata = transferFromCall {
            from: from_addr(),
            to: to_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(
            token_addr(),
            calldata,
            U256::ZERO,
            Err(b"InsufficientAllowance".to_vec()),
        );

        let result = transfer_from(
            &vm,
            MockMutatingCtx,
            token_addr(),
            from_addr(),
            to_addr(),
            U256::from(1_000u64),
        );
        assert!(result.is_err());
    }

    #[test]
    fn balance_of_returns_mocked_value() {
        let vm = TestVM::default();
        let calldata = balanceOfCall { account: from_addr() }.abi_encode();
        let mocked = U256::from(3_000_000u64);
        vm.mock_static_call(token_addr(), calldata, Ok(mocked.abi_encode()));

        let result = balance_of(&vm, token_addr(), from_addr());
        assert_eq!(result.unwrap(), mocked);
    }
}
