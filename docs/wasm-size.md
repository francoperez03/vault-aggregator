# `vault-adapter` WASM Size — Arbitrum One Gate

Command: `cd packages/contracts/vault-adapter && cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`

## Result

- **Compressed size: 12,550 bytes** (12.6 KB)
- **Fragment count: 1** (single-fragment, activates on ArbOS 51 / Arbitrum One as-is)
- **Gate: 22,528 bytes** (the effective ~22KB / 1-fragment Arbitrum One gate — ArbOS 51 has no
  fragment support, so a >1-fragment binary that only passes a Sepolia check cannot activate on
  One; see `.planning/STATE.md`'s Phase 04.1 decision and `coinflip`'s equivalent mainnet gate)
- **Headroom: 9,978 bytes (~44%)** under the gate
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exits `0`

No lever was applied — the measured size is well under 22,528 bytes.

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
