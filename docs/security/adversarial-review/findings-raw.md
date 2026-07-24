# Blind Adversarial Review - Raw Output (D-14)

## Method note

Twelve independent sub-agents ran, four per partition, each reading only its hand-built bundle
(`bundle-core.md`, `bundle-sharemath.md`, `bundle-periphery.md`) plus its assigned lens file from
`.claude/skills/solidity-auditor/references/hacking-agents/`. None of them had access to any prior
threat register, security review, or known-issues document. Each agent applied the
Feynman/Socratic/Inversion protocol from `senior-auditor-sop.md` (pasted into its bundle) before
attacking with its named lens.

| Partition | Bundle | Lenses run |
|---|---|---|
| core | `bundle-core.md` (`core.rs`, `registry.rs`, `adapter_dispatch.rs`, `usdc.rs`, `errors.rs`) | access-control, execution-trace, asymmetry, flow-gap |
| sharemath | `bundle-sharemath.md` (`share_math.rs` isolated) | math-precision, numerical-gap, invariant, boundary |
| periphery | `bundle-periphery.md` (`vault-periphery/src/*.rs` + `deposit_for` context) | trust-gap, periphery, first-principles, economic-security |

This document is the record of that blind run as it came out, before anything was
cross-referenced against prior work. It is not edited after the cross-reference pass
(`cross-reference.md`) is written.

Totals: 3 high, 6 medium, 4 info (one medium collapsed from three lenses converging on the same
`split_by_bps` gap by different reasoning paths).

---

## Core partition

### HIGH

#### C-H1 - Unprotected `init` allows front-running to steal permanent contract ownership
- **location**: `core.rs:init` (blast radius: `add_adapter`, `set_enabled`, everything gated by `only_owner`)
- **lens**: access-control
- **attack (traced)**: `init(owner)` runs as a second, un-atomic transaction after `cargo stylus
  deploy`. It has zero access-control guard, not even an implicit deployer check, and sets `owner`
  on first call with no revert path afterward (no `transferOwnership`). An attacker watching the
  mempool/RPC for the newly deployed address submits `init(attacker_address)` before the deployer's
  own `init(deployer_address)` lands. The deployer's legitimate call then hits `already_initialized`
  and reverts permanently, no recovery. The attacker, now permanent owner, calls
  `add_adapter(evil_adapter)` (zero behavioral validation, only `is_zero()` + not-already-registered
  checks), enables it by default, and any victim who calls `rebalance`/`deposit` against that
  adapter has their USDC pulled via `transferFrom` and kept by the attacker's contract while the
  victim is minted shares that price against a number the evil adapter reports arbitrarily.
- **impact**: total, permanent takeover of the contract's owner role by transaction-ordering alone;
  from there, full control of the adapter registry and enable/disable switch for the contract's
  entire lifetime, and direct total loss of any deposit routed through the attacker's adapter.

### MEDIUM

#### C-M1 - Entry-path "shortfall guard" (`DEPOSIT_TOLERANCE_BPS`) is a tautology; it can never detect real under-crediting, unlike the exit path
- **location**: `core.rs:deposit_leg` (contrasted with `core.rs:unwind_position`)
- **lens**: asymmetry
- **attack (traced)**: the exit path (`unwind_position`) measures a real observed USDC balance
  delta before/after `adapter.withdraw()` and reverts on shortfall, ungameable. The entry path's
  guard instead recomputes `value_back = convert_to_assets(minted, ts + minted, total_assets_before
  + slice, OFFSET_POW)`, feeding it the assumed post-deposit totals, never a fresh
  `adapter_dispatch::total_assets()` read taken after the deposit call. This guarantees `value_back`
  reconstructs back to (approximately) `slice` regardless of what the adapter actually did with the
  money. Concrete trace (`OFFSET_POW = 1`): adapter at `ts=1000`/`total_assets=1000` (1:1), user
  deposits `slice=100`, underlying protocol takes a 50% haircut so real `total_assets()` after is
  `1050` not `1100`. `minted = floor(100*1001/1001) = 100`. `value_back = floor(100*1101/1101) =
  100`. Guard's floor threshold is `floor(100*9900/10000) = 99`; `100 >= 99` passes.
  `DepositShortfall` never fires, yet the real exchange rate is now `1050/1100 = 0.9545`, silently
  diluting every existing holder (900 pre-existing shares drop from a 900 USDC claim to 859.09 USDC)
  with zero observability.
- **impact**: the code's own doc-comment (`core.rs:433-440`) claims this guard turns silent dilution
  into a loud revert, that claim does not hold structurally. Any adapter that legitimately returns
  less than face value on deposit (entry fee, slippage, a wrapped-4626 rounding dip) dilutes every
  existing holder pro rata with the safety net never engaging, worse than having no guard because
  the team is relying on this as their live signal.

#### C-M2 - `redeem()` permanently reverts on a zero/dust-valued position while `rebalance()` silently clears the identical position, breaking the "always reachable" exit invariant
- **location**: `core.rs:redeem` / `core.rs:unwind_position`, contrasted with `core.rs:rebalance`
- **lens**: execution-trace
- **attack (traced)**: both `redeem` and `rebalance` route through `unwind_position`, which
  unconditionally burns shares before the conditional withdraw and returns the sum of `owed`
  reconciled against measured balance delta. Trace: user deposits 1,000 USDC into adapter A
  (`adapter_total_shares[A]=1000`, `user_shares=1000`). A's underlying protocol takes a total loss;
  `adapter.total_assets() = 0`. User calls `redeem(10000)`: `owed = convert_to_assets(1000,1000,0,
  OFFSET) = 0`, burn executes unconditionally, `owed_total += 0`, `max_withdraw = 0` so withdraw is
  skipped, `balance_after - balance_before = 0`, `reconcile_credit(0,0)=0`, `paid=0` triggers
  `if paid.is_zero() { return Err(zero_amount()) }`, the whole transaction, including the burn,
  reverts. Every subsequent `redeem(10000)` call replays identically and reverts forever. Calling
  `rebalance([A],[10000])` instead runs the identical computation (`owed_total=0`, burn goes
  through) but `rebalance`'s caller code returns `Ok(())` on zero proceeds instead of reverting, so
  the burn sticks and the position is cleared silently, through a function whose own doc-comment
  says it's "the ONLY way to write weight preference," not documented as an exit path. Not limited
  to total loss: any sufficiently small/dust position (nonzero shares, nonzero backing) floors
  `owed` to 0 for the same reason via the virtual-offset rounding.
- **impact**: the bundle's stated invariant ("a user's position in ANY adapter must always be
  reachable via redeem/rebalance") is only half true, `redeem`, the only function that actually
  calls `usdc::transfer`, is permanently unusable the moment a position floors to zero value. A
  frontend or user wiring up only `redeem()` as the exit button has no way to clear a dust/zeroed
  position; the workaround (`rebalance`) is undiscoverable from its own naming/documentation.

#### C-H2 - Single illiquid adapter freezes a user's entire cross-adapter position, including healthy legs
- **location**: `core.rs:unwind_position` (shared exit primitive, reached from both `redeem` and `rebalance`)
- **lens**: flow-gap
- **seam**: periphery x first-principles, an individually honest external return
  (`maxWithdraw() == 0` on one registered adapter, a routine state for a lending-protocol wrapper at
  high utilization) combines with the core's all-or-nothing reconciliation design to defeat the
  stated "always reachable" guarantee.
- **attack (traced)**: victim sets weights `[A,B] = [9000,1000]`, deposits 1,000 USDC, 900 into A,
  100 into B, both legs succeed. B's underlying protocol later reports `maxWithdraw() == 0` (a
  routine, honest, temporary liquidity condition the code's own doc-comment anticipates). Victim
  calls `redeem(10000)`: `unwind_position` walks the full registry filtered only by nonzero
  `user_shares`, cannot skip B. Leg A: `owed_A ~ 900`, shares burned, `withdraw(900)` succeeds,
  balance +900. Leg B: `owed_B ~ 100`, shares burned unconditionally, `owed_total += 100` (now
  1000), but `max_withdraw(B)=0` so `withdraw` is skipped, no USDC moves for that leg. After the
  loop: `actual_delta = 900`, `owed_total = 1000`, `reconcile_credit(1000,900)` sees the shortfall
  and returns `Err(RedeemShortfall)`, the whole transaction, including A's successful 900 USDC
  withdrawal and both share burns, reverts atomically. Victim gets zero USDC. Reducing bps doesn't
  help (any bps>0 touches every held adapter proportionally, no per-adapter selection on the public
  surface). No owner-side escape (`set_enabled(false)` only blocks new deposits; exit path ignores
  enabled/disabled status).
- **impact**: any user who diversifies across more than one adapter, the aggregator's entire stated
  purpose, can have 100% of their funds frozen (not just the illiquid leg's share) by a routine,
  temporary liquidity dip in a single adapter they may hold only a small allocation in. No
  partial-redeem-per-adapter entrypoint, no admin remediation path.

### INFO

#### C-I1 - Reentrancy across adapter calls: identity-manipulation angle traced and found closed
- **location**: `core.rs:deposit_for`, `core.rs:unwind_position`, `core.rs:deposit_leg`
- **lens**: execution-trace
- Traced and ruled out: `redeem`/`rebalance` use `msg_sender()` directly, never an attacker-supplied
  parameter, so a reentrant call from an adapter executes as `user = adapter's own address`, which
  holds no shares of its own. `deposit_leg`'s approval is scoped per-adapter and adapters can't
  repeat within one call (`write_weights` rejects duplicates). Every post-external-call read is
  fresh, not a stale snapshot. `deposit_for`'s `user` parameter can be abused to credit a third
  party from the reentrant caller's own funds, but never to debit one (core never grants approvals
  to adapters). No concrete victim/asset-loss trace found for the identity/allowance-reentrancy
  angle specifically; the separate asymmetric-pricing TOCTOU gap (`total_assets_before` snapshotted
  once, never re-verified) is out of this lens's assignment and flagged as an already-accepted
  tradeoff in the source's own comments.

---

## Sharemath partition

### HIGH

#### S-H1 - Donation-primed ratio makes `convert_to_shares` mint exactly zero shares for a legitimate-size deposit, transferring it whole to the existing shareholder
- **location**: `share_math.rs:convert_to_shares`, weaponized via a direct-donation vector the
  module's own `reconcile_credit` comment anticipates
- **lens**: numerical-gap (seam: boundary x precision)
- **attack (traced)**: attacker is first depositor with `assets=1` wei
  (`total_shares=0,total_assets=0`), so `shares = floor(1*(0+1_000_000)/(0+1)) = 1_000_000`.
  Attacker then donates `999_999_999_999` wei directly to the adapter (raw balance credit, not
  through `convert_to_shares`, explicitly anticipated by the module's own doc comment on
  `reconcile_credit`). State: `total_shares=1_000_000` (unchanged), `total_assets=1_000_000_000_000`
  (1,000,000 USDC). A victim deposits an ordinary `500_000` wei (0.5 USDC):
  `shares = floor(500_000 * 2_000_000 / 1_000_000_000_001) = floor(0.999999999999) = 0`. The
  victim's 500,000 wei is absorbed into `total_assets` but they are minted zero shares,
  `total_shares` stays at 1,000,000, all attacker-owned. The attacker later redeems against the now
  larger `total_assets` and walks away with their donation plus the victim's deposit, for free.
- **impact**: straight fund theft, not mitigated first-depositor dilution, a full, silent value
  transfer with no revert, repeatable against every under-threshold depositor until someone deposits
  enough to push the ratio back down. Threshold scales with attacker capital (~2x target deposit
  per unit of `OFFSET_POW` ratio); realistic against sub-1-USDC deposits.

### MEDIUM

#### S-M1 - `split_by_bps` on an empty `weights_bps` silently drops the entire `amount`, no error (converged from three lenses: numerical-gap, invariant, boundary)
- **location**: `share_math.rs:split_by_bps`
- **lenses**: numerical-gap, invariant, boundary. All three reached this independently; reasoning
  preserved per-lens since each frames the seam differently.
- **numerical-gap framing** (boundary x invariant seam): the invariant "sum(slices) == amount" is
  enforced by shoving the leftover remainder into `slices[0]`, but the early-exit-shaped boundary
  case of an empty weights array has no `slices[0]` to receive it. Per the bundle's own caller-side
  notes, `split_by_bps` trusts the caller to have already validated `sum(weights_bps) == 10_000`
  (which an empty array fails, since sum==0), so today's single caller may never hit this path,
  downgraded to medium/lead-strength rather than confirmed live exploit, since the guarding
  validation lives outside this bundle.
- **invariant framing**: unlike every overflow/div-by-zero path elsewhere in the file, this failure
  mode returns `Ok` instead of `Err`. Fix suggested as one line:
  `if weights_bps.is_empty() { return Err(...) }`.
- **boundary framing**: frames it explicitly as the empty-slice corner case of the
  `weights_bps: &[U256]` input, and notes the doc comment's "always, with no dust lost or created"
  guarantee is violated at exactly this corner with no signal.
- **attack (traced, shared across all three)**: call `split_by_bps(1_000_000, &[])`. Loop body
  never runs (`weights_bps.len()==0`), `allocated` stays `0`. `remainder = amount - allocated =
  1_000_000`. `if let Some(first) = slices.first_mut()` matches `None` (empty vec), so the
  `remainder` is silently discarded. Function returns `Ok(vec![])` for a nonzero `amount` with no
  error.
- **impact**: if any caller path can reach this with a zero-length active-adapter list (all adapters
  temporarily deactivated during a rebalance, or a future caller that doesn't yet enforce "always
  >=1 active adapter"), the deposited/rebalanced amount vanishes from accounting with `Ok(())`
  returned rather than a revert, silent fund loss or funds stranded in the core with no share-ledger
  entry crediting anyone.

#### S-M2 - `convert_to_shares` / `convert_to_assets` entry vs exit pricing asymmetry (yield front-run) - CONFIDENCE-LIMITED
- **location**: `share_math.rs:convert_to_shares` / `share_math.rs:convert_to_assets`, per the
  bundle's own "Caller-side context" notes
- **lens**: invariant (coupled state-price reads across mutating paths)
- **attack (traced)**: the bundle's caller-side notes state `convert_to_shares` is fed a
  `total_assets` value "snapshotted BEFORE the USDC pull/adapter deposit in the same transaction,"
  while `convert_to_assets` is fed a value "read live from the adapter at withdrawal time." If
  "snapshotted" means a cached/stored figure that can trail the adapter's real, yield-accruing
  balance, a depositor who deposits and withdraws back-to-back can extract the gap. Concrete numbers:
  stored `total_assets=1,000,000` / `total_shares=1,000,000`, offset `1,000,000`, but real
  yield-bearing balance already `1,100,000` (10% accrued, unreflected). Attacker deposits
  `1,000,000` priced against the stale figure: `shares = floor(1,000,000*2,000,000/1,000,001) ~
  1,999,998`. Attacker immediately withdraws those shares priced against the live figure
  (`total_assets_live = 1,100,000+1,000,000 = 2,100,000`, `total_shares=2,999,998`):
  `assets_out = floor(1,999,998*(2,100,001)/(2,999,998+1,000,000)) ~ 1,049,999`. Net: put in
  1,000,000, took out ~1,049,999, a ~5% profit in one atomic round-trip, paid out of yield that
  should have accrued to pre-existing shareholders.
- **caveat (self-flagged by the originating lens)**: this bundle contains only the pure math;
  whether "snapshotted" genuinely means a stale/cached read (exploitable) versus simply "read live,
  but before this deposit's own effect is applied" (correct, not exploitable) cannot be confirmed
  from `share_math.rs` alone, `VaultCore`, which supplies these arguments, is out of scope for this
  bundle. Flagged at medium rather than high specifically because the exploit lives in how the
  functions are fed data, not in the functions themselves.
- **impact (if premise holds)**: a repeatable, atomic, single-transaction yield-skimming attack
  against every other depositor in the same adapter ledger, no external capital beyond the deposit
  amount, no waiting period.

### NO FINDINGS

- **math-precision lens**: checked rounding direction (floors both ways, in the vault's favor,
  matches doc), virtual-offset inflation-attack economics at USDC's 6-decimal scale (closed, the
  attacker's own payoff after a zeroing-strength donation is deeply negative), `mul_div_floor`
  overflow/narrowing (U512 widen before divide, checked narrow-back), `split_by_bps` multiply-before-
  divide order (checked, correct), `reconcile_credit` (pure cap/compare, no arithmetic to exploit),
  overflow bounds on `+offset_pow`/`+1` (checked_add, unreachable precondition at realistic scale).
  No finding produced.
- **invariant lens**, invariants 1 and 4: `mul_div_floor` never truncates/wraps, held.
  `reconcile_credit` never overpays, held trivially (two branches, no arithmetic path to overpay).

---

## Periphery partition

### NO FINDINGS (high-confidence closures, all four lenses converge)

All four periphery lenses (trust-gap, periphery, first-principles, economic-security) independently
traced and closed the same core seam: `user = self.vm().msg_sender()` is the only value ever passed
as both Permit2's `owner` and the core's `deposit_for` `user` argument, never a function parameter,
never attacker-substitutable. This forecloses:
- **front-running/relay a leaked signature as a different EOA**: Permit2 recovers the signer from
  the signature and reverts on any `owner` mismatch with the actual caller; a copied calldata replay
  by an attacker fails before any funds move, and the victim's nonce remains available.
- **redirect credit to a different address than whoever's tokens moved**: same binding forecloses
  decoupling "whose tokens move" from "who gets credited."
- **amount divergence across the pull -> approve -> deposit_for chain**: the same `U256 amount` is
  used at every step (Permit2-verified struct, `approve(core, amount)`, `deposit_for(user, amount)`);
  no intermediate rounding/fee point exists (USDC is not fee-on-transfer/rebasing).
- **reentrancy to double-spend the standing core allowance**: `deposit_for`'s `transfer_from` pulls
  the entire `amount` out of the periphery before any external adapter call, so by the time
  reentrancy is possible the periphery's balance is already zero; a reentrant `approve` overwrite is
  absolute (not additive) and moot either way.
- **hostile/replaced periphery minting unbacked positions**: `deposit_for` independently pulls via
  its own `transfer_from`; a malicious periphery clone must actually hold and approve real USDC.

### INFO

#### P-I1 - Periphery's belief about "USDC" is never reconciled with the core's belief
- **location**: `router.rs:constructor` (usdc param) interacting with the core's hardcoded `USDC` constant
- **lens**: trust-gap
- **attack (traced)**: the periphery's constructor stores whatever `usdc` address it's given (only a
  zero-address check, no equality check against the core). If ever constructed with a `usdc` that
  doesn't match the core's hardcoded `USDC` (deploy-script argument-order slip, stale address from a
  migration), every deposit reverts permanently: Permit2 correctly pulls the periphery's configured
  token, the periphery approves that wrong token to the core, but the core's `transfer_from` targets
  its own `USDC` constant, a different address, and fails for lack of balance/allowance. No value
  stolen or stranded (same reverting transaction), but every deposit through this periphery is DoS'd
  until redeploy (the periphery has no setter), which also invalidates every outstanding signed
  permit.
- **impact**: not attacker-exploitable post-deployment; a deploy-time invariant asserted nowhere
  on-chain. Failure mode is a silent, total, unrecoverable-without-redeploy DoS rather than a loud,
  cheap-to-catch construction revert.

#### P-I2 - Signature-shape gate silently excludes EIP-1271 (smart-contract-wallet) signers
- **location**: `router.rs:deposit_with_permit2` (`signature.len() != 65` / `v`-byte checks)
- **lens**: first-principles
- **attack (traced)**: a Safe multisig (or any ERC-1271 wallet) produces a valid EIP-1271 signature
  for Permit2's `permitTransferFrom` (Permit2 natively supports this via
  `SignatureVerification.verify`, falling back to `isValidSignature` for non-65-byte signatures).
  This periphery's local shape gate rejects any non-65-byte signature with `InvalidSignatureLength`
  before Permit2 is ever called, even though the exact same signature, forwarded unmodified to
  Permit2 directly, would have been valid.
- **impact**: not a fund-loss or fund-stranding bug (tx simply reverts, nothing moves), a
  compatibility/availability gap. Smart-contract-wallet users are locked out of the intended
  "single EIP-712 signature" UX and must fall back to manual `approve` + direct `deposit_for`. The
  bundle's stated guarantee ("canonical Permit2 SignatureTransfer flow") is narrower in practice:
  EOA-signature-only.

#### P-I3 - No sweep/rescue path if the core ever pulls a partial amount
- **location**: `router.rs:deposit_with_permit2` (steps 2-4)
- **lens**: economic-security
- **attack (traced)**: not reachable against the core logic as pasted in this bundle (`deposit_for`
  always pulls the full `amount` in one shot before any adapter interaction). Recorded as a
  forward-looking gap only: if a future core revision ever pulled less than the approved `amount`
  (partial-fill or fee-taking core), the undrawn residual would sit in the periphery's own balance
  with no function anywhere in this contract able to move it out (no owner, no sweep, no fallback).
  The existing re-zero step only clears the allowance, not a stranded balance.
- **impact**: zero under the code in this bundle, cannot be triggered today. Flagged only because
  the failure mode, if the core-side invariant it depends on ever changes, is permanent fund lock
  with no recovery path.
