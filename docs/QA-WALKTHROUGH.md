# QA Walkthrough — Vault Aggregator E2E on Arbitrum Sepolia (VQA-01)

Manual script to verify the full vault flow end to end on the live Arbitrum Sepolia rig:
**deposit → allocation → live yield → rebalance → two-step withdrawal**. This is the phase's
"done" gate. Deposit / allocation / rebalance / withdraw were already proven live in Phase 14.1
(`.planning/phases/14.1-lemon-permit2-write-path/14.1-RIG-VERIFICATION.md`); this phase adds the
**live-yield** step — the VFE-02 counter visibly ticking off a real on-chain donation.

Everything here runs on **Arbitrum Sepolia** with the **testnet** deployer key. The mainnet M2 key
is never used. Zero real funds at risk.

## Prerequisites

Environment (the rig addresses live in `docs/.sepolia-env`; the RPC URL and signing keys are
operator-supplied and are **not** committed):

```bash
cd vault-aggregator
source docs/.sepolia-env          # rig addresses (USDC, core, periphery, adapters, mock vaults)
export ARB_SEPOLIA_RPC_URL=...    # your Arbitrum Sepolia RPC endpoint
export SEPOLIA_WALLET_KEY=...     # testnet deployer 0xD245…0E3e (funds deposits + donations)
# export SEPOLIA_WALLET_KEY_2=... # optional user B, only for the two-user contract e2e
```

Rig (from `docs/TESTNET.md`, Phase 14.1 redeploy — the generation `simulate-yield.sh` targets):

| Contract | Address |
|----------|---------|
| USDC (real, Circle faucet) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| vault-core (`--features testnet`) | `0xdf558fb62b5ca7139aa53d65f0d8dc3805117754` |
| vault-periphery | `0x8d0b46b7466e45803d96f0bba838f9c39d511367` |
| MockVault — Morpho / Fluid / Euler / Aave | `0x0913…fbab` / `0x65ab…3464` / `0x2d36…ca98` / `0x2325…0230` |

Fund the testnet wallet with Sepolia USDC via <https://faucet.circle.com> before starting.

## Part A — Automated suites (must be green first)

1. **Web suite** (pure client logic incl. the live-yield hook + counter):
   ```bash
   cd vault-aggregator/apps/web && npm run test
   ```
   Expected: all files pass (currently **179/179**). This includes `useVaultYield`, the yield
   snapshot math, and the home-page wiring of the counter.

2. **Live contract e2e** against the rig (needs `ARB_SEPOLIA_RPC_URL` + `SEPOLIA_WALLET_KEY`):
   ```bash
   cd vault-aggregator/packages/contracts
   source ../../docs/.sepolia-env
   cargo test -p adapter-e2e --test sepolia_core_flow -- --test-threads=1
   cargo test -p adapter-e2e --test sepolia_periphery  -- --test-threads=1
   ```
   Expected: `core_deposit_rebalance_redeem_flow`, `dust_accrual_over_n_cycles`,
   `deposit_without_weights_reverts_no_weights_set`, `two_users_exact_payout_with_different_weights`
   pass against the live rig. **Note:** these tests self-skip (print `... not set, skipping` and
   return `ok`) when `ARB_SEPOLIA_RPC_URL` / `SEPOLIA_WALLET_KEY` are unset — a `0.00s` "ok" with a
   skip line is **not** a live pass. Confirm real tx activity in the output, not a skip.
   **Do NOT** run the `*_roundtrip.rs` tests — those hit Arbitrum One and mainnet deploy is deferred.

## Part B — Manual browser/EVM walkthrough

Start the app: `cd vault-aggregator/apps/web && npm run dev`, open it, connect the testnet wallet,
and make sure you're on Arbitrum Sepolia (the app's network guard will prompt otherwise).

1. **Deposit + allocation.** Go to Depositar, enter a small USDC amount (e.g. 5 USDC), set an
   allocation across the four protocols, and submit. Approve the USDC allowance if prompted.
   - Expected: tx confirms; the home page shows "Tu posición" with the total, and "Por protocolo"
     lists the four protocols credited per your weights. (Deposit/allocation live-proof precedent:
     14.1-RIG-VERIFICATION.md.)

2. **Live yield — the new VFE-02 step.** In a second terminal:
   ```bash
   cd vault-aggregator
   source docs/.sepolia-env
   export ARB_SEPOLIA_RPC_URL=...  SEPOLIA_WALLET_KEY=...
   AMOUNT=250000 INTERVAL=90 ROUNDS=8 ./scripts/simulate-yield.sh
   ```
   This donates 0.25 USDC to each MockVault every 90s for 8 rounds, moving `total_assets()`.
   - Expected: within **~1–2 rounds** (the hook samples every `MIN_SAMPLE_INTERVAL_S = 60s`; the
     `INTERVAL=90` keeps each round a fresh sample) the **total-position counter** and the **donated
     protocol rows** tick **upward**, green, at 6-decimal precision, with no layout shift as digits
     grow.
   - **Landmine-1 warning sign:** if the counter stays **flat for 10+ minutes**, the donation isn't
     landing on-chain — that's a rig/script problem, **not** a counter bug. Check the `cast send`
     output of `simulate-yield.sh` (tx hashes, revert reasons) before suspecting the UI.

3. **Rebalance.** Go to Rebalancear, change the sliders, and submit.
   - Expected: tx confirms and on-chain weights update. Critically, right after settlement the
     counter must **not** show a false upward spike from the share-jump — the baseline resets
     (Pitfall 2). A brief flat/`--text-secondary` moment, then it resumes ticking off real donations.

4. **Two-step withdrawal (browser/EVM path).** Go to Retirar and run both steps to completion
   (step 1 measures and persists the pending amount → the persistent pending-settlement banner; step
   2 settles).
   - Expected: withdrawal completes on-chain; the pending banner clears; balances reflect the exit.

5. **Lemon in-app deposit (conditional).**
   - If `NEXT_PUBLIC_LEMON_MINI_APP_ID` is set in the `apps/web` env, run the **real in-Lemon
     deposit** (WebView `depositWithPermit` path) and confirm it settles like the browser path.
   - If it is **not** set, this step is **carried-forward, non-blocking** — same precedent as Phase
     14.1. Note it here and move on; it does not gate VQA-01.

## Pass criteria

The full deposit → allocation → live yield → rebalance → two-step withdrawal flow completes on
Arbitrum Sepolia, the automated web + contract suites are green (real live pass, not skipped), and
the counter is **observed ticking off a real `simulate-yield.sh` donation** with no false
post-rebalance spike. Mainnet deploy remains deferred (CONTEXT.md).
