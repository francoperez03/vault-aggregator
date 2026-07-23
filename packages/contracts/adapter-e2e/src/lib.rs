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

/// Aave v3 via its official Stata static wrapper `stataArbUSDCn`. The adapter holds Stata shares,
/// never the rebasing `aArbUSDCn` aToken (ADR 001, `docs/DISCOVERY.md` §2.1). Asset-exact
/// `withdraw()` confirmed against the deployed implementation — `PROTOCOL-PROBES.md`
/// AAVE-WITHDRAW-PATH.
pub const STATA_VAULT: Address = address!("7cfadfd5645b50be87d546f42699d863648251ad");

/// Explicit gas limit for every adapter-mutating tx, because `eth_estimateGas` under-estimates
/// Stylus calls on Arbitrum One. Both failures were mined at status=0 with gasUsed ~= gasLimit,
/// while the identical call replayed as `eth_call` succeeded (2026-07-22, `docs/RUNBOOK-M2.md`):
///
/// | Vault  | estimate | mined OOG at | actually needed |
/// |--------|----------|--------------|-----------------|
/// | Euler  | 217,692  | 217,692      | 198,382         |
/// | Morpho | 602,149  | 600,000      | 578,240         |
///
/// Morpho is the expensive one: MetaMorpho's `withdraw` walks its market queue, so the ceiling is
/// set well above it rather than per-protocol. Unused gas is refunded on Arbitrum, so a generous
/// fixed limit costs nothing and removes a whole class of flaky live failures. The frontend
/// (Phase 14) and the Phase 11 core will need the same buffer when they call these adapters.
pub const TX_GAS_LIMIT: u64 = 2_000_000;

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

/// Arbitrum Sepolia mock rig: the disposable MockUsdc / MockVault x4 / vault-core / adapter x4
/// deployed by `scripts/deploy-testnet-mocks.sh`. This is where the CORE's plumbing
/// (deposit split, rebalance, redeem reconciliation) gets exercised on-chain against adapters
/// that really answer — the mainnet round-trips above only ever exercised a single adapter each,
/// with an EOA standing in for the core.
///
/// The mocks deliberately do NOT reproduce any real protocol's quirks (Fluid's throttle, Aave's
/// Stata wrapping, Morpho's queue walk). Adapter-vs-real-protocol behaviour is proven by the
/// Arbitrum One round-trips in this same crate and recorded in `docs/RUNBOOK-M2.md` — these
/// Sepolia tests never substitute for that evidence. See `docs/TESTNET.md`.
pub mod sepolia {
    use alloy::primitives::Address;
    use alloy::sol;

    sol! {
        #[sol(rpc)]
        interface IVaultCore {
            function init(address owner) external;
            function addAdapter(address adapter) external;
            function setEnabled(address adapter, bool enabled) external;
            function removeAdapter(address adapter) external;
            function deposit(uint256 amount) external returns (uint256);
            function redeem(uint256 shares) external returns (uint256);
            function rebalance(address[] adapters, uint256[] newWeights) external;
        }

        #[sol(rpc)]
        interface IMockUsdc {
            function mint(address account, uint256 value) external;
            function transfer(address to, uint256 value) external returns (bool);
            function approve(address spender, uint256 value) external returns (bool);
            function balanceOf(address account) external view returns (uint256);
        }

        #[sol(rpc)]
        interface IMockVault {
            function setWithdrawCap(uint256 cap) external;
            function totalAssets() external view returns (uint256);
            function totalSupply() external view returns (uint256);
            function maxWithdraw(address owner) external view returns (uint256);
        }
    }

    /// The four protocol slots, in the order the deploy script registers them with the core.
    /// Each is a mock stand-in for the same-named real protocol on Arbitrum One.
    pub const PROTOCOLS: [&str; 4] = ["MORPHO", "FLUID", "EULER", "AAVE"];

    /// Reads `ARB_SEPOLIA_RPC_URL`. `None` when unset — the caller early-returns `Ok(())`, the
    /// same env-gated skip idiom the Arbitrum One tests use, so `cargo test --workspace` stays
    /// green and touches no network for anyone who has not deployed the rig.
    pub fn rpc_url() -> Option<String> {
        std::env::var("ARB_SEPOLIA_RPC_URL").ok()
    }

    /// Sepolia deployer/owner key. Testnet-only funds; still env-only, never a source literal.
    pub fn wallet_key() -> anyhow::Result<String> {
        std::env::var("SEPOLIA_WALLET_KEY")
            .map_err(|_| anyhow::anyhow!("SEPOLIA_WALLET_KEY not set"))
    }

    /// Reads and parses one address from the environment. `Result`, not `Option`: past the
    /// `rpc_url()` skip gate a missing address is a configuration error. All of these are written
    /// to `docs/.sepolia-env` by the deploy script — `source` it before running the tests.
    pub fn env_addr(var: &str) -> anyhow::Result<Address> {
        std::env::var(var)
            .map_err(|_| anyhow::anyhow!("{var} not set (source docs/.sepolia-env)"))?
            .parse()
            .map_err(|e| anyhow::anyhow!("bad {var}: {e}"))
    }

    /// MockUsdc, the asset both the core and every adapter are compiled against in `testnet` builds.
    pub fn mock_usdc_addr() -> anyhow::Result<Address> {
        env_addr("MOCK_USDC_ADDR")
    }

    /// The testnet-build vault-core.
    pub fn core_addr() -> anyhow::Result<Address> {
        env_addr("TESTNET_CORE_ADDR")
    }

    /// The four adapter instances, in `PROTOCOLS` order.
    pub fn adapter_addrs() -> anyhow::Result<Vec<Address>> {
        PROTOCOLS
            .iter()
            .map(|p| env_addr(&format!("TESTNET_{p}_ADAPTER_ADDR")))
            .collect()
    }

    /// The four MockVault instances, in `PROTOCOLS` order.
    pub fn mock_vault_addrs() -> anyhow::Result<Vec<Address>> {
        PROTOCOLS
            .iter()
            .map(|p| env_addr(&format!("MOCK_{p}_VAULT")))
            .collect()
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

pub fn aave_adapter_addr() -> anyhow::Result<Address> {
    std::env::var("AAVE_ADAPTER_ADDR")
        .map_err(|_| anyhow::anyhow!("AAVE_ADAPTER_ADDR not set"))?
        .parse()
        .map_err(|e| anyhow::anyhow!("bad AAVE_ADAPTER_ADDR: {e}"))
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
