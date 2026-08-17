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
  One (see `docs/RUNBOOK-M2.md`).

Production `vault-core` and `vault-periphery` are live on Arbitrum One since 2026-08-10 (addresses
and the real-USDC smoke run in `docs/RUNBOOK-M2.md`). Before that, the mainnet adapters were validated
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
derived by sampling `assets-per-share` on an interval and computing the delta over time. See
`apps/web/hooks/useVaultYield.ts`.

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

Not duplicated here — one source of truth, updated as rigs get redeployed:

- Arbitrum Sepolia test rig (mock vaults, disposable): `docs/TESTNET.md`
- Arbitrum One production adapters + wallets: `docs/RUNBOOK-M2.md`

## WASM size gate

Every contract in this repo must clear the Arbitrum One mainnet gate: 24KB compressed WASM (in
practice ~22KB/1-fragment, since Arbitrum One's ArbOS does not support multi-fragment programs).
The build pipeline is inherited verbatim from the CoinFlip repo: workspace-root release profile
(`opt-level = "z"`, `lto = true`, `panic = "abort"`, `strip = true`) plus a nightly
`-Cpanic=immediate-abort` / `-Zbuild-std` build for the final size reduction pass.
