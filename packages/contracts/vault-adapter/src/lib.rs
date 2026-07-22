//! VaultAdapter: a generic ERC-4626 client Stylus contract, one instance per protocol vault
//! (Morpho `gtUSDCc`, Fluid `fUSDC`, Euler `eUSDC-2` in this phase; Aave-via-Stata joins in
//! Phase 10). The adapter custodies the vault's shares; the core (Phase 11) only ever sees
//! USDC in/out (D-02).
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod adapter;
#[cfg(test)]
mod conformance;
mod erc20;
mod erc4626;
mod errors;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use adapter::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct VaultAdapter {
        /// Target ERC-4626 vault, fixed at init, no setter (D-01).
        address vault;
        /// Authorized caller for deposit/withdraw (EOA in this phase per D-04, core in Phase 11).
        address core;
        /// One-shot init guard (D-01: immutable config, no setters).
        bool initialized;
    }
}
