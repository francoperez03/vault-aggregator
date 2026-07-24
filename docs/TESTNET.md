# Testnet mock rig (Arbitrum Sepolia)

A disposable rig that runs the **real** `vault-core`, **real** `vault-adapter` and **real**
`vault-periphery` against four **mock** ERC-4626 vaults and the **real** Arbitrum Sepolia USDC, so
the core's plumbing (including the Permit2 intake path) can be exercised on-chain with
controllable adapter state.

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

## Deployed rig (Arbitrum Sepolia, 2026-07-24, post-C-H1 redeploy)

Fully redeployed (core, periphery, all 4 adapters, all 4 MockVaults — every contract, not just
the core) as the C-H1 gap-closure fix: the blind adversarial review found `VaultCore::init(owner)`
had no access control (front-runnable, permanent ownership takeover, no recovery path — see
`docs/known-issues.md`'s C-H1 entry and `docs/security/adversarial-review/cross-reference.md`).
`init` is replaced by a real Stylus `#[constructor]` that sets `owner` atomically at deploy time.
A new core invalidates the whole rig (each adapter's `init(vault, core)` is one-shot, and the
periphery's `core` address is fixed at its own constructor), so every contract below is fresh —
the MockVaults too, since an old rig's orphaned adapters would otherwise still hold real shares in
a reused MockVault and silently break the "sole shareholder" invariant several edge-case tests
assume (found the hard way: reusing the old MockVaults on the first redeploy attempt broke 3 of 9
`sepolia_edge_cases` tests with stale-balance assertions; redeploying the MockVaults too fixed all
3). Deployer/owner: `0xD245710638f66A16386df955D45e65d13B0C0E3e` (the M1 Sepolia wallet, key
`~/.wakeup-sepolia.key`).

| Role | Address |
|---|---|
| USDC (real, Circle-issued, faucet-fundable) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Permit2 (canonical, identical on One and Sepolia) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| vault-core (`--features testnet`, `#[constructor]`) | `0x813f2112107c87a4583d9f1ce22d63c3274e2209` |
| vault-periphery | `0xc01feceacc7ba14e6d7a45c66ab40f3774afa49d` |
| MockVault — Morpho slot | `0x3e2353aeb1e566f5f0b46533be6e611733e8865c` |
| MockVault — Fluid slot | `0x6629e5085f006d1c36906d42c9ddcff7be33cfec` |
| MockVault — Euler slot | `0xf5e6fd6eea6880577d50c8b8836cd7fc77a8be2e` |
| MockVault — Aave slot | `0xbab043c0e33bff2057552d1b5b308b4de9d8595e` |
| Adapter — Morpho slot | `0x7d8edb9916cd58c7ce37a390a25a7fa31701f529` |
| Adapter — Fluid slot | `0x9fd3010469d2537aec876555f9cc9465c6fff7a6` |
| Adapter — Euler slot | `0xca124be152be53cc825e65a604c8de8f4b330a6b` |
| Adapter — Aave slot | `0xf1cf7ee1ab7732281c420f01264a9fba1f384941` |

`owner` is now set by the `vault-core` deploy transaction's own `#[constructor]` (no separate
`init` call); `vault-periphery`'s deploy transaction similarly bakes in `(core, permit2, usdc)` as
constructor args. All ten new contracts, plus `addAdapter` ×4 and the bootstrap 25/25/25/25
`rebalance`, deployed cleanly. Total redeploy cost across the two attempts (first with reused
MockVaults, retried fully fresh once the stale-balance issue was found): ~0.003 Sepolia ETH.

### ABI as deployed

Verified on-chain immediately after the redeploy:

- `cast call $TESTNET_CORE_ADDR "init(address)" 0x1111111111111111111111111111111111111111` →
  **reverts** (`0x` data, no such selector) — the C-H1 fix's whole point: there is no live,
  callable, unauthenticated bootstrap entrypoint left on this ABI.
- `cast call $TESTNET_CORE_ADDR "weightBpsOf(address,address)(uint256)" $DEPLOYER $TESTNET_MORPHO_ADAPTER_ADDR`
  → `2500` (the bootstrap 25% weight).
- `cast call $TESTNET_PERIPHERY_ADDR "core()(address)"` → `$TESTNET_CORE_ADDR`.
- `cast call $TESTNET_CORE_ADDR "removeAdapter(address)" <adapter>` → **reverts** (`0x` data, no
  such selector). `removeAdapter`, `weightsOf` and now `init(address)` are gone from this ABI; use
  `setEnabled`, `weightBpsOf`, and the deploy-time `#[constructor]` instead.

The core exposes, and this redeploy verified: `deposit(uint256)`, `depositFor(address,uint256)`,
`redeem(uint256 bps)`, `rebalance(address[],uint256[])`, `sharesOf(address,address)`,
`weightBpsOf(address,address)`, `adapterTotalShares(address)`, `addAdapter(address)`,
`setEnabled(address,bool)`. `init(address)` is gone — ownership is set exclusively by the
`#[constructor]` baked into the deploy transaction.

**Full live e2e re-run against this rig (2026-07-24): 16/16 tests green** —
`sepolia_core_flow` (4/4), `sepolia_edge_cases` (9/9, including 4 that self-skipped on a first pass
for insufficient deployer USDC and then genuinely passed once wallet A was topped up from wallet
B's balance), `sepolia_periphery` (3/3). `--test-threads=1`, zero net USDC lost across the run
(final balances: wallet A ~18.9 USDC, wallet B ~14.8 USDC, both healthy).

## Retired rigs (superseded 2026-07-24)

Two prior rigs are retired by this redeploy. Both cannot be re-pointed at the new core: each
adapter's `init(vault, core)` is one-shot with no setter (F9 D-01).

**Rig 2 (13a/13b, superseded by the C-H1 fix):** the frozen 13a ABI rig, live-verified 16/16 green
against the pooled 13a/13b test suite before this gap closure. Retired ONLY because its core still
carries the unprotected `init(address)` C-H1 vulnerability — the ABI shape and test coverage are
otherwise identical to the rig above.

| Role | Address |
|---|---|
| vault-core (`--features testnet`) | `0x159b8f77ec3cc5a9a0fc5df25e9ae2f1b184d2ad` |
| vault-periphery | `0x31ecfa1cc28d479a3123f1290625d0046c198c76` |
| MockVault — Morpho slot | `0x3a6a3ca3b1571bfb6835c6b4df1cfffd64a5c58f` |
| MockVault — Fluid slot | `0x5279d9b41a548874951b369e8aa3cea0c6bf486e` |
| MockVault — Euler slot | `0xe9b9b2709262745454993b4ecf219d7870391211` |
| MockVault — Aave slot | `0xacb179937adb75bb0c821900e24b059715619d11` |
| Adapter — Morpho slot | `0xc2a6616ae58b3be6793d31c84b6134dc57bfa9a4` |
| Adapter — Fluid slot | `0x1a659df84d6ef1549178d63eafb9b7e5221d901b` |
| Adapter — Euler slot | `0x104066f5376c43cb4b67ffa67b580b6b4a9bada1` |
| Adapter — Aave slot | `0x9a871c7713f28c0a3b8218e8548ff449a3c5cf3b` |

**Rig 1 (Phase 12.1-era, superseded 2026-07-24):** exported the old pooled-allocation ABI
(`redeem(shares)`, `weightsOf(address)`, owner-only `rebalance`) and used MockUsdc as its asset;
MockUsdc has no role in either later rig at all.

| Role | Address |
|---|---|
| MockUsdc (retired, no longer referenced anywhere) | `0xe26bd9f1f02e468093e1287f418bb79749a6ac92` |
| vault-core (`--features testnet`) | `0x27a7beb767996da72b8e93088fd7affe30a7dadf` |
| MockVault — Morpho slot | `0x4271b6b81fa0c12908d2240438eca2c95dfeba21` |
| MockVault — Fluid slot | `0xc7b2d9dedcc02c61fbe74fd09e0b7a9bf00ef1c7` |
| MockVault — Euler slot | `0x5aa5420a2b9ea8689cb6d8f02406590d128979f5` |
| MockVault — Aave slot | `0xe677d5020fe7e5bededb7512a6a4a09831dcd4e2` |
| Adapter — Morpho slot | `0x3ae8c718f261cfbe8dfc2e6a678117d7a3fec9bd` |
| Adapter — Fluid slot | `0x9022f19e7987465f7d2b015bf9587c2600d54989` |
| Adapter — Euler slot | `0x9e56af544590f1b5b67d53ce23e3079089ab336c` |
| Adapter — Aave slot | `0x56e17eca6e0f21a8aa19b7a4ddc4eea111291cdc` |

Its 5/5 green e2e run (2026-07-23) predates the per-user rewrite and the `redeem(uint256 bps)` ABI
entirely, and does not stand in for either later rig's evidence.

## Mainnet ↔ testnet mapping

Native USDC on Arbitrum One is `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`; on Sepolia the rig uses
the real Circle-issued USDC at `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d`
(`SEPOLIA_USDC_ADDR` in `docs/.sepolia-env`) — not a mock.

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

- **`vault-periphery`** — Permit2 intake front-door. Immutable constructor `(core, permit2, usdc)`;
  `depositWithPermit2` pulls USDC via a Permit2 `SignatureTransfer` then calls `core.depositFor`,
  crediting the signer, not the periphery (D-19: the core pulls the exact amount it measures via
  `transferFrom`, so a compromised periphery cannot mint unbacked shares). No privileged role on the
  core — `depositFor` stays permissionless.
- **`mock-vault`** — ERC-4626 implementing exactly the surface the adapter calls
  (`deposit`/`withdraw`/`redeem`/`convertToAssets`/`convertToShares`/`maxWithdraw`/`maxRedeem`/
  `asset`/`totalAssets`/`balanceOf`). `totalAssets` reads the vault's real asset balance, so a
  donation inflates the share price exactly like production. Adds one knob:
  `setWithdrawCap(uint256)` (owner-only) bounding `maxWithdraw`, the Fluid-throttle simulator.
  Withdraw/redeem require caller == owner: the adapter only ever moves its own position, so the
  ERC-4626 allowance flow is intentionally absent.

## The `testnet` feature

`vault-adapter` and `vault-core` both carry USDC as a **compile-time constant**, so pointing them
at real Sepolia USDC is a build variant, not an env var:

```rust
#[cfg(not(feature = "testnet"))]
const USDC: Address = address!("af88d065e77c8cC2239327C5EDb3A432268e5831");
#[cfg(feature = "testnet")]
const USDC: Address = address!("75faf114eafb1BDbe2F0316DF893fd58CE46AA4d");
```

**A `--features testnet` artifact must never be deployed to mainnet** — its USDC constant points at
a Sepolia-only token, so it would be inert on Arbitrum One even if deployed there by mistake. The
deploy script greps both constants against the real Sepolia USDC address and refuses to build if
they diverge (`check_const` in `scripts/deploy-testnet-mocks.sh`).

The feature is default-off, so the mainnet build is unaffected.

### Sizes (`cargo stylus check --endpoint arb1`, compressed)

| Contract | Size | Headroom vs 22,528 gate |
|---|---|---|
| `mock-vault` | 13,932 | 38% |
| `vault-adapter --features testnet` | 9,281 | 59% |
| `vault-core --features testnet` | 20,681 | 8.2% (post-C-H1 `#[constructor]` fix, `docs/wasm-size.md`) |
| `vault-periphery` | 10,252 | 55% (independent 22,528-byte gate, see `docs/wasm-size.md`) |

## Deploy

```bash
export ARB_SEPOLIA_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
./scripts/deploy-testnet-mocks.sh
```

USDC is a known constant, so there is no bootstrap step for it: the preflight checks the deployer
holds enough real Sepolia USDC (fund via the Circle faucet, https://faucet.circle.com, if not) and
then deploys straight through — four MockVaults, `vault-core`, `vault-periphery`, four
`vault-adapter`s, wiring, `addAdapter` ×4, and a 25/25/25/25 bootstrap allocation. Every step
records to `docs/.sepolia-env` and is skipped on re-run, so a failure mid-way resumes instead of
redeploying.

## Run the tests

```bash
source docs/.sepolia-env
ARB_SEPOLIA_RPC_URL=$ARB_SEPOLIA_RPC_URL \
SEPOLIA_WALLET_KEY=$(cat ~/.wakeup-sepolia.key) \
SEPOLIA_WALLET_KEY_2=$(cat ~/.wakeup-sepolia-user-b.key) \
  cargo test -p adapter-e2e --test sepolia_core_flow --test sepolia_edge_cases --test sepolia_periphery \
  -- --test-threads=1 --nocapture
```

All three test files are rewritten against the per-user model and pass live against the current
rig above: 16/16 (`sepolia_core_flow` 4/4, `sepolia_edge_cases` 9/9, `sepolia_periphery` 3/3).
Some `sepolia_edge_cases` tests self-skip cleanly (not a failure) if a wallet's real Sepolia USDC
balance runs too low to fund that test's deposit — fund via https://faucet.circle.com or transfer
between the two test wallets if that happens.

`--test-threads=1` will be required once rewritten: the tests mutate shared on-chain state. With
`ARB_SEPOLIA_RPC_URL` unset every test skips cleanly, which is what keeps `cargo test --workspace`
green and free.
