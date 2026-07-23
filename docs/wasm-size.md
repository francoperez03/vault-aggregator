# `vault-adapter` WASM Size — Arbitrum One Gate

Command: `cd packages/contracts/vault-adapter && cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`

## Result

- **Compressed size: 12,550 bytes** (12.6 KB)
- **Fragment count: 1** (single-fragment, activates on ArbOS 51 / Arbitrum One as-is)
- **Gate: 22,528 bytes (22528)** (the effective ~22KB / 1-fragment Arbitrum One gate — ArbOS 51
  has no fragment support, so a >1-fragment binary that only passes a Sepolia check cannot
  activate on One; see `.planning/STATE.md`'s Phase 04.1 decision and `coinflip`'s equivalent
  mainnet gate)
- **Headroom: 9,978 bytes (~44%)** under the gate
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exits `0`

No lever was applied — the measured size (12550 bytes) is well under the 22528-byte gate.

## Size progression across this phase

| Plan | Milestone | Compressed size | Delta |
|------|-----------|------------------|-------|
| 09-01 | Scaffold (placeholder `#[public] impl`, `sol_storage!` entrypoint only) | 3,973 bytes | — |
| 09-02 | Post-bindings (`erc20.rs`/`erc4626.rs` dispatch helpers added, unused/dead-code-stripped) | 3,967 bytes | −6 bytes (noise; dead code stripped from release) |
| 09-03 | Post-logic (full D-03 surface: `init`/`deposit`/`withdraw`/`total_assets`/`max_withdraw` wired to the dispatch helpers, `errors.rs` added) | 12,555 bytes | +8,588 bytes |
| 09-04 | Current (conformance tests added — `#[cfg(test)]`-only, does not touch the release binary) | 12,550 bytes | −5 bytes (noise; conformance.rs is test-only, this diff reflects unrelated compiler/build variance, not code added by this plan) |

The real per-plan cost lands entirely in Plan 03: wiring the dispatch helpers into the actual
public surface (guard logic, external calls, typed errors) is what the adapter's size budget is
spent on, not the bindings themselves. Plan 04 adds zero release-binary cost since
`conformance.rs` is gated `#[cfg(test)]` and never compiled into the deployed WASM.

## Escalation ladder (NOT applied — recorded for when the measurement demands it)

In order, only to be applied if a future plan pushes the measured size over 22,528 bytes:

1. **Release profile flags already in `vault-aggregator/Cargo.toml`** — `opt-level = "z"`,
   `lto = true`, `panic = "abort"`, `codegen-units = 1`, `strip = true`. Already the default
   profile from Plan 01; free, no further action needed unless removed.
2. **`-Cpanic=immediate-abort` + `-Zbuild-std`** on the pinned `nightly-2025-09-15` toolchain —
   the single largest lever measured in M1 (coinflip core: ~9.9KB compressed reclaimed). Narrow
   window: `cargo-stylus` 0.10.7/0.10.8 hardcodes the legacy `panic_immediate_abort` flag,
   nightlies from 2026-01-15 onward reject it, older nightlies break alloy's MSRV. Do not bump
   the toolchain without re-bisecting this window first (`.planning/STATE.md`, Phase 04.1
   RESOLVED decision).
3. **`wasm-opt -Oz`** (Binaryen) — measured ~1,156 bytes / 3.3% reclaim on the equivalent coinflip
   core binary. M1 deliberately declined this lever: it adds a transform a third party must
   replicate exactly to reproduce the on-chain bytecode from source, which conflicts with the
   program's public-repo source-verification goal (`cargo stylus verify`). Same reasoning applies
   here if this lever is ever needed.

This adapter is small by design (D-02/D-03's four-function surface plus `init`); do not
pre-apply any of the above to a binary that already fits with ~44% headroom.

## `vault-core` WASM Size — Arbitrum One Gate (Phase 12 baseline)

Command: `cd packages/contracts/vault-core && cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`

### Result (measured 2026-07-23, F11 final committed state — deposit + redeem + inflation test)

- **Compressed size: 19,529 bytes** (19.5 KB)
- **Fragment count: 1** (single-fragment, activates on ArbOS 51 / Arbitrum One as-is)
- **Gate: 22,528 bytes (22528)**
- **Headroom: 2,999 bytes (~13.3%)** under the gate
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exits `0`

### Nightly lever status: SPENT (already committed)

The `-Cpanic=immediate-abort` + `-Zbuild-std` lever (escalation ladder step 2 above) is **already
applied** — `rust-toolchain.toml` pins `channel = "nightly-2025-09-15"` with
`components = ["rust-src"]`, committed in `940cf0e` ("Pin nightly-2025-09-15 toolchain for the
panic=immediate-abort WASM lever") during Phase 11 Plan 04. That commit's own measurement (23,674
bytes stable → 19,549 bytes with the lever) is what got `redeem()` under the gate; the 19,529-byte
number above is the post-lever, current state after the zero-value-adapter-leg fix (`fd83d6c`).

**For Phase 12, this means the remaining escalation levers are ONLY:**
1. `wasm-opt -Oz` (declined — breaks `cargo stylus verify` source reproducibility, see ladder
   step 3 above)
2. A core/periphery contract split (moving surface out of `vault-core` entirely)

There is no further "free" toolchain lever left to pull if `split_by_position` +
`reconcile_credit` + `RedeemShortfall` + the `rebalance` orchestration push this over budget.

### WARNING for Plans 02/03

**~2,999 bytes (~13.3%) of headroom is the ENTIRE budget left for Phase 12's `rebalance` +
hardened `redeem` surface.** Re-run `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`
after every task that touches `core.rs`, not just at the end of each plan — do not wait for a
plan-boundary surprise.

### Result (measured 2026-07-23, post Plan 02 — hardened `redeem` with D-04/D-05/D-06/D-07)

- **Compressed size: 20,110 bytes** (20.1 KB)
- **Fragment count: 1** (single-fragment, activates on ArbOS 51 / Arbitrum One as-is)
- **Gate: 22,528 bytes (22528)**
- **Headroom: 2,418 bytes (~10.7%)** under the gate
- **Delta vs Plan 01 baseline (19,529 bytes): +581 bytes** — the wired `split_by_position` +
  `reconcile_credit` calls plus the extra `usdc::balance_of` before/after reads in `redeem`
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exits `0`

**Remaining budget for Plan 03's `rebalance` (unwind + re-split + owner guards): ~2,418 bytes
(~10.7%).** Same warning carries forward — re-check after every task, the same escalation ladder
(wasm-opt declined, core/periphery split) is the only lever left if this is exceeded.

### Result (measured 2026-07-23, post Plan 03 — `rebalance` + D-13 ABI-surface fix)

- **Compressed size: 21,045 bytes** (21.0 KB)
- **Fragment count: 1** (single-fragment, activates on ArbOS 51 / Arbitrum One as-is)
- **Gate: 22,528 bytes (22528)**
- **Headroom: 1,483 bytes (~6.6%)** under the gate
- **Delta vs Plan 02 (20,110 bytes): +935 bytes** — the `rebalance` method itself (unwind loop +
  re-split loop + `Rebalanced` event) plus the `unwind_request` helper; NOT `set_allocation`'s
  move to a plain `impl` block (moving a fn between impl blocks is a zero-cost source
  reorganization, not new codegen)
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exits `0`

**Phase 12 is now feature-complete (rebalance + hardened redeem) at ~6.6% headroom.** This is the
tightest margin measured across the whole vault-core surface so far. Any future addition to
`core.rs` (Phase 13+ fork-test scaffolding is test-only and exempt, but any new production method)
MUST re-run this check before committing — the only levers left if this is exceeded are
`wasm-opt -Oz` (declined, breaks `cargo stylus verify`) or a core/periphery contract split.

### D-13 architectural note: `#[public]` exports ALL methods regardless of Rust visibility

The plan's original approach (un-`pub`-ing `set_allocation` while leaving it inside the
`#[public] impl VaultCore` block) does NOT remove it from the exported ABI: `stylus-proc`'s
`PublicImpl` macro (verified against its own source, `stylus-proc-0.10.7/src/macros/public/mod.rs`)
exports every method in a `#[public]`-annotated impl block regardless of `pub`/private
visibility — this was already true (and unnoticed) for the pre-existing private `only_owner`/
`ensure_initialized` helpers, both of which still appear in `cargo stylus export-abi`'s output
today. The actual fix: `set_allocation` was moved to a SEPARATE, plain (unannotated) `impl
VaultCore` block, placed after the `#[public]` block closes. Rust does not require same-impl-block
locality for method calls within the same type/module, so `rebalance`'s `self.set_allocation(...)`
call compiles unchanged. `only_owner`/`ensure_initialized` remaining exported is a pre-existing
F11 condition, out of this plan's scope — logged to `deferred-items.md`.
