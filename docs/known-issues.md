# Known issues — carried into Phase 13's security review

## KI-01 — Stranded USDC in the core (D-10)

A user's `rebalance` re-splits only the balance delta measured inside `unwind_position` for their
own legs. It never reads `balanceOf(core)`. Consequence: surplus capped by `reconcile_credit`
(a donation, a sandwich, adapter rounding in the core's favour) accumulates in the core and no code
path moves it. This is deliberate: sweeping the full core balance from a user path is the theft
vector of the per-user model, and an owner-only `sweep()` was rejected (bytes, plus an owner
function that moves funds is exactly the surface a review scrutinises).

**For Phase 13:** quantify how much dust actually accrues. If it is material, `sweep()` is the
deferred candidate to reopen — with data.

## KI-02 — A throttled protocol blocks that user's whole exit (D-09, inherited F12 D-06)

Whole-tx atomicity means one throttled adapter (FLUID-THROTTLE, see `PROTOCOL-PROBES.md`) reverts
the user's entire `redeem` or `rebalance`, not just that leg. Under the pooled model this blocked
the pool; under the per-user model it blocks the individual user until the protocol frees liquidity.
Best-effort partial exit was rejected twice: it breaks the `delta == owed` reconciliation.

**For Phase 13:** if the fork tests show Fluid throttling with real frequency, partial exit and/or
delta-only rebalance are the deferred candidates to reopen.

## KI-03 — Exact USDC amount on redeem is not provable under TestVM

`stylus-test` 0.10.7 shares one return-data buffer across mocked calls inside a single top-level
call, so the two `balanceOf(core)` reads inside `redeem` collapse to the same value. Share-ledger
independence IS proven in TestVM (`two_users_with_different_weights_redeem_only_their_own_position`);
the exact payout is verified on the Sepolia rig instead — the same split F12 adopted.

**For Phase 13:** once the Sepolia rig is redeployed against the 12.1 ABI, extend the e2e suite with
an exact-payout assertion for two users with different weights, closing the gap TestVM leaves open.
