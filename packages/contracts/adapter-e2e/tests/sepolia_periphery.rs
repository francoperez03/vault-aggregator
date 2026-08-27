//! The three D-19 residual risks left explicitly open for 13b (`13-CONTEXT.md` D-19): the
//! periphery's own trust boundary, not the core's. D-19 designed `vault-periphery` so a
//! compromise can't steal custodied funds; these tests prove the one thing that IS transiently
//! robbable (the periphery's own balance mid-flow) actually lands at zero, and that a revert
//! mid-flow leaves nothing stranded either.
//!
//! Restored in Phase 14.1 (D-A1/D-A3) after being dropped alongside the periphery crate itself:
//! the entrypoint's old `2`-suffixed name is gone, renamed to `deposit_with_permit`, and resynced
//! against the current per-user core ABI (`IVaultCore`/`IVaultPeriphery` in
//! `adapter-e2e/src/lib.rs`) and the restored `TESTNET_PERIPHERY_ADDR` env var.
//!
//! Real Permit2 `SignatureTransfer`, signed live in-test -- CoinFlip's `sepolia_permit2.rs` lesson
//! (KNOWN-BLOCKER-05-05-1) is that the Permit2 path breaks in ways only a live chain surfaces, so
//! these run against the deployed rig, never `TestVM`.
//!
//! Requires `--test-threads=1`: shares on-chain rig state with `sepolia_core_flow.rs` and
//! `sepolia_edge_cases.rs`.
//!
//! Run with:
//!   source .sepolia-env
//!   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... SEPOLIA_WALLET_KEY_2=... \
//!     cargo test -p adapter-e2e --test sepolia_periphery -- --test-threads=1 --nocapture

use std::time::{SystemTime, UNIX_EPOCH};

use alloy::network::EthereumWallet;
use alloy::primitives::{address, Address, Bytes, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::SignerSync;
use alloy::sol_types::{eip712_domain, SolStruct};

use adapter_e2e::sepolia::{
    adapter_addrs, assert_reverts_with_vault_error, core_addr, periphery_addr, rpc_url, usdc_addr,
    wallet_key, wallet_key_b, IUsdc, IVaultCore, IVaultPeriphery,
};

/// Canonical Permit2 -- identical address on every EVM chain, Sepolia included.
const CANONICAL_PERMIT2: Address = address!("000000000022D473030F116dDEE9F6B43aC78BA3");

const CORE_TX_GAS_LIMIT: u64 = 15_000_000;

/// `AdapterNotEnabled` from `vault-core/src/errors.rs`'s coded-error table (13a Tier 1 collapse).
const ADAPTER_NOT_ENABLED_CODE: u8 = 8;

/// Permit2 EIP-712 `SignatureTransfer` types (witness-less), matching the canonical contract's
/// on-chain typehash exactly. Ported from `coinflip-e2e/src/lib.rs`'s `permit2_eip712` module --
/// this crate has no periphery-facing EIP-712 struct of its own to reuse, so it is copied rather
/// than shared across the two sibling repos.
mod permit2_eip712 {
    use alloy::sol;

    sol! {
        #[derive(Debug)]
        struct TokenPermissions {
            address token;
            uint256 amount;
        }

        #[derive(Debug)]
        struct PermitTransferFrom {
            TokenPermissions permitted;
            address spender;
            uint256 nonce;
            uint256 deadline;
        }
    }
}
use permit2_eip712::{PermitTransferFrom, TokenPermissions};

/// Signs a fresh Permit2 `PermitTransferFrom` (spender = the periphery), returning
/// `(nonce, deadline, signature)` ready for `depositWithPermit`. Ported from
/// `coinflip-e2e/tests/sepolia_permit2.rs::sign_fresh_permit`.
async fn sign_permit2(
    signer: &PrivateKeySigner,
    provider: &impl Provider,
    token: Address,
    spender: Address,
    amount: U256,
) -> anyhow::Result<(U256, U256, Bytes)> {
    let chain_id = provider.get_chain_id().await?;
    let domain = eip712_domain! {
        name: "Permit2",
        chain_id: chain_id,
        verifying_contract: CANONICAL_PERMIT2,
    };
    let nonce = U256::from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos());
    let deadline = U256::from(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs() + 300);
    let permit = PermitTransferFrom {
        permitted: TokenPermissions { token, amount },
        spender,
        nonce,
        deadline,
    };
    let digest = permit.eip712_signing_hash(&domain);
    let signature = signer.sign_hash_sync(&digest)?;
    let sig_bytes = signature.as_bytes(); // 65 bytes: r ++ s ++ v.
    assert_eq!(sig_bytes.len(), 65, "Permit2 signature must be exactly 65 bytes");
    Ok((nonce, deadline, Bytes::copy_from_slice(&sig_bytes)))
}

/// One-time `approve(Permit2, MAX)`, idempotent -- the standard Permit2 consumer preamble, a
/// separate tx from the signed permit itself.
async fn ensure_permit2_allowance(
    usdc: &IUsdc::IUsdcInstance<impl Provider + Clone>,
    owner: Address,
    amount: U256,
) -> anyhow::Result<()> {
    let allowance = usdc.allowance(owner, CANONICAL_PERMIT2).call().await?;
    if allowance < amount {
        eprintln!("approving Permit2...");
        usdc.approve(CANONICAL_PERMIT2, U256::MAX)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
    }
    Ok(())
}

/// D-19 residual risk #1: after a `depositWithPermit` completes, the periphery's own USDC
/// balance and its allowance to the core must both be zero. That transient balance is the ONLY
/// thing a compromised periphery could ever move -- it never holds a privileged claim on other
/// users' custodied funds (the core always pulls, never trusts a declared amount).
///
/// This is also the D-A3 live-rig parity check (Phase 14.1): a real Permit2-signed deposit moves
/// real Sepolia USDC and mints shares, verified via `sharesOf` before/after.
#[tokio::test]
async fn periphery_holds_zero_balance_and_allowance_after_deposit() -> anyhow::Result<()> {
    let Some(rpc) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };

    let signer: PrivateKeySigner = wallet_key()?.parse()?;
    let caller = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer.clone()))
        .connect_http(rpc.parse()?);

    let usdc_address = usdc_addr()?;
    let usdc = IUsdc::new(usdc_address, provider.clone());
    let core_address = core_addr()?;
    let core = IVaultCore::new(core_address, provider.clone());
    let periphery_address = periphery_addr()?;
    let periphery = IVaultPeriphery::new(periphery_address, provider.clone());
    let adapters = adapter_addrs()?;

    let amount = U256::from(200_000u64); // 0.2 USDC -- real faucet USDC is scarce (13a D-21).

    let balance = usdc.balanceOf(caller).call().await?;
    if balance < amount {
        eprintln!(
            "caller holds {balance} units of real Sepolia USDC, need {amount}; skipping (fund \
             via https://faucet.circle.com)"
        );
        return Ok(());
    }

    // D-01: no implicit fallback allocation. Bootstrap weights if the caller has never written
    // any (this wallet has run other tests in this suite already, so it normally has some).
    let mut has_weights = false;
    for adapter in &adapters {
        if !core.weightBpsOf(caller, *adapter).call().await?.is_zero() {
            has_weights = true;
            break;
        }
    }
    if !has_weights {
        core.rebalance(adapters.clone(), vec![U256::from(2500u64); 4])
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
    }

    ensure_permit2_allowance(&usdc, caller, amount).await?;
    let (nonce, deadline, sig) =
        sign_permit2(&signer, &provider, usdc_address, periphery_address, amount).await?;

    let mut shares_before = Vec::with_capacity(adapters.len());
    for adapter in &adapters {
        shares_before.push(core.sharesOf(caller, *adapter).call().await?);
    }

    eprintln!("sending depositWithPermit...");
    let receipt = periphery
        .depositWithPermit(amount, nonce, deadline, sig)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "depositWithPermit reverted on-chain: {}",
        receipt.transaction_hash
    );
    eprintln!(
        "live Permit2 deposit tx: {} (amount={amount})",
        receipt.transaction_hash
    );

    // The residual-risk #1 assertion: nothing left behind, either as a balance or as a lingering
    // allowance to the core.
    let periphery_balance = usdc.balanceOf(periphery_address).call().await?;
    assert!(
        periphery_balance.is_zero(),
        "periphery holds {periphery_balance} units of USDC after a completed depositWithPermit \
         -- the only thing a compromised periphery could steal must be exactly zero"
    );
    let periphery_allowance = usdc.allowance(periphery_address, core_address).call().await?;
    assert!(
        periphery_allowance.is_zero(),
        "periphery retains a {periphery_allowance}-unit USDC allowance to the core after \
         depositWithPermit -- WR-03 (residual-allowance) must not regress"
    );

    // D-A3 live-rig parity: sharesOf(caller) must grow on at least one adapter -- the USDC moved
    // and the deposit really reached the core's per-user accounting, not just the periphery.
    let mut grew = false;
    for (i, adapter) in adapters.iter().enumerate() {
        let after = core.sharesOf(caller, *adapter).call().await?;
        if after > shares_before[i] {
            eprintln!("sharesOf({caller}, {adapter}): {} -> {after}", shares_before[i]);
            grew = true;
        }
    }
    assert!(
        grew,
        "no adapter's sharesOf(caller) grew after depositWithPermit -- the position never \
         landed in the core"
    );

    Ok(())
}

/// D-19 residual risk #2: a `depositWithPermit` whose signer has weights pointing at a disabled
/// adapter must revert with NOTHING left in the periphery. The core's `deposit_for` guard checks
/// every target adapter's enabled bit BEFORE any external call (`vault-core/src/core.rs`), so the
/// whole tx reverts before the Permit2 pull's effects are ever committed.
#[tokio::test]
async fn deposit_with_permit_toward_disabled_adapter_reverts_leaving_nothing() -> anyhow::Result<()>
{
    let Some(rpc) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };

    let signer: PrivateKeySigner = wallet_key()?.parse()?;
    let caller = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer.clone()))
        .connect_http(rpc.parse()?);

    let usdc_address = usdc_addr()?;
    let usdc = IUsdc::new(usdc_address, provider.clone());
    let core_address = core_addr()?;
    let core = IVaultCore::new(core_address, provider.clone());
    let periphery_address = periphery_addr()?;
    let periphery = IVaultPeriphery::new(periphery_address, provider.clone());
    let adapters = adapter_addrs()?;

    // Any adapter the caller currently has a nonzero weight on will do -- the core's guard checks
    // every weighted target, not just the first.
    let mut target = None;
    for adapter in &adapters {
        if !core.weightBpsOf(caller, *adapter).call().await?.is_zero() {
            target = Some(*adapter);
            break;
        }
    }
    let Some(target) = target else {
        eprintln!(
            "caller has no weights set on any adapter yet; can't exercise the disabled-adapter \
             path, skipping"
        );
        return Ok(());
    };

    let amount = U256::from(100_000u64); // 0.1 USDC -- this attempt is simulated, never spent.

    let disable_receipt = core
        .setEnabled(target, false)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        disable_receipt.status(),
        "setEnabled({target}, false) reverted: {}",
        disable_receipt.transaction_hash
    );

    // The Permit2 pull happens INSIDE depositWithPermit, before the core's own guard fires, so a
    // valid signature and a real Permit2 allowance are still required for the simulation to reach
    // (and fail on) the AdapterNotEnabled guard rather than an unrelated Permit2 revert.
    ensure_permit2_allowance(&usdc, caller, amount).await?;
    let (nonce, deadline, sig) =
        sign_permit2(&signer, &provider, usdc_address, periphery_address, amount).await?;

    // Simulated, not sent: a revert is the expected outcome, and `eth_call` proves it without
    // paying for a failed transaction (matches `sepolia_edge_cases.rs`'s established pattern).
    let attempt = periphery
        .depositWithPermit(amount, nonce, deadline, sig)
        .call()
        .await;
    assert_reverts_with_vault_error(
        attempt,
        ADAPTER_NOT_ENABLED_CODE,
        "depositWithPermit with weights pointing at a disabled adapter",
    );

    let periphery_balance = usdc.balanceOf(periphery_address).call().await?;
    assert!(
        periphery_balance.is_zero(),
        "periphery holds {periphery_balance} units of USDC after a depositWithPermit attempt \
         that reverted -- the whole tx must leave nothing stranded"
    );

    // Restore the rig on the way out, including the assertion-failure path via `?` above having
    // already returned -- if an assert above panics, the adapter is left disabled; that's an
    // acceptable trade-off for a test failure state, matching this suite's convention elsewhere.
    let restore_receipt = core
        .setEnabled(target, true)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        restore_receipt.status(),
        "setEnabled({target}, true) (restoring) reverted: {}",
        restore_receipt.transaction_hash
    );

    Ok(())
}

/// D-19 residual risk #3: `depositFor` is permissionless by design (D-19: the core PULLS from
/// `msg.sender` and credits `user`, so crediting a third party is a gift, never a theft). This
/// test proves a dust `depositFor` toward a third party doesn't disturb the per-adapter
/// anti-inflation offset (`adapter_total_shares`, D-06) that offset is GLOBAL to the adapter, not
/// scoped per user, so a stranger's dust gift must not be able to poison anyone else's future
/// deposits into that same adapter.
#[tokio::test]
async fn permissionless_dust_deposit_for_does_not_disturb_the_offset() -> anyhow::Result<()> {
    let Some(rpc) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };
    let Ok(key_b) = wallet_key_b() else {
        eprintln!("SEPOLIA_WALLET_KEY_2 not set, skipping the permissionless dust-deposit test");
        return Ok(());
    };

    let signer_a: PrivateKeySigner = wallet_key()?.parse()?;
    let user_a = signer_a.address();
    let provider_a = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer_a))
        .connect_http(rpc.parse()?);

    let signer_b: PrivateKeySigner = key_b.parse()?;
    let user_b = signer_b.address();
    let provider_b = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer_b))
        .connect_http(rpc.parse()?);

    let usdc_a = IUsdc::new(usdc_addr()?, provider_a.clone());
    let usdc_b = IUsdc::new(usdc_addr()?, provider_b.clone());
    let core_address = core_addr()?;
    let core_a = IVaultCore::new(core_address, provider_a.clone());
    let core_b = IVaultCore::new(core_address, provider_b.clone());
    let adapters = adapter_addrs()?;

    // `depositFor` uses the TARGET's own stored weights, never the caller's (D-01/D-19) -- B must
    // already have written weights (via `rebalance`) at some prior point, or there's nothing to
    // credit dust into.
    let mut target = None;
    for adapter in &adapters {
        if !core_a.weightBpsOf(user_b, *adapter).call().await?.is_zero() {
            target = Some(*adapter);
            break;
        }
    }
    let Some(target) = target else {
        eprintln!(
            "user B has no weights set on any adapter yet (run sepolia_core_flow.rs's \
             two_users_exact_payout_with_different_weights first to bootstrap B); skipping"
        );
        return Ok(());
    };

    const DUST: u64 = 10_000; // 0.01 USDC -- the minimum non-zero-slice gift.
    const NORMAL: u64 = 200_000; // 0.2 USDC -- an ordinary deposit proving the offset still mints.

    let balance_a = usdc_a.balanceOf(user_a).call().await?;
    if balance_a < U256::from(DUST) {
        eprintln!(
            "user A holds {balance_a} units, need {DUST} for the dust gift; skipping (fund via \
             https://faucet.circle.com)"
        );
        return Ok(());
    }
    let balance_b = usdc_b.balanceOf(user_b).call().await?;
    if balance_b < U256::from(NORMAL) {
        eprintln!(
            "user B holds {balance_b} units, need {NORMAL} for the follow-up normal deposit; \
             skipping (fund via https://faucet.circle.com)"
        );
        return Ok(());
    }

    let shares_b_before = core_a.sharesOf(user_b, target).call().await?;
    let shares_a_before = core_a.sharesOf(user_a, target).call().await?;
    let adapter_total_before = core_a.adapterTotalShares(target).call().await?;

    usdc_a
        .approve(core_address, U256::from(DUST))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    eprintln!("A depositFor(B, {DUST}) -- permissionless dust credited to a third party...");
    let receipt = core_a
        .depositFor(user_b, U256::from(DUST))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "depositFor(B, dust) reverted: {}",
        receipt.transaction_hash
    );

    let shares_b_after_dust = core_a.sharesOf(user_b, target).call().await?;
    assert!(
        shares_b_after_dust > shares_b_before,
        "B's sharesOf({target}) did not grow after A's depositFor(B, dust)"
    );
    let shares_a_after_dust = core_a.sharesOf(user_a, target).call().await?;
    assert_eq!(
        shares_a_after_dust, shares_a_before,
        "A's own sharesOf({target}) changed after crediting a third party -- depositFor must \
         never credit the payer"
    );

    // The load-bearing assertion: a normal deposit afterward, by the credited third party acting
    // as "another user" relative to A (the dust payer), must still mint nonzero shares on the
    // SAME adapter -- proving the dust gift didn't poison the per-adapter offset.
    usdc_b
        .approve(core_address, U256::from(NORMAL))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    let receipt = core_b
        .deposit(U256::from(NORMAL))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    assert!(
        receipt.status(),
        "B's normal deposit after the dust gift reverted: {}",
        receipt.transaction_hash
    );

    let shares_b_after_normal = core_a.sharesOf(user_b, target).call().await?;
    assert!(
        shares_b_after_normal > shares_b_after_dust,
        "B's normal deposit minted zero additional shares on {target} -- the dust gift poisoned \
         the per-adapter offset"
    );
    let adapter_total_after = core_a.adapterTotalShares(target).call().await?;
    assert!(
        adapter_total_after > adapter_total_before,
        "adapterTotalShares({target}) did not grow across the dust + normal deposit sequence"
    );

    Ok(())
}
