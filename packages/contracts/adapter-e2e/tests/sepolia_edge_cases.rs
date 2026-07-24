//! The live-state edge cases Arbitrum One cannot be forced into: a throttled vault that caps
//! withdrawals, and a donation that inflates the share price. On mainnet you can only wait for
//! Fluid to throttle or for someone to donate; here the MockVault's `setWithdrawCap` knob and a
//! plain transfer produce those states on demand, against the real core and real adapters.
//!
//! Every test restores the state it perturbs (caps are reset; donations are not reversible but
//! are deliberately small and only inflate the pool, which no assertion elsewhere forbids).
//!
//! Requires `--test-threads=1`: these tests mutate shared on-chain rig state.
//!
//! Run with:
//!   source docs/.sepolia-env
//!   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... \
//!     cargo test -p adapter-e2e --test sepolia_edge_cases -- --test-threads=1 --nocapture
//!
//! DISABLED pending Phase 13 Plan 07-09's rewrite (13-CONTEXT D-05/D-07): this file still asserts
//! the retired pooled-allocation ABI (`IMockUsdc::mint`, owner-only-shaped `redeem(shares)`) that
//! 13a's redeploy removed — real Sepolia USDC has no `mint`, so `mock_usdc_addr`/`IMockUsdc` no
//! longer exist in `adapter_e2e::sepolia` (Plan 06 Task 1). Rewriting this file against the
//! per-user model plus the D-07 edge cases and KI-04's `redeem(bps)` regression is explicitly
//! Plan 07-09's scope, not this plan's — gating the whole file out here is the minimal
//! blocking-issue fix (Rule 3) that keeps `cargo test --workspace` compiling in the meantime.
#![cfg(any())]

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::arbitrum_one::IVaultAdapter;
use adapter_e2e::assert_reverts_with_selector;
use adapter_e2e::sepolia::{
    adapter_addrs, core_addr, mock_usdc_addr, mock_vault_addrs, rpc_url, wallet_key, IMockUsdc,
    IMockVault, IVaultCore,
};

const CORE_TX_GAS_LIMIT: u64 = 15_000_000;

/// `WithdrawExceedsMax(uint256)` from `vault-adapter/src/errors.rs`. The core's
/// `adapter_dispatch::withdraw` propagates the adapter's raw revert data unchanged, so this is
/// what a throttled leg surfaces as at the core's boundary.
const WITHDRAW_EXCEEDS_MAX_SELECTOR: [u8; 4] = [0xd9, 0xea, 0x4d, 0x85];

/// `ZeroAmount()` from `vault-core/src/errors.rs` (`cast sig "ZeroAmount()"`).
const ZERO_AMOUNT_SELECTOR: [u8; 4] = [0x1f, 0x2a, 0x20, 0x05];

/// $10 of mock USDC — enough to split four ways and still leave meaningful per-adapter positions.
const SEED: u64 = 10_000_000;

/// Boilerplate every test repeats: wallet-backed provider plus the rig's addresses. Generic over
/// the provider because `ProviderBuilder`'s filler stack has no nameable concrete type.
struct Rig<P> {
    provider: P,
    caller: Address,
    core: Address,
    usdc: Address,
    adapters: Vec<Address>,
    vaults: Vec<Address>,
}

/// `None` when `ARB_SEPOLIA_RPC_URL` is unset — callers early-return `Ok(())` and skip.
async fn connect() -> anyhow::Result<Option<Rig<impl Provider + Clone>>> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(None);
    };
    let signer: PrivateKeySigner = wallet_key()?.parse()?;
    let caller = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    Ok(Some(Rig {
        provider,
        caller,
        core: core_addr()?,
        usdc: mock_usdc_addr()?,
        adapters: adapter_addrs()?,
        vaults: mock_vault_addrs()?,
    }))
}

impl<P: Provider + Clone> Rig<P> {
    fn usdc(&self) -> IMockUsdc::IMockUsdcInstance<P> {
        IMockUsdc::new(self.usdc, self.provider.clone())
    }

    fn core(&self) -> IVaultCore::IVaultCoreInstance<P> {
        IVaultCore::new(self.core, self.provider.clone())
    }

    fn adapter(&self, i: usize) -> IVaultAdapter::IVaultAdapterInstance<P> {
        IVaultAdapter::new(self.adapters[i], self.provider.clone())
    }

    fn vault(&self, i: usize) -> IMockVault::IMockVaultInstance<P> {
        IMockVault::new(self.vaults[i], self.provider.clone())
    }

    /// Ensures every adapter holds a position, so cap/donation effects are observable. Returns the
    /// shares this call minted (zero when the pool was already seeded).
    async fn ensure_seeded(&self) -> anyhow::Result<U256> {
        let already = self.adapter(0).totalAssets().call().await?;
        if !already.is_zero() {
            return Ok(U256::ZERO);
        }

        let seed = U256::from(SEED);
        let usdc = self.usdc();
        if usdc.balanceOf(self.caller).call().await? < seed {
            usdc.mint(self.caller, seed * U256::from(100))
                .gas(CORE_TX_GAS_LIMIT)
                .send()
                .await?
                .get_receipt()
                .await?;
        }
        usdc.approve(self.core, seed)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;

        let shares = self.core().deposit(seed).call().await?;
        self.core()
            .deposit(seed)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        eprintln!("seeded the pool with {seed} units -> {shares} shares");
        Ok(shares)
    }

    async fn set_cap(&self, i: usize, cap: U256) -> anyhow::Result<()> {
        self.vault(i)
            .setWithdrawCap(cap)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        Ok(())
    }
}

/// A vault-level throttle is visible to the adapter: `maxWithdraw()` tracks the cap, not just the
/// position. This is the read the core relies on when sizing a redeem leg.
#[tokio::test]
async fn withdraw_cap_propagates_to_adapter_max_withdraw() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    rig.ensure_seeded().await?;

    let uncapped = rig.adapter(0).maxWithdraw().call().await?;
    assert!(!uncapped.is_zero(), "adapter 0 holds no position to cap");

    let cap = uncapped / U256::from(2);
    rig.set_cap(0, cap).await?;
    let capped = rig.adapter(0).maxWithdraw().call().await?;
    assert_eq!(capped, cap, "adapter maxWithdraw did not follow the vault cap");

    rig.set_cap(0, U256::MAX).await?;
    let restored = rig.adapter(0).maxWithdraw().call().await?;
    assert_eq!(restored, uncapped, "clearing the cap did not restore maxWithdraw");

    Ok(())
}

/// The atomicity guarantee (D-06/D-10) proven on-chain: one throttled adapter reverts the ENTIRE
/// redeem, and because the revert unwinds the whole call frame the caller's shares survive — the
/// same redeem succeeds once the throttle clears. On mainnet this path can only be observed by
/// catching Fluid mid-throttle.
#[tokio::test]
async fn throttled_adapter_reverts_whole_redeem_and_burns_nothing() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    let minted = rig.ensure_seeded().await?;
    let shares = if minted.is_zero() {
        // Pool was already seeded by an earlier run: mint a fresh, known share amount to redeem.
        let seed = U256::from(SEED);
        rig.usdc()
            .approve(rig.core, seed)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        let s = rig.core().deposit(seed).call().await?;
        rig.core()
            .deposit(seed)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        s
    } else {
        minted
    };

    // Freeze one leg completely.
    rig.set_cap(0, U256::ZERO).await?;

    // Simulated, not sent: a revert is the expected outcome, and `eth_call` proves it without
    // paying for a failed transaction.
    let attempt = rig.core().redeem(shares).call().await;
    assert_reverts_with_selector(
        attempt,
        WITHDRAW_EXCEEDS_MAX_SELECTOR,
        "WithdrawExceedsMax",
        "redeem with a fully throttled adapter",
    );

    // Clear the throttle; the very same redeem must now go through, which is only possible if the
    // failed attempt burned nothing.
    rig.set_cap(0, U256::MAX).await?;
    let receipt = rig
        .core()
        .redeem(shares)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "redeem still reverted after clearing the cap: {}",
        receipt.transaction_hash
    );

    Ok(())
}

/// A donation straight into a vault inflates every holder's position. Two things must hold: the
/// core sees the larger pool (the adapter's `totalAssets` grows by the donation), and a normal
/// deposit afterwards still mints non-zero shares — the on-chain replay of Phase 11's D-03
/// inflation test, now against the real virtual-offset share math rather than TestVM.
#[tokio::test]
async fn donation_inflates_pool_without_breaking_deposits() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    rig.ensure_seeded().await?;

    let before = rig.adapter(1).totalAssets().call().await?;
    assert!(!before.is_zero(), "adapter 1 holds no position to inflate");

    let donation = U256::from(1_000_000u64); // $1, straight to the vault, bypassing the core.
    let usdc = rig.usdc();
    if usdc.balanceOf(rig.caller).call().await? < donation {
        usdc.mint(rig.caller, donation * U256::from(100))
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
    }
    usdc.transfer(rig.vaults[1], donation)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    let after = rig.adapter(1).totalAssets().call().await?;
    assert!(
        after > before,
        "donation of {donation} did not raise the adapter's position ({before} -> {after})"
    );

    // The whole point: the pool got more expensive per share, but a normal depositor still gets
    // shares. A vault without the virtual-offset defence would round them to zero here.
    let probe = U256::from(1_000_000u64);
    usdc.approve(rig.core, probe)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    let shares = rig.core().deposit(probe).call().await?;
    assert!(
        !shares.is_zero(),
        "a {probe}-unit deposit minted zero shares after a {donation}-unit donation"
    );

    Ok(())
}

/// Cheapest possible guard check, and the one a fuzzer would find first.
#[tokio::test]
async fn zero_amount_deposit_reverts() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };

    let attempt = rig.core().deposit(U256::ZERO).call().await;
    assert_reverts_with_selector(
        attempt,
        ZERO_AMOUNT_SELECTOR,
        "ZeroAmount",
        "core.deposit(0)",
    );

    Ok(())
}
