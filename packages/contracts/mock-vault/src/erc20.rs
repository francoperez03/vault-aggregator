//! Asset ERC-20 binding for `MockVault`: `transfer`/`transferFrom`/`balanceOf`. Same bare
//! `alloy_sol_types::sol!` + manual `call`/`static_call` dispatch shape as
//! `vault-adapter/src/erc20.rs`, including its tri-state bool-return rule.

use alloc::vec::Vec;

use alloy_primitives::{Address, U256};
use alloy_sol_types::{sol, SolCall};
use stylus_sdk::call::{call, static_call};
use stylus_sdk::prelude::Call;
use stylus_sdk::stylus_core::calls::MutatingCallContext;
use stylus_sdk::stylus_core::host::Host;

sol! {
    // cast sig "transfer(address,uint256)" = 0xa9059cbb
    function transfer(address to, uint256 amount) external returns (bool);
    // cast sig "transferFrom(address,address,uint256)" = 0x23b872dd
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    // cast sig "balanceOf(address)" = 0x70a08231
    function balanceOf(address account) external view returns (uint256);
}

/// Tri-state return decoding (mirrors `vault-adapter/src/erc20.rs::decode_bool_result`):
/// empty -> ok, `true` -> ok, `false`/undecodable -> error.
fn decode_bool_result(result: &[u8]) -> Result<(), Vec<u8>> {
    if result.is_empty() {
        return Ok(());
    }
    match <bool as alloy_sol_types::SolValue>::abi_decode(result) {
        Ok(true) => Ok(()),
        _ => Err(b"TransferFailed".to_vec()),
    }
}

/// Sends `amount` of `token` from the vault to `to`.
pub fn transfer(
    vm: &impl Host,
    call_ctx: impl MutatingCallContext,
    token: Address,
    to: Address,
    amount: U256,
) -> Result<(), Vec<u8>> {
    let calldata = transferCall { to, amount }.abi_encode();
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
