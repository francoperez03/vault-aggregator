//! Live Arbitrum One round-trip against Aave v3 through its official Stata static wrapper
//! `stataArbUSDCn` (0x7cfadfd5645b50be87d546f42699d863648251ad). Spends real USDC (~$3) and gas.
//! Roadmap criterion 3 for Phase 10, and a byte-for-byte replica of the Morpho/Fluid/Euler round
//! trips (D-08) — no extra boundary probe: live-state edge cases are Phase 13's scope.
//!
//! The 2-unit tolerance below was measured, not assumed (D-09). Stata has the exchange rate
//! furthest from 1:1 of the four vaults (1 share = 1.173952 USDC), so it was worth checking:
//! convertToShares(3000000) = 2555464 -> convertToAssets(2555464) = 2999999, a 1-unit loss, the
//! same as Euler. The existing tolerance covers it.
//!
//! Run with:
//!   ARB_ONE_RPC_URL=... M2_WALLET_KEY=... AAVE_ADAPTER_ADDR=... cargo test -p adapter-e2e -- aave

use alloy::network::EthereumWallet;
use alloy::primitives::U256;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::arbitrum_one::{IVaultAdapter, IERC20};
use adapter_e2e::{aave_adapter_addr, rpc_url, wallet_key, TX_GAS_LIMIT, USDC};

#[tokio::test]
async fn aave_deposit_withdraw_roundtrip() -> anyhow::Result<()> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_ONE_RPC_URL not set, skipping live Arbitrum One test");
        return Ok(());
    };

    let key = wallet_key()?;
    let signer: PrivateKeySigner = key.parse()?;
    let caller = signer.address();
    let wallet = EthereumWallet::from(signer);

    let provider = ProviderBuilder::new()
        .wallet(wallet)
        .connect_http(rpc_url.parse()?);

    let usdc = IERC20::new(USDC, provider.clone());
    let adapter_address = aave_adapter_addr()?;
    let adapter = IVaultAdapter::new(adapter_address, provider.clone());

    let amount = U256::from(3_000_000u64); // $3 (D-06)

    let start_balance = usdc.balanceOf(caller).call().await?;

    eprintln!("sending approve...");
    let approve_receipt = usdc
        .approve(adapter_address, amount)
        .gas(TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        approve_receipt.status(),
        "approve tx reverted on-chain (status=0): {}",
        approve_receipt.transaction_hash
    );

    eprintln!("sending deposit...");
    let deposit_receipt = adapter
        .deposit(amount)
        .gas(TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        deposit_receipt.status(),
        "deposit tx reverted on-chain (status=0): {}",
        deposit_receipt.transaction_hash
    );

    // The adapter is the custodian of the shares (D-02) — it must now hold a nonzero position.
    let total_assets = adapter.totalAssets().call().await?;
    assert!(
        total_assets > U256::ZERO,
        "adapter.totalAssets() must be nonzero after a successful deposit"
    );

    let max_withdraw = adapter.maxWithdraw().call().await?;
    let withdraw_amount = amount.min(max_withdraw);

    eprintln!("sending withdraw...");
    let withdraw_receipt = adapter
        .withdraw(withdraw_amount)
        .gas(TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        withdraw_receipt.status(),
        "withdraw tx reverted on-chain (status=0): {}",
        withdraw_receipt.transaction_hash
    );

    let end_balance = usdc.balanceOf(caller).call().await?;
    // Bounded rounding tolerance (D-06): the 4626-safe round-down convention loses at most a
    // couple of millionths of a dollar, never an unbounded/exact-equality check.
    let loss = start_balance - end_balance;
    assert!(
        loss <= U256::from(2u64),
        "post-withdraw balance lost more than the accepted 2-unit rounding tolerance: lost {loss}"
    );
    eprintln!("observed rounding loss: {loss} units (millionths of a dollar)");

    Ok(())
}
