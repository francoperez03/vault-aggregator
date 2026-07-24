//! Typed custom errors for `VaultCore`, `sol!`-declared and abi-encoded into the `Vec<u8>` revert
//! payload — same idiom as `vault-adapter/src/errors.rs`.

use alloc::vec::Vec;

use alloy_primitives::U256;
use alloy_sol_types::{sol, SolError};

sol! {
    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAddress();
    error NotOwner();
    error ZeroAmount();
    error ZeroShares();
    error AllocationInvalid();
    error AdapterNotEnabled();
    error AdapterHasBalance(uint256 totalAssets);
    error DivisionByZero();
    error MulDivOverflow();
    error ShareMathOverflow();
    error AdapterDecodeFailed();
    error TransferFailed();
    error AdapterAlreadyRegistered();
    error AdapterNotRegistered();
    error InsufficientShares();
    error RedeemShortfall(uint256 owed, uint256 actual);
    error NoWeightsSet();
}

pub fn already_initialized() -> Vec<u8> {
    AlreadyInitialized {}.abi_encode()
}

pub fn not_initialized() -> Vec<u8> {
    NotInitialized {}.abi_encode()
}

pub fn zero_address() -> Vec<u8> {
    ZeroAddress {}.abi_encode()
}

pub fn not_owner() -> Vec<u8> {
    NotOwner {}.abi_encode()
}

pub fn zero_amount() -> Vec<u8> {
    ZeroAmount {}.abi_encode()
}

pub fn zero_shares() -> Vec<u8> {
    ZeroShares {}.abi_encode()
}

pub fn allocation_invalid() -> Vec<u8> {
    AllocationInvalid {}.abi_encode()
}

pub fn adapter_not_enabled() -> Vec<u8> {
    AdapterNotEnabled {}.abi_encode()
}

pub fn adapter_has_balance(total_assets: U256) -> Vec<u8> {
    AdapterHasBalance { totalAssets: total_assets }.abi_encode()
}

pub fn division_by_zero() -> Vec<u8> {
    DivisionByZero {}.abi_encode()
}

pub fn mul_div_overflow() -> Vec<u8> {
    MulDivOverflow {}.abi_encode()
}

pub fn share_math_overflow() -> Vec<u8> {
    ShareMathOverflow {}.abi_encode()
}

pub fn adapter_decode_failed() -> Vec<u8> {
    AdapterDecodeFailed {}.abi_encode()
}

pub fn transfer_failed() -> Vec<u8> {
    TransferFailed {}.abi_encode()
}

pub fn adapter_already_registered() -> Vec<u8> {
    AdapterAlreadyRegistered {}.abi_encode()
}

pub fn adapter_not_registered() -> Vec<u8> {
    AdapterNotRegistered {}.abi_encode()
}

pub fn insufficient_shares() -> Vec<u8> {
    InsufficientShares {}.abi_encode()
}

pub fn redeem_shortfall(owed: U256, actual: U256) -> Vec<u8> {
    RedeemShortfall { owed, actual }.abi_encode()
}

pub fn no_weights_set() -> Vec<u8> {
    NoWeightsSet {}.abi_encode()
}
