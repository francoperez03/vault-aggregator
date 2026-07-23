//! MockVault: a minimal ERC-4626 vault implementing exactly the surface `vault-adapter` invokes
//! (`deposit`/`withdraw`/`redeem`/`convertToAssets`/`convertToShares`/`maxWithdraw`/`maxRedeem`/
//! `asset`/`totalAssets`/`balanceOf`), deployed 4x on Arbitrum Sepolia as stand-ins for the real
//! Morpho/Fluid/Euler/Aave-Stata vaults. `totalAssets` reads the vault's actual asset balance, so
//! donation-based share inflation reproduces naturally on-chain; `setWithdrawCap` simulates
//! Fluid-style withdrawal throttling. **Testnet-only fixture — never deploy to mainnet.**
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod erc20;
mod vault;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use vault::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct MockVault {
        /// Underlying asset (MockUsdc on Sepolia), fixed at init.
        address asset;
        /// Fault-injection admin (may call `setWithdrawCap`), fixed at init.
        address owner;
        /// One-shot init guard.
        bool initialized;
        /// Total share supply.
        uint256 total_shares;
        /// `maxWithdraw` ceiling knob — U256::MAX at init (no throttle) until the owner sets it.
        uint256 withdraw_cap;
        /// Per-holder share balances.
        mapping(address => uint256) shares;
    }
}
