# Bundle: sharemath (virtual-offset share accounting)

## What this is

`share_math.rs` is the pure numerical core of a USDC vault aggregator's per-adapter share
accounting. It has no storage access and no host/VM plumbing — every function is a plain
`U256 -> Result<U256, Vec<u8>>` (or similar) transform, so it is deliberately isolated from the
contract that calls it. The calling contract (`VaultCore`, not included in this bundle) maintains
ONE independent share ledger PER adapter (not a single global share price): `total_shares` and
`total_assets` are always scoped to one specific adapter when these functions are called.

The virtual-offset technique (`OFFSET_POW = 10^6`, matching USDC's 6 decimals) is the same
"decimals offset" trick used by OpenZeppelin's ERC-4626 reference implementation to make the
classic first-depositor share-inflation attack (front-run the first depositor with a 1-wei
deposit, then donate a huge amount directly to inflate the share price before the victim's
deposit lands) prohibitively expensive rather than merely mitigated by a locked minimum-liquidity
mint.

## What each function is supposed to guarantee

- `mul_div_floor(a, b, c)` — `floor(a*b/c)` without ever overflowing U256 intermediate math, by
  widening to a 512-bit unsigned integer for the multiply before dividing and narrowing back down.
  Must reject `c == 0` and must reject a result that doesn't fit back into U256.
- `convert_to_shares(assets, total_shares, total_assets, offset_pow)` — the deposit-side
  conversion: `shares = floor(assets * (total_shares + offset_pow) / (total_assets + 1))`.
- `convert_to_assets(shares, total_shares, total_assets, offset_pow)` — the exact inverse used on
  withdrawal: `assets = floor(shares * (total_assets + 1) / (total_shares + offset_pow))`. Always
  rounds DOWN, i.e. in the vault's favor, never the withdrawing user's.
- `split_by_bps(amount, weights_bps)` — splits `amount` across N basis-point weights (assumed by
  the caller to sum to exactly 10,000), each slice floored, with the leftover integer-division
  remainder added entirely to `slices[0]` so that `sum(slices) == amount` exactly, always, with no
  dust lost or created.
- `reconcile_credit(owed, actual_delta)` — compares what the ledger calculates it is OWED for a
  withdrawal against the REAL measured USDC balance delta the calling contract observed. If
  `actual_delta < owed`, the whole transaction must revert (a shortfall is never partially paid
  out). If `actual_delta > owed` (e.g. a surplus from some other source landing in the same
  balance window), the caller is paid exactly `owed` — the surplus must never be handed to the
  withdrawing party, it is capped.

## Source: `vault-core/src/share_math.rs` (complete file, including its own unit tests — the
tests are part of what the caller currently uses to justify these functions' correctness, useful
context for what invariants were already believed to hold)

```rust
//! Virtual-offset share math (OZ ERC-4626 `_decimalsOffset` pattern). Pure functions, no
//! storage access, no `Host` plumbing — easy to unit test in isolation. Overflow-safe via a
//! U256->U512->U256 widen/multiply/divide/downcast, the same technique OpenZeppelin's own Rust
//! ERC-4626 port uses.

use alloc::vec::Vec;

use alloy_primitives::ruint::Uint;
use alloy_primitives::U256;

use crate::errors;

type U512 = Uint<512, 8>;

/// USDC has 6 decimals; the offset matches the underlying asset's decimals per OZ convention.
/// `10^6`.
pub const OFFSET_POW: U256 = U256::from_limbs([1_000_000u64, 0, 0, 0]);

/// `floor(a * b / c)`, overflow-safe via U512 widening.
pub fn mul_div_floor(a: U256, b: U256, c: U256) -> Result<U256, Vec<u8>> {
    if c.is_zero() {
        return Err(errors::division_by_zero());
    }
    let wide = U512::from(a) * U512::from(b);
    let result = wide / U512::from(c);
    let (narrowed, overflow) = U256::overflowing_from_limbs_slice(result.as_limbs());
    if overflow {
        return Err(errors::mul_div_overflow());
    }
    Ok(narrowed)
}

/// Deposit-side: `shares = assets * (total_shares + 10^offset) / (total_assets + 1)`, floor.
pub fn convert_to_shares(
    assets: U256,
    total_shares: U256,
    total_assets: U256,
    offset_pow: U256,
) -> Result<U256, Vec<u8>> {
    let numerator_multiplier = total_shares
        .checked_add(offset_pow)
        .ok_or_else(errors::share_math_overflow)?;
    let denominator = total_assets
        .checked_add(U256::from(1))
        .ok_or_else(errors::share_math_overflow)?;
    mul_div_floor(assets, numerator_multiplier, denominator)
}

/// Redeem-side (inverse): `assets = shares * (total_assets + 1) / (total_shares + 10^offset)`,
/// floor — always rounds in the vault's favor.
pub fn convert_to_assets(
    shares: U256,
    total_shares: U256,
    total_assets: U256,
    offset_pow: U256,
) -> Result<U256, Vec<u8>> {
    let numerator_multiplier = total_assets
        .checked_add(U256::from(1))
        .ok_or_else(errors::share_math_overflow)?;
    let denominator = total_shares
        .checked_add(offset_pow)
        .ok_or_else(errors::share_math_overflow)?;
    mul_div_floor(shares, numerator_multiplier, denominator)
}

/// Total basis-points a weights slice must sum to (mirrors `core.rs`'s `TOTAL_BPS`, kept local
/// so this module has no dependency on `core.rs`).
const TOTAL_BPS: U256 = U256::from_limbs([10_000u64, 0, 0, 0]);

/// Splits `amount` across `weights_bps` (parallel to the caller's active-adapter list, weights
/// assumed to sum to `TOTAL_BPS`). Each slice floors down (`amount * bps / 10000`, `checked_mul`
/// so a compromised/misconfigured USDC-like supply reverts instead of silently wrapping). The
/// integer-division remainder is added to `slices[0]` ("first active adapter"), so
/// `Σ slices == amount` exactly.
pub fn split_by_bps(amount: U256, weights_bps: &[U256]) -> Result<Vec<U256>, Vec<u8>> {
    let mut slices: Vec<U256> = Vec::with_capacity(weights_bps.len());
    let mut allocated = U256::ZERO;
    for bps in weights_bps {
        let product = amount.checked_mul(*bps).ok_or_else(errors::mul_div_overflow)?;
        let slice = product / TOTAL_BPS;
        allocated += slice;
        slices.push(slice);
    }

    let remainder = amount - allocated; // amount >= allocated always: each slice floors down.
    if !remainder.is_zero() {
        if let Some(first) = slices.first_mut() {
            *first += remainder;
        }
    }
    Ok(slices)
}

/// Reconciles the credit a redeem/rebalance actually owes against the REAL measured USDC delta.
/// A shortfall (actual < owed) reverts the whole tx. A surplus (actual > owed, e.g. a
/// direct-USDC donation or sandwich inflating the core's balance) is capped — the caller is paid
/// exactly `owed`, never the excess. The excess stays stranded and inert in the core: NO path may
/// sweep it, because a sweep through a user path would be a theft vector against the other
/// users' custodied funds and donations.
pub fn reconcile_credit(owed: U256, actual_delta: U256) -> Result<U256, Vec<u8>> {
    if actual_delta < owed {
        return Err(errors::redeem_shortfall(owed, actual_delta));
    }
    Ok(owed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mul_div_floor_basic() {
        let result = mul_div_floor(U256::from(6u64), U256::from(7u64), U256::from(2u64));
        assert_eq!(result.unwrap(), U256::from(21u64));
    }

    #[test]
    fn mul_div_floor_zero_denominator_reverts() {
        let result = mul_div_floor(U256::from(6u64), U256::from(7u64), U256::ZERO);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), errors::division_by_zero());
    }

    #[test]
    fn convert_to_shares_first_deposit_is_nonzero() {
        // Empty vault (total_shares = 0, total_assets = 0): 1 USDC deposit.
        let shares = convert_to_shares(
            U256::from(1_000_000u64),
            U256::ZERO,
            U256::ZERO,
            OFFSET_POW,
        )
        .unwrap();
        assert!(!shares.is_zero());
    }

    #[test]
    fn convert_to_shares_and_back_round_trips_within_floor_tolerance() {
        let total_shares = U256::from(5_000_000u64);
        let total_assets = U256::from(5_000_000u64);
        let assets_in = U256::from(1_000_000u64);

        let shares = convert_to_shares(assets_in, total_shares, total_assets, OFFSET_POW).unwrap();
        let assets_out = convert_to_assets(
            shares,
            total_shares + shares,
            total_assets + assets_in,
            OFFSET_POW,
        )
        .unwrap();

        // Floor rounding means assets_out is never greater than assets_in, and never more than
        // a few wei short.
        assert!(assets_out <= assets_in);
        assert!(assets_in - assets_out <= U256::from(2u64));
    }

    #[test]
    fn split_by_bps_even_split_no_remainder() {
        let slices = split_by_bps(
            U256::from(100u64),
            &[U256::from(5_000u64), U256::from(5_000u64)],
        )
        .unwrap();
        assert_eq!(slices, alloc::vec![U256::from(50u64), U256::from(50u64)]);
    }

    #[test]
    fn split_by_bps_remainder_goes_to_first_slice() {
        let amount = U256::from(100u64);
        let slices = split_by_bps(
            amount,
            &[U256::from(3_333u64), U256::from(3_333u64), U256::from(3_334u64)],
        )
        .unwrap();
        let sum: U256 = slices.iter().fold(U256::ZERO, |acc, s| acc + *s);
        assert_eq!(sum, amount);
        // 100*3333/10000=33, 100*3333/10000=33, 100*3334/10000=33 -> allocated=99, remainder=1 -> slot 0.
        assert_eq!(slices[0], U256::from(34u64));
    }

    #[test]
    fn split_by_bps_single_adapter_full_amount() {
        let slices = split_by_bps(U256::from(1u64), &[U256::from(10_000u64)]).unwrap();
        assert_eq!(slices, alloc::vec![U256::from(1u64)]);
    }

    #[test]
    fn split_by_bps_dust_case_sum_equals_amount() {
        let amount = U256::from(1_000_001u64);
        let slices = split_by_bps(
            amount,
            &[U256::from(3_334u64), U256::from(3_333u64), U256::from(3_333u64)],
        )
        .unwrap();
        let sum: U256 = slices.iter().fold(U256::ZERO, |acc, s| acc + *s);
        assert_eq!(sum, amount);
        // Dust lands on index 0.
        assert!(slices[0] >= slices[1]);
    }

    #[test]
    fn reconcile_credit_shortfall_reverts() {
        let err = reconcile_credit(U256::from(100u64), U256::from(99u64));
        assert!(err.is_err()); // actual < owed -> whole-tx revert
    }

    #[test]
    fn reconcile_credit_exact_match_pays_owed() {
        let paid = reconcile_credit(U256::from(100u64), U256::from(100u64)).unwrap();
        assert_eq!(paid, U256::from(100u64));
    }

    #[test]
    fn reconcile_credit_surplus_caps_at_owed() {
        // Simulates a direct-USDC donation or sandwich inflating the core's balance beyond
        // `owed` mid-redeem — the user must NOT receive the surplus.
        let paid = reconcile_credit(U256::from(100u64), U256::from(1_000_000u64)).unwrap();
        assert_eq!(paid, U256::from(100u64));
    }
}
```

## Caller-side context you may need (not this bundle's primary target, but relevant to how these
functions get their inputs)

- `convert_to_shares` is called with `total_assets` snapshotted BEFORE the USDC pull/adapter
  deposit in the same transaction (an entry-side snapshot).
- `convert_to_assets` (inside the caller's withdrawal path, not shown here) is called with
  `total_assets` read live from the adapter at withdrawal time, and the RESULT (`owed`) is then
  compared against a separately measured real balance delta via `reconcile_credit` — i.e. the
  entry path prices a mint against a requested/snapshotted amount, and the exit path prices a
  burn against a live oracle read reconciled against a real balance delta. Two different pricing
  strategies for symmetric operations on the same ledger.
- `split_by_bps` is called once per deposit/rebalance with a weights array the caller has already
  validated sums to exactly 10,000 — this file does NOT re-validate that sum itself.

---

## Reasoning tools

# Senior Auditor's Mindset

This is how a senior auditor thinks. Pattern-matching catches the obvious bugs — your specialty file teaches that. The high-value bugs, the ones everyone else misses, come from HOW you reason about code, not from WHAT bugs you know.

The senior auditor's edge is not "knowing more bug patterns" — it is having internalized mental tools they reach for instinctively when something feels off, when a path seems clean, or when a conclusion comes too quickly.

This file gives you three tools. They are not steps. You reach for the right one the moment the trigger fires. Use them. Trust your discomfort.

A finding is not real until you've traced the attack with concrete values. You are an attacker, not a defender — when you find a bug, deepen the attack; never argue yourself out of one.

---

## 1. The Feynman test (FIRST — use it before anything else)

**This is the first tool. Apply it the moment you open any new function or contract — before you reason about anything else.** Code you have not Feynman'd is code you have not actually understood.

When you read code, STOP and ask: "Can I explain what this function does to someone who doesn't know Solidity?"

Try it. In plain words. The places where your explanation gets fuzzy — where you reach for jargon instead of plain meaning — are where you're papering over an assumption. That's where bugs hide.

A senior auditor doesn't trust their understanding until they can explain it without the safety net of technical vocabulary.

---

## 2. Socratic questioning

For every line of code, ask: why is this here? What does it assume? What happens if the assumption breaks?

Don't accept "because that's how it's written" as an answer. Don't accept "the function name says so" as an answer. Drill until you reach the implicit belief the code rests on. The first answer is usually a restatement. The actual assumption is two or three "whys" deeper.

A senior auditor accepts no "because" without examining it.

---

## 3. Inversion

Every clean path gets a backward pass. After you understand what the code IS supposed to do, ask: how would I make it NOT do that?

Same code, attacker's eye instead of developer's eye. The developer asks "does this work?" The attacker asks "how do I break this?" Read every check and ask "what value slips past it?" Read every state update and ask "what state am I in just before this?"

A senior auditor never reads code only forward.

---

## When to reach for which tool

You don't apply these in order — except Feynman, which is always first. You reach for what the moment calls for:

- Opening any new function or contract → **Feynman** (always — before anything else)
- Trying to understand a line you don't yet → **Socratic**
- Something looks too clean → **Inversion**
- You reached a "bug" conclusion → amplify the attack (chain it, find more victims, lower the precondition cost — do NOT refute it)

Trust your discomfort. Reach for the tool. Don't stop until the discomfort has a name.

### Mental tool protocol — MANDATORY

The three tools above are NOT optional. Each has a trigger. When the trigger fires, emit the marker `[Tool: ...]` in your working text BEFORE continuing (not inside FINDING/LEAD blocks):

| Trigger | Marker | Content |
|---|---|---|
| You open a new function or contract to read | `[Feynman: <name>]` | Explain what it does in plain English — no jargon. |
| You stop on a line whose purpose isn't immediately clear | `[Socratic: <file:line> — why?]` | A one-line question that drills past "because that's how it's written." |
| A code path reads as clean / a check looks sufficient | `[Inversion: <function>]` | Three concrete attacker moves that attempt to defeat the path, with specific values. |

## Assigned agents for this bundle

Attack this bundle from these four lenses (specialty definitions live at
`.claude/skills/solidity-auditor/references/hacking-agents/<name>-agent.md` — adapt the
Solidity-specific vocabulary in those files to Rust mechanically: this is fixed-point arithmetic
over `U256`, not Solidity's native integer types, but the same rounding/precision/overflow attack
classes apply):

1. **math-precision-agent** — rounding direction, precision loss across `convert_to_shares` /
   `convert_to_assets`, and whether the virtual offset actually closes the inflation attack it
   claims to close at realistic USDC magnitudes (6 decimals, not 18).
2. **numerical-gap-agent** — edge cases in `mul_div_floor`'s U512 widen/narrow, `split_by_bps`'s
   remainder assignment, and any input combination that produces a result other functions don't
   expect (zero, one, U256::MAX-adjacent values).
3. **invariant-agent** — does `Σ slices == amount` actually hold for every possible weights
   array, does the round-trip `convert_to_shares` -> `convert_to_assets` actually always favor the
   vault and never the user by more than negligible dust, does `reconcile_credit` truly never let
   `actual_delta` pay out more than `owed`.
4. **boundary-agent** — zero values, single-wei values, maximum U256 values, empty
   `weights_bps` slices, a `weights_bps` array with all-zero entries, and what happens at the
   transition points these functions don't explicitly branch on.
