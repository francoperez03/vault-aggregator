//! Live-Arbitrum-One integration test support. This crate is a plain host binary/test crate —
//! NOT a Stylus contract — so it can depend on the full `alloy` client without bloating the WASM
//! contracts' dependency graph. Everything here is dev/test tooling for Plan 06's real-USDC
//! round-trip tests (D-05: real small transactions, not a fork), never a shipped artifact.

use alloy::primitives::{address, Address};

/// Native USDC on Arbitrum One (D-02: the aggregator is USDC-only). Compile-time constant, not
/// an env var — a typo in an env var would point real money at the wrong token.
pub const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");

/// Morpho Gauntlet USDC Core `gtUSDCc`, the production vault (`docs/PROTOCOL-PROBES.md`).
pub const MORPHO_VAULT: Address = address!("7e97fa6893871A2751B5fE961978DCCb2c201E65");

/// Fluid `fUSDC`, the production vault. FLUID-THROTTLE is UNRESOLVED from static reads
/// (`docs/PROTOCOL-PROBES.md`) — `fluid_roundtrip.rs`'s boundary test is the empirical answer.
pub const FLUID_VAULT: Address = address!("1A996cb54bb95462040408C06122D45D6Cdb6096");

/// Euler v2 `eUSDC-2`, the production vault.
pub const EULER_VAULT: Address = address!("6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b");

/// ABI stubs hand-written against the adapter's real `#[public]` surface (never generated from a
/// Rust-macro interface binding or a `.sol` file/Foundry: this repo's contracts are Rust/Stylus,
/// the stub here is just alloy's typed-call sugar over plain JSON-RPC). Names confirmed against
/// `cargo stylus export-abi`, recorded in 09-03-SUMMARY.md — `total_assets`/`max_withdraw` export
/// as `totalAssets`/`maxWithdraw` (snake_case -> camelCase).
pub mod arbitrum_one {
    use alloy::sol;

    sol! {
        #[sol(rpc)]
        interface IVaultAdapter {
            function init(address vault, address core) external;
            function deposit(uint256 usdc_amount) external returns (uint256);
            function withdraw(uint256 usdc_amount) external returns (uint256);
            function totalAssets() external view returns (uint256);
            function maxWithdraw() external view returns (uint256);
        }

        #[sol(rpc)]
        interface IERC20 {
            function approve(address spender, uint256 amount) external returns (bool);
            function balanceOf(address account) external view returns (uint256);
            function allowance(address owner, address spender) external view returns (uint256);
        }

        #[sol(rpc)]
        interface IERC4626 {
            function maxWithdraw(address owner) external view returns (uint256);
            function totalAssets() external view returns (uint256);
            function convertToAssets(uint256 shares) external view returns (uint256);
        }
    }
}

/// Reads `ARB_ONE_RPC_URL`. `None` when unset — the caller early-returns `Ok(())` (env-gated
/// skip idiom, T-09-19: this is what proves `cargo test --workspace` never spends real money).
pub fn rpc_url() -> Option<String> {
    std::env::var("ARB_ONE_RPC_URL").ok()
}

/// D-07's dedicated M2 wallet private key, funded with real USDC + ETH gas on Arbitrum One. Read
/// from env only, never a literal in source (T-09-22).
pub fn wallet_key() -> anyhow::Result<String> {
    std::env::var("M2_WALLET_KEY").map_err(|_| anyhow::anyhow!("M2_WALLET_KEY not set"))
}

/// Deployed adapter addresses, read from env so callers can override without editing source.
/// `Result`, not `Option`: once `rpc_url()`'s skip gate is passed, a missing address is a real
/// configuration error, not a reason to skip.
pub fn morpho_adapter_addr() -> anyhow::Result<Address> {
    std::env::var("MORPHO_ADAPTER_ADDR")
        .map_err(|_| anyhow::anyhow!("MORPHO_ADAPTER_ADDR not set"))?
        .parse()
        .map_err(|e| anyhow::anyhow!("bad MORPHO_ADAPTER_ADDR: {e}"))
}

pub fn fluid_adapter_addr() -> anyhow::Result<Address> {
    std::env::var("FLUID_ADAPTER_ADDR")
        .map_err(|_| anyhow::anyhow!("FLUID_ADAPTER_ADDR not set"))?
        .parse()
        .map_err(|e| anyhow::anyhow!("bad FLUID_ADAPTER_ADDR: {e}"))
}

pub fn euler_adapter_addr() -> anyhow::Result<Address> {
    std::env::var("EULER_ADAPTER_ADDR")
        .map_err(|_| anyhow::anyhow!("EULER_ADAPTER_ADDR not set"))?
        .parse()
        .map_err(|e| anyhow::anyhow!("bad EULER_ADAPTER_ADDR: {e}"))
}

/// Asserts a contract call reverted with a specific 4-byte custom-error selector (e.g. the
/// adapter's `WithdrawExceedsMax(uint256)`), so a boundary test can never pass on an UNRELATED
/// revert. Prefers structural revert data from the RPC error (`alloy::contract::Error::
/// as_revert_data`); falls back to matching the selector hex in the error message for providers
/// that omit structured revert data. Ported from `coinflip-e2e/src/lib.rs`.
pub fn assert_reverts_with_selector<T>(
    result: Result<T, alloy::contract::Error>,
    selector: [u8; 4],
    error_name: &str,
    context: &str,
) {
    let err = match result {
        Ok(_) => panic!("{context}: expected a {error_name} revert, but the call succeeded"),
        Err(e) => e,
    };
    let selector_hex = alloy::hex::encode(selector);
    match err.as_revert_data() {
        Some(data) => assert!(
            data.starts_with(&selector),
            "{context}: expected {error_name} (selector 0x{selector_hex}), got revert data 0x{}",
            alloy::hex::encode(&data)
        ),
        None => {
            let msg = err.to_string();
            assert!(
                msg.to_ascii_lowercase().contains(&selector_hex),
                "{context}: expected {error_name} (selector 0x{selector_hex}) but the RPC error \
                 carries no structured revert data and its message doesn't mention the selector: \
                 {msg}"
            );
        }
    }
}
