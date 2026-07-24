//! VaultCore: the USDC-denominated aggregator contract sitting above 4 `VaultAdapter` instances
//! (Morpho, Fluid, Euler, Aave-via-Stata). Custodies USDC, splits each caller's deposit across
//! THEIR OWN stored weights (Phase 12.1 D-01/D-02 — there is no owner-set global allocation),
//! mints per-(user, adapter) internal shares (non-transferable, F11 D-02), and redeems a bps
//! fraction of a caller's own position back to USDC. The core never touches a lending protocol
//! directly — it only ever calls the adapter's frozen 5-function interface.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

mod adapter_dispatch;
mod core;
mod errors;
mod registry;
mod share_math;
mod usdc;

use stylus_sdk::prelude::*;

#[cfg(feature = "export-abi")]
pub use core::print_from_args;

sol_storage! {
    #[entrypoint]
    pub struct VaultCore {
        /// Contract owner, set once at init. No transferOwnership in this phase's scope.
        address owner;
        /// One-shot init guard.
        bool initialized;

        /// Dynamic adapter registry (D-07). Index order is the iteration order used by the
        /// split-by-bps remainder rule (index 0 = "first active adapter", D-10).
        address[] adapters;
        mapping(address => bool) adapter_enabled;

        /// D-05: per-(user, adapter) internal share ledger. Non-transferable (F11 D-02).
        /// Invariant: for every adapter, sum over users of user_shares[user][adapter]
        /// == adapter_total_shares[adapter].
        mapping(address => mapping(address => uint256)) user_shares;
        /// D-05/D-06: shares minted per adapter — the per-adapter denominator of the virtual
        /// offset. There is no aggregate share price in this model: every adapter has its own.
        mapping(address => uint256) adapter_total_shares;

        /// D-01/D-02: the caller's stored weight preference. `weight_targets[user]` is the ordered
        /// adapter list a deposit splits over; `weight_bps[user][adapter]` is that adapter's bps.
        /// Written ONLY by `rebalance` — there is no `set_weights` and no owner-level allocation.
        mapping(address => address[]) weight_targets;
        mapping(address => mapping(address => uint256)) weight_bps;
    }
}
