# Testnet mock rig (Arbitrum Sepolia)

A disposable rig that runs the **real** `vault-core` and **real** `vault-adapter` against four
**mock** ERC-4626 vaults and a mock USDC, so the core's plumbing can be exercised on-chain with
controllable state and zero real money.

Deployed by [`scripts/deploy-testnet-mocks.sh`](../scripts/deploy-testnet-mocks.sh); addresses land
in `docs/.sepolia-env`. The mainnet rig ([RUNBOOK-M2.md](./RUNBOOK-M2.md)) is untouched by any of
this.

## Why it exists

Phase 8 closed the fork-tooling question with verdict **NEITHER** (no nitro-testnode fork, and
`TestVMBuilder::rpc_url()` never forks external calls), so live transactions are the only way to
run a Stylus contract against contracts that really answer. Two things follow:

- **Adapters** were validated with real small-USDC round-trips against the real protocols on
  Arbitrum One (Phases 9-10, 5/5 green — see [RUNBOOK-M2.md](./RUNBOOK-M2.md)). That is the only
  evidence that counts for protocol-quirk behaviour.
- **The core** (Phases 11-12: split deposit, rebalance, redeem reconciliation) had never run
  on-chain at all — only under TestVM, where every adapter is a mock and the shared return-data
  buffer limits what a test can even assert. This rig closes that gap.

## What it proves — and what it does not

**Proves:** the core's real on-chain behaviour — four-way split deposit, rebalance unwind and
re-split, redeem's live-position split and balance-delta reconciliation, whole-tx atomicity when a
leg fails, and the virtual-offset share math under a real donation. Plus edge states Arbitrum One
cannot be forced into: `setWithdrawCap` produces a Fluid-style throttle on demand.

**Does not prove:** anything about the real protocols. The mocks are textbook-conformant ERC-4626
by construction — no Fluid throttle, no Aave Stata wrapping/rebasing, no Morpho market-queue walk.
A green Sepolia run says nothing about whether an adapter handles the real thing. **These tests
never substitute for the Arbitrum One round-trips.**

## ⚠️ Status: superseded by Phase 12.1

The rig below is **deployed and green** (5/5 e2e on Arbitrum Sepolia, 2026-07-23). But Phase 12.1
replaces the core's accounting model — global pooled allocation becomes per-user weights plus a
per-user-per-adapter share ledger — so:

- **The two e2e test files assert the OLD model and must be rewritten in 12.1.**
  `sepolia_core_flow` drives an owner-only `rebalance(adapters, weights)` over a global 25/25/25/25
  split; `sepolia_edge_cases`'s redeem test depends on `split_by_position` over the shared pool.
  Both concepts disappear. Their *green run recorded here* is evidence about the pooled model, not
  about whatever 12.1 ships.
- **`vault-core` and all four adapters must be redeployed** for 12.1. The core changes bytecode;
  the adapters' `init(vault, core)` is one-shot with no setter (D-01), so they cannot be re-pointed
  at a new core.
- **MockUsdc and the four MockVaults survive untouched** — they are model-agnostic, and so are the
  `testnet` feature, `scripts/deploy-testnet-mocks.sh` and the `sepolia` module's helpers. Re-running
  the deploy script with only `MOCK_USDC_ADDR` + the four `MOCK_*_VAULT` lines kept in
  `docs/.sepolia-env` redeploys just the core and adapters.

Everything below describes the rig as built. Treat the addresses as current and the test
descriptions as pending a 12.1 rewrite.

## Deployed rig (Arbitrum Sepolia, 2026-07-23)

Deployer/owner: `0xD245710638f66A16386df955D45e65d13B0C0E3e` (the M1 Sepolia wallet).

| Role | Address |
|---|---|
| MockUsdc | `0xe26bd9f1f02e468093e1287f418bb79749a6ac92` |
| vault-core (`--features testnet`) | `0x27a7beb767996da72b8e93088fd7affe30a7dadf` |
| MockVault — Morpho slot | `0x4271b6b81fa0c12908d2240438eca2c95dfeba21` |
| MockVault — Fluid slot | `0xc7b2d9dedcc02c61fbe74fd09e0b7a9bf00ef1c7` |
| MockVault — Euler slot | `0x5aa5420a2b9ea8689cb6d8f02406590d128979f5` |
| MockVault — Aave slot | `0xe677d5020fe7e5bededb7512a6a4a09831dcd4e2` |
| Adapter — Morpho slot | `0x3ae8c718f261cfbe8dfc2e6a678117d7a3fec9bd` |
| Adapter — Fluid slot | `0x9022f19e7987465f7d2b015bf9587c2600d54989` |
| Adapter — Euler slot | `0x9e56af544590f1b5b67d53ce23e3079089ab336c` |
| Adapter — Aave slot | `0x56e17eca6e0f21a8aa19b7a4ddc4eea111291cdc` |

Total deploy + full test-suite cost: **~0.0016 Sepolia ETH**.

### First on-chain run (2026-07-23) — 5/5 green

This is the first time `vault-core` executed anywhere outside TestVM.

- `core_deposit_rebalance_redeem_flow` — $100 deposited and split four ways, rebalanced to
  40/30/20/10, fully redeemed for **exactly 100,000,000 units back, zero rounding loss**.
- `withdraw_cap_propagates_to_adapter_max_withdraw` — vault throttle visible through the adapter.
- `throttled_adapter_reverts_whole_redeem_and_burns_nothing` — **D-06/D-10 whole-tx atomicity proven
  on-chain**: one fully throttled leg reverts the entire redeem, and the identical redeem succeeds
  once the throttle clears, so the failed attempt burned nothing.
- `donation_inflates_pool_without_breaking_deposits` — the virtual-offset defence holds against a
  real on-chain donation.
- `zero_amount_deposit_reverts` — `ZeroAmount` guard.

One transient `error: tx failed to complete` hit the first deploy run mid-way. An unchanged re-run
completed cleanly, which is exactly what the env-file resume exists for — no contract was
redeployed and nothing was lost.

## Mainnet ↔ testnet mapping

Native USDC on Arbitrum One is `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; on Sepolia its
stand-in is the deployed `MockUsdc` (`MOCK_USDC_ADDR` in `docs/.sepolia-env`).

| Protocol | Arbitrum One vault | Arbitrum One adapter | Sepolia stand-ins |
|---|---|---|---|
| Morpho `gtUSDCc` | `0x7e97fa6893871A2751B5fE961978DCCb2c201E65` | `0xdb4010382d4b07d77c2d78dc3f0b4c83a1f9c7a3` | `MOCK_MORPHO_VAULT` / `TESTNET_MORPHO_ADAPTER_ADDR` |
| Fluid `fUSDC` | `0x1A996cb54bb95462040408C06122D45D6Cdb6096` | `0xbd5d02430e8d8532e486e91a7a52cf0cf770494a` | `MOCK_FLUID_VAULT` / `TESTNET_FLUID_ADAPTER_ADDR` |
| Euler v2 `eUSDC-2` | `0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b` | `0x1e69c0453ce9485487a12cb25542ccebcf98cf39` | `MOCK_EULER_VAULT` / `TESTNET_EULER_ADAPTER_ADDR` |
| Aave v3 `stataArbUSDCn` | `0x7cfadfd5645b50be87d546f42699d863648251ad` | `0x3b1c548a7e15525b98cdcf34a4b0c769718610d3` | `MOCK_AAVE_VAULT` / `TESTNET_AAVE_ADAPTER_ADDR` |

The mainnet adapters were driven by an EOA standing in for the core (D-04); there is **no**
`vault-core` on Arbitrum One. The Sepolia rig is the first deployment of the core anywhere.

Wallets: mainnet uses the dedicated M2 wallet `0x13B5…B992` (`~/.wakeup-m2-arb1.key`, real funds).
Sepolia reuses the M1 deployer `0xD245710638f66A16386df955D45e65d13B0C0E3e`
(`~/.wakeup-sepolia.key`) — the D-07 no-reuse rule is scoped to mainnet.

## Contracts

- **`mock-usdc`** — 6-decimal ERC-20, `mint` deliberately unauthenticated so tests can size
  positions freely.
- **`mock-vault`** — ERC-4626 implementing exactly the surface the adapter calls
  (`deposit`/`withdraw`/`redeem`/`convertToAssets`/`convertToShares`/`maxWithdraw`/`maxRedeem`/
  `asset`/`totalAssets`/`balanceOf`). `totalAssets` reads the vault's real asset balance, so a
  donation inflates the share price exactly like production. Adds one knob:
  `setWithdrawCap(uint256)` (owner-only) bounding `maxWithdraw`, the Fluid-throttle simulator.
  Withdraw/redeem require caller == owner: the adapter only ever moves its own position, so the
  ERC-4626 allowance flow is intentionally absent.

## The `testnet` feature

`vault-adapter` and `vault-core` both carry USDC as a **compile-time constant**, so pointing them
at MockUsdc is a build variant, not an env var:

```rust
#[cfg(not(feature = "testnet"))]
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");
#[cfg(feature = "testnet")]
const USDC: Address = address!("…MockUsdc…");
```

**A `--features testnet` artifact must never be deployed to mainnet.** The deploy script greps
both constants against the deployed MockUsdc and refuses to build if they diverge.

The feature is default-off, so the mainnet build is unaffected. Measured under the real deploy
lever (`-Z build-std=std,panic_abort -Z build-std-features=panic_immediate_abort`, the flags
cargo-stylus injects):

| Crate | Result |
|---|---|
| `vault-adapter` | byte-identical to before the cfg split |
| `vault-core` | same uncompressed size (78,900 bytes), exactly 2 bytes differ |

Those two bytes are embedded panic **line numbers**, each shifted by exactly +8 — the number of
lines the cfg block adds above the rest of the file (217→225, 222→230). No code, size, or
behaviour change; reproduce with `cmp -l` on the two artifacts. Compressed, that costs 19 bytes
(brotli packs the changed bytes slightly differently): `cargo stylus check` reports 21,142 for the
pre-branch source and 21,161 now, both far under the 22,528-byte Arbitrum One gate.

Nothing on mainnet depends on the core's bytes today: there is no `vault-core` deployed anywhere
but this Sepolia rig.

### Sizes (`cargo stylus check`, compressed)

| Contract | Size | Headroom vs 22,528 gate |
|---|---|---|
| `mock-usdc` | 7,657 | 66% |
| `mock-vault` | 13,504 | 40% |
| `vault-adapter --features testnet` | 9,144 | 59% |
| `vault-core --features testnet` | 21,133 | 6.2% |
| `vault-core` (default/mainnet) | 21,161 | 6.1% |

This is why deploying is a two-step bootstrap: MockUsdc must exist before the constant can name it.

## Deploy

```bash
export ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
./scripts/deploy-testnet-mocks.sh
```

First run deploys MockUsdc and stops, telling you to paste its address into the two `testnet`
constants. Do that, re-run, and it continues: four MockVaults, the core, four adapters, wiring,
`addAdapter` ×4, a 25/25/25/25 bootstrap allocation, and a 1,000 mUSDC mint. Every step records to
`docs/.sepolia-env` and is skipped on re-run, so a failure mid-way resumes instead of redeploying.

## Run the tests

```bash
source docs/.sepolia-env
ARB_SEPOLIA_RPC_URL=$ARB_SEPOLIA_RPC_URL SEPOLIA_WALLET_KEY=$(cat ~/.wakeup-sepolia.key) \
  cargo test -p adapter-e2e --test sepolia_core_flow --test sepolia_edge_cases \
  -- --test-threads=1 --nocapture
```

`--test-threads=1` is required: the tests mutate shared on-chain state (allocations, withdraw
caps). With `ARB_SEPOLIA_RPC_URL` unset every test skips cleanly, which is what keeps
`cargo test --workspace` green and free.

- **`sepolia_core_flow`** — sets a 25/25/25/25 allocation, deposits, asserts the four-way split,
  rebalances to 40/30/20/10, asserts the re-split proportions, redeems, asserts the payout, and
  restores the canonical allocation. Self-contained and re-runnable.
- **`sepolia_edge_cases`** — cap propagation to `maxWithdraw`; a fully throttled leg reverting the
  whole redeem while burning no shares; a donation inflating the pool without zeroing subsequent
  deposits; `deposit(0)` reverting `ZeroAmount`. Caps are always restored.
