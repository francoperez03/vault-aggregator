//! Typed custom errors for `VaultCore`, `sol!`-declared and abi-encoded into the `Vec<u8>` revert
//! payload — same idiom as `vault-adapter/src/errors.rs`.
//!
//! The 16 payload-less conditions this module used to declare as 16 separate `sol!` errors are
//! collapsed into one coded error, `VaultError(uint8 code)`, to reclaim ABI-selector/dispatch
//! bytes (Phase 13 D-18 spike, Tier 1 trim: −556 B measured). Codes are stable and are assigned in
//! the declaration order the errors used to appear in, listed here so a consumer (frontend,
//! e2e stubs, an auditor reading a revert) can decode `VaultError(uint8)` and look up what it
//! means without re-deriving the mapping from git history:
//!
//! | Code | Condition               | Wrapper (unchanged name)   |
//! |------|--------------------------|-----------------------------|
//! | 1    | `AlreadyInitialized`    | retired (C-H1 fix, see below) |
//! | 2    | `NotInitialized`        | `not_initialized()`         |
//! | 3    | `ZeroAddress`           | `zero_address()`            |
//! | 4    | `NotOwner`              | `not_owner()`                |
//! | 5    | `ZeroAmount`            | `zero_amount()`              |
//! | 6    | `ZeroShares`            | `zero_shares()`              |
//! | 7    | `AllocationInvalid`     | `allocation_invalid()`       |
//! | 8    | `AdapterNotEnabled`     | `adapter_not_enabled()`      |
//! | 9    | `DivisionByZero`        | `division_by_zero()`        |
//! | 10   | `MulDivOverflow`        | `mul_div_overflow()`        |
//! | 11   | `ShareMathOverflow`     | `share_math_overflow()`     |
//! | 12   | `AdapterDecodeFailed`   | `adapter_decode_failed()`   |
//! | 13   | `TransferFailed`        | `transfer_failed()`         |
//! | 14   | `AdapterAlreadyRegistered` | `adapter_already_registered()` |
//! | 15   | `AdapterNotRegistered`  | `adapter_not_registered()`  |
//! | 16   | `NoWeightsSet`          | `no_weights_set()`          |
//!
//! `AdapterHasBalance(uint256)` and `RedeemShortfall(uint256, uint256)` carry diagnostic payload
//! and stay typed — only the payload-less 16 are in scope for the collapse.

use alloc::vec::Vec;

use alloy_primitives::U256;
use alloy_sol_types::{sol, SolError};

sol! {
    error VaultError(uint8 code);
    error AdapterHasBalance(uint256 totalAssets);
    error RedeemShortfall(uint256 owed, uint256 actual);
    error DepositShortfall(uint256 requested, uint256 credited);
}

fn coded(code: u8) -> Vec<u8> {
    VaultError { code }.abi_encode()
}

// Code 1 (`AlreadyInitialized`) is retired: the C-H1 fix (`vault-core/src/core.rs`'s
// `#[constructor]`) removed the caller-supplied `init` entrypoint it used to guard, and Stylus
// constructors are only ever invoked once, at deployment, so there is no live call path that can
// re-trigger it. The code number is left unused rather than renumbered, so `VaultError(1)` never
// gets silently reassigned to a different condition in this contract's history.

pub fn not_initialized() -> Vec<u8> {
    coded(2)
}

pub fn zero_address() -> Vec<u8> {
    coded(3)
}

pub fn not_owner() -> Vec<u8> {
    coded(4)
}

pub fn zero_amount() -> Vec<u8> {
    coded(5)
}

pub fn zero_shares() -> Vec<u8> {
    coded(6)
}

pub fn allocation_invalid() -> Vec<u8> {
    coded(7)
}

pub fn adapter_not_enabled() -> Vec<u8> {
    coded(8)
}

pub fn adapter_has_balance(total_assets: U256) -> Vec<u8> {
    AdapterHasBalance { totalAssets: total_assets }.abi_encode()
}

pub fn division_by_zero() -> Vec<u8> {
    coded(9)
}

pub fn mul_div_overflow() -> Vec<u8> {
    coded(10)
}

pub fn share_math_overflow() -> Vec<u8> {
    coded(11)
}

pub fn adapter_decode_failed() -> Vec<u8> {
    coded(12)
}

pub fn transfer_failed() -> Vec<u8> {
    coded(13)
}

pub fn adapter_already_registered() -> Vec<u8> {
    coded(14)
}

pub fn adapter_not_registered() -> Vec<u8> {
    coded(15)
}

pub fn redeem_shortfall(owed: U256, actual: U256) -> Vec<u8> {
    RedeemShortfall { owed, actual }.abi_encode()
}

pub fn no_weights_set() -> Vec<u8> {
    coded(16)
}

/// WR-02 (`deposit_leg`'s cheap guard): the shares minted for a deposit leg reconvert to less
/// than the tolerated fraction of the requested slice. Carries diagnostic payload (the e2e suite,
/// Plan 08, reads `credited` to measure the actual dilution), so this stays typed rather than
/// folded into `VaultError`.
pub fn deposit_shortfall(requested: U256, credited: U256) -> Vec<u8> {
    DepositShortfall { requested, credited }.abi_encode()
}
