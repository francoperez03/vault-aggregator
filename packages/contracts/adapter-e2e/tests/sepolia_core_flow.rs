//! The test this whole testnet rig exists for: vault-core's full deposit -> rebalance -> redeem
//! plumbing running on-chain against four real adapter instances that really answer, instead of
//! TestVM mocks. Arbitrum Sepolia, MockUsdc, zero real money.
//!
//! Run with:
//!   source docs/.sepolia-env
//!   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... \
//!     cargo test -p adapter-e2e --test sepolia_core_flow -- --test-threads=1 --nocapture

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::sepolia::{
    adapter_addrs, core_addr, mock_usdc_addr, rpc_url, wallet_key, IMockUsdc, IVaultCore, PROTOCOLS,
};
use adapter_e2e::arbitrum_one::IVaultAdapter;

/// The core fans out to four adapters, each of which does transferFrom + approve + vault.deposit —
/// far heavier than the single-adapter mainnet round-trips, and `eth_estimateGas` under-reports
/// Stylus calls (see `TX_GAS_LIMIT`'s note). Unused gas is refunded, so overshooting is free.
const CORE_TX_GAS_LIMIT: u64 = 15_000_000;

/// $100 of mock USDC (6 decimals).
const AMOUNT: u64 = 100_000_000;

/// Rounding slack, in millionths of a dollar. `split_by_bps` hands its remainder to slot 0 (up to
/// 3 units across four adapters) and each MockVault rounds shares down on deposit (1 unit each),
/// so a handful of units of drift is correct behaviour, not a bug. Still ~4e-7 of the position.
const TOLERANCE: u64 = 20;

fn bps_25() -> Vec<U256> {
    vec![U256::from(2500); 4]
}

fn assert_close(actual: U256, expected: U256, label: &str) {
    let diff = if actual > expected {
        actual - expected
    } else {
        expected - actual
    };
    assert!(
        diff <= U256::from(TOLERANCE),
        "{label}: expected ~{expected}, got {actual} (drift {diff} > tolerance {TOLERANCE})"
    );
}

#[tokio::test]
async fn core_deposit_rebalance_redeem_flow() -> anyhow::Result<()> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };

    let signer: PrivateKeySigner = wallet_key()?.parse()?;
    let caller = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let usdc = IMockUsdc::new(mock_usdc_addr()?, provider.clone());
    let core_address = core_addr()?;
    let core = IVaultCore::new(core_address, provider.clone());
    let adapters: Vec<Address> = adapter_addrs()?;

    let amount = U256::from(AMOUNT);

    // --- fund ------------------------------------------------------------------------------

    if usdc.balanceOf(caller).call().await? < amount {
        eprintln!("minting mock USDC...");
        usdc.mint(caller, amount * U256::from(10))
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
    }

    // --- deterministic starting allocation: 25/25/25/25 -------------------------------------
    //
    // Set it explicitly rather than trusting the deploy script's bootstrap: a previous run of this
    // test (or the edge-case suite) may have left a different allocation, and every assertion
    // below is written against a known split. This also makes the test re-runnable.

    eprintln!("rebalance -> 25/25/25/25...");
    core.rebalance(adapters.clone(), bps_25())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    let mut before = Vec::new();
    for adapter in &adapters {
        before.push(
            IVaultAdapter::new(*adapter, provider.clone())
                .totalAssets()
                .call()
                .await?,
        );
    }

    // --- deposit: splits four ways ----------------------------------------------------------

    usdc.approve(core_address, amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    // The core exposes no share-balance view, so read the minted amount by simulating the exact
    // call about to be sent (the approve above is already on-chain, so the simulation runs the
    // real body). Nothing else touches this contract during the test, so the send mints the same.
    let shares = core.deposit(amount).call().await?;
    assert!(!shares.is_zero(), "deposit simulated as minting zero shares");
    eprintln!("depositing {amount} units, expecting {shares} shares...");

    let receipt = core
        .deposit(amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "core.deposit reverted on-chain: {}",
        receipt.transaction_hash
    );

    // Each adapter should have gained a quarter of the deposit.
    let quarter = amount / U256::from(4);
    for (i, adapter) in adapters.iter().enumerate() {
        let after = IVaultAdapter::new(*adapter, provider.clone())
            .totalAssets()
            .call()
            .await?;
        let delta = after - before[i];
        assert_close(delta, quarter, &format!("{} deposit slice", PROTOCOLS[i]));
    }

    // --- rebalance: 40/30/20/10 -------------------------------------------------------------

    let new_weights: Vec<U256> = [4000u64, 3000, 2000, 1000]
        .iter()
        .map(|b| U256::from(*b))
        .collect();
    eprintln!("rebalance -> 40/30/20/10...");
    let receipt = core
        .rebalance(adapters.clone(), new_weights.clone())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "core.rebalance reverted on-chain: {}",
        receipt.transaction_hash
    );

    // Rebalance unwinds everything to the core and re-splits the REAL balance, so assert each
    // adapter holds its weight of the resulting total rather than of the original deposit.
    let mut positions = Vec::new();
    for adapter in &adapters {
        positions.push(
            IVaultAdapter::new(*adapter, provider.clone())
                .totalAssets()
                .call()
                .await?,
        );
    }
    let total: U256 = positions.iter().fold(U256::ZERO, |acc, p| acc + *p);
    assert!(!total.is_zero(), "pool is empty after rebalance");
    for (i, position) in positions.iter().enumerate() {
        let expected = total * new_weights[i] / U256::from(10_000);
        assert_close(*position, expected, &format!("{} post-rebalance", PROTOCOLS[i]));
    }

    // --- redeem: pulls proportionally back out ----------------------------------------------

    let balance_before_redeem = usdc.balanceOf(caller).call().await?;
    eprintln!("redeeming {shares} shares...");
    let receipt = core
        .redeem(shares)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "core.redeem reverted on-chain: {}",
        receipt.transaction_hash
    );

    let payout = usdc.balanceOf(caller).call().await? - balance_before_redeem;
    eprintln!("redeem paid out {payout} units for {shares} shares");
    // At least what went in, modulo rounding. Strictly more is legitimate: the edge-case suite
    // donates to a mock vault, which inflates every holder's position.
    assert!(
        payout + U256::from(TOLERANCE) >= amount,
        "redeem paid {payout}, expected at least {amount} minus {TOLERANCE} units of rounding"
    );

    // Leave the rig on the canonical allocation for the next run.
    core.rebalance(adapters, bps_25())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    Ok(())
}
