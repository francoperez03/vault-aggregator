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

Both throttle shapes revert, by two different mechanisms — worth stating explicitly, because they
look asymmetric in `unwind_position` and the asymmetry is what CR-01 exploited:

- **Partial throttle** (`0 < maxWithdraw() < owed`): the leg withdraws `maxWithdraw()` but
  reconciles against the full `owed`, so the measured balance delta falls short and
  `reconcile_credit` reverts `RedeemShortfall`.
- **Full throttle** (`maxWithdraw() == 0`): `unwind_request` returns `None` and the external
  `withdraw` is SKIPPED — calling `withdraw(0)` would revert `ZeroAmount` on a merely-illiquid
  protocol. The share burn above it is unconditional and `owed_total += owed` runs BEFORE the
  skip, so the skipped leg still shows up as a shortfall and reverts the whole tx.

The `owed_total += owed` placement is load-bearing for the second case. Phase 12.1 briefly had it
inside the `if let` (CR-01): a fully-throttled leg then succeeded with the user's shares burned and
nothing paid out, silently redistributing their assets to the other holders in that adapter. Do not
move it back inside the conditional.

**For Phase 13:** if the fork tests show Fluid throttling with real frequency, partial exit and/or
delta-only rebalance are the deferred candidates to reopen.

## KI-03 — Exact USDC amount on redeem is not provable under TestVM

`stylus-test` 0.10.7 shares one return-data buffer across mocked calls inside a single top-level
call, so the two `balanceOf(core)` reads inside `redeem` collapse to the same value. Share-ledger
independence IS proven in TestVM (`two_users_with_different_weights_redeem_only_their_own_position`);
the exact payout is verified on the Sepolia rig instead — the same split F12 adopted.

**For Phase 13:** once the Sepolia rig is redeployed against the 12.1 ABI, extend the e2e suite with
an exact-payout assertion for two users with different weights, closing the gap TestVM leaves open.

**KI-03: RESOLVED — `two_users_exact_payout_with_different_weights`, 2026-07-24, exact payout
asserted on the Sepolia rig.** Two users, disjoint adapters, disjoint weights (A 50/50 on
adapters[0]/[1], B 70/30 on adapters[2]/[3]); each user's redeem payout is asserted with strict
`assert_eq!` against an off-chain replica of `share_math::convert_to_assets`, and each user's
`sharesOf` ledger is asserted byte-identical across the other's exit. The rest of this section
stands as the historical record of why TestVM couldn't reach this case.

## KI-04 — The full-throttle revert (KI-02) has no TestVM regression test, by construction

`stylus-test` 0.10.7 keeps ONE global return-data buffer (`TestVM::state.return_data`), overwritten
at mock-REGISTRATION time. `perform_mocked_*_call` only supplies the return-data *length*; the bytes
every mocked call reads back are the last-registered mock's, from offset 0. So inside a single
top-level call, `adapter.totalAssets()`, `adapter.maxWithdraw()` and `usdc.balanceOf(core)` all
decode the SAME `U256`.

That makes the full-throttle case unreachable under TestVM. Reaching the skipped-leg branch requires
`maxWithdraw() == 0`, which forces `totalAssets() == 0` in the same call, which forces
`owed = slice_shares * (0 + 1) / (total_shares + 10^6) == 0` (floor) since `slice_shares <=
total_shares`. A skipped leg under TestVM therefore ALWAYS has `owed == 0`, and the CR-01 bug — the
`owed` of a skipped leg going missing from `owed_total` — is invisible: zero is zero either way.
Forcing `owed > 0` needs `slice_shares >= total_shares + 10^6`, which underflows the
`total_shares - slice_shares` burn and panics in a debug build. Same reasoning rules out the partial
throttle case (`max == totalAssets` in every mocked call, so `max < owed` is unreachable).

What guards it instead:

- `unwind_request_skips_zero_and_throttled` (unit) pins the pure half: `max_withdraw() == 0` yields
  `None`, i.e. the leg IS skipped while the burn above it lands.
- `throttled_adapter_reverts_whole_redeem_and_burns_nothing` in
  `packages/contracts/adapter-e2e/tests/sepolia_edge_cases.rs` pins the end-to-end half on a real
  chain: `MockVault::setWithdrawCap(0)` freezes one leg, the redeem reverts, and the identical
  redeem succeeds once the cap clears — which is only possible if the failed attempt burned nothing.

**For Phase 13:** this e2e test is the CR-01 regression gate. It currently binds the F12 ABI
(`redeem(uint256 shares)`); when the rig is redeployed against the 12.1 ABI it must be re-pointed at
`redeem(uint256 bps)` and re-run, with an added `sharesOf(user, adapter)` assertion proving the
position is intact after the reverted attempt. Do not close Phase 13 with this test unported.

**KI-04: RESOLVED — `throttled_adapter_reverts_whole_redeem_and_burns_nothing` re-pointed at
`redeem(bps)` with a `sharesOf` snapshot assertion, 2026-07-24, green against the 13a rig.** Both
throttle shapes D-07 requires are now covered by name: the same test above (full throttle, cap 0
on adapter 0) plus two siblings in `sepolia_edge_cases.rs` —
`partial_throttle_reverts_with_shortfall_instead_of_paying_less` (D-07.1, cap strictly between 0
and the owed amount) and `full_throttle_skips_the_leg_but_still_reverts` (D-07.2, the CR-01 shape
repeated on a second adapter so it carries no state dependency on the KI-04 test). All three assert
`sharesOf(caller, adapter)` byte-identical across the reverted attempt on every adapter, and accept
either `WithdrawExceedsMax` or `RedeemShortfall` by name, never a bare "reverted".
