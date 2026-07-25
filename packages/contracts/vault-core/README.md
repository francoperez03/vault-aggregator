# vault-core

The system of record for the Vault Aggregator: a per-user, per-adapter share ledger plus the
split-deposit / user-rebalance / redeem logic that moves USDC in and out of the four whitelisted
protocol adapters. One Stylus contract, one `#[public] impl` block — Stylus allows exactly one
per contract type, so every mutating and view method lives in that single block, with
owner/user-gated helpers factored into a second plain `impl` off the ABI.

## What it is

There is no aggregate pool and no single global share price. Each user holds an independent share
balance in each adapter they have deposited into (`user_shares[user][adapter]`), and each adapter
has its own `adapter_total_shares` and its own real-world `total_assets()`. Allocation across
adapters is a **per-user preference**, not an owner-level knob: a user sets their own weights via
`rebalance`, and `deposit` applies those stored weights to every subsequent deposit.

Guard-before-mutate is the house convention throughout: ownership checks, adapter
registered/enabled checks, and weight-set validation (matching lengths, no duplicates, every
target enabled, sum exactly 10000 bps) all run and can revert before any storage write or external
call happens, so a rejected call never leaves partial state.

## Public surface at a glance

- `constructor(owner)` — one-shot, sets ownership atomically at deploy (C-H1 fix: no
  caller-supplied `init(owner)` window to front-run).
- `add_adapter(adapter)` / `set_enabled(adapter, bool)` — owner-only registry maintenance. No
  `remove_adapter` (deleted deliberately, Phase 13 D-18): `set_enabled(false)` covers the
  operational need without the guard complexity a removable registry entry requires.
- `deposit(amount)` — sugar over `deposit_for(msg.sender, amount)`.
- `deposit_for(user, amount)` — permissionless-but-safe: pulls USDC from `msg.sender` but always
  credits `user`, split by `user`'s own stored weights. A caller can pay for someone else's
  deposit, never redirect funds. This is what `vault-periphery`'s Permit2 path calls.
- `rebalance(adapters[], weights[])` — user-only, over the caller's own position. Fully unwinds
  the caller's current position (across every adapter they hold shares in, not just their old
  weight set), measures the real proceeds, stores the new weights, and re-splits.
- `redeem(bps)` — exits `bps`/10000 of the caller's own position across every adapter they hold
  shares in, back to USDC held by this contract.
- Views: `shares_of(user, adapter)`, `adapter_total_shares(adapter)`, `weight_bps_of(user,
  adapter)` — scalar reads, not aggregated arrays; the frontend batches four reads via multicall
  and computes USDC value off-chain.

## Share math

The virtual-offset floor-rounding formula (applied per adapter, not per aggregate pool) lives in
`src/share_math.rs` and is not restated here. The frontend's off-chain replica is
`apps/web/lib/vault/valuation.ts`.

## WASM gate headroom

vault-core is the tightest binary in the workspace against Arbitrum One's ~22,528-byte compressed
gate (single WASM fragment, no multi-fragment support on ArbOS 51). It ships with the same
`-Cpanic=immediate-abort` / `-Zbuild-std` nightly build lever CoinFlip uses, pinned to
`nightly-2025-09-15` for the whole workspace. Check headroom before adding surface:

```bash
cargo stylus check --endpoint arb1 -p vault-core
```
