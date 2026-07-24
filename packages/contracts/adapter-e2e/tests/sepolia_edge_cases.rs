//! The live-state edge cases Arbitrum One cannot be forced into: a throttled vault that caps
//! withdrawals. On mainnet you can only wait for Fluid to throttle; here the MockVault's
//! `setWithdrawCap` knob produces that state on demand, against the real core and real adapters.
//!
//! CR-01 / KI-04: a fully-throttled adapter must revert the WHOLE `redeem`, never burn the
//! caller's shares while paying nothing. The bug lived in `unwind_position`
//! (`vault-core/src/core.rs`): `owed_total += owed` briefly sat INSIDE the `if let Some(request) =
//! unwind_request(...)` block, so a skipped (fully-throttled) leg's `owed` never made it into the
//! reconciliation and the leg silently "succeeded" with the burn already applied. The fix moved
//! `owed_total += owed` OUTSIDE that `if let`, unconditional. `stylus-test` 0.10.7's shared
//! return-data buffer makes this unreachable in a unit test (`docs/known-issues.md` KI-04): forcing
//! `max_withdraw() == 0` in TestVM also forces `totalAssets() == 0` in the same mocked call, which
//! forces `owed == 0`, and a skipped leg with `owed == 0` can't distinguish the fixed and broken
//! code. Only a real chain, where each read returns its own value, can catch a regression here.
//!
//! Every test restores the withdraw cap it sets (`U256::MAX`) on every exit path, including the
//! assertion-failure path, since the rig's on-chain state is shared across the whole suite.
//!
//! Requires `--test-threads=1`: these tests mutate shared on-chain rig state.
//!
//! Run with:
//!   source docs/.sepolia-env
//!   ARB_SEPOLIA_RPC_URL=... SEPOLIA_WALLET_KEY=... \
//!     cargo test -p adapter-e2e --test sepolia_edge_cases -- --test-threads=1 --nocapture
//!
//! `donation_inflates_pool_without_breaking_deposits` (D-07.4) is deferred to Phase 13 Plan 08: its
//! rewrite against the per-user model (virtual offset per adapter) is that plan's scope, not this
//! one's, and it is not present in this file — adding it back with the old pooled-model mint calls
//! would just reintroduce the same `IUsdc::mint` compile break Plan 06 gated around. D-07.3
//! (deposit-shortfall) is also Plan 08's scope and is likewise not in this file yet.

use alloy::network::EthereumWallet;
use alloy::primitives::{Address, U256};
use alloy::providers::{Provider, ProviderBuilder};
use alloy::signers::local::PrivateKeySigner;

use adapter_e2e::arbitrum_one::IVaultAdapter;
use adapter_e2e::sepolia::{
    adapter_addrs, assert_reverts_with_vault_error, core_addr, mock_vault_addrs, rpc_url,
    usdc_addr, wallet_key, IMockVault, IUsdc, IVaultCore,
};

const CORE_TX_GAS_LIMIT: u64 = 15_000_000;

/// `WithdrawExceedsMax(uint256)` from `vault-adapter/src/errors.rs`. The core's
/// `adapter_dispatch::withdraw` propagates the adapter's raw revert data unchanged, so this is
/// one of the two shapes a throttled leg can surface as at the core's boundary.
const WITHDRAW_EXCEEDS_MAX_SELECTOR: [u8; 4] = [0xd9, 0xea, 0x4d, 0x85];

/// `RedeemShortfall(uint256,uint256)` from `vault-core/src/errors.rs` (`cast sig
/// "RedeemShortfall(uint256,uint256)"`). The other shape a throttled leg can surface as: the
/// core's own `reconcile_credit` catches the shortfall before the adapter's own guard would.
const REDEEM_SHORTFALL_SELECTOR: [u8; 4] = [0x5b, 0x1b, 0x92, 0x9e];

/// `ZeroAmount` from `vault-core/src/errors.rs`'s coded-error table (13a Tier 1 collapse): the 16
/// payload-less errors, including `ZeroAmount`, now share one selector (`VaultError(uint8)`) and
/// are told apart by the `uint8` code in the payload, not by selector.
const ZERO_AMOUNT_CODE: u8 = 5;

/// 2 USDC (6 decimals). Real faucet USDC is scarce (13a D-21) and this file seeds a fresh position
/// per test (each throttle test fully exits, or reverts without exiting) — deliberately smaller
/// than `sepolia_core_flow.rs`'s 10 USDC.
const SEED: u64 = 2_000_000;

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
        usdc: usdc_addr()?,
        adapters: adapter_addrs()?,
        vaults: mock_vault_addrs()?,
    }))
}

impl<P: Provider + Clone> Rig<P> {
    fn usdc(&self) -> IUsdc::IUsdcInstance<P> {
        IUsdc::new(self.usdc, self.provider.clone())
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

    /// Ensures the caller has a position on every adapter: writes a 25/25/25/25 allocation if the
    /// caller has never bootstrapped one (per-user model, D-01: there is no implicit fallback
    /// weight), then deposits `SEED`. Real USDC has no `mint` (13a D-21) — returns `false` and
    /// prints an explicit skip message when the caller's faucet balance can't cover `SEED`, rather
    /// than failing the test on a setup problem.
    async fn ensure_seeded(&self) -> anyhow::Result<bool> {
        let seed = U256::from(SEED);
        let usdc = self.usdc();

        let balance = usdc.balanceOf(self.caller).call().await?;
        if balance < seed {
            eprintln!(
                "caller holds {balance} units of real Sepolia USDC, need {seed}; skipping \
                 (fund via https://faucet.circle.com)"
            );
            return Ok(false);
        }

        if self
            .core()
            .weightBpsOf(self.caller, self.adapters[0])
            .call()
            .await?
            .is_zero()
        {
            self.core()
                .rebalance(self.adapters.clone(), vec![U256::from(2500); 4])
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
        self.core()
            .deposit(seed)
            .gas(CORE_TX_GAS_LIMIT)
            .send()
            .await?
            .get_receipt()
            .await?;
        Ok(true)
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

/// Accepts either revert shape KI-02 documents for a throttled leg (`WithdrawExceedsMax` from the
/// adapter's own guard, or `RedeemShortfall` from the core's reconciliation) and rejects anything
/// else. Never accepts "reverted for some other reason" (T-13-34): a revert from an unrelated
/// cause (out of gas, unregistered adapter) must still fail the test.
fn assert_reverts_as_throttled<T>(result: Result<T, alloy::contract::Error>, context: &str) {
    let err = match result {
        Ok(_) => panic!(
            "{context}: expected a WithdrawExceedsMax or RedeemShortfall revert, but the call \
             succeeded"
        ),
        Err(e) => e,
    };
    let Some(data) = err.as_revert_data() else {
        panic!(
            "{context}: expected WithdrawExceedsMax or RedeemShortfall but the RPC error carries \
             no structured revert data: {err}"
        );
    };
    assert!(
        data.starts_with(&WITHDRAW_EXCEEDS_MAX_SELECTOR) || data.starts_with(&REDEEM_SHORTFALL_SELECTOR),
        "{context}: expected WithdrawExceedsMax (0x{}) or RedeemShortfall (0x{}), got revert data \
         0x{}",
        alloy::hex::encode(WITHDRAW_EXCEEDS_MAX_SELECTOR),
        alloy::hex::encode(REDEEM_SHORTFALL_SELECTOR),
        alloy::hex::encode(&data)
    );
}

/// A vault-level throttle is visible to the adapter: `maxWithdraw()` tracks the cap, not just the
/// position. This is the read the core relies on when sizing a redeem leg.
#[tokio::test]
async fn withdraw_cap_propagates_to_adapter_max_withdraw() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    if !rig.ensure_seeded().await? {
        return Ok(());
    }

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

/// CR-01 / KI-04's regression gate, re-pointed at the per-user `redeem(uint256 bps)`. A fully
/// throttled adapter (`maxWithdraw() == 0`) must revert the ENTIRE redeem and leave the caller's
/// `sharesOf` on every adapter byte-identical to before the attempt — proving the reverted call
/// burned nothing. Clearing the cap and re-running the SAME redeem must then succeed and zero the
/// caller's position, which is only possible if the failed attempt mutated no state. This is the
/// only place `unwind_position`'s `owed_total += owed` placement (outside the `if let`) gets
/// verified end-to-end; see `docs/known-issues.md` KI-02/KI-04.
#[tokio::test]
async fn throttled_adapter_reverts_whole_redeem_and_burns_nothing() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    if !rig.ensure_seeded().await? {
        return Ok(());
    }

    let mut shares_before = Vec::with_capacity(rig.adapters.len());
    for adapter in &rig.adapters {
        shares_before.push(rig.core().sharesOf(rig.caller, *adapter).call().await?);
    }
    assert!(
        !shares_before[0].is_zero(),
        "caller holds no shares on adapter 0 to throttle"
    );

    // Freeze one leg completely: unwind_request returns None, the external withdraw is skipped.
    rig.set_cap(0, U256::ZERO).await?;

    // Simulated, not sent: a revert is the expected outcome, and `eth_call` proves it without
    // paying for a failed transaction.
    let attempt = rig.core().redeem(U256::from(10_000)).call().await;
    assert_reverts_as_throttled(attempt, "redeem with a fully throttled adapter");

    // The invariant KI-04 exists to check: the reverted attempt burned nothing anywhere, not just
    // on the throttled adapter.
    for (i, adapter) in rig.adapters.iter().enumerate() {
        let shares_after = rig.core().sharesOf(rig.caller, *adapter).call().await?;
        assert_eq!(
            shares_after, shares_before[i],
            "sharesOf(caller, {adapter}) changed after a redeem that should have reverted whole"
        );
    }

    // Clear the throttle; the very same redeem must now go through, which is only possible if the
    // failed attempt burned nothing.
    rig.set_cap(0, U256::MAX).await?;
    let receipt = rig
        .core()
        .redeem(U256::from(10_000))
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

    for adapter in &rig.adapters {
        let remaining = rig.core().sharesOf(rig.caller, *adapter).call().await?;
        assert!(
            remaining.is_zero(),
            "sharesOf(caller, {adapter}) not zero after a full (10000 bps) exit"
        );
    }

    Ok(())
}

/// D-07.1: a PARTIALLY throttled adapter (`0 < maxWithdraw() < owed`) must revert with a
/// shortfall, never pay the caller less than owed. The core never partial-fills a redeem.
#[tokio::test]
async fn partial_throttle_reverts_with_shortfall_instead_of_paying_less() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    if !rig.ensure_seeded().await? {
        return Ok(());
    }

    let uncapped = rig.adapter(0).maxWithdraw().call().await?;
    assert!(!uncapped.is_zero(), "adapter 0 holds no position to throttle");

    let mut shares_before = Vec::with_capacity(rig.adapters.len());
    for adapter in &rig.adapters {
        shares_before.push(rig.core().sharesOf(rig.caller, *adapter).call().await?);
    }

    // A cap strictly between 0 and the full position: the leg withdraws the cap but reconciles
    // against the full owed amount, so the delta falls short.
    let cap = uncapped / U256::from(2);
    assert!(!cap.is_zero(), "computed a zero partial cap, need 0 < cap < owed");
    rig.set_cap(0, cap).await?;

    let balance_before = rig.usdc().balanceOf(rig.caller).call().await?;
    let attempt = rig.core().redeem(U256::from(10_000)).call().await;
    assert_reverts_as_throttled(attempt, "redeem with a partially throttled adapter");

    // The point of this scenario: the core never pays partial. A `.call()` simulation never sends
    // a tx either way, so this also guards against a future rewrite accidentally switching the
    // attempt to `.send()` without noticing the balance assertion below would then be load-bearing.
    let balance_after = rig.usdc().balanceOf(rig.caller).call().await?;
    assert_eq!(
        balance_after, balance_before,
        "caller's USDC balance changed on a redeem that should have reverted without paying out"
    );

    for (i, adapter) in rig.adapters.iter().enumerate() {
        let shares_after = rig.core().sharesOf(rig.caller, *adapter).call().await?;
        assert_eq!(
            shares_after, shares_before[i],
            "sharesOf(caller, {adapter}) changed after a redeem that should have reverted whole"
        );
    }

    rig.set_cap(0, U256::MAX).await?;
    Ok(())
}

/// D-07.2, the CR-01 gate from the other angle, on a DIFFERENT adapter than the KI-04 test above
/// so this test carries no dependency on that test's state. A fully throttled leg is SKIPPED
/// (`unwind_request` returns None, since calling `withdraw(0)` would itself revert `ZeroAmount` on
/// a merely-illiquid protocol) yet the tx still reverts, because `owed_total += owed` runs BEFORE
/// the skip — this is exactly the CR-01 shape.
#[tokio::test]
async fn full_throttle_skips_the_leg_but_still_reverts() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };
    if !rig.ensure_seeded().await? {
        return Ok(());
    }

    let mut shares_before = Vec::with_capacity(rig.adapters.len());
    for adapter in &rig.adapters {
        shares_before.push(rig.core().sharesOf(rig.caller, *adapter).call().await?);
    }
    assert!(
        !shares_before[1].is_zero(),
        "caller holds no shares on adapter 1 to throttle"
    );

    rig.set_cap(1, U256::ZERO).await?;
    let max_withdraw = rig.adapter(1).maxWithdraw().call().await?;
    assert!(
        max_withdraw.is_zero(),
        "adapter 1's maxWithdraw did not follow the vault cap down to zero, got {max_withdraw}"
    );

    let attempt = rig.core().redeem(U256::from(10_000)).call().await;
    assert_reverts_as_throttled(attempt, "redeem with a fully throttled second adapter");

    for (i, adapter) in rig.adapters.iter().enumerate() {
        let shares_after = rig.core().sharesOf(rig.caller, *adapter).call().await?;
        assert_eq!(
            shares_after, shares_before[i],
            "sharesOf(caller, {adapter}) changed after a redeem that should have reverted whole"
        );
    }

    rig.set_cap(1, U256::MAX).await?;
    Ok(())
}

/// Cheapest possible guard check, and the one a fuzzer would find first.
#[tokio::test]
async fn zero_amount_deposit_reverts() -> anyhow::Result<()> {
    let Some(rig) = connect().await? else {
        return Ok(());
    };

    let attempt = rig.core().deposit(U256::ZERO).call().await;
    assert_reverts_with_vault_error(attempt, ZERO_AMOUNT_CODE, "core.deposit(0)");

    Ok(())
}
