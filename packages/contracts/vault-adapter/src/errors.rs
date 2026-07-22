//! Typed custom errors for `VaultAdapter`, `sol!`-declared and abi-encoded into the
//! `Vec<u8>` revert payload so the Phase 11 core can decode them exactly like Solidity
//! custom errors (09-PATTERNS.md `vault-adapter/src/errors.rs`, option (a)).

use alloc::vec::Vec;

use alloy_primitives::U256;
use alloy_sol_types::{sol, SolError};

sol! {
    error AlreadyInitialized();
    error NotInitialized();
    error ZeroAddress();
    error NotCore();
    error ZeroAmount();
    error ZeroShares();
    error WithdrawExceedsMax(uint256 max);
    error TransferFailed();
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

pub fn not_core() -> Vec<u8> {
    NotCore {}.abi_encode()
}

pub fn zero_amount() -> Vec<u8> {
    ZeroAmount {}.abi_encode()
}

pub fn zero_shares() -> Vec<u8> {
    ZeroShares {}.abi_encode()
}

pub fn withdraw_exceeds_max(max: U256) -> Vec<u8> {
    WithdrawExceedsMax { max }.abi_encode()
}

pub fn transfer_failed() -> Vec<u8> {
    TransferFailed {}.abi_encode()
}
