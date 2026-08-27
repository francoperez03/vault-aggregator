# Vault Aggregator

Vault Aggregator (WakeUp Labs M2) is a Stylus/Rust USDC yield aggregator on Arbitrum: one deposit
splits a user's USDC across four whitelisted lending protocols (Aave, Morpho, Fluid, Euler — the
production shortlist that replaced the original Beefy slot, see PROJECT.md), tracked as a per-user,
per-adapter share ledger inside the contract itself. Milestone 2 of the WakeUp Stylus mini-apps
program, hosted as a mini-app inside Lemon's wallet.

## Architecture

Four pieces:

- **`vault-core`** — the system of record. Owns the per-user share ledger, the adapter registry,
  and the split/rebalance/redeem math. One `#[public] impl` block (a Stylus constraint, not a
  style choice); `depositFor` is permissionless-but-safe (see below).
- **`vault-periphery`** — a stateless, privilege-free Permit2 front door. Optional: any EOA can
  call `vault-core::depositFor` directly without it.
- **`vault-adapter`** — one Stylus binary, one deployed instance per protocol vault (never one
  instance serving several). Four identical binaries, four different `vault` addresses wired at
  `init` time. See `packages/contracts/vault-adapter/README.md`.
- **`mock-vault`** — a textbook ERC-4626 stand-in used only on the Arbitrum Sepolia test rig, so
  `vault-core`'s plumbing can be exercised on-chain without touching real protocol money. Real
  protocol behavior is validated separately, directly against Aave/Morpho/Fluid/Euler on Arbitrum
  One.

Production `vault-core` and `vault-periphery` are live on Arbitrum One since 2026-08-10 (addresses
below). Before that, the mainnet adapters were validated
standalone, driven by an EOA standing in for the core, and the Arbitrum Sepolia rig was the first
deployment of the core anywhere.

## Deposit / Rebalance / Two-step Withdraw

**Deposit** is a single transaction, split across the caller's own stored per-protocol weights
(set via `rebalance`, see below): the core snapshots every active adapter's `total_assets()` once,
divides the incoming amount by basis points, and pushes one `deposit` call per adapter leg —
whole-tx atomic, so a single failing leg reverts the entire deposit rather than leaving a partial
position.

**Rebalance is user-only, over the caller's own positions** — there is no owner-level allocation
knob. Calling `rebalance(new_weights)` fully unwinds the caller's current position across every
adapter they hold shares in (not just the ones in their old weights — a user who ends up holding
shares in an adapter the owner later disabled must still be able to exit it), measures the real
USDC proceeds, stores the new weight set, and re-splits those proceeds against it. The owner's
role is registry maintenance only: `add_adapter` / `set_enabled`, never allocation.

**Withdraw is two steps** by design: `redeem(bps)` exits a fraction of the caller's position back
to USDC held by the vault-core contract itself (basis points of the caller's own position, not a
raw share count — every adapter has its own share price, so there is no single global share
scalar to redeem against), then a second step moves that USDC from the mini-app into the user's
Lemon account via the Lemon SDK. The second step lives in `apps/web`, not in the contract.

## Share-math model

Per-user, per-adapter shares with a virtual-offset floor-rounding scheme (the standard ERC-4626
inflation-attack mitigation, applied per adapter rather than to one aggregate pool). The formula
lives in one place and is not restated here: `packages/contracts/vault-core/src/share_math.rs`
(on-chain, authoritative) and `apps/web/lib/vault/valuation.ts` (the frontend's off-chain replica,
used to convert shares to a displayed USDC value without a round-trip read per render).

## Adapter registry

Owner-only `add_adapter(adapter)` (enabled by default) and `set_enabled(adapter, bool)`. There is
no `remove_adapter` — deleted deliberately (Phase 13 D-18) rather than hardened, because the guard
it existed to enforce only existed because the function did. Disabling an adapter blocks new money
from choosing it as a weight target but never blocks money out: both `redeem` and `rebalance`'s
unwind iterate the full registry filtered by held shares, not by the enabled set, so a disabled
adapter can never strand a position.

## Live yield counter

The in-app "live" APY/yield counter (VFE-02) is not a contract feature: it is a client-side rate
derived by sampling the position's USDC value every 60s (`useVaultPosition` polls; inside the
Lemon WebView there are no focus events to piggyback on) and computing the delta over time. See
`apps/web/hooks/useVaultYield.ts` and `apps/web/lib/vault/yieldSnapshot.ts`.

Two properties of that derivation matter for anyone reading the number:

- **Capital moves are never yield.** `deriveRate` rejects any delta whose implied APR exceeds
  `MAX_PLAUSIBLE_APR` (1000%) and treats it as a rebase (rate 0, new baseline). A deposit,
  redeem or rebalance landing between two samples therefore never shows up as a rate, whichever
  screen or tab produced it. This replaced the earlier `txNonce`-only protection after a 0.5 USDC
  deposit read as 105s of yield rendered a 10,170,003% APY in production (2026-08-25).
- **USDC has 6 decimals, so small positions accrue in visible steps.** At ~4.5% APY a $0.50
  position gains one atomic unit ($0.000001) roughly every 16 minutes; between two 60s samples
  the delta is usually 0 and the APY pill stays hidden ("nothing derived, nothing claimed"). When
  a single atomic step does land inside one window, that window's annualized rate over a tiny
  principal reads high for a minute. The displayed APY converges to the protocol's real rate as
  the position grows; for a $100+ position the noise is negligible.

## Permit2 write path

`vault-periphery`'s `depositWithPermit` pulls USDC via a single-use Permit2 `SignatureTransfer`
signature, then calls the core's `depositFor(user, amount)` (D-A1). The position is credited to
whoever signed the permit, split by that address's own stored weights — the periphery holds no
privilege the core recognizes, so a compromised periphery could at most donate its own transient
balance, never mint an unbacked claim against other users' custodied USDC (D-19). This exists
because Lemon's smart-account wallet cannot do a plain `approve` + `deposit` two-tx flow (the same
constraint CoinFlip's `betWithPermit2` already works around) — Lemon signs the Permit2 struct
client-side and submits it through `callSmartContract`'s native `permits[]` support. The
browser/EOA path (plain `approve` + `core.deposit`) is unaffected and still works standalone.

## Deployed addresses

Arbitrum One (production, live since 2026-08-10):

| Contract | Address |
|---|---|
| vault-core | `0x8a1758d3dd3d1049c43bfb1d1fec11fd403d3553` |
| vault-periphery | `0x4e69892949f07623f3f59b24ebbb6e7ca2327bbc` |
| Adapter — Morpho `gtUSDCc` | `0x9aa8886c64d7b3799f676a41ad8bada77f128603` |
| Adapter — Fluid `fUSDC` | `0xe6f1d13787cb3cc8d0483fdd8a748f9d60ba5110` |
| Adapter — Euler `eUSDC-2` | `0x5ab92d390895ce6662568585413b42524eeabcfd` |
| Adapter — Aave `stataArbUSDCn` | `0x156dc816990079917594cf1394389ed918e4ff3c` |
| USDC (native) | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` |

Deployer / registry owner: `0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992` (key kept outside the repo).
Every Stylus write from a client pins a 6,000,000 gas limit: `eth_estimateGas` under-reports for
Stylus→EVM calls (a full four-protocol rebalance measured 2.6M and a 2M limit OOG'd on mainnet);
unused gas is refunded on Arbitrum.

The Arbitrum Sepolia rig is disposable; `scripts/deploy-testnet-mocks.sh` writes its addresses to
`.sepolia-env` at the repo root.

## Stylus version upgrades (re-activation)

Every Stylus program records the Stylus version it was activated under. When an ArbOS upgrade
bumps that version, the chain refuses to run older programs — every `eth_call` and tx against
them reverts with `ProgramNeedsUpgrade(activated, current)` — until someone re-activates them.
This is protocol behavior, not a bug in the contract or the app, and it affects every Stylus
program on the network at once. Solidity contracts (USDC, Permit2, the underlying protocols) and
Lemon's smart accounts are unaffected.

Symptoms: in Lemon, every write shows the generic red sheet
(`MiniAppsStackStrings...errors.undefined`) because the pre-flight simulation reverts before
anything is broadcast; in the web app, position reads fail.

Check and fix (any funded key works; the owner is not required; storage is untouched):

```bash
RPC=https://arb1.arbitrum.io/rpc
cast call 0x0000000000000000000000000000000000000071 'stylusVersion()(uint16)' -r $RPC
cast call 0x0000000000000000000000000000000000000071 'programVersion(address)(uint16)' <program> -r $RPC
cargo stylus activate --address <program> --endpoint $RPC --private-key-path <key>
```

Activation is keyed by codehash, so the four adapters (one binary, four instances) need a single
activation; `ProgramUpToDate()` on the rest is the expected answer. The 2026-08-22 v2→v3
re-activation took three txs (~0.0005 ETH): core `0x1d762042…`, periphery `0xbaa6e17b…`,
adapters `0x1d6e4205…`; storage, weights and user shares verified intact afterwards.

## WASM size gate

Every contract in this repo must clear the Arbitrum One mainnet gate: 24KB compressed WASM (in
practice ~22KB/1-fragment, since Arbitrum One's ArbOS does not support multi-fragment programs).
The build pipeline is inherited verbatim from the CoinFlip repo: workspace-root release profile
(`opt-level = "z"`, `lto = true`, `panic = "abort"`, `strip = true`) plus a nightly
`-Cpanic=immediate-abort` / `-Zbuild-std` build for the final size reduction pass.
