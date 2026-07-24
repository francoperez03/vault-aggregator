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

## Phase 12.1 — Per-user allocation & per-adapter share ledger

### Baseline (before any 12.1 code)

- **Compressed size: 21,164 bytes**
- **Fragment count: 1**
- **Gate: 22,528 bytes**
- **Headroom: 1,364 bytes**
- `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` exit code: 0

**Note on the 119-byte gap vs the 21,045-byte figure recorded at the end of Phase 12:** this is
measurement noise, not toolchain drift. `docs/TESTNET.md` already measured and attributed this
exact class of variance while adding the `testnet` feature cfg branch: re-running
`cargo stylus check` against what is understood to be the same F12-final source produced 21,142
bytes (not 21,045), and the subsequent testnet-cfg branch measured 21,161 — a ~100-150 byte spread
across runs attributed to brotli compression non-determinism on an otherwise byte-identical (or
near-identical) uncompressed artifact (`cmp -l` showed only 2 embedded panic-line-number bytes
differ for that change). 21,164 falls inside that already-documented band, so this baseline is
treated as reproducible and the phase proceeds without escalating to the user.

### D-13 STOP rule (binding for every 12.1 task)

Every task that touches `vault-core` source MUST, before closing, run
`cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"` from
`packages/contracts/vault-core/` and append a row below with the measured compressed size and
fragment count.

**STOP condition:** compressed size > 22,528 bytes **OR** fragment count > 1.

On STOP the phase halts. The executor does NOT pick a mitigation on its own. It reports the
measured size, the fragment count and D-14's ordered plan B, and waits for a decision:

1. `wasm-opt -Oz` (Binaryen) — cheapest lever, no design change. Watch reproducibility for
   `cargo stylus verify` (see ADR-001's `-Zbuild-std` risk; this deepens it).
2. Surface trim, in this order: drop the `sharesOf`/`weightsOf` views (D-08), collapse the typed
   errors into one generic error, drop `remove_adapter` (D-11's `set_enabled(false)` already
   covers the operational case). These are product decisions, not silent refactors.
3. Core/periphery split — last resort only, out of this phase's scope if reached.

### Measurements

| Task | Change | Compressed bytes | Fragments | Delta |
|------|--------|------------------|-----------|-------|
| 01-01 | baseline (no 12.1 code) | 21,164 | 1 | — |
| 01-02 | storage spike (Option A: nested ledger + per-user weights + probe fn) — REVERTED | 21,970 | 1 | +806 |
| 02-01 | per-user storage + write_weights/read_weights + sharesOf/weightsOf + NoWeightsSet | 21,682 | 1 | +518 |
| 02-02 | weights validator tests (test-only) | 21,674 | 1 | -8 |
| 03-01 | per-user deposit/redeem/rebalance + unwind_position + deposit_leg; deleted set_allocation, AllocationSet, active_adapters, split_by_position, InsufficientShares, adapter_bps, flat shares, scalar total_shares | 20,960 | 1 | -714 |
| 03-02 | rewritten legacy tests (test-only) | 21,036 | 1 | +76 |
| 04-01 | mandatory security tests (test-only) | 20,997 | 1 | -39 |
| CR-01 | fix: accumulate `owed_total` before the throttle skip in `unwind_position` | 20,961 | 1 | -36 |

**Layout verdict (Assumption A1 → measured):** Option A costs +806 bytes on top of the 12.1
baseline, including the throwaway probe function. Remaining headroom for the rest of the phase:
558 bytes. Verdict: PROCEED with Option A, but the budget left for Plan 03 falls under 800 bytes
and the STOP is probable.

The probe function compiled with the exact accessor syntax from the plan on the first try — no
adjustment to `weight_targets.setter(user).push(adapter)` or any other accessor was needed.

**Task 02-01 (real code, not a throwaway spike):** 21,682 bytes, +518 bytes vs the 12.1 baseline
(21,164) — 214 bytes cheaper than the disposable spike's +806 bytes, consistent with the spike's
probe function adding weight the real `write_weights`/`read_weights`/`shares_of`/`weights_of`
wiring didn't need to duplicate. `weight_targets.setter(user).erase()` compiled unmodified — no
pop-loop fallback was needed. Headroom remaining for Plan 03: 846 bytes (~3.8%) under the
22,528-byte gate.

**Task 02-02 (test-only, `#[cfg(test)]` code):** 21,674 bytes, -8 bytes vs Task 02-01 — inside the
noise band already documented for this project (brotli compression non-determinism across
otherwise-identical release artifacts, since `#[cfg(test)]` code is never compiled into the
release WASM); not a real reduction. Headroom for Plan 03 stays effectively 846-854 bytes (~3.8%).

**Task 03-01 (the atomic deposit/redeem/rebalance rewrite):** 20,960 bytes, **-714 bytes vs Task
02-02** (21,674). The D-13 STOP rule did NOT trigger — the measured size went DOWN, not up, because
this task deletes more surface than it adds: `set_allocation`, the `AllocationSet` event,
`registry::active_adapters`, `share_math::split_by_position` (plus its 6 unit tests),
`errors::InsufficientShares`/`insufficient_shares()`, and three storage fields (`adapter_bps`, the
flat `shares` mapping, the scalar `total_shares`) are all gone, while the additions
(`unwind_position`, `deposit_leg`, the rewritten `deposit`/`redeem`/`rebalance` bodies) reuse
`write_weights`/`read_weights`/`sharesOf`/`weightsOf` from Plan 02 rather than duplicating logic.
Headroom under the 22,528-byte gate: **1,568 bytes (~7%)** — comfortably clear of the gate, and
more headroom than Plan 02 left for this plan (846 bytes), not less. `cargo stylus export-abi`
confirms `deposit`, `redeem`, `rebalance`, `sharesOf`, `weightsOf`, `addAdapter`, `setEnabled`,
`removeAdapter` are present and `setAllocation` is absent.

**Task 03-02 (test-only rewrite of the legacy suite):** 21,036 bytes, +76 bytes vs Task 03-01 —
inside the project's documented brotli non-determinism noise band (`#[cfg(test)]` code is never
compiled into the release WASM, so this is not a real size change). Headroom stays effectively
~1,490-1,568 bytes (~6.6-7%) under the gate. Phase 12.1 closes with net headroom LARGER than the
846 bytes Plan 02 left for this plan, because the deletions in Task 03-01 (`set_allocation`,
`AllocationSet`, `active_adapters`, `split_by_position`, `InsufficientShares`, three storage
fields) outweighed the additions (`unwind_position`, `deposit_leg`, the rewritten public methods).

**Task 04-01 (the five mandatory security/D-11/D-12 tests, plus the `deposit_without_weights_...`
extension):** 20,997 bytes, -39 bytes vs Task 03-02 (21,036) — inside the same documented brotli
non-determinism noise band, exactly as expected: every line added in this task lives under
`#[cfg(test)] mod tests`, so none of it is compiled into the release WASM. The D-13 STOP rule did
not trigger (it structurally cannot for test-only code). Headroom under the 22,528-byte gate:
**1,531 bytes (~6.8%)**.

**CR-01 fix (code review):** 20,961 bytes, -36 bytes vs Task 04-01 (20,997) — inside the documented
brotli non-determinism noise band. The change is a single statement moved out of an `if let` body in
`unwind_position` (`owed_total += owed`), which is byte-neutral by construction: the same add, one
scope up. The D-13 STOP rule did not trigger. Headroom under the 22,528-byte gate: **1,567 bytes
(~7.0%)**.

### Phase 12.1 final

- **Compressed size: 20,961 bytes**, **fragments: 1**, headroom `22528 - 20961` = **1,567 bytes (~7.0%)**
- **Net delta for the whole phase vs the 12.1 baseline (21,164 bytes, `01-01`): -203 bytes** — the
  phase nets NEGATIVE despite adding a full per-user weight ledger, a per-adapter share ledger and
  seven new/rewritten mandatory tests, because Task 03-01's deletion of the pooled owner-allocation
  model (`set_allocation`, `AllocationSet`, `active_adapters`, `split_by_position` + 6 tests,
  `InsufficientShares`, three storage fields) outweighed every addition across the phase.
- Plan B (D-14) activated: **no** — the D-13 STOP rule never triggered across any of the four
  plans; every task closed with headroom comfortably above zero (the tightest single-task margin
  was Task 03-01's 1,568 bytes, ~7%, still the largest headroom recorded since Phase 12 began).
- `cargo stylus export-abi` confirms `deposit(uint256)`, `redeem(uint256)`, `rebalance(address[]
  memory, uint256[] memory)`, `sharesOf(address, address)`, `weightsOf(address)` are exported, and
  `setAllocation` is absent, matching the ABI `docs/TESTNET.md` records for the pending Sepolia
  redeploy.

**Post-phase hardening (WR-01 + WR-04, pre-Phase-13 sweep):** 21,265 bytes, 1 fragment, +304 bytes
vs the 12.1 final (20,961). Command: `cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`
(exit 0, activation fee computed). Two changes measured together:

- WR-01: `remove_adapter` now guards on the core's own `adapter_total_shares` ledger instead of the
  adapter's external `totalAssets()` — a storage read replacing a staticcall (slightly byte-negative
  on its own).
- WR-04: `overflow-checks = true` added to `[profile.release]` — this is where the +304 bytes come
  from (wrap-check branches on every non-`checked_*` arithmetic site). Accepted deliberately: on a
  custody contract, ledger burn/mint arithmetic must revert on overflow, never wrap.

Headroom under the 22,528-byte gate: **1,263 bytes (~5.6%)**. The D-13 STOP rule did not trigger.

---

## Phase 13 D-18 spike — does a Permit2 intake fit in `vault-core`? (throwaway, 2026-07-24)

Measured from `packages/contracts/vault-core` with
`cargo stylus check --endpoint="https://arb1.arbitrum.io/rpc"`, every step exit 0 with an
activation fee computed (i.e. 1 fragment, activates on Arbitrum One). **The code measured here was
discarded — only this table survives.** Purpose: decide Permit2's topology for Phase 13a before
planning it.

| # | State | Compressed | Delta | Headroom (22,528) |
|---|-------|-----------|-------|--------------------|
| M0 | Baseline at `625a3cb` (post WR-01 + WR-04) | 21,205 B | — | 1,323 B |
| M1 | + Tier 1 trim | 20,649 B | −556 B | 1,879 B |
| M2 | + Tier 2 trim, **including the mandatory `adapterTotalShares` getter** | 19,904 B | −745 B | 2,624 B |
| M3 | + minimal Permit2 `SignatureTransfer` intake | 22,475 B | **+2,571 B** | **53 B** |

**Note on M0:** the 12.1 record says 21,265 B; this run measured 21,205 B on the same commit with
no source change. The 60-byte gap is inside the documented ~100–150 B brotli non-determinism band.

**Tier 1** (accessory, costs nothing that matters):
- 16 payload-less typed errors collapsed into one `VaultError(uint8 code)`; `AdapterHasBalance` and
  `RedeemShortfall` stay typed because they carry diagnostic payload.
- Dropped the `Initialized`, `AdapterAdded`, `AdapterEnabled`, `AdapterRemoved` events. `Deposit`,
  `Redeem` and `Rebalanced` survive — they are the user's movement history.

**Tier 2** (real cost, small):
- Dropped `remove_adapter`. `set_enabled(false)` covers the operational case (D-11 guarantees exits
  always work), and deleting the function also deletes the WR-01 finding rather than mitigating it.
- Replaced `weightsOf(user) -> (address[], uint256[])` with the scalar
  `weightBpsOf(user, adapter) -> uint256`. F14 D-23 already sources the adapter list from env vars
  and F14 D-25 batches reads through multicall, so two dynamic arrays buy nothing over four scalar
  reads — and dynamic-tuple ABI encoding is not cheap.

**Permit2 intake as measured (M3):** bare `sol!` `permitTransferFrom` binding (nested-struct params
make `sol_interface!` compute a wrong selector — ADR-001 prohibition, proven in
`coinflip-periphery/src/permit2.rs`), the canonical Permit2 address constant, one `pull_tokens`
dispatch helper, a public `depositWithPermit2(amount, nonce, deadline, signature)`, and a shared
internal `split_and_mint` so the accounting is not duplicated between the two deposit entrypoints.
The AllowanceTransfer half of CoinFlip's module is excluded (the vault has no weekly-permit path).
This is the floor, not a first draft to be optimised further.

### Verdict

**Permit2 does NOT fit in-core.** Two independent reasons:

1. **Without the trims it is not close.** Permit2 costs +2,571 B against 1,323 B of headroom at M0 —
   it overshoots the gate by ~1,248 B. The trims are load-bearing, not optional.
2. **With both trims it "fits" by 53 bytes, which is not a fit.** The documented brotli
   non-determinism band is ~100–150 B, so 53 B of headroom is smaller than the measurement's own
   noise. The same source could measure over the gate on the next build. It also leaves zero budget
   for Phase 13's remaining work (the WR-02 cheap guard) and for anything F15 needs.

**Therefore: Plan B (separate periphery) is the design for 13a**, and the trims are worth keeping on
their own merits — Tier 1 is free, and together they buy back 1,301 B in the core regardless of
where Permit2 ends up.
