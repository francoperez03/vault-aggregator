# Vault Aggregator — Arbitrum One Production Deploy Plan

Target: **Arbitrum One (chain id 42161)**. Everything here spends real funds.
Companion docs: `RUNBOOK-M2.md` (interim rig already live on One), `PROTOCOL-PROBES.md`
(live evidence per protocol), `wasm-size.md` (One's 22,528-byte / 1-fragment gate),
`security/vault-aggregator-review-checklist.md` (M2's mandatory internal review).

## 0. What is already true on Arbitrum One

- Four **interim** adapter instances are live and round-tripped 5/5 with real USDC
  (RUNBOOK-M2.md). They are disposable by design (core = the M2 EOA); production deploys
  fresh instances pointed at the real `vault-core`. No fund migration (T-09-24).
- All four protocol vaults were probed live: asset-exact `withdraw()` present, round-down
  rounding confirmed, Fluid throttle behaviour measured (`PROTOCOL-PROBES.md`).
- Binary gates all pass today against One's RPC (1 fragment each):
  `vault-core` 20,351 B, `vault-adapter` 12,550 B, `vault-periphery` 10,266 B — gate 22,528 B.
- `vault-core`'s USDC address is a **compile-time constant**: the default (non-`testnet`)
  build already embeds native Arbitrum One USDC. No config step can get this wrong.

## 1. Decisions needed BEFORE deploying (owner is immutable)

| Decision | Options | Why it blocks |
|---|---|---|
| **D-M1: final owner of `vault-core`** | M2 wallet (fast, interim) vs client multisig | `constructor(owner)` runs once at deploy; **there is no `transfer_ownership` on the core ABI**. Whatever address is passed owns `addAdapter`/`setEnabled` forever. Deploy with the FINAL owner, or accept redeploying later. |
| D-M2: Permit2 periphery in scope | deploy `vault-periphery` (Permit2 `depositWithPermit2`) vs approve+call only | Lemon QA established the vault flow works approve+call direct; the periphery is extra surface + one more activation. If Lemon is the only distribution channel, it can ship later without touching the core. |
| D-M3: seed/smoke budget | e.g. 2 USDC + 0.001 ETH extra to the M2 wallet | Wallet holds 0.00159 ETH + 9.99 USDC. Enough for adapters (activation ~0.0001 ETH each codehash), tight if core + periphery both activate; top up ~0.002 ETH for margin. |

## 2. Pre-flight gates (all must pass, in order)

1. **Freeze the source**: tag the commit (`vX.Y.0-mainnet`) — everything below deploys that tag.
2. `cargo test --workspace` green (unit + TestVM; e2e skip cleanly without `ARB_ONE_RPC_URL`).
3. Re-run the three size gates against One (`cargo stylus check
   --endpoint="https://arb1.arbitrum.io/rpc"` in `vault-core/`, `vault-adapter/`,
   `vault-periphery/` if in scope): compressed ≤ 22,528 B **and** fragments = 1, each.
4. **Security checklist sign-off** written into
   `docs/security/vault-aggregator-review-checklist.md` (M2 hard constraint) — the
   adversarial-review bundles must be closed or explicitly accepted (WR-02, KI-01, KI-03
   already carry measured verdicts).
5. Re-probe the four vaults (read-only, same eight calls as `PROTOCOL-PROBES.md`) to confirm
   none migrated/paused since 2026-07-22: `asset() == USDC`, `maxDeposit != 0`, no reverts.
6. Toolchain intact: `nightly-2025-09-15` pinned (panic=immediate-abort lever), Docker up
   (`cargo stylus deploy` reproducible builds — required for `cargo stylus verify` later).

## 3. Deploy sequence (Arbitrum One)

Deployer: M2 wallet `0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992`, key `~/.wakeup-m2-arb1.key`
(chmod 600, never in the repo). Every mutating tx sets an **explicit gas limit of 2,000,000**
(`adapter_e2e::TX_GAS_LIMIT`): live OOG failures proved `eth_estimateGas` under-reports for
Stylus→EVM calls (Euler, Morpho — RUNBOOK-M2.md). Unused gas refunds, the buffer is free.
Keep `MAX_FEE_GWEI=0.1` as the fee-spike guard (observed gas price ~0.020 gwei).

```text
Step 1  Deploy vault-core          cargo stylus deploy (Docker) from packages/contracts/vault-core
                                   constructor arg: OWNER (D-M1) — pays its own activation
Step 2  Deploy 4 × vault-adapter   scripts/deploy-adapters.sh with CORE=<vault-core addr>
                                   (adapt the script: interim rig used CORE = EOA; production
                                   passes the core contract). Same WASM ⇒ activation paid once,
                                   instances 2-4 are code-deposit only.
        init per instance:         init(vault=<protocol vault>, core=<vault-core>)
                                   verify via the Initialized(vault, core) event (no vault() getter)
Step 3  Wire the core              core.addAdapter(morpho); addAdapter(fluid); addAdapter(euler);
                                   addAdapter(aave)   — owner-only, order fixes adapter indices
Step 4  (if D-M2 yes) periphery    cargo stylus deploy vault-periphery
                                   constructor: core + USDC + canonical Permit2
                                   0x000000000022D473030F116dDEE9F6B43aC78BA3
Step 5  Verify sources             cargo stylus verify per contract against Arbiscan
                                   (public-repo deliverable; requires the Docker build of Step 1/2/4)
Step 6  Record                     append addresses + txs to RUNBOOK-M2.md, refresh docs/.m2-env
```

Second `init` on any adapter must revert `AlreadyInitialized` (`0x0dc149f0`) — re-run the
T-09-11 guard probe as a cheap post-deploy check.

## 4. Parameters — the exact values

### Protocol targets (all ERC-4626, all asset() == native USDC, probed live)

| Protocol | Vault | Address | Notes |
|---|---|---|---|
| Aave v3 | `stataArbUSDCn` (official static wrapper) | `0x7cfadfd5645b50be87d546f42699d863648251ad` | EIP-1967 proxy (impl `0x9bf9df78…981e`); NEVER point at the raw aToken |
| Morpho | `gtUSDCc` (Gauntlet USDC Core) | `0x7e97fa6893871A2751B5fE961978DCCb2c201E65` | 18-dec shares; withdraw walks the market queue → the gas-hungry one |
| Fluid | `fUSDC` | `0x1A996cb54bb95462040408C06122D45D6Cdb6096` | withdrawal throttle: treat `maxWithdraw()` as an upper bound near vault-level liquidity |
| Euler v2 | `eUSDC-2` | `0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b` | minimal-clone proxy; selector scan false-negatives are expected, `cast call` probes instead |

### Assets & infra

| Param | Value |
|---|---|
| USDC (native, 6 dec) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (bridged USDC.e is NOT supported) |
| Permit2 (only if D-M2) | `0x000000000022D473030F116dDEE9F6B43aC78BA3` |
| RPC | `https://arb1.arbitrum.io/rpc` |
| Gas limit (every mutating call, incl. frontend writes) | 2,000,000 explicit — wagmi/viem auto-estimation reproduces the OOG bug |
| Fee ceiling | `MAX_FEE_GWEI=0.1` |

### Allocation model

Weights are **per-user**, set by each user's own `rebalance(address[], uint256[])` (bps,
must sum 10,000) — the pooled owner-set allocation was deleted in Phase 12.1. There is no
protocol-level default to configure at deploy time; the frontend's suggested split
(e.g. 40/30/20/10) is a UI default, not a contract parameter. `deposit(amount)` requires the
user's weights to exist (`NoWeightsSet` otherwise) — the frontend flow already handles this.

## 5. Post-deploy smoke test (real USDC, small)

From the M2 wallet, against the PRODUCTION core (mirrors `adapter-e2e`'s flows):

1. `USDC.approve(core, 2_000000)` → `core.rebalance([4 adapters], [4000,3000,2000,1000])`
   with 0 balance (sets weights) → `core.deposit(1_000000)`.
2. Read back: `sharesOf(wallet, adapter)` > 0 on all four; `adapterTotalShares` matches.
3. `core.rebalance` to a different shape (e.g. 10/20/30/40) — exercises unwind + re-split.
4. `core.redeem(10000)` (full exit) → wallet USDC back minus ≤ a few units of 4626
   round-down (measured: 1 unit/leg worst case).
5. Expect: no OOG (2M limit), no stranded position (`adapterTotalShares == 0` after exit).

Abort criteria: any leg reverting beyond the known typed errors, or a stranded position →
`setEnabled(adapter,false)` and stop; exits are guaranteed to keep working (D-11).

## 6. Frontend cutover

- Env: chain 42161, core address, the four adapter addresses (D-23 sources adapters from
  env), native USDC. Push to Vercel prod env vars, redeploy.
- Every `writeContract` sets `gas: 2_000_000n` explicitly (see §4 — this WILL bite otherwise).
- Lemon: vault flow is approve+call direct (established in QA); Permit2 only if D-M2 lands.
- QA pass per `QA-WALKTHROUGH.md` against mainnet with cents, not dollars.

## 7. Costs (measured, not guessed)

Phases 9–10 (4 adapter deploys + 2 activations + 4 inits + 5 round-trips incl. failures):
**0.000687 ETH total** at ~0.020 gwei. Production adds core (+1 activation), 4 fresh adapter
instances (1 activation), optional periphery (+1 activation), wiring and the smoke test —
budget **0.003 ETH** to be comfortable; top up the M2 wallet accordingly (D-M3).
