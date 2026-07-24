# Vault Aggregator Internal Security Review Checklist

This is an internal security review of the `vault-aggregator` Stylus contracts
(`packages/contracts/vault-core/src`, `packages/contracts/vault-adapter/src`), performed before
the `feat/vault-e2e-suite-and-security-review` pull request, per the client's security-review
mandate (VSEC-01). Every item is checked against the current implementation, with a
`file:function` evidence pointer, mapped to an OWASP ASVS category and, where applicable, a
STRIDE threat ID from `.planning/phases/12.1-per-user-allocation-and-per-adapter-share-ledger/12.1-SECURITY.md`.

**Contracts under review:** `vault-core` (the single core contract) + four `vault-adapter`
instances (Morpho, Fluid, Euler, Aave/Stata wrappers) + four `MockVault` test doubles on the
Sepolia rig. This register is cross-referenced against a blind adversarial review that ran with
no access to this document or to `12.1-SECURITY.md`/`known-issues.md`
(`docs/security/adversarial-review/findings-raw.md`, triaged in
`docs/security/adversarial-review/cross-reference.md`).

**Deployed topology note (supersedes an earlier draft of this checklist's scope).** A prior
version of this plan's own instructions described the topology as core + `vault-periphery` (a
Permit2 signature-substitution router for Lemon). That periphery contract has since been
**deleted entirely** — see `PERMIT2-REMOVED` below and `docs/known-issues.md`. The topology
actually deployed and reviewed here is a **single core contract**
(`0x1e223295ef6d36b9125d28cdf2619937f473ba28` on Arbitrum Sepolia) + four adapters + four
MockVaults, with **no periphery**. Every periphery-specific finding (P-I1/P-I2/P-I3, D-19
residuals #1–#3) is recorded MOOT in §11 rather than dispositioned as if the periphery still
existed.

Legend: ✅ mitigated/verified · ⚠️ flagged/accepted, not a blind-✅ · MOOT superseded by a later
change, no action possible or needed · NA not applicable (operational).

---

## 1. No security-by-obscurity

**Status:** ✅

Storage and bytecode are public on-chain regardless of Rust `pub`/private visibility. The plain
(unannotated) `impl VaultCore` block housing `deposit_for`, `unwind_position`, `deposit_leg`,
`write_weights`, `read_weights` (`core.rs:236-241`'s own doc comment) exists to keep these
methods OFF the exported ABI (`#[public]`'s macro exports by presence in the annotated block, not
by Rust-level visibility — verified against `stylus-proc`'s `PublicImpl`), not to hide anything
security-critical: every guard these helpers enforce (`ensure_initialized`, zero checks, weight
validation, adapter-enabled checks) is unconditional regardless of who can see the caller graph.

- **Evidence:** `core.rs:236-241` (doc comment explaining the plain-impl-block pattern);
  `core.rs:250` `deposit_for`, `core.rs:316` `unwind_position`, `core.rs:374` `deposit_leg`,
  `core.rs:429` `write_weights` are all off the ABI by construction, not by omission.
- **ASVS:** V1 Architecture (general secure-design principle, not a numbered control).

---

## 2. Reentrancy / Checks-Effects-Interactions (mandatory axis 1 of 4)

**Status:** ✅ (CEI holds) with one documented, load-bearing dependency (⚠️, see IN-04 below)

This is the reentrancy axis VSEC-01 mandates as its own section.

- **`unwind_position`** (`core.rs:316-369`) is the shared exit primitive for `redeem` and
  `rebalance`. Per-adapter, the share burn (`core.rs:342-343`) happens BEFORE the external
  `withdraw` call (`core.rs:356`) — classic CEI. This is the "logical" reentrancy vector, not the
  classic re-entrant-call vector: `owed_total += owed` (`core.rs:352`) is placed OUTSIDE the
  `if let Some(request) = unwind_request(...)` conditional that gates the external withdraw call.
  This placement is deliberate and load-bearing (CR-01/KI-02, `docs/known-issues.md`): if `owed`
  only accumulated inside the conditional, a fully-throttled leg (`max_withdraw() == 0`,
  `unwind_request` returns `None`, the withdraw is SKIPPED) would shrink the reconciliation target
  to match what was actually withdrawn — no shortfall, the call succeeds, and the user's shares in
  that adapter are destroyed for nothing (a real, exploitable defect found and fixed in Phase
  12.1's own review, re-verified live on Sepolia by
  `throttled_adapter_reverts_whole_redeem_and_burns_nothing` and its siblings in
  `packages/contracts/adapter-e2e/tests/sepolia_edge_cases.rs`, KI-04 RESOLVED).
- **`deposit_leg`** (`core.rs:374-422`): USDC approval + adapter deposit happen first
  (`core.rs:381-384`), the allowance is zeroed immediately after success (`core.rs:390-391`,
  WR-03), and share minting/storage writes happen last (`core.rs:418-420`) — standard CEI for an
  intake path (the external call must land before the mint that prices against it).
- **Evidence:** `core.rs:316-369` (`unwind_position`), `core.rs:374-422` (`deposit_leg`), the
  `owed_total` placement comment at `core.rs:345-351`.
- **STRIDE:** Tampering — the class of threat T-12.1-13/T-12.1-14 (ledger conservation, CEI
  reentrancy safety) named in `12.1-SECURITY.md`.
- **ASVS:** V1 Architecture (CEI ordering).
- **Disposition (KI-02/CR-01 class):** FIXED, with a permanent regression gate. See §7
  (Reentrancy discipline at the Stylus↔EVM boundary) for the `reentrant`-feature dependency this
  ordering still assumes.

---

## 3. Share rounding / inflation (mandatory axis 2 of 4)

**Status:** ✅

This is the share-rounding axis VSEC-01 mandates as its own section.

- **Per-adapter virtual offset** (`OFFSET_POW = 10^6`, `share_math.rs:convert_to_shares`/
  `convert_to_assets`): every adapter maintains its OWN `adapter_total_shares` entry and its own
  `total_assets()` read — there is no single scalar `total_shares` field anywhere in `VaultCore`'s
  storage (T-12.1-11's mitigation, `grep total_shares.get()` against a scalar returns nothing).
  The classic ERC-4626 first-depositor donation-inflation attack is priced per-adapter, not once
  globally, and is proven by
  `inflation_attack_per_adapter_second_depositor_gets_nonzero_proportionate_shares`
  (`core.rs:1395`).
- **U256 → U512 → U256 pattern**: `mul_div_floor` (`share_math.rs:20`) widens before dividing and
  narrows back with a checked cast — no truncation/overflow path found by the blind sharemath
  review's math-precision lens (`findings-raw.md`, "NO FINDINGS" section).
- **`convert_to_shares` zero-mint guard**: `deposit_leg` reverts `ZeroShares` immediately after
  computing `minted` (`core.rs:395-397`) if a deposit would mint zero shares — this closes S-H1
  (see §11 below, refuted/MOOT-in-practice) directly at the point of use.
- **Evidence:** `share_math.rs:20` (`mul_div_floor`), `share_math.rs:34` (`convert_to_shares`),
  `share_math.rs:51` (`convert_to_assets`), `core.rs:1395` (inflation test).
- **STRIDE:** Tampering — per-adapter inflation/donation (T-12.1-11/T-12.1-18 in
  `12.1-SECURITY.md`).
- **ASVS:** V5 Input Validation.

---

## 4. Redeem slippage (mandatory axis 3 of 4)

**Status:** ⚠️ Flagged/accepted, not a blind ✅ (WR-02)

This is the redeem-slippage axis VSEC-01 mandates as its own section. Framed from the exit side:
`unwind_position` measures a REAL balance delta (`core.rs:318`, `core.rs:360`,
`core.rs:363-365`) and reverts on any shortfall (`reconcile_credit`, `share_math.rs:100`) —
ungameable on exit. The asymmetric risk lives on the ENTRY side (deposit), which is why it is
tracked as WR-02, not as a redeem-side defect:

- **`deposit_leg`'s `DEPOSIT_TOLERANCE_BPS` guard** (100 bps, `core.rs:40`, `core.rs:399-416`) is
  a cheap guard, not a full symmetrization (a second post-deposit `total_assets()` read per leg
  was rejected on WASM byte-budget grounds, D-13/Phase 13 D-18 spike).
- **Measured dilution** (`docs/PROTOCOL-PROBES.md` §`WR-02-DILUTION`): a 50 bps deposit-credit
  haircut on a 200,000-unit deposit mints 1,000 fewer vault shares than face value (0.5%
  dilution) — small, proportional, does not compound across unrelated deposits.
- **Live-chain addendum**: reproducing the guard's donation-inflated trigger condition on Sepolia
  shows the underlying `MockVault`'s own `ZeroShares` guard (evaluated inside
  `adapter_dispatch::deposit`, BEFORE `deposit_leg`'s own math runs) fires FIRST, a stricter guard
  catching the same condition earlier — not a gap (`deposit_credit_shortfall_beyond_tolerance_reverts`,
  `packages/contracts/adapter-e2e/tests/sepolia_edge_cases.rs`).
- **Evidence:** `core.rs:36-40` (`DEPOSIT_TOLERANCE_BPS`), `core.rs:399-416` (`deposit_leg`'s
  guard), `docs/PROTOCOL-PROBES.md` §`WR-02-DILUTION`.
- **STRIDE:** Tampering — asymmetric entry/exit pricing (T-12.1-11/T-12.1-13 in
  `12.1-SECURITY.md`).
- **ASVS:** V5 Input Validation.
- **Disposition: ACCEPTED WITH GUARD.** D-13's rejection of full per-leg symmetrization stands;
  the measured number does not reopen it. See `docs/known-issues.md` WR-02.

---

## 5. Whitelisting / access control permissions (mandatory axis 4 of 4)

**Status:** ✅ (constructor-set owner) — see also C-H1 below for the fix history

This is the whitelisting-permissions axis VSEC-01 mandates as its own section. Reflects the
constructor-set owner (no claimable `init`) and the removal of `remove_adapter`.

- **Owner bootstrap**: `owner` is set exactly once, atomically, by a real Stylus `#[constructor]`
  (`core.rs:75-83`) at deployment — there is no public `init` entrypoint left to front-run.
  `no_public_method_other_than_constructor_can_set_owner` (`core.rs:583`) proves no post-deploy
  method can set or reassign `owner`. See §6 (C-H1) for the full fix history.
- **Owner-gated registry**: `add_adapter` (`core.rs:88-100`) and `set_enabled` (`core.rs:114-122`)
  both call `ensure_initialized()` then `only_owner()` (`core.rs:221-226`) as their first
  statements, before any state write.
- **No `remove_adapter`**: Tier 2 (Phase 13 D-18 byte-budget spike) deleted it entirely
  (`core.rs:108-113`'s doc comment). This retires WR-01 (see §11) rather than mitigating it:
  `set_enabled(false)` covers the operational "stop new deposits" case, and D-11 guarantees a
  disabled adapter's existing position stays reachable via `redeem`/`rebalance` (both iterate the
  FULL registry filtered by held shares, never by `adapter_enabled` —
  `disabled_adapter_blocks_deposits_but_never_traps_a_position`, `core.rs:925`).
- **`deposit()` permissionless by design, not an oversight**: `deposit(amount)` always credits
  `msg.sender` to itself (`core.rs:149-152`, `deposit_for(caller, amount)` where `caller =
  self.vm().msg_sender()`). `deposit_for`'s third-party-credit path is no longer reachable from
  outside the contract — it was demoted to a private helper (`core.rs:242-249`'s doc comment)
  when the periphery (its only external caller) was deleted; the only remaining caller is
  `deposit()` with `user == msg.sender` always.
- **Weights pointing at a disabled/unregistered adapter revert**: `write_weights` rejects
  unregistered or disabled targets before any write (`weights_reject_unregistered_target`,
  `core.rs:1645`; `weights_reject_disabled_target`, `core.rs:1659`).
- **Evidence:** `core.rs:75-83` (`constructor`), `core.rs:88-100` (`add_adapter`), `core.rs:114-122`
  (`set_enabled`), `core.rs:149-152` (`deposit`), `core.rs:221-226` (`only_owner`), `core.rs:583`
  (owner-immutability test).
- **STRIDE:** Elevation of Privilege — T-12.1-04 (`write_weights` access control), and C-H1 (owner
  bootstrap takeover, novel, see §6).
- **ASVS:** V4 Access Control.

---

## 6. `C-H1` — Unprotected `init` allowed front-running to steal permanent ownership (blind adversarial review, novel HIGH, gate)

**Status:** ✅ FIXED

Found by the blind adversarial review (`docs/security/adversarial-review/findings-raw.md`
§C-H1), triaged as NOVEL — nothing in `12.1-SECURITY.md`, `known-issues.md`, or `12.1-REVIEW.md`
addressed `init` at all. The original `VaultCore::init(&mut self, owner: Address)` took `owner`
as a caller-supplied parameter with zero access control (no `only_owner()` call — `only_owner()`
itself reads `self.owner.get()`, exactly the field `init` was about to set). An attacker watching
the mempool for the newly-deployed address could front-run the deployer's own `init` call,
permanently claim the owner role (no `transferOwnership` recovery path), and register a malicious
adapter through the now-compromised registry.

**Why this is a gate, not a routine finding:** the phase's security-enforcement policy blocks
phase close on a high novel finding (T-13-49 in this plan's threat register). Total, permanent,
irreversible compromise of the entire adapter registry by transaction-ordering alone qualifies.

**Fix shipped:** the caller-supplied `owner` parameter and the public `init` entrypoint were
removed entirely, replaced by a real Stylus `#[constructor]` (`core.rs:75-83`) that sets `owner`
atomically as part of the deployment transaction itself — the same pattern already proven in this
workspace by the (now-deleted) `vault-periphery/src/router.rs`'s constructor. Stylus constructors
run exactly once, at deployment, before the contract address can receive any other call, so there
is no live, callable, unauthenticated bootstrap path left to front-run. A weaker fix was
considered and explicitly rejected (`owner = msg_sender()` inside a still-public `init`) — it
only narrows the race window, it does not close it.

- **Evidence:** `core.rs:75-83` (`constructor`), `core.rs:583`
  (`no_public_method_other_than_constructor_can_set_owner`).
- **Verified:** `cargo test --workspace --lib` green; measured WASM size 20,681 bytes / 1
  fragment, under the 22,528-byte Arbitrum One gate (`docs/wasm-size.md`). The Sepolia rig (core,
  4 adapters, 4 MockVaults — no periphery) was fully redeployed against the constructor-based
  core, and all live e2e tests re-ran green against it (`docs/TESTNET.md`).
- **Disposition: FIXED**, with a permanent regression test.
- **STRIDE:** Elevation of Privilege.
- **ASVS:** V4 Access Control.

---

## 7. Reentrancy discipline at the Stylus↔EVM boundary (IN-04)

**Status:** ⚠️ Accepted, load-bearing dependency documented

Reentrancy safety across every external call this contract makes (`usdc::transfer_from`,
`usdc::approve`, `adapter_dispatch::deposit`/`withdraw`/`total_assets`/`max_withdraw`) is 100%
dependent on `stylus-sdk`'s `reentrant` feature staying OFF (confirmed absent from
`vault-core/Cargo.toml`'s `[features]`). The guard comment in `Cargo.toml` is the only thing
telling a future maintainer not to flip it.

- **Evidence:** `vault-core/Cargo.toml:[features]` (guard comment), `core.rs:281-367`
  (`unwind_position`/`deposit_leg`'s CEI ordering, which assumes non-reentrant execution).
- **Blind review cross-reference (C-I1):** independently traced and closed — `redeem`/`rebalance`
  use `msg_sender()` directly, never an attacker-supplied parameter, so a reentrant call from an
  adapter executes as `user = adapter's own address`, which holds no shares of its own. No new
  surface found.
- **STRIDE:** Tampering/Elevation of Privilege — the class of threat T-12.1-14.
- **ASVS:** V1 Architecture.
- **Disposition: ACCEPTED**, documented guard, both in `Cargo.toml` and here.

---

## 8. Arithmetic (overflow/underflow) — WR-04

**Status:** ✅ FIXED

`overflow-checks = true` was added to `[profile.release]` pre-Phase-13 (12.1-SECURITY.md's
residual-risk sweep), byte cost +304 measured and recorded in `docs/wasm-size.md`. Every
accounting mutation additionally uses `checked_sub`/`checked_add`/`checked_mul` at the critical
paths (`core.rs:363-365`'s `checked_sub` on the balance delta, explicitly commented: "a
compromised adapter moving USDC OUT of the core would wrap in release builds, turning a loss into
a huge delta that passes the shortfall gate").

- **Evidence:** `vault-core/Cargo.toml:[profile.release]`, `core.rs:363-365`.
- **STRIDE:** Tampering — integer overflow/underflow (T-12.1-13/T-12.1-14 class).
- **ASVS:** V5 Input Validation.
- **Disposition: FIXED** (WR-04, closed 2026-07-24 per `12.1-SECURITY.md`'s residual-risk sweep,
  pre-Phase-13).

---

## 9. Solvency / conservation invariant — WR-01

**Status:** RETIRED BY DELETION, not mitigated (see §5 above)

The ledger (`user_shares`/`adapter_total_shares`), not `totalAssets()`, is the source of truth for
"does this user hold a position here." The original WR-01 fix re-pointed a `remove_adapter` guard
at the ledger instead of the spoofable external `totalAssets()` read — but Tier 2 (13a) then
deleted `remove_adapter` entirely, so there is no "now it can be removed" outcome left to verify.
What remains testable is the invariant the fix depended on: a fully redeemed position leaves the
ledger at zero even when the underlying vault keeps dust
(`full_exit_zeroes_the_ledger_even_when_the_vault_keeps_dust`,
`packages/contracts/adapter-e2e/tests/sepolia_edge_cases.rs`, live-green).

- **Evidence:** `core.rs:108-113` (doc comment retiring `remove_adapter`), the live e2e test above.
- **STRIDE:** Tampering — ledger conservation (T-12.1-13).
- **ASVS:** V5 Input Validation.
- **Disposition: RETIRED BY DELETION.** Recorded here as retired, not as "fixed and
  re-verified," per `docs/known-issues.md`'s own instruction for how this checklist should record
  it.

---

## 10. Novel findings from the blind adversarial run

The blind review (`docs/security/adversarial-review/findings-raw.md`, triaged in
`docs/security/adversarial-review/cross-reference.md`) ran with zero access to
`12.1-SECURITY.md`, `12.1-REVIEW.md`, or `known-issues.md`. Final count: 4 matches, 6 novel, 2
noise (refuted). Every novel finding gets its own disposition below; matches and refuted noise are
cross-referenced but not re-litigated.

### C-H1 — see §6 above. Disposition: FIXED (gate closed).

### C-M2 — `redeem()` permanently reverts on a zero/dust-valued position while `rebalance()` silently clears the identical position

**Verdict:** NOVEL, MEDIUM. Verified against `core.rs:158-173`: `redeem` computes `paid =
self.unwind_position(user, bps)?` then `if paid.is_zero() { return Err(errors::zero_amount()) }`
(`core.rs:165-167`) — this check runs AFTER `unwind_position`'s unconditional share burn, so the
revert undoes the burn (atomic revert), leaving the position permanently stuck for any user whose
reconciled `owed` floors to zero (total loss on that adapter, or a sufficiently small dust
position). `rebalance` (`core.rs:201-205`) runs the identical `unwind_position` call but its own
caller code returns `Ok(())` on zero proceeds — no revert, so that burn sticks and the position is
cleared silently through a function whose own doc comment (`core.rs:175-179`) does not name it as
an exit path.

**Disposition: DEFERRED to a named follow-up (Phase 15).** This documentation-only checklist pass
does not touch contract code (per this plan's own scope). The recommended fix
(`cross-reference.md`'s proposal: distinguish "no position existed" from "a position existed and
burned to a reconciled value of zero" in `redeem`'s zero-paid check) is cheap and
non-architectural, but is not implemented in the code reviewed here — `core.rs:165-167` is
unchanged. No funds are at risk either way (the user's economic outcome is correctly zero under
both functions); the gap is discoverability of `rebalance` as the workaround exit path. Recorded
as an explicit action item for Phase 15: either ship the one-line fix, or correct the code's own
doc comments to name `rebalance` explicitly as the dust-clearing path until it is fixed.

### S-M1 — `split_by_bps` on an empty `weights_bps` would silently drop the entire `amount`, but is unreachable via any live entrypoint today

**Verdict:** NOVEL, MEDIUM, confirmed unreachable via the only caller in this codebase. Verified
against `share_math.rs:75-92`: an empty `weights_bps` never runs the loop, `remainder = amount`,
and `if let Some(first) = slices.first_mut()` matches `None` for an empty `Vec`, silently
discarding the remainder and returning `Ok(vec![])` for a nonzero `amount`. Checked against
`core.rs:write_weights` (`core.rs:429` onward), the sole path that produces the `weights_bps`
slice fed to `split_by_bps`: an empty/mismatched-length adapters array is rejected
(`weights_reject_length_mismatch_and_empty`, `core.rs:1629`) before anything is written, so
`read_weights(user)` can never hand `split_by_bps` an empty slice today via any live entrypoint.

**Disposition: DEFERRED to a named follow-up (Phase 15), non-blocking.** Not reachable today, so
this is a defense-in-depth hardening item, not a live gap — it does not block phase close. The
recommended one-line fix (`if weights_bps.is_empty() { return Err(errors::allocation_invalid()); }`
at the top of `split_by_bps`, per `cross-reference.md`) is not implemented in the code reviewed
here — `share_math.rs:75-92` is unchanged. Recorded as an explicit action item for Phase 15, cheap
enough to bundle with C-M2's fix in the same hardening pass, so a future refactor that loosens the
"always non-empty" precondition upstream does not silently reintroduce a fund-accounting gap.

### S-M2 — entry vs exit pricing asymmetry (yield front-run), CONFIDENCE-LIMITED

**Verdict:** REFUTED, with arithmetic (`cross-reference.md`). Both `deposit_for`'s `ta_before`
(`core.rs:272-277`) and `unwind_position`'s `ta` (`core.rs:338`) are live external `staticcall`
reads to the adapter at the point of use, in the same transaction — there is no cached/stored
`total_assets` field anywhere in `VaultCore`'s storage for either side to trail. The premise the
originating lens flagged as unverifiable (a stale vs. live read) does not hold once the calling
contract is in scope.

**Disposition: no action.** Refuted, not merely low-confidence.

### C-I1 — see §7 above (matches IN-04). Disposition: no action, no new surface.

### S-H1 — donation-primed zero-share mint

**Verdict:** NOISE — refuted with a concrete counter-example (`cross-reference.md`). The finding
is pure-math-correct in isolation (`share_math.rs:convert_to_shares` really can return 0 for the
traced inputs) but `deposit_leg`'s own `if minted.is_zero() { return Err(errors::zero_shares()) }`
(`core.rs:395-397`) reverts the ENTIRE `deposit_for` transaction — including the external
`adapter_dispatch::deposit` call that would have moved the victim's USDC — before any mint-side
bookkeeping executes. Independently corroborates `12.1-REVIEW.md`'s own IN-01 finding from the
opposite direction.

**Disposition: no action.** Refuted.

### C-M1 — matches WR-02 (§4 above). Disposition: no change, already dispositioned as ACCEPTED WITH GUARD.

### C-H2 — matches KI-02/AR-02 (§12 below). Disposition: no change, already dispositioned as ACCEPTED.

---

## 11. `PERMIT2-REMOVED` — the periphery contract and its findings are MOOT

**Status:** MOOT (superseded)

`vault-periphery` — the sole public method of which, `depositWithPermit2`, existed to let Lemon
substitute a signed Permit2 transfer for a real user signature — has been **deleted entirely**
(`packages/contracts/vault-periphery` removed as a crate and workspace member). CoinFlip (M1)
empirically proved Lemon's hosting model cannot support this: the server-side
`PERMIT_PLACEHOLDER_0` mechanism fails, and Permit2 is not an allowed entrypoint contract inside
Lemon's mini-app sandbox. With no working consumer, the periphery, its Permit2 binding, and the
core's now-orphaned permissionless `deposit_for(user, amount)` entrypoint were all removed
together. `VaultCore::deposit_for` was demoted from a public ABI entry to a private helper
(`core.rs:242-249`); `deposit(uint256)` is now the only intake entrypoint, always self-deposit
(`payer == user == msg.sender`, `core.rs:149-152`). Lemon integrates via the CoinFlip fallback
instead: one-time `USDC.approve(core, amount)`, then `core.deposit(amount)` per deposit.

**Every finding this deletion makes moot:**

- **P-I1** (periphery's belief about "USDC" never reconciled with the core's) — MOOT, the
  periphery no longer exists; there is nothing left to reconcile.
- **P-I2** (Permit2 signature-shape gate silently excludes EIP-1271/smart-contract-wallet
  signers) — MOOT, there is no Permit2 intake path at all anymore.
- **P-I3** (no sweep/rescue path on a partial pull) — MOOT, the periphery that could have held a
  partial pull no longer exists.
- **D-19 residual risks #1–#3** (periphery transient-balance zeroing, disabled-adapter revert
  leaving nothing stranded, permissionless dust-deposit not poisoning the offset) — the first two
  were periphery-specific and no longer apply; the third exercised `deposit_for`'s
  third-party-credit path directly, which is no longer reachable from outside the contract
  (`deposit_for` is private, only ever called by `deposit()` with `user == msg.sender`).

- **Evidence:** `core.rs:242-249` (`deposit_for`'s doc comment recording the demotion),
  `core.rs:149-152` (`deposit`), `docs/known-issues.md`'s `PERMIT2-REMOVED` entry,
  `docs/security/adversarial-review/cross-reference.md`'s Periphery partition closing note,
  `docs/TESTNET.md` (redeployed rig, no periphery contract, no `TESTNET_PERIPHERY_ADDR`).
- **Disposition: MOOT.** Recorded as the historical record of what the blind review found in the
  periphery while it existed; none of P-I1/P-I2/P-I3/D-19#1-3 require further action.

---

## 12. Deferred / accepted informational findings

- **KI-02 — a throttled protocol blocks that user's whole exit (D-09, inherited F12 D-06).**
  **Status: ACCEPTED (AR-02).** Whole-tx atomicity means one throttled adapter reverts the user's
  entire `redeem`/`rebalance`, not just that leg. Best-effort partial exit was rejected twice: it
  breaks the `delta == owed` reconciliation. The blind review's C-H2 independently traced the same
  shape and rated it HIGH by blast-radius framing ("100% of a diversified user's funds frozen by a
  routine, temporary liquidity dip") — flagged here as worth re-confirming, but the design
  decision (D-09) was made with this exact tradeoff in view, twice, and remains the team's call to
  make, not this review's to overturn. **Disposition: no change, accepted.**
- **KI-01 — stranded USDC in the core (D-10).** **Status: RESOLVED, measured.**
  `dust_accrual_over_n_cycles` measured 0 units stranded over 5 full deposit → rebalance →
  full-bps-redeem cycles (`docs/PROTOCOL-PROBES.md` §`KI-01-DUST`). `sweep()` stays closed per the
  original D-10 rejection, now with data instead of argument alone. **Disposition: RESOLVED.**
- **KI-03 — exact USDC amount on redeem was not provable under TestVM's shared return-data
  buffer.** **Status: RESOLVED.** `two_users_exact_payout_with_different_weights` asserts exact
  payout on the Sepolia rig for two users with disjoint adapters/weights. **Disposition:
  RESOLVED.**
- **KI-04 — the full-throttle revert (KI-02) had no TestVM regression test, by construction.**
  **Status: RESOLVED.** `throttled_adapter_reverts_whole_redeem_and_burns_nothing` re-pointed at
  `redeem(bps)` with a `sharesOf` snapshot assertion, plus two siblings covering both throttle
  shapes (partial and full), all green against the 13a/13b rig. **Disposition: RESOLVED.**

**IN-01/IN-02/IN-03/IN-05 — deferred to F15 (D-10, out of Phase 13's explicit scope), each with
its own reason (`12.1-REVIEW.md`):**

- **IN-01** (`core.rs:185-187`, "unreachable `minted_total.is_zero()` check in `deposit`") —
  provably dead code (`split_by_bps` always routes a non-zero remainder to `slices[0]` when
  `amount > 0`, and `deposit_leg` already reverts `ZeroShares` on a zero mint). **Disposition:
  DEFERRED to F15** — belt-and-braces guard, harmless to leave, revisit only if byte budget gets
  tight enough to want the few bytes back.
- **IN-02** (`core.rs:235,246-253`, needless `Vec` clones in `rebalance`) — a WASM-size
  optimization, not a security defect. **Disposition: DEFERRED to F15** — bundle with any future
  byte-budget hardening pass, not security-blocking.
- **IN-03** (`core.rs:43,256`, `Rebalanced` event omits the new weights) — an indexability/UX gap
  (frontend must poll `weightsOf` instead of reading logs), not a fund-safety issue.
  **Disposition: DEFERRED to F15** — add `WeightsSet` event only if byte budget allows; otherwise
  weight history stays poll-only by design.
- **IN-05** (`share_math.rs:17`, `OFFSET_POW = 10^6` is the low end of the recommended virtual-offset
  range) — a headroom note, not a defect; the classic donation attack is already unprofitable at
  this offset (`inflation_attack_per_adapter_second_depositor_gets_nonzero_proportionate_shares`).
  **Disposition: DEFERRED to F15** — bump to `10^12` only before any real deposit exists (changing
  it with live positions re-prices every share), no action required now.

---

## 13. Mainnet deploy gate (NA, operational)

**Status:** NA — operational gate, not a code control

Zero mainnet deployment without Franco's explicit authorization (D-01, inherited from Phase
12.1). Owner can be pointed at a Safe multisig at deploy time (an ops decision, not a code
change) — `VaultCore`'s `owner` field is a plain `address`, code has no multisig-awareness either
way.

- **ASVS:** V4 Access Control (owner-key custody is an operational control).
- **Disposition: NA**, gate enforced procedurally, not in code.

---

## Sign-off

Reviewed by:
Date:

_(To be completed at Task 2 — Franco's sign-off. Every finding above ends in a written
disposition: FIXED, RETIRED BY DELETION, ACCEPTED (WITH GUARD/RATIONALE), RESOLVED, DEFERRED to a
named phase, MOOT, NA, or REFUTED/no action. No item is open without one.)_
