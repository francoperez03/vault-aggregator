# Testnet mock rig (Arbitrum Sepolia)

A disposable rig that runs the **real** `vault-core` and **real** `vault-adapter` against four
**mock** ERC-4626 vaults and the **real** Arbitrum Sepolia USDC, so the core's plumbing can be
exercised on-chain with controllable adapter state.

**`vault-periphery` is back (Phase 14.1, D-A1).** It was deleted in Phase 13 on the belief that
Lemon could not perform any Permit2 signature substitution — that belief was wrong: the failure
was in a hand-rolled server-side substitution scheme, not in Permit2-inside-Lemon as a concept.
Lemon's `callSmartContract` natively signs a real Permit2 `SignatureTransfer` EIP-712 struct
client-side (inside the app, with the user's own key) via its `permits[]` field, exactly the same
mechanism CoinFlip's own `betWithPermit2` already relies on. The periphery's `depositWithPermit`
pulls USDC via that signature and forwards to the core's permissionless `depositFor`. The old
`docs/known-issues.md` `PERMIT2-REMOVED` entry is superseded — see
`.planning/phases/14.1-lemon-permit2-write-path/` for the restore.

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

## Deployed rig (Arbitrum Sepolia, 2026-07-24, Phase 14.1 Permit2-periphery redeploy)

Fully redeployed (core, `vault-periphery`, all 4 adapters, all 4 MockVaults) to restore the
Permit2 write path (D-A1): `vault-periphery` re-added with its `depositWithPermit` entrypoint, and
`vault-core::deposit_for` re-exposed on the public ABI as its consumer. A new core invalidates the
whole rig (each adapter's `init(vault, core)` is one-shot), and the MockVaults were redeployed
fresh too — a prior redeploy that reused MockVaults across rig generations left the *old* rig's
adapters still holding shares in those same vaults, which desyncs an adapter's `totalAssets()`
from its vault's raw balance. Redeploying all four MockVaults alongside the core avoids that trap.
Deployer/owner: `0xD245710638f66A16386df955D45e65d13B0C0E3e` (the M1 Sepolia wallet, key
`~/.wakeup-sepolia.key`).

| Role | Address |
|---|---|
| USDC (real, Circle-issued, faucet-fundable) | `0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d` |
| Permit2 (canonical, same on every EVM chain) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| vault-core (`--features testnet`, `#[constructor]`) | `0xdf558fb62b5ca7139aa53d65f0d8dc3805117754` |
| vault-periphery (constructor `(core, permit2, usdc)`) | `0x8d0b46b7466e45803d96f0bba838f9c39d511367` |
| MockVault — Morpho slot | `0x09135d78253449c5f0df675b6b6e18582bdcfbab` |
| MockVault — Fluid slot | `0x65ab69fa086fa134b1645f81be64f15ed5793464` |
| MockVault — Euler slot | `0x2d368ef0746c75e87ca1768284fbe7adb827ca98` |
| MockVault — Aave slot | `0x2325bbea0b93ecd9c6c3a8a9f680af5cd99a0230` |
| Adapter — Morpho slot | `0xa1c816ed5baf2f2e00ef97304669d0db021638e6` |
| Adapter — Fluid slot | `0xde30f459e69e9ad3794902eb1bb56f29c28d51a0` |
| Adapter — Euler slot | `0x337b4e1ab360eddeb8f8e25633bae5ca8ea0463c` |
| Adapter — Aave slot | `0x7fbcc12f0b088ea832bd5108682cedfe502d3d36` |

`owner` is set by the `vault-core` deploy transaction's own `#[constructor]`. All ten new
contracts (core, periphery, 4 adapters, 4 MockVaults), plus `addAdapter` ×4 and the bootstrap
25/25/25/25 `rebalance`, deployed cleanly. `TESTNET_PERIPHERY_ADDR` is back in `docs/.sepolia-env`.

### ABI as deployed

Adds `vault-periphery`'s `depositWithPermit(uint256,uint256,uint256,bytes)` and re-exposes the
core's `depositFor(address,uint256)` (both absent from the retired 13-11 rig). Everything else
unchanged: `deposit(uint256)`, `redeem(uint256 bps)`, `rebalance(address[],uint256[])`,
`sharesOf(address,address)`, `weightBpsOf(address,address)`, `adapterTotalShares(address)`,
`addAdapter(address)`, `setEnabled(address,bool)`.

**Live Permit2 deposit proof (2026-07-24):** see
`.planning/phases/14.1-lemon-permit2-write-path/14.1-RIG-VERIFICATION.md` for the `export-abi`
output and the on-chain tx hash + before/after `sharesOf`. `sepolia_periphery.rs` is restored and
green against this rig (`--test-threads=1`).

## Retired rigs (superseded 2026-07-24)

**Rig 5 (13-11 gap closure, superseded by the Phase 14.1 Permit2-periphery restore):** identical
core-only ABI, no `vault-periphery`, no `depositFor`. Retired only because D-A1 restores the
periphery and a new core (needed to re-expose `depositFor`) requires a full MockVault redeploy too
(see the desync note above).

| Role | Address |
|---|---|
| vault-core (`--features testnet`, `#[constructor]`) | `0xd38b38213ac17181c4b02c9c10422b691eab5626` |
| MockVault — Morpho slot | `0x67c1a85dc2fcce7a6efbc40cd3fc7c7b17e4ee5b` |
| MockVault — Fluid slot | `0xd9cf011fb4064512cd87d92edc6b06e4b9a0e798` |
| MockVault — Euler slot | `0x5553c14f3aab35b26a084b258975a20372bc318e` |
| MockVault — Aave slot | `0x376691c24db74625d653768fc7536b9871b3d038` |
| Adapter — Morpho slot | `0x676cbf462a0ac54554a63442964783739dab8e6a` |
| Adapter — Fluid slot | `0x035093a4d2ddf8c79c839705378ebfab6ebae3ce` |
| Adapter — Euler slot | `0x2ba4158df4dd03a4ec18691a0f649b947de6db88` |
| Adapter — Aave slot | `0x62124bd637c6fc46cb13e5903b46c25b83e08b9a` |

Its 13/13 green e2e run (2026-07-24, pre-14.1) predates the Permit2-periphery restore and does not
stand in for the new rig's evidence.

**Rig 4 (Permit2 removal, superseded by the 13-11 gap closure):** identical ABI to Rig 5 above;
retired only because C-M2/S-M1 changed `vault-core`'s internal behavior, and a new core requires a
full MockVault redeploy too (see the desync note above).

| Role | Address |
|---|---|
| vault-core (`--features testnet`) | `0x1e223295ef6d36b9125d28cdf2619937f473ba28` |
| MockVault — Morpho slot | `0x8bbb9576af205c481d177bd03653cdeaf5ad41ae` |
| MockVault — Fluid slot | `0x704d336f09b67835000bc2554cdc595edf94caea` |
| MockVault — Euler slot | `0x6aca4e2fcb1532bbd0b51980c44b34fd3cca3453` |
| MockVault — Aave slot | `0x65d13bbb205c6a87728e32c17801dfdff6ae3e2a` |
| Adapter — Morpho slot | `0x1b56374d5026e354615ccfc10373f2a9459ff9a3` |
| Adapter — Fluid slot | `0x1dbc8816f6271c53e23fb995d4d5cf51e6673ffa` |
| Adapter — Euler slot | `0x000ce6d89a227c975c7d3c130aece43bb0d978ba` |
| Adapter — Aave slot | `0x718566ae22dd5ffe5186d88d524e748adaf554f4` |

Its 13/13 green e2e run (2026-07-24, pre-13-11) predates the C-M2/S-M1 fixes and does not stand in
for the new rig's evidence.

Three earlier rigs are retired by that redeploy in turn (the C-H1 rig below, plus the two it
already retired). None can be re-pointed at a later core: each adapter's `init(vault, core)` is
one-shot with no setter (F9 D-01).

**Rig 3 (C-H1 fix, superseded by the Permit2 removal):** the C-H1 gap-closure rig, live-verified
16/16 green (`sepolia_core_flow` 4/4, `sepolia_edge_cases` 9/9, `sepolia_periphery` 3/3) before this
redeploy. Retired ONLY because it still carries `vault-periphery` and the public `depositFor` —
the core's constructor-based ownership fix and the rest of the ABI are otherwise identical to the
rig above.

| Role | Address |
|---|---|
| vault-core (`--features testnet`) | `0x813f2112107c87a4583d9f1ce22d63c3274e2209` |
| vault-periphery | `0xc01feceacc7ba14e6d7a45c66ab40f3774afa49d` |
| MockVault — Morpho slot | `0x3e2353aeb1e566f5f0b46533be6e611733e8865c` |
| MockVault — Fluid slot | `0x6629e5085f006d1c36906d42c9ddcff7be33cfec` |
| MockVault — Euler slot | `0xf5e6fd6eea6880577d50c8b8836cd7fc77a8be2e` |
| MockVault — Aave slot | `0xbab043c0e33bff2057552d1b5b308b4de9d8595e` |
| Adapter — Morpho slot | `0x7d8edb9916cd58c7ce37a390a25a7fa31701f529` |
| Adapter — Fluid slot | `0x9fd3010469d2537aec876555f9cc9465c6fff7a6` |
| Adapter — Euler slot | `0xca124be152be53cc825e65a604c8de8f4b330a6b` |
| Adapter — Aave slot | `0xf1cf7ee1ab7732281c420f01264a9fba1f384941` |

**Rig 2 (13a/13b, superseded by the C-H1 fix):** the frozen 13a ABI rig, live-verified 16/16 green
against the pooled 13a/13b test suite before that gap closure. Retired ONLY because its core still
carries the unprotected `init(address)` C-H1 vulnerability — the ABI shape and test coverage are
otherwise identical to Rig 3 above.

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
MockUsdc has no role in any later rig at all.

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
  `depositWithPermit` pulls USDC via a Permit2 `SignatureTransfer` then calls `core.depositFor`,
  crediting the signer, not the periphery (D-19: the core pulls the exact amount it measures via
  `transferFrom`, so a compromised periphery cannot mint unbacked shares). No privileged role on the
  core — `depositFor` stays permissionless. No fixed signature-length guard: Permit2 itself accepts
  both 65/64-byte ECDSA (EOA owners) and arbitrary-length ERC-1271 `isValidSignature` (smart-account
  owners, e.g. Lemon's Safe-style wallet).
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
