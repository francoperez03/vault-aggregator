//! USDC (external ERC-20) `approve` dispatch: vendorized from `vault-core/src/usdc.rs`, same bare
//! `sol!` + manual dispatch shape and the same tri-state return-value rule (T-09-05 carryover).
//! The periphery never needs `transfer_from`/`transfer`/`balance_of` -- it only ever grants the
//! core an exact allowance (and zeroes it again), so only `approve` is ported here.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    // cast sig "approve(address,uint256)" = 0x095ea7b3
    function approve(address spender, uint256 amount) external returns (bool);
}

/// Tri-state return decoding (T-09-05 carryover):
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
        Ok(false) => Err(b"TransferFailed".to_vec()),
        Err(_) => Err(b"TransferFailed".to_vec()),
    }
}

/// Approves `spender` to move `amount` of `token` on this periphery's behalf.
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
    fn approve_returns_true_is_ok() {
        let vm = TestVM::default();
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(true.abi_encode()));

        let result = approve(&vm, MockMutatingCtx, token_addr(), spender_addr(), U256::from(1_000u64));
        assert!(result.is_ok());
    }

    #[test]
    fn approve_returns_empty_is_ok() {
        let vm = TestVM::default();
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(Vec::new()));

        let result = approve(&vm, MockMutatingCtx, token_addr(), spender_addr(), U256::from(1_000u64));
        assert!(result.is_ok());
    }

    #[test]
    fn approve_returns_false_is_err() {
        let vm = TestVM::default();
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(token_addr(), calldata, U256::ZERO, Ok(false.abi_encode()));

        let result = approve(&vm, MockMutatingCtx, token_addr(), spender_addr(), U256::from(1_000u64));
        assert!(result.is_err());
    }

    #[test]
    fn approve_propagates_revert() {
        let vm = TestVM::default();
        let calldata = approveCall {
            spender: spender_addr(),
            amount: U256::from(1_000u64),
        }
        .abi_encode();
        vm.mock_call(
            token_addr(),
            calldata,
            U256::ZERO,
            Err(b"InsufficientBalance".to_vec()),
        );

        let result = approve(&vm, MockMutatingCtx, token_addr(), spender_addr(), U256::from(1_000u64));
        assert!(result.is_err());
    }
}
