# vault-adapter

A single Stylus/Rust binary implementing a generic ERC-4626 adapter, with one deployed instance
per protocol vault — never one instance serving several vaults (D-01, Phase 9). Four protocols
(Morpho, Fluid, Euler, Aave-via-Stata) are four instances of the exact same WASM, wired to
different `vault` addresses at `init` time.

## What it is

The public surface is five functions, no more:

- `init(vault, core)` — one-shot, fixes `vault` and `core` for the life of the deployment. No
  setter afterwards.
- `deposit(usdc_amount)` — `onlyCore`. Pulls USDC from `core`, deposits into `vault`, credits the
  resulting shares to the adapter itself (the adapter custodies shares, `core` never holds them).
- `withdraw(usdc_amount)` — `onlyCore`. Withdraws exactly `usdc_amount` from `vault`, sent directly
  to `core`. Reverts `WithdrawExceedsMax` rather than clamping to a smaller amount.
- `total_assets()` — public view, no gate.
- `max_withdraw()` — public view, no gate.

Everything mutating is behind `onlyCore`; both views are open. For the four deployed instances'
addresses (Morpho, Fluid, Euler, Aave), see `docs/RUNBOOK-M2.md` — not duplicated here, addresses
and doc pages drift out of sync otherwise.

## Accounting

`total_assets()` is `convertToAssets(vault.balanceOf(self))`. Nothing else. There is no internal
share counter, no cached balance, no state the adapter keeps of its own position beyond what the
vault itself reports.

## Donated funds are stranded, on purpose

There is no `sweep()`, `rescue()` or any other privileged recovery function, and there will not be
one. Anything sent directly to an adapter's address — native USDC, an `aArbUSDCn` aToken, an ERC-20
nobody asked for — stays there permanently. Nobody can move it, including us.

This is a deliberate trade (Phase 10 D-05). A rescue function is a privileged entrypoint: audit
surface, attack surface, and a key that has to stay safe forever, added to solve a problem that
only exists when somebody gives money away by accident. The four-function surface stays four
functions.

What a donation does to the accounting, proven in `src/conformance.rs::aave`:

| Donated | Effect on `total_assets()` / `max_withdraw()` |
|---|---|
| Native USDC | none — the adapter never reads its balance. Stranded and visible. |
| `aArbUSDCn` (rebasing aToken) | none — same reason. The rebasing is invisible to the adapter. |
| Vault shares (e.g. `stataArbUSDCn`) | rises by exactly `convertToAssets(donated shares)` — the position genuinely grew, and the extra is withdrawable. A gift, not an exploit. |

The third row is the one with a consequence: it means an adapter's reported position can be
inflated by a third party. That is not defended here (the adapter is doing the right thing), it is
defended in the aggregator core's share math — see VAULT-06.
