# Blind Adversarial Review - Cross-Reference (D-14)

## Thesis

Phase 12.1's threat register (`12.1-SECURITY.md`) declared 22 threats closed, `threats_open: 0`,
verified. That audit ran *after* `12.1-REVIEW.md` had already found and fixed a real, exploitable
defect (CR-01: a fully-throttled adapter burned a user's shares and paid nothing) in the exact
invariant the threat register claimed to protect (T-12.1-13/T-12.1-14, ledger conservation and CEI
reentrancy safety). A threat model that says an invariant is proven can still have a live bug
underneath it - the code review found it, not the model. That is the precedent D-14 exists to
repeat deliberately: run auditors blind, with no access to the register that says "this is already
covered," and see what surfaces that the prior pass's own framing made invisible.

The rest of this document cross-references `findings-raw.md` (produced with zero access to
`12.1-SECURITY.md`, `12.1-REVIEW.md`, or `known-issues.md`) against those three documents. What
matches is the register confirming its own coverage from a second, independent angle - useful,
but not the point. What is novel is what Phase 12.1's own review, plus everything found empirically
in Phase 13's live e2e work, still missed. That delta is the actual output of this exercise, and it
is what feeds Plan 11's public checklist.

## Method

Every finding in `findings-raw.md` is triaged into exactly one of three states:

- **matches** - a known WR-0*/IN-0*/KI-0*/T-12.1-* item covers the same defect. Noted if the blind
  finding sharpens the vector or if severities diverge.
- **novel** - no prior document names this. These are what the audit missed. Each gets a
  disposition (fix now / accept with rationale / defer to a named follow-up), because Plan 11
  builds the client-facing checklist directly from these dispositions.
- **noise** - traced against the actual codebase (not just the isolated bundle) and found not to
  hold. Refuted with a concrete counter-example per the SOP's rule: no auto-refuting a real bug,
  no silently dropping a wrong one either.

---

## Core partition

### C-H1 - Unprotected `init` allows front-running to steal permanent contract ownership

**Verdict: NOVEL - HIGH - GATE.**

Verified directly against `vault-core/src/core.rs`: `pub fn init(&mut self, owner: Address)` takes
`owner` as a caller-supplied parameter, checked only for `initialized.get()` and `owner.is_zero()`.
No `only_owner()` call, no deployer check of any kind - `only_owner()` itself reads
`self.owner.get()`, which is exactly the field `init` is about to set. Nothing in the 12.1 threat
register addresses `init` at all: T-12.1-04 covers `write_weights`'s access control (confirmed
absent from the exported ABI), not the owner-bootstrap path. `known-issues.md` and `12.1-REVIEW.md`
are silent on `init` entirely - `grep -n "fn init"` across both prior documents returns nothing.
This is not a rediscovery of a known-and-accepted risk; it is a real gap that survived Phase 12.1's
own review and its "verified, 0 open threats" sign-off.

**Why this is a gate, not a routine finding:** per this plan's own threat register (T-13-46) and
the phase's `security_enforcement` policy, a high novel finding blocks phase close. This is that
finding. `VaultCore`'s owner role controls the entire adapter registry (`add_adapter`,
`set_enabled`) for the contract's lifetime with zero recovery path - there is no
`transferOwnership`. A front-run `init` call is total, permanent, irreversible compromise.

**Disposition: FIXED — via a real `#[constructor]`, not the `msg_sender()` self-claim originally
written up here.** The write-up above proposed `owner = self.vm().msg_sender()` inside a still-public
`init`, paired with runbook-level races (priority gas, private mempool submission) to narrow the
front-running window. On reflection that fix does not close the gap, it only shrinks it: an
attacker's transaction can still beat the deployer's `init` call, and "submit with priority gas" is
an operational mitigation, not a guarantee, for a permanent, irreversible takeover with no
`transferOwnership` recovery path.

The fix actually shipped removes the caller-supplied `owner` parameter and the public `init`
entrypoint entirely, replacing them with a real Stylus `#[constructor]` (`vault-core/src/core.rs`)
that sets `owner` atomically as part of the deployment transaction itself — the exact pattern
already proven in this workspace by `vault-periphery/src/router.rs`'s `#[constructor]`. Stylus
constructors run exactly once, at deployment, before the contract address can receive any other
call, so there is no live, callable, unauthenticated bootstrap path left to front-run. This closes
the gap at the protocol level instead of narrowing a race window at the operational level — the
stronger of the two remedies this finding named, and the one actually implemented.

Verified: a new unit test (`no_public_method_other_than_constructor_can_set_owner`) proves no
post-deploy method can set or reassign `owner`; `cargo test --workspace --lib` is green; measured
WASM size is 20,681 bytes / 1 fragment, comfortably under the 22,528-byte Arbitrum One gate
(`docs/wasm-size.md`). The Sepolia rig (core, periphery, 4 adapters, 4 MockVaults — a new core
invalidates the whole rig under the one-shot adapter `init(vault, core)` binding and the
periphery's constructor-wired `core` address) was fully redeployed against the fixed core, and all
16 live e2e tests re-ran green against it. This closes before Phase 13 sign-off, per the gate this
finding names.

### C-M1 - Entry-path "shortfall guard" (`DEPOSIT_TOLERANCE_BPS`) is a tautology

**Verdict: MATCHES WR-02 (T-12.1-11/T-12.1-13, `known-issues.md` WR-02, `12.1-REVIEW.md` WR-02).**

This is the same defect, reached the same way (recomputing `convert_to_assets` from the assumed
post-deposit totals rather than a fresh delta) and demonstrated with the same 50%-haircut shape as
`12.1-REVIEW.md`'s own WR-02 write-up. Worth stating explicitly: **this is convergent evidence, not
independent noise.** A blind auditor with only the pasted Rust and no prior context reached the
identical structural conclusion that Phase 13 Plan 08 reached empirically on live Sepolia
infrastructure (`docs/known-issues.md` WR-02, `docs/PROTOCOL-PROBES.md` `WR-02-DILUTION`): live
testing found the underlying `MockVault`'s own `ZeroShares` guard fires first (a stricter guard
catching the same condition earlier), and the measured dilution below tolerance is small (0.5% per
the Plan 08 write-up). Two completely different methods - a blind code-only auditor with the
Feynman/asymmetry lens, and a live on-chain probe - landed on the same root cause. That agreement is
itself a useful signal for the client-facing checklist: this is a genuinely well-understood,
already-quantified risk, not a corner nobody looked at.

**Disposition: no change.** Already dispositioned in `known-issues.md` as "ACCEPTED WITH GUARD" with
measured data. Nothing in the blind run adds a new attack surface beyond what WR-02 already covers.

### C-M2 - `redeem()` permanently reverts on a zero/dust position while `rebalance()` silently clears it

**Verdict: NOVEL - MEDIUM.**

Verified against `core.rs`: `redeem` computes `paid = self.unwind_position(user, bps)?` then
`if paid.is_zero() { return Err(errors::zero_amount()) }` - and this check runs AFTER
`unwind_position`'s unconditional share burn, so the revert undoes the burn (standard atomic
revert), leaving the position stuck. `rebalance` runs the identical `unwind_position` call but its
own caller code is `if proceeds.is_zero() { ...; return Ok(()) }` - no revert, so the burn from that
call sticks. Neither `known-issues.md`, `12.1-REVIEW.md`, nor `12.1-SECURITY.md` document this
specific `redeem`-reverts-forever / `rebalance`-clears-silently divergence for a zeroed or
dust-valued position; KI-02 is the closest neighbor but is about protocol-side throttling
(`maxWithdraw() == 0` on a live, non-zero position), not about a position whose *reconciled owed
value* itself floors to zero. This is a genuinely new observation.

**Disposition: FIX NOW (cheap).** The user's economic outcome is correctly zero either way - no
funds are at risk - but a frontend or user who only wires up `redeem()` has no way to clear a
zeroed ledger entry, and the workaround (`rebalance`) is not documented or named as an exit
mechanism. Recommended fix: change `redeem`'s zero-paid check to only revert when
`unwind_position` burned nothing (i.e., distinguish "no position existed to redeem" from "a
position existed and burned to a reconciled value of zero"), so the zero-valued-but-real burn
commits instead of reverting. This is a small conditional change, not an architectural one. If
deferred instead, the "always reachable via redeem/rebalance" claim in the code's own doc-comments
must be corrected to name `rebalance` explicitly as the dust-clearing path.

### C-H2 - Single illiquid adapter freezes a user's entire cross-adapter position

**Verdict: MATCHES KI-02 / AR-02 / T-12.1-15.**

This is the FLUID-THROTTLE scenario already named in `known-issues.md` KI-02 and accepted as
`AR-02` in `12.1-SECURITY.md` ("A fully or partially throttled adapter reverts that user's whole
redeem/rebalance rather than attempting a best-effort partial exit... Partial exit was rejected
twice"), backed by design decision D-09. The blind auditor's trace (900 USDC healthy in adapter A,
100 USDC frozen in adapter B, full redeem reverts atomically, victim gets zero) is the same shape
KI-02 already documents and the same tradeoff AR-02 already accepts.

**Severity note worth flagging for Plan 11's checklist, even though this is a match:** the blind
run rates this HIGH (flow-gap lens: "100% of funds frozen... triggered purely by a routine,
temporary liquidity dip"); the prior register's disposition is `accept`, not `mitigate`, and
`T-12.1-15`'s severity in the STRIDE table is not separately re-graded against this framing. This is
not a new finding, but it is a legitimate prompt to re-confirm the accept-disposition still holds
given how starkly the blind auditor states the blast radius (100% of a diversified user's funds,
not just the illiquid leg's share). No action required beyond flagging: the design decision (D-09)
was made with this exact tradeoff in view, twice, and remains the team's call to make, not this
review's to overturn.

### C-I1 - Reentrancy identity-manipulation angle, no finding

**Verdict: MATCHES IN-04.** Consistent with the prior review's own conclusion: `stylus-sdk`'s
`reentrant` feature is off, and the accepted-tradeoff framing (`total_assets_before` snapshotted
once, never re-verified) is the same TOCTOU gap IN-04 already names. No new surface.

---

## Sharemath partition

### S-H1 - Donation-primed zero-share mint ("transfer whole deposit to attacker")

**Verdict: NOISE - REFUTED with a concrete counter-example.**

The finding is pure-math correct in isolation (`share_math.rs:convert_to_shares` really does return
`0` for the traced inputs) but the numerical-gap lens only had `share_math.rs` in its bundle, not
the caller. Checked against the actual caller, `core.rs:deposit_leg`:

```rust
let minted = share_math::convert_to_shares(slice, ts, total_assets_before, share_math::OFFSET_POW)?;
if minted.is_zero() {
    return Err(errors::zero_shares());
}
```

This check runs immediately after the external `adapter_dispatch::deposit(...)` call that actually
moves the victim's USDC into the adapter, but Stylus/EVM revert semantics undo external call effects
transaction-wide: when `minted.is_zero()` triggers `Err(errors::zero_shares())`, that error
propagates via `?` through `deposit_leg` into `deposit_for`'s per-leg loop
(`minted_total += self.deposit_leg(user, targets[i], slices[i], ta_before[i])?`), and the ENTIRE
`deposit_for` transaction reverts - including the `adapter_dispatch::deposit` call that had already
transferred the victim's 500,000 wei. Concrete trace against the finding's own numbers: `minted =
floor(500_000 * 2_000_000 / 1_000_000_000_001) = 0`, so the very next line in `deposit_leg` reverts
the call with `ZeroShares`, before any of the mint-side bookkeeping the finding describes ever
executes, and before the victim's funds are anything other than temporarily in-flight inside a
transaction that never commits. The victim's wallet balance is unchanged, and the attacker gains
nothing from this specific attempt - they must retry with a larger deposit that clears the
zero-mint floor, at which point the (real, but separately quantified) WR-02-style dilution applies,
not a full-value transfer.

This also independently corroborates `12.1-REVIEW.md`'s own IN-01 finding ("the caller already
guards zero-mint at the point of use") from the opposite direction: IN-01 observed the *aggregate*
`minted_total.is_zero()` check in `deposit_for` is unreachable because `deposit_leg`'s *per-leg*
`minted.is_zero()` check already fires first. That per-leg check is precisely the guard that closes
this blind finding.

**Disposition: no action.** Refuted, not merely low-confidence - the caller-side guard is
unconditional and reachable on every code path that would trigger this scenario.

### S-M1 - `split_by_bps` on an empty `weights_bps` silently drops the entire `amount`

**Verdict: NOVEL - MEDIUM, but confirmed unreachable via the only caller in this codebase.**

Checked against `core.rs:write_weights`, the sole path that produces the `weights_bps` slice fed to
`split_by_bps`: `if adapters.is_empty() || adapters.len() != weights_bps.len() { return
Err(errors::allocation_invalid()); }` runs before anything is written, so an empty weights array can
never be persisted, and `read_weights(user)` (the only source `deposit_for`/`rebalance` read from)
can therefore never hand `split_by_bps` an empty slice today. All three lenses that found this
(numerical-gap, invariant, boundary) independently reached the same downgrade-to-lead-strength
conclusion for the same reason: the guard lives outside `share_math.rs` and none of them could see
it from an isolated bundle. Verified now: the guard exists, is unconditional, and the function is
genuinely unreachable with this input via any live entrypoint. Not documented anywhere in the prior
register - this is a novel defense-in-depth observation, not a novel live exploit.

**Disposition: FIX NOW (cheap, non-blocking).** One-line change
(`if weights_bps.is_empty() { return Err(errors::allocation_invalid()); }` at the top of
`split_by_bps`) turns a silent-`Ok` footgun into an explicit revert, at effectively zero byte cost,
and removes the fragility the three lenses flag (a future caller or refactor that loosens the
"always non-empty" precondition would otherwise reintroduce a silent fund-accounting gap with zero
observability). Not a gate - not reachable today, no severity escalation - but cheap enough that
there is no reason to defer it past Phase 13's own hardening pass (the same pass that already
closed WR-01/WR-04 pre-emptively).

### S-M2 - `convert_to_shares` / `convert_to_assets` entry vs exit pricing asymmetry (yield front-run) - CONFIDENCE-LIMITED

**Verdict: REFUTED, with arithmetic.** The invariant lens explicitly flagged its own uncertainty:
whether `convert_to_shares`'s `total_assets` argument is genuinely a stale/cached figure that can
trail the adapter's real yield-bearing balance, or simply "read live, but before this deposit's own
effect is applied" (correct, not exploitable) - and said the calling contract was out of scope for
that bundle's verdict. Checked directly against `core.rs`, the calling contract:

- `deposit_for` builds `ta_before` via `adapter_dispatch::total_assets(self.vm(), *adapter)` - a
  live external `staticcall` to the adapter, executed at the top of the SAME transaction, immediately
  before the USDC pull and before any adapter deposit call. This is not a stored/cached figure
  anywhere in contract storage; `VaultCore` has no persistent `total_assets` field at all (deleted in
  Phase 12.1 per T-12.1-11's mitigation note - `grep total_shares.get()` on a scalar field returns
  nothing).
- `unwind_position` reads `ta = adapter_dispatch::total_assets(self.vm(), adapter)` - the identical
  external call, live, at the point of use, inside the SAME atomic redeem transaction.

Both sides of every round-trip read the SAME kind of value (a fresh external call to the adapter,
at the moment each function needs it) - there is no cached/stored figure on either side that can
trail real yield accrual between the deposit and the redeem read. The premise the invariant lens
flagged as unverifiable ("snapshotted BEFORE... vs read live... at withdrawal time" implying two
different data sources) does not hold: both are live reads, the only difference is *when within the
transaction* each is taken relative to that transaction's own mutating calls, which is the
documented, deliberate anti-self-dilution ordering (`deposit_for`'s comment: "protects against
minting against a post-deposit total_assets, which would dilute the depositor against their own
funds") - not a yield-skimming gap against OTHER holders. A genuine 10%-in-one-atomic-transaction
yield jump, as the finding's numbers assume, is not how interest-accruing lending protocols behave
within a single block/transaction; nothing in this codebase creates the two-different-clocks
condition the exploit requires.

**Disposition: no action.** The confidence-limited premise is refuted by the caller code the
originating lens correctly identified as out of its own scope. No fix needed; no follow-up plan
required.

---

## Periphery partition

### P-I1 - Periphery's belief about "USDC" never reconciled with the core's belief

**Verdict: NOVEL - INFO.** Not addressed anywhere in `12.1-SECURITY.md`/`known-issues.md` (periphery
did not exist in Phase 12.1's scope). Confirmed structurally accurate: `USDC` in `core.rs` is a
compile-time constant with no public getter, so a constructor-time cross-check in
`vault-periphery` would require adding new ABI surface to the core purely for this check, a byte
cost against a deploy-time-only, non-attacker-reachable invariant.

**Disposition: ACCEPT WITH RATIONALE.** Given the WASM byte budget this program operates under
(documented gate discipline in `docs/wasm-size.md`), adding a getter + cross-check for a failure
mode that (a) requires an operator deploy-script mistake, not attacker input, and (b) fails loud and
total (every deposit reverts, easily caught in the first post-deploy smoke test) rather than silent,
is not worth the byte cost. Defer to the deploy runbook: add an explicit pre-flight check
("periphery's configured `usdc` == core's known `USDC` constant, verified off-chain before wiring
the frontend") to the Sepolia/mainnet deploy checklist.

### P-I2 - Signature-shape gate silently excludes EIP-1271 (smart-contract-wallet) signers

**Verdict: NOVEL - INFO.** Genuinely new; nothing in the prior register discusses Permit2 signature
shape or smart-contract-wallet support (out of Phase 12.1's scope).

**Disposition: ACCEPT WITH RATIONALE.** Not a fund-loss or fund-stranding bug - the call simply
reverts, nothing moves. This is a UX/compatibility scope decision (EOA-only Permit2 flow) rather
than a defect. Worth one line in the public-facing docs so the "canonical Permit2 SignatureTransfer
flow" claim is scoped accurately (EOA-signature-only, not Safe/ERC-1271-compatible) - a docs fix,
not a code fix. If Safe/multisig support becomes a product requirement later, that is a scoped
follow-up (accept `signature.len() != 65` as a known limitation until then).

### P-I3 - No sweep/rescue path if the core ever pulls a partial amount

**Verdict: NOVEL - INFO, not reachable today.** New observation (periphery is out of Phase 12.1's
scope); confirmed not reachable against the current `deposit_for`, which always pulls the entire
`amount` in one `transfer_from` before any adapter interaction, so no partial-pull path exists to
trigger it.

**Disposition: ACCEPT, defer to a named follow-up.** Zero action today. If a future core revision
introduces partial-fill or fee-taking deposit semantics, that same change must add a sweep/rescue
mechanism to the periphery in the same PR - record this as an explicit dependency for whichever
future plan touches `deposit_for`'s pull semantics, so it is not rediscovered from scratch.

### Closing note — the periphery contract has been removed (post-13b, pre-checklist)

CoinFlip (M1) empirically proved Lemon cannot perform Permit2 signature substitution (the
server-side placeholder mechanism fails, Permit2 is not an allowed entrypoint inside Lemon's
sandbox). `vault-periphery`'s `depositWithPermit2` existed solely to let Lemon use that exact
mechanism, so it had no working consumer. The periphery crate, its Permit2 binding, and the core's
now-orphaned permissionless `deposit_for(user, amount)` entrypoint have all been deleted; Lemon
integrates via the CoinFlip fallback (`approve` once, then `core.deposit(amount)` per deposit).

**P-I1, P-I2 and P-I3 above are now MOOT** - the contract they describe no longer exists. There is
no periphery balance to reconcile (P-I1), no Permit2 signature shape to gate on (P-I2), and no
periphery to add a sweep/rescue path to (P-I3). This partition's three findings stand as the
historical record of what the blind review found in the periphery while it existed; none require
further action. See `docs/known-issues.md`'s `PERMIT2-REMOVED` entry for the full disposition.

---

## Final count

| State | Count | IDs |
|---|---|---|
| matches | 4 | C-M1 (WR-02), C-H2 (KI-02/AR-02/T-12.1-15), C-I1 (IN-04) |
| novel | 6 | C-H1 (HIGH, gate — FIXED via `#[constructor]`), C-M2 (MEDIUM), S-M1 (MEDIUM, unreachable-today), P-I1 (INFO), P-I2 (INFO), P-I3 (INFO) |
| noise (refuted) | 2 | S-H1 (donation zero-mint, refuted by `deposit_leg`'s zero-shares guard), S-M2 (yield-skim, refuted - both sides read live, no cached figure) |

**Novel findings are what Phase 12.1's review, plus everything found empirically through Phase 13's
live e2e work, still missed.** One of them is HIGH:

**C-H1 (unprotected `init`, permanent ownership takeover by front-running) was a blocking gate — now
FIXED** via a real `#[constructor]` (see its disposition above, and `docs/known-issues.md`'s C-H1
entry). Every other novel finding is
medium or info and does not block; C-M2 and S-M1 have cheap, non-architectural fixes recommended
for the same hardening pass that already closed WR-01/WR-04, while the periphery info items are
scope/documentation decisions, not defects.

This is not a case of "the blind run found nothing new" - had it been, that would also have been a
valid, honest result per this plan's own instructions. It found one real, high-severity gap that a
fully "verified, 0 open threats" prior audit missed, which is exactly the D-14 thesis playing out a
second time on a second codebase surface.
