#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod permit2;
mod router;
mod usdc;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use router::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct VaultPeriphery {
        address core;
        address permit2;
        address usdc;
    }
}
