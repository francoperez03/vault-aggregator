//! MockUsdc: a minimal 6-decimal ERC-20 with an open (unauthenticated) `mint`, standing in for
//! native USDC on Arbitrum Sepolia so the testnet mock-vault rig can create arbitrarily large
//! positions without faucet dependencies. **Testnet-only fixture — never deploy to mainnet.**
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod token;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use token::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct MockUsdc {
        uint256 total_supply;
        mapping(address => uint256) balances;
        mapping(address => mapping(address => uint256)) allowances;
    }
}
