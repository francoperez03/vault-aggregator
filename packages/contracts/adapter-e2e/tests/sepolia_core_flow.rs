//! The test this whole testnet rig exists for: vault-core's full deposit -> rebalance -> redeem
//! plumbing running on-chain against four real adapter instances that really answer, instead of
//! TestVM mocks. Arbitrum Sepolia, real Circle-issued USDC, zero real money at stake.
//!
//! Rewritten against the per-user model (Phase 13 Plan 06, 13-CONTEXT D-05): `redeem` takes bps
//! of the caller's OWN position, not a global share count; `rebalance` operates on the caller's
//! own weights, never a global allocation; the asset is real USDC with no `mint`.
//!
//! Run with:
//!   source .sepolia-env
//!   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... \
//!     cargo test -p adapter-e2e --test sepolia_core_flow -- --test-threads=1 --nocapture
//!
//! The two-user exact-payout test additionally needs SEPOLIA_WALLET_KEY_2 (user B).

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::arbitrum_one::IVaultAdapter;
use adapter_e2e::sepolia::{
    adapter_addrs, assert_reverts_with_vault_error, core_addr, rpc_url, usdc_addr, wallet_key,
    wallet_key_b, IUsdc, IVaultCore, PROTOCOLS,
};

/// KI-01/D-09: five distinct full-bps allocations, one per cycle, so `dust_accrual_over_n_cycles`
/// exercises a different rebalance split every time rather than repeating the same rounding.
const DUST_CYCLE_WEIGHTS: [[u64; 4]; 5] = [
    [4000, 3000, 2000, 1000],
    [1000, 4000, 3000, 2000],
    [2000, 1000, 4000, 3000],
    [3000, 2000, 1000, 4000],
    [2500, 2500, 2500, 2500],
];

/// The core fans out to four adapters, each of which does transferFrom + approve + vault.deposit —
/// far heavier than the single-adapter mainnet round-trips, and `eth_estimateGas` under-reports
/// Stylus calls (see `TX_GAS_LIMIT`'s note). Unused gas is refunded, so overshooting is free.
const CORE_TX_GAS_LIMIT: u64 = 15_000_000;

/// 10 USDC (6 decimals). Real faucet USDC is scarce (13a D-21) — this is deliberately smaller
/// than the old mock-USDC test's $100.
const AMOUNT: u64 = 10_000_000;

/// Rounding slack, in millionths of a dollar. `split_by_bps` hands its remainder to slot 0 (up to
/// 3 units across four adapters) and each MockVault rounds shares down on deposit (1 unit each),
/// so a handful of units of drift is correct behaviour, not a bug. Still ~2e-6 of the position.
const TOLERANCE: u64 = 20;

/// `NoWeightsSet` from `vault-core/src/errors.rs`'s coded-error table (13a Tier 1 collapse).
const NO_WEIGHTS_SET_CODE: u8 = 16;

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

/// A deliberate off-chain REPLICA of `vault-core::share_math::convert_to_assets`
/// (`shares * (total_assets + 1) / (total_shares + 10^6)`, floor), used ONLY by the KI-03 test
/// below to compute the exact payout a real redeem must produce. Not imported from the WASM
/// crate on purpose: if this replica ever diverges from the real formula, the test fails — that
/// divergence IS the thing KI-03 exists to catch, since TestVM's shared return-data buffer
/// (`stylus-test` 0.10.7) makes the equivalent assertion unreachable in unit tests
/// (the known-issues log KI-03). Plain U256 arithmetic is safe here: shares/assets in this rig
/// never approach 2^256, unlike the on-chain version this doesn't need the U512 widen.
fn convert_to_assets_offchain(shares: U256, total_shares: U256, total_assets: U256) -> U256 {
    const OFFSET_POW: u64 = 1_000_000;
    let numerator = shares * (total_assets + U256::from(1));
    numerator / (total_shares + U256::from(OFFSET_POW))
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

    let usdc = IUsdc::new(usdc_addr()?, provider.clone());
    let core_address = core_addr()?;
    let core = IVaultCore::new(core_address, provider.clone());
    let adapters: Vec<Address> = adapter_addrs()?;

    let amount = U256::from(AMOUNT);

    // Real USDC has no `mint`: a dry faucet is a setup problem, never a contract bug (13a D-21).
    let balance = usdc.balanceOf(caller).call().await?;
    if balance < amount {
        eprintln!(
            "deployer holds {balance} units of real Sepolia USDC, need {amount}; skipping \
             (fund via https://faucet.circle.com)"
        );
        return Ok(());
    }

    // --- deterministic starting allocation: 25/25/25/25 -------------------------------------
    //
    // Set it explicitly rather than trusting whatever a previous run left behind: every
    // assertion below is written against a known split, and per-user rebalance is always
    // re-runnable regardless of prior state.

    eprintln!("rebalance -> 25/25/25/25...");
    core.rebalance(adapters.clone(), bps_25())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    // --- snapshot the caller's own ledger before depositing ---------------------------------

    let mut shares_before = Vec::new();
    let mut adapter_total_before = Vec::new();
    let mut ta_before = Vec::new();
    for adapter in &adapters {
        shares_before.push(core.sharesOf(caller, *adapter).call().await?);
        adapter_total_before.push(core.adapterTotalShares(*adapter).call().await?);
        ta_before.push(
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

    eprintln!("depositing {amount} units...");
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

    // Each adapter should have gained a quarter of the deposit, and the caller's own ledger
    // (sharesOf) plus the adapter-wide ledger (adapterTotalShares) must have grown by exactly the
    // same amount — nobody else touched these adapters in this transaction.
    let quarter = amount / U256::from(4);
    for (i, adapter) in adapters.iter().enumerate() {
        let ta_after = IVaultAdapter::new(*adapter, provider.clone())
            .totalAssets()
            .call()
            .await?;
        assert_close(
            ta_after - ta_before[i],
            quarter,
            &format!("{} deposit slice (totalAssets)", PROTOCOLS[i]),
        );

        let shares_after = core.sharesOf(caller, *adapter).call().await?;
        assert!(
            shares_after > shares_before[i],
            "{}: sharesOf(caller) did not grow on deposit",
            PROTOCOLS[i]
        );

        let adapter_total_after = core.adapterTotalShares(*adapter).call().await?;
        assert_eq!(
            adapter_total_after - adapter_total_before[i],
            shares_after - shares_before[i],
            "{}: adapterTotalShares grew by more than the caller's own minted shares",
            PROTOCOLS[i]
        );
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

    // Value each leg the way F14's frontend will: sharesOf / adapterTotalShares * totalAssets().
    // Validating that exact formula here, on the live rig, is this step's second purpose.
    let mut values = Vec::new();
    for adapter in &adapters {
        let shares = core.sharesOf(caller, *adapter).call().await?;
        let total_shares = core.adapterTotalShares(*adapter).call().await?;
        let ta = IVaultAdapter::new(*adapter, provider.clone())
            .totalAssets()
            .call()
            .await?;
        values.push(if total_shares.is_zero() {
            U256::ZERO
        } else {
            shares * ta / total_shares
        });
    }
    let total_value: U256 = values.iter().fold(U256::ZERO, |acc, v| acc + *v);
    assert!(
        !total_value.is_zero(),
        "caller position valued at zero after rebalance"
    );
    for (i, value) in values.iter().enumerate() {
        let expected = total_value * new_weights[i] / U256::from(10_000);
        assert_close(
            *value,
            expected,
            &format!("{} post-rebalance value", PROTOCOLS[i]),
        );
    }

    // --- redeem: exit is denominated in bps of the caller's OWN position, never in shares ----

    let balance_before_redeem = usdc.balanceOf(caller).call().await?;
    eprintln!("redeeming 10000 bps (full exit)...");
    let receipt = core
        .redeem(U256::from(10_000))
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
    eprintln!("redeem paid out {payout} units");
    // At least what went in, modulo rounding. Strictly more is legitimate: a donation from a
    // sibling test inflates every holder's position.
    assert!(
        payout + U256::from(TOLERANCE) >= amount,
        "redeem paid {payout}, expected at least {amount} minus {TOLERANCE} units of rounding"
    );

    for adapter in &adapters {
        let remaining = core.sharesOf(caller, *adapter).call().await?;
        assert!(
            remaining.is_zero(),
            "sharesOf(caller) not zero on {adapter} after a full (10000 bps) exit"
        );
    }

    // Leave the rig on the canonical allocation for the next run.
    core.rebalance(adapters, bps_25())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    Ok(())
}

/// The per-user model has no implicit fallback allocation (13-CONTEXT D-01): a `deposit` before
/// the caller has ever written weights reverts `NoWeightsSet`, and the coded-error table
/// (`vault-core/src/errors.rs`) must be decodable from a plain client — the same thing F14's
/// frontend will need to do to show a useful error.
///
/// `write_weights` has no "clear" path (`rebalance` requires a non-empty adapter list), so once a
/// wallet has ever called it, it stays bootstrapped forever on this rig. This precondition can
/// only be observed once per wallet; the probe below detects a prior run and skips instead of
/// re-asserting a state that no longer holds.
#[tokio::test]
async fn deposit_without_weights_reverts_no_weights_set() -> anyhow::Result<()> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };
    let Ok(key_b) = wallet_key_b() else {
        eprintln!("SEPOLIA_WALLET_KEY_2 not set, skipping the NoWeightsSet precondition test");
        return Ok(());
    };

    let signer_b: PrivateKeySigner = key_b.parse()?;
    let user_b = signer_b.address();
    let provider_b = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer_b))
        .connect_http(rpc_url.parse()?);

    let core = IVaultCore::new(core_addr()?, provider_b.clone());
    let adapters = adapter_addrs()?;

    // Probe adapters[2] — the first adapter user B ever gets weight on in
    // `two_users_exact_payout_with_different_weights` below. A nonzero weight there means this
    // rig instance already saw B bootstrap, so the NoWeightsSet precondition can't recur.
    if !core.weightBpsOf(user_b, adapters[2]).call().await?.is_zero() {
        eprintln!(
            "user B already has weights set on {} from a previous run of this suite; the \
             NoWeightsSet precondition can't be re-observed on this rig instance, skipping",
            adapters[2]
        );
        return Ok(());
    }

    let attempt = core.deposit(U256::from(1_000_000u64)).call().await;
    assert_reverts_with_vault_error(
        attempt,
        NO_WEIGHTS_SET_CODE,
        "deposit before any weights were ever written",
    );

    Ok(())
}

/// KI-03, the gap TestVM cannot cover by construction: `stylus-test` 0.10.7 shares one
/// return-data buffer across mocked calls inside a single top-level call, so the two
/// `balanceOf(core)` reads inside `unwind_position` collapse to the same value under a unit
/// test. Share-ledger independence between users IS provable under TestVM and already is
/// (`two_users_with_different_weights_redeem_only_their_own_position`); the EXACT payout amount
/// is not, and this live test is the only place it gets checked (pattern T-12.1-21,
/// the known-issues log KI-03).
///
/// Two users, disjoint adapters, disjoint weights: A only ever touches adapters[0]/[1] at
/// 50/50, B only ever touches adapters[2]/[3] at 70/30. `write_weights` rejects zero weights, so
/// a single 4-slot allocation with two zero legs is not expressible — disjoint adapter subsets
/// are the only way to get both disjoint adapters AND different weight ratios in one test.
#[tokio::test]
async fn two_users_exact_payout_with_different_weights() -> anyhow::Result<()> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };
    let Ok(key_b) = wallet_key_b() else {
        eprintln!("SEPOLIA_WALLET_KEY_2 not set, skipping the KI-03 two-user exact-payout test");
        return Ok(());
    };

    let signer_a: PrivateKeySigner = wallet_key()?.parse()?;
    let user_a = signer_a.address();
    let provider_a = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer_a))
        .connect_http(rpc_url.parse()?);

    let signer_b: PrivateKeySigner = key_b.parse()?;
    let user_b = signer_b.address();
    let provider_b = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer_b))
        .connect_http(rpc_url.parse()?);

    let adapters = adapter_addrs()?;
    let usdc_a = IUsdc::new(usdc_addr()?, provider_a.clone());
    let usdc_b = IUsdc::new(usdc_addr()?, provider_b.clone());
    let core_address = core_addr()?;
    let core_a = IVaultCore::new(core_address, provider_a.clone());
    let core_b = IVaultCore::new(core_address, provider_b.clone());

    let amount = U256::from(4_000_000u64); // 4 USDC each — the wallets' faucet budget is limited.

    let balance_a = usdc_a.balanceOf(user_a).call().await?;
    let balance_b = usdc_b.balanceOf(user_b).call().await?;
    if balance_a < amount || balance_b < amount {
        eprintln!(
            "insufficient real Sepolia USDC for the two-user test (A: {balance_a}, B: {balance_b}, \
             need {amount} each); skipping (fund via https://faucet.circle.com)"
        );
        return Ok(());
    }

    let a_adapters = vec![adapters[0], adapters[1]];
    let a_weights = vec![U256::from(5000u64), U256::from(5000u64)];
    let b_adapters = vec![adapters[2], adapters[3]];
    let b_weights = vec![U256::from(7000u64), U256::from(3000u64)];

    eprintln!("A: rebalance -> 50/50 on {a_adapters:?}");
    core_a
        .rebalance(a_adapters, a_weights)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    eprintln!("B: rebalance -> 70/30 on {b_adapters:?}");
    core_b
        .rebalance(b_adapters, b_weights)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    usdc_a
        .approve(core_address, amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    eprintln!("A deposits {amount}...");
    core_a
        .deposit(amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    usdc_b
        .approve(core_address, amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    eprintln!("B deposits {amount}...");
    core_b
        .deposit(amount)
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    // --- snapshot both users' ledgers on all four adapters, right before A's exit -----------

    let mut shares_a = Vec::new();
    let mut shares_b_before = Vec::new();
    let mut total_shares = Vec::new();
    let mut total_assets = Vec::new();
    for adapter in &adapters {
        shares_a.push(core_a.sharesOf(user_a, *adapter).call().await?);
        shares_b_before.push(core_a.sharesOf(user_b, *adapter).call().await?);
        total_shares.push(core_a.adapterTotalShares(*adapter).call().await?);
        total_assets.push(
            IVaultAdapter::new(*adapter, provider_a.clone())
                .totalAssets()
                .call()
                .await?,
        );
    }

    // --- compute A's expected payout off-chain, replicating unwind_position's per-adapter math ---

    let expected_a: U256 = (0..adapters.len())
        .map(|i| {
            if shares_a[i].is_zero() {
                U256::ZERO
            } else {
                convert_to_assets_offchain(shares_a[i], total_shares[i], total_assets[i])
            }
        })
        .fold(U256::ZERO, |acc, owed| acc + owed);
    assert!(!expected_a.is_zero(), "computed A's expected payout as zero");

    // --- A exits fully: the payout must match the off-chain computation EXACTLY -------------

    let balance_before_a = usdc_a.balanceOf(user_a).call().await?;
    eprintln!("A redeems 10000 bps (full exit)...");
    core_a
        .redeem(U256::from(10_000))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    let payout_a = usdc_a.balanceOf(user_a).call().await? - balance_before_a;

    // KI-03's assertion: strict equality, not `assert_close`. If real on-chain rounding ever
    // forces a tolerance here, it must be documented with an exact unit count, never widened
    // silently — this is the whole point of closing KI-03 on a live chain instead of TestVM.
    assert_eq!(
        payout_a, expected_a,
        "A's exact payout diverged from the off-chain convert_to_assets replica"
    );

    // --- B's position must be byte-identical to the pre-exit snapshot: A's exit touched none of
    // B's ledger (T-13-28) ---

    for (i, adapter) in adapters.iter().enumerate() {
        let shares_b_after = core_a.sharesOf(user_b, *adapter).call().await?;
        assert_eq!(
            shares_b_after, shares_b_before[i],
            "{adapter}: B's sharesOf changed after A's redeem"
        );
    }

    // --- B exits too, with the identical exact-payout check, so the test doesn't depend on
    // which user exits first ---

    let mut shares_b = Vec::new();
    let mut total_shares_b = Vec::new();
    let mut total_assets_b = Vec::new();
    for adapter in &adapters {
        shares_b.push(core_b.sharesOf(user_b, *adapter).call().await?);
        total_shares_b.push(core_b.adapterTotalShares(*adapter).call().await?);
        total_assets_b.push(
            IVaultAdapter::new(*adapter, provider_b.clone())
                .totalAssets()
                .call()
                .await?,
        );
    }
    let expected_b: U256 = (0..adapters.len())
        .map(|i| {
            if shares_b[i].is_zero() {
                U256::ZERO
            } else {
                convert_to_assets_offchain(shares_b[i], total_shares_b[i], total_assets_b[i])
            }
        })
        .fold(U256::ZERO, |acc, owed| acc + owed);

    let balance_before_b = usdc_b.balanceOf(user_b).call().await?;
    eprintln!("B redeems 10000 bps (full exit)...");
    core_b
        .redeem(U256::from(10_000))
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;
    let payout_b = usdc_b.balanceOf(user_b).call().await? - balance_before_b;
    assert_eq!(
        payout_b, expected_b,
        "B's exact payout diverged from the off-chain convert_to_assets replica"
    );

    Ok(())
}

/// KI-01/D-09: quantifies how much USDC actually strands in the core across repeated
/// deposit/rebalance/redeem cycles, so `known-issues.md`'s "quantify it, then decide on `sweep()`"
/// deferral gets a real number instead of staying open indefinitely.
///
/// N = 5 (D-09's range is 5/10/20): each cycle is a full round-trip (deposit -> rebalance to a
/// distinct allocation -> full-bps redeem), and `USDC.balanceOf(core)` is read before the loop and
/// after every cycle. Five cycles landed a clearly non-zero, non-exploding series on the first
/// run (see the `KI-01-DUST` verdict this test's output feeds into the PROTOCOL-PROBES log), so
/// there was no need to burn more of the finite faucet budget on 10 or 20.
///
/// The dust is expected to be monotonic non-decreasing (nothing sweeps it) and small relative to
/// the cycle amount (share-math rounding, not a leak): `DUST_CAP` below is a generous multiple of
/// what floor-division rounding across 4 adapters x 2-3 legs per cycle can plausibly produce, not
/// a tight bound -- its job is to catch an exploding regression, not to pin the exact number.
#[tokio::test]
async fn dust_accrual_over_n_cycles() -> anyhow::Result<()> {
    let Some(rpc_url) = rpc_url() else {
        eprintln!("ARB_SEPOLIA_RPC_URL not set, skipping Sepolia mock-rig test");
        return Ok(());
    };

    let signer: PrivateKeySigner = wallet_key()?.parse()?;
    let caller = signer.address();
    let provider = ProviderBuilder::new()
        .wallet(EthereumWallet::from(signer))
        .connect_http(rpc_url.parse()?);

    let usdc = IUsdc::new(usdc_addr()?, provider.clone());
    let core_address = core_addr()?;
    let core = IVaultCore::new(core_address, provider.clone());
    let adapters: Vec<Address> = adapter_addrs()?;

    const N: usize = 5;
    const CYCLE_AMOUNT: u64 = 1_000_000; // 1 USDC per cycle.
    /// Generous ceiling on TOTAL dust growth across all N cycles -- see the doc-comment above.
    const DUST_CAP: u64 = 50_000; // 0.05 USDC total, i.e. 1% of one cycle's volume.

    let amount = U256::from(CYCLE_AMOUNT);
    let needed = amount * U256::from(N as u64);
    let balance = usdc.balanceOf(caller).call().await?;
    if balance < needed {
        eprintln!(
            "caller holds {balance} units of real Sepolia USDC, need {needed} for {N} dust \
             cycles; skipping (fund via https://faucet.circle.com)"
        );
        return Ok(());
    }

    let dust_before = usdc.balanceOf(core_address).call().await?;
    let mut dust_series = Vec::with_capacity(N);

    for (i, weights) in DUST_CYCLE_WEIGHTS.iter().take(N).enumerate() {
        usdc.approve(core_address, amount)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        let deposit_receipt = core
            .deposit(amount)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        assert!(
            deposit_receipt.status(),
            "cycle {i}: deposit reverted: {}",
            deposit_receipt.transaction_hash
        );

        let new_weights: Vec<U256> = weights.iter().map(|w| U256::from(*w)).collect();
        let rebalance_receipt = core
            .rebalance(adapters.clone(), new_weights)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        assert!(
            rebalance_receipt.status(),
            "cycle {i}: rebalance reverted: {}",
            rebalance_receipt.transaction_hash
        );

        let redeem_receipt = core
            .redeem(U256::from(10_000))
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        assert!(
            redeem_receipt.status(),
            "cycle {i}: redeem(10000) reverted: {}",
            redeem_receipt.transaction_hash
        );

        let dust_after_cycle = usdc.balanceOf(core_address).call().await?;
        dust_series.push(dust_after_cycle);
    }

    eprintln!("dust before any cycle: {dust_before}");
    eprintln!("dust series (after each cycle): {dust_series:?}");

    // Monotonic non-decreasing: no code path sweeps it, so it can only hold steady or grow.
    let mut previous = dust_before;
    for (i, dust) in dust_series.iter().enumerate() {
        assert!(
            *dust >= previous,
            "cycle {i}: dust dropped from {previous} to {dust} -- something is moving USDC out \
             of the core with no accounting for it"
        );
        previous = *dust;
    }

    let total_growth = dust_series[N - 1] - dust_before;
    let average_per_cycle = total_growth / U256::from(N as u64);
    eprintln!(
        "total dust growth over {N} cycles: {total_growth} units (~{average_per_cycle} units/cycle)"
    );
    assert!(
        total_growth <= U256::from(DUST_CAP),
        "dust grew by {total_growth} units over {N} cycles, above the {DUST_CAP}-unit sanity cap \
         -- this looks like a leak, not rounding"
    );

    // Leave the rig on the canonical allocation for the next run (mirrors
    // `core_deposit_rebalance_redeem_flow`'s cleanup at the end of its own test).
    core.rebalance(adapters, bps_25())
        .gas(CORE_TX_GAS_LIMIT)
        .send()
        .await?
        .get_receipt()
        .await?;

    Ok(())
}
