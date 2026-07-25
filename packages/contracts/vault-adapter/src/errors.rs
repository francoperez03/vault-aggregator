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

/// Encodes AlreadyInitialized: guards the adapter's own one-shot `init` against a second call.
pub fn already_initialized() -> Vec<u8> {
    AlreadyInitialized {}.abi_encode()
}

/// Encodes NotInitialized: guards every mutating method before `init` has run.
pub fn not_initialized() -> Vec<u8> {
    NotInitialized {}.abi_encode()
}

/// Encodes ZeroAddress: shared guard for any `Address` param that must never be `0x0`.
pub fn zero_address() -> Vec<u8> {
    ZeroAddress {}.abi_encode()
}

/// Encodes NotCore: the adapter is a trusted-router callee — only the registered vault-core
/// address may call its mutating deposit/withdraw entrypoints.
pub fn not_core() -> Vec<u8> {
    NotCore {}.abi_encode()
}

/// Encodes ZeroAmount: a deposit/withdraw amount of exactly zero is rejected up front.
pub fn zero_amount() -> Vec<u8> {
    ZeroAmount {}.abi_encode()
}

/// Encodes ZeroShares: a mint or burn that would move zero shares reverts instead of silently
/// no-opping.
pub fn zero_shares() -> Vec<u8> {
    ZeroShares {}.abi_encode()
}

/// WithdrawExceedsMax(uint256): carries the adapter's live `maxWithdraw()` ceiling as diagnostic
/// payload so a caller can see exactly how throttled the underlying protocol is.
pub fn withdraw_exceeds_max(max: U256) -> Vec<u8> {
    WithdrawExceedsMax { max }.abi_encode()
}

/// Encodes TransferFailed: the shared tri-state ERC-20 decode (T-09-05, see `erc20.rs`) saw an
/// explicit `false` or an undecodable return.
pub fn transfer_failed() -> Vec<u8> {
    TransferFailed {}.abi_encode()
}
