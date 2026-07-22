//! Live Arbitrum One round-trip against Fluid `fUSDC`. Spends real USDC (~$3) and gas.
//! Run with:
//!   ARB_ONE_RPC_URL=... M2_WALLET_KEY=... FLUID_ADAPTER_ADDR=... cargo test -p adapter-e2e

use alloy::network::EthereumWallet;
use alloy::primitives::U256;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::arbitrum_one::{IVaultAdapter, IERC20};
use adapter_e2e::{assert_reverts_with_selector, fluid_adapter_addr, rpc_url, wallet_key, USDC};

/// `WithdrawExceedsMax(uint256)`'s 4-byte selector (`cast sig "WithdrawExceedsMax(uint256)"`),
/// the adapter's D-08 typed revert (`errors.rs`), matched byte-for-byte here.
const WITHDRAW_EXCEEDS_MAX_SELECTOR: [u8; 4] = [0xd9, 0xea, 0x4d, 0x85];

#[tokio::test]
async fn fluid_deposit_withdraw_roundtrip() -> anyhow::Result<()> {
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
    let adapter_address = fluid_adapter_addr()?;
    let adapter = IVaultAdapter::new(adapter_address, provider.clone());

    let amount = U256::from(3_000_000u64); // $3 (D-06)

    let start_balance = usdc.balanceOf(caller).call().await?;

    eprintln!("sending approve...");
    let approve_receipt = usdc
        .approve(adapter_address, amount)
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

/// Answers FLUID-THROTTLE (`docs/PROTOCOL-PROBES.md`) empirically. Two probes against the
/// caller's live `maxWithdraw()`:
/// 1. `maxWithdraw() + 1` must revert with the adapter's own `WithdrawExceedsMax` guard — proves
///    the guard fires correctly at the boundary.
/// 2. `maxWithdraw()` exactly (the reported boundary itself) is attempted. A revert INSIDE the
///    vault here (not the adapter's own guard) is the observable proof that Fluid's `maxWithdraw`
///    over-reports relative to its `withdrawalLimit` throttle; success is proof it does not.
///    Either outcome is a valid, useful result — this test only fails if a partial withdrawal
///    occurs (the caller's USDC balance must be unchanged when the withdraw reverts).
#[tokio::test]
async fn fluid_withdraw_above_max_reverts() -> anyhow::Result<()> {
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
    let adapter_address = fluid_adapter_addr()?;
    let adapter = IVaultAdapter::new(adapter_address, provider.clone());

    let max_withdraw = adapter.maxWithdraw().call().await?;
    eprintln!("live maxWithdraw() = {max_withdraw}");

    // Probe 1: strictly above the reported max must revert with the adapter's own guard.
    let above_max = max_withdraw + U256::from(1u64);
    let above_max_result = adapter.withdraw(above_max).call().await;
    assert_reverts_with_selector(
        above_max_result,
        WITHDRAW_EXCEEDS_MAX_SELECTOR,
        "WithdrawExceedsMax",
        "fluid_withdraw_above_max_reverts: withdraw(maxWithdraw + 1)",
    );

    // Probe 2: the exact reported boundary. Record the outcome either way — this is the
    // empirical answer to FLUID-THROTTLE, not an assertion of a specific outcome.
    let balance_before = usdc.balanceOf(caller).call().await?;
    let at_max_result = adapter.withdraw(max_withdraw).send().await;
    match at_max_result {
        Ok(pending_tx) => match pending_tx.get_receipt().await {
            Ok(receipt) if receipt.status() => {
                eprintln!(
                    "FLUID-THROTTLE RESULT: withdraw(maxWithdraw()) SUCCEEDED — maxWithdraw() \
                     does not over-report relative to Fluid's withdrawalLimit throttle for this \
                     caller/amount."
                );
            }
            Ok(receipt) => {
                eprintln!(
                    "FLUID-THROTTLE RESULT: withdraw(maxWithdraw()) reverted on-chain \
                     (tx {} mined with status=0) — maxWithdraw() over-reports relative to \
                     Fluid's withdrawalLimit throttle.",
                    receipt.transaction_hash
                );
            }
            Err(e) => {
                eprintln!(
                    "FLUID-THROTTLE RESULT: withdraw(maxWithdraw()) reverted before/while \
                     mining — maxWithdraw() over-reports relative to Fluid's withdrawalLimit \
                     throttle. Error: {e}"
                );
            }
        },
        Err(e) => {
            eprintln!(
                "FLUID-THROTTLE RESULT: withdraw(maxWithdraw()) reverted at submission — \
                 maxWithdraw() over-reports relative to Fluid's withdrawalLimit throttle. \
                 Error: {e}"
            );
        }
    }

    // No partial withdrawal must have occurred regardless of outcome: either the balance is
    // unchanged (revert) or it increased by exactly the withdrawn amount (success) — never a
    // partial amount in between.
    let balance_after = usdc.balanceOf(caller).call().await?;
    let delta = if balance_after >= balance_before {
        balance_after - balance_before
    } else {
        U256::ZERO
    };
    assert!(
        delta == U256::ZERO || delta == max_withdraw,
        "withdraw(maxWithdraw()) must either fully succeed (balance +maxWithdraw) or fully \
         revert (balance unchanged), never a partial withdrawal: observed delta {delta}"
    );

    Ok(())
}
