//! ERC-4626 vault binding (D-02/D-03, generic adapter surface).
//!
//! The struct-shaped-calldata Stylus macro (`sol` + `_interface` + `!`, spelled out to avoid
//! this file itself matching the crate-wide grep ban) is banned unconditionally in this crate
//! (ADR 001 Decision, M1 carryover 1.1): its selector builder computes the wrong 4-byte selector
//! for struct-shaped calldata params, proven byte-for-byte in
//! `coinflip-periphery/src/permit2.rs`'s Permit2 spike. None of the ERC-4626 signatures bound
//! here take struct params, but the ban is unconditional per ADR 001, not conditional on today's
//! signature shapes — so this module follows the same bare `alloy_sol_types::sol!` + manual
//! `stylus_sdk::call::call`/`static_call` dispatch shape as `permit2.rs`, never that macro.
//!
//! Every selector below is asserted in `#[cfg(test)]` against the live `cast sig` values
//! recorded in `docs/PROTOCOL-PROBES.md` (re-confirmed 2026-07-21 against Morpho/Fluid/Euler on
//! Arbitrum One) — the exact idiom that caught the M1 defect described above.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::{call, static_call};
use stylus_sdk::prelude::Call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    // cast sig "deposit(uint256,address)" = 0x6e553f65
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    // cast sig "withdraw(uint256,address,address)" = 0xb460af94
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    // cast sig "redeem(uint256,address,address)" = 0xba087652
    function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets);
    // cast sig "convertToAssets(uint256)" = 0x07a2d13a
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    // cast sig "convertToShares(uint256)" = 0xc6e6f592
    function convertToShares(uint256 assets) external view returns (uint256 shares);
    // cast sig "maxRedeem(address)" = 0xd905777e
    function maxRedeem(address owner) external view returns (uint256 maxShares);
    // cast sig "maxWithdraw(address)" = 0xce96cb77
    function maxWithdraw(address owner) external view returns (uint256 maxAssets);
    // cast sig "asset()" = 0x38d52e0f
    function asset() external view returns (address);
    // cast sig "totalAssets()" = 0x01e1d114
    function totalAssets() external view returns (uint256);
}

/// Shared decode-failure mapping for every dispatch fn below: an ABI-decode error on the
/// underlying vault's return bytes becomes a plain revert reason rather than leaking a raw
/// `alloy_sol_types::Error` into the adapter's public `Result<_, Vec<u8>>` surface.
fn decode_error(_err: alloy_sol_types::Error) -> Vec<u8> {
    b"AbiDecodeFailed".to_vec()
}

/// Deposits `assets` into `vault`, crediting `receiver` with shares. Returns shares minted.
/// Mutating (`call::call`) — `adapter.rs`'s own `deposit` grants the allowance via `erc20::approve`
/// immediately before this call, never leaving a standing approval.
pub fn deposit_to_vault(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    vault: Address,
    assets: U256,
    receiver: Address,
) -> Result<U256, Vec<u8>> {
    let calldata = depositCall { assets, receiver }.abi_encode();
    let result = call(vm, call_ctx, vault, &calldata)?;
    depositCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Withdraws `assets` from `vault` on behalf of `owner`, crediting `receiver`. Returns shares
/// burned. Per `docs/PROTOCOL-PROBES.md`'s WITHDRAW-PATH verdict, all three Phase 9 production
/// vaults support this asset-exact path directly.
pub fn withdraw_from_vault(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    vault: Address,
    assets: U256,
    receiver: Address,
    owner: Address,
) -> Result<U256, Vec<u8>> {
    let calldata = withdrawCall {
        assets,
        receiver,
        owner,
    }
    .abi_encode();
    let result = call(vm, call_ctx, vault, &calldata)?;
    withdrawCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Redeems `shares` from `vault` on behalf of `owner`, crediting `receiver`. Returns assets out.
/// Not the primary withdraw path per the probe verdict (`withdraw()` is used instead) — kept as
/// the fallback path in case a future protocol lacks asset-exact `withdraw()`.
pub fn redeem_from_vault(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    vault: Address,
    shares: U256,
    receiver: Address,
    owner: Address,
) -> Result<U256, Vec<u8>> {
    let calldata = redeemCall {
        shares,
        receiver,
        owner,
    }
    .abi_encode();
    let result = call(vm, call_ctx, vault, &calldata)?;
    redeemCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `vault.maxWithdraw(owner)`. Per FLUID-THROTTLE (`docs/PROTOCOL-PROBES.md`), this
/// interface answer is not unconditionally trustworthy on Fluid — callers guarding a live
/// withdraw should not treat it as a hard ceiling without Plan 06's empirical boundary check.
pub fn max_withdraw(vm: &impl Host, vault: Address, owner: Address) -> Result<U256, Vec<u8>> {
    let calldata = maxWithdrawCall { owner }.abi_encode();
    let result = static_call(vm, Call::new(), vault, &calldata)?;
    maxWithdrawCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `vault.maxRedeem(owner)`. View dispatch — the share-denominated counterpart to
/// `max_withdraw`'s asset-denominated ceiling, kept alongside it for a vault where the fallback
/// `redeem_from_vault` path is the one actually exercised.
pub fn max_redeem(vm: &impl Host, vault: Address, owner: Address) -> Result<U256, Vec<u8>> {
    let calldata = maxRedeemCall { owner }.abi_encode();
    let result = static_call(vm, Call::new(), vault, &calldata)?;
    maxRedeemCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `vault.convertToAssets(shares)`. View dispatch — pure share-price read, no side effects;
/// callers use this to price a position without moving any funds.
pub fn convert_to_assets(vm: &impl Host, vault: Address, shares: U256) -> Result<U256, Vec<u8>> {
    let calldata = convertToAssetsCall { shares }.abi_encode();
    let result = static_call(vm, Call::new(), vault, &calldata)?;
    convertToAssetsCall::abi_decode_returns(&result).map_err(decode_error)
}

/// Reads `vault.totalAssets()`. View dispatch — the adapter's own `totalAssets()` (its public ABI
/// surface) is a thin pass-through of this exact read, so the vault's own accounting stays the
/// single source of truth rather than being shadowed by adapter-local bookkeeping.
pub fn total_assets(vm: &impl Host, vault: Address) -> Result<U256, Vec<u8>> {
    let calldata = totalAssetsCall {}.abi_encode();
    let result = static_call(vm, Call::new(), vault, &calldata)?;
    totalAssetsCall::abi_decode_returns(&result).map_err(decode_error)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloy_sol_types::SolValue;
    use stylus_sdk::testing::TestVM;

    fn vault_addr() -> Address {
        Address::from([0x11; 20])
    }

    fn owner_addr() -> Address {
        Address::from([0x22; 20])
    }

    fn receiver_addr() -> Address {
        Address::from([0x33; 20])
    }

    // --- selector cross-checks (docs/PROTOCOL-PROBES.md, cast sig values) ---

    #[test]
    fn deposit_selector_matches_cast_sig() {
        let calldata = depositCall {
            assets: U256::from(1u64),
            receiver: receiver_addr(),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0x6e, 0x55, 0x3f, 0x65]);
    }

    #[test]
    fn withdraw_selector_matches_cast_sig() {
        let calldata = withdrawCall {
            assets: U256::from(1u64),
            receiver: receiver_addr(),
            owner: owner_addr(),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0xb4, 0x60, 0xaf, 0x94]);
    }

    #[test]
    fn redeem_selector_matches_cast_sig() {
        let calldata = redeemCall {
            shares: U256::from(1u64),
            receiver: receiver_addr(),
            owner: owner_addr(),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0xba, 0x08, 0x76, 0x52]);
    }

    #[test]
    fn convert_to_assets_selector_matches_cast_sig() {
        let calldata = convertToAssetsCall {
            shares: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0x07, 0xa2, 0xd1, 0x3a]);
    }

    #[test]
    fn convert_to_shares_selector_matches_cast_sig() {
        let calldata = convertToSharesCall {
            assets: U256::from(1u64),
        }
        .abi_encode();
        assert_eq!(&calldata[0..4], &[0xc6, 0xe6, 0xf5, 0x92]);
    }

    #[test]
    fn max_redeem_selector_matches_cast_sig() {
        let calldata = maxRedeemCall { owner: owner_addr() }.abi_encode();
        assert_eq!(&calldata[0..4], &[0xd9, 0x05, 0x77, 0x7e]);
    }

    #[test]
    fn max_withdraw_selector_matches_cast_sig() {
        let calldata = maxWithdrawCall { owner: owner_addr() }.abi_encode();
        assert_eq!(&calldata[0..4], &[0xce, 0x96, 0xcb, 0x77]);
    }

    #[test]
    fn asset_selector_matches_cast_sig() {
        let calldata = assetCall {}.abi_encode();
        assert_eq!(&calldata[0..4], &[0x38, 0xd5, 0x2e, 0x0f]);
    }

    #[test]
    fn total_assets_selector_matches_cast_sig() {
        let calldata = totalAssetsCall {}.abi_encode();
        assert_eq!(&calldata[0..4], &[0x01, 0xe1, 0xd1, 0x14]);
    }

    // --- dispatch / mock_call behaviour ---

    #[test]
    fn deposit_to_vault_returns_mocked_shares() {
        let vm = TestVM::default();
        let calldata = depositCall {
            assets: U256::from(1_000_000u64),
            receiver: receiver_addr(),
        }
        .abi_encode();
        let mocked_shares = U256::from(961_766u64);
        vm.mock_call(
            vault_addr(),
            calldata,
            U256::ZERO,
            Ok(mocked_shares.abi_encode()),
        );

        // deposit_to_vault requires a MutatingCallContext; real #[public] code (adapter.rs, Plan
        // 03) supplies `Call::new_mutating(&mut storage)`. This module test has no
        // `TopLevelStorage` implementor at hand, so it uses the minimal fixture below (mirrors
        // stylus-sdk's own `call/mod.rs` unit test fixture).
        let mutating_ctx = MockMutatingCtx;
        let result = deposit_to_vault(
            &vm,
            mutating_ctx,
            vault_addr(),
            U256::from(1_000_000u64),
            receiver_addr(),
        );
        assert_eq!(result.unwrap(), mocked_shares);
    }

    #[test]
    fn deposit_to_vault_propagates_revert() {
        let vm = TestVM::default();
        let calldata = depositCall {
            assets: U256::from(1_000_000u64),
            receiver: receiver_addr(),
        }
        .abi_encode();
        vm.mock_call(
            vault_addr(),
            calldata,
            U256::ZERO,
            Err(b"VaultPaused".to_vec()),
        );

        let mutating_ctx = MockMutatingCtx;
        let result = deposit_to_vault(
            &vm,
            mutating_ctx,
            vault_addr(),
            U256::from(1_000_000u64),
            receiver_addr(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn max_withdraw_returns_mocked_value() {
        let vm = TestVM::default();
        let calldata = maxWithdrawCall { owner: owner_addr() }.abi_encode();
        let mocked = U256::from(6_783_400u64);
        vm.mock_static_call(vault_addr(), calldata, Ok(mocked.abi_encode()));

        let result = max_withdraw(&vm, vault_addr(), owner_addr());
        assert_eq!(result.unwrap(), mocked);
    }

    #[test]
    fn total_assets_returns_mocked_value() {
        let vm = TestVM::default();
        let calldata = totalAssetsCall {}.abi_encode();
        let mocked = U256::from(35_779_340u64);
        vm.mock_static_call(vault_addr(), calldata, Ok(mocked.abi_encode()));

        let result = total_assets(&vm, vault_addr());
        assert_eq!(result.unwrap(), mocked);
    }

    /// Minimal `MutatingCallContext` for unit-testing dispatch helpers outside a `#[public]`
    /// contract (no `TopLevelStorage` implementor available at this layer) — mirrors the `MyContract`
    /// test fixture in `stylus-sdk`'s own `call/mod.rs` unit tests.
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
