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

/// Shared encoder for the collapsed payload-less `VaultError(uint8)` (Phase 13 D-18 spike): every
/// one-liner below just picks its stable code from the table above.
fn coded(code: u8) -> Vec<u8> {
    VaultError { code }.abi_encode()
}

// Code 1 (`AlreadyInitialized`) is retired: the C-H1 fix (`vault-core/src/core.rs`'s
// `#[constructor]`) removed the caller-supplied `init` entrypoint it used to guard, and Stylus
// constructors are only ever invoked once, at deployment, so there is no live call path that can
// re-trigger it. The code number is left unused rather than renumbered, so `VaultError(1)` never
// gets silently reassigned to a different condition in this contract's history.

/// Encodes NotInitialized (code 2): guards every mutating entrypoint before `constructor` has run.
pub fn not_initialized() -> Vec<u8> {
    coded(2)
}

/// Encodes ZeroAddress (code 3): shared guard for any `Address` param that must never be `0x0`.
pub fn zero_address() -> Vec<u8> {
    coded(3)
}

/// Encodes NotOwner (code 4): `only_owner()`'s single revert path.
pub fn not_owner() -> Vec<u8> {
    coded(4)
}

/// Encodes ZeroAmount (code 5): a deposit/withdraw amount of exactly zero is rejected up front.
pub fn zero_amount() -> Vec<u8> {
    coded(5)
}

/// Encodes ZeroShares (code 6): a mint that would credit the caller zero shares reverts instead of
/// silently no-opping.
pub fn zero_shares() -> Vec<u8> {
    coded(6)
}

/// Encodes AllocationInvalid (code 7): `write_weights`'s single revert for any malformed weight set
/// (empty, mismatched lengths, duplicate/unregistered/disabled adapter, zero weight, sum != 10000).
pub fn allocation_invalid() -> Vec<u8> {
    coded(7)
}

/// Encodes AdapterNotEnabled (code 8): a weight or deposit leg targets an adapter the owner disabled
/// (D-11 — disabling blocks new money in, never blocks an existing position out).
pub fn adapter_not_enabled() -> Vec<u8> {
    coded(8)
}

/// AdapterHasBalance(uint256): carries the adapter's live `total_assets` as diagnostic payload, so
/// stays a typed `sol!` error instead of folding into the payload-less `VaultError` collapse.
pub fn adapter_has_balance(total_assets: U256) -> Vec<u8> {
    AdapterHasBalance { totalAssets: total_assets }.abi_encode()
}

/// Encodes DivisionByZero (code 9): a `share_math` denominator (total shares/assets) collapsed to
/// zero.
pub fn division_by_zero() -> Vec<u8> {
    coded(9)
}

/// Encodes MulDivOverflow (code 10): the widened multiply in `share_math::mul_div_floor` would not
/// fit back down into `U256`.
pub fn mul_div_overflow() -> Vec<u8> {
    coded(10)
}

/// Encodes ShareMathOverflow (code 11): a `share_math` intermediate (e.g. `total_shares + OFFSET_POW`)
/// overflowed `U256`.
pub fn share_math_overflow() -> Vec<u8> {
    coded(11)
}

/// Encodes AdapterDecodeFailed (code 12): an adapter's ABI-encoded return bytes did not decode to
/// the expected type (`adapter_dispatch.rs`'s `decode_error` catch-all).
pub fn adapter_decode_failed() -> Vec<u8> {
    coded(12)
}

/// Encodes TransferFailed (code 13): the shared tri-state ERC-20 decode (T-09-05) saw an explicit
/// `false` or an undecodable return from `approve`/`transferFrom`/`transfer`.
pub fn transfer_failed() -> Vec<u8> {
    coded(13)
}

/// Encodes AdapterAlreadyRegistered (code 14): `add_adapter` called twice with the same address.
pub fn adapter_already_registered() -> Vec<u8> {
    coded(14)
}

/// Encodes AdapterNotRegistered (code 15): a weight or `set_enabled` call names an adapter never
/// added via `add_adapter`.
pub fn adapter_not_registered() -> Vec<u8> {
    coded(15)
}

/// RedeemShortfall(uint256, uint256): carries the owed vs. actually-recovered USDC delta so a
/// throttled/compromised adapter's shortfall is diagnosable on-chain (D-10 atomicity gate); stays
/// typed rather than folded into `VaultError`.
pub fn redeem_shortfall(owed: U256, actual: U256) -> Vec<u8> {
    RedeemShortfall { owed, actual }.abi_encode()
}

/// Encodes NoWeightsSet (code 16): `deposit`/`deposit_for` called before the target user ever ran
/// `rebalance` to bootstrap a weight set (D-01 — no implicit fallback allocation).
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
