//! Virtual-offset share math (D-03, OZ ERC-4626 `_decimalsOffset` pattern). Pure functions, no
//! storage access, no `Host` plumbing — easy to unit test in isolation. Overflow-safe via a
//! U256->U512->U256 widen/multiply/divide/downcast, the same technique OpenZeppelin's own Rust
//! ERC-4626 port uses (11-RESEARCH.md §Architecture Patterns Pattern 2).

use alloc::vec::Vec;

use alloy_primitives::ruint::Uint;
use alloy_primitives::U256;

use crate::errors;

type U512 = Uint<512, 8>;

/// USDC has 6 decimals; the offset matches the underlying asset's decimals per OZ convention
/// (11-RESEARCH.md Assumption A2). `10^6`.
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
/// assumed to sum to `TOTAL_BPS` per D-06's `set_allocation` guard). Each slice floors down
/// (`amount * bps / 10000`, `checked_mul` so a compromised/misconfigured USDC-like supply reverts
/// instead of silently wrapping — RESEARCH.md A4). The integer-division remainder is added to
/// `slices[0]` (D-10: "first active adapter"), so `Σ slices == amount` exactly.
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

/// Splits `amount` proportional to each active adapter's CURRENT `total_assets` (D-04), remainder
/// to index 0 (D-10, matching `split_by_bps`). Each slice floors down via `mul_div_floor`'s U512
/// widening, so `Σ(slices) == amount` exactly. NOT `split_by_bps`'s `checked_mul`/10000 shape:
/// positions are unbounded USDC `total_assets` quantities, not bps bounded by 10000, so
/// `amount * position` can overflow `U256` for large accumulated pools. An adapter at position 0
/// gets a 0 slice — the redeem loop (12-02) must skip it, not `withdraw(0)` (D-11 exit-by-omission).
/// `Err(division_by_zero)` if the positions sum to zero.
pub fn split_by_position(amount: U256, positions: &[U256]) -> Result<Vec<U256>, Vec<u8>> {
    let total: U256 = positions.iter().fold(U256::ZERO, |acc, p| acc + *p);
    if total.is_zero() {
        return Err(errors::division_by_zero());
    }
    let mut slices: Vec<U256> = Vec::with_capacity(positions.len());
    let mut allocated = U256::ZERO;
    for position in positions {
        let slice = mul_div_floor(amount, *position, total)?;
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
/// D-06: a shortfall (actual < owed) reverts the whole tx. D-07: a surplus (actual > owed, e.g. a
/// direct-USDC donation or sandwich inflating the core's balance) is capped — the caller is paid
/// exactly `owed`, never the excess (the excess stays in the core for the next rebalance to sweep).
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
        // Dust lands on index 0 (D-10).
        assert!(slices[0] >= slices[1]);
    }

    #[test]
    fn split_by_position_proportional_and_sums_to_amount() {
        let amount = U256::from(1_000_000u64); // 1 USDC being redeemed
        // Adapter A holds 60% of the pool, adapter B holds 40% (realistic USDC-scale positions).
        let positions = [U256::from(60_000_000_000u64), U256::from(40_000_000_000u64)];
        let slices = split_by_position(amount, &positions).unwrap();
        let sum: U256 = slices.iter().fold(U256::ZERO, |acc, s| acc + *s);
        assert_eq!(sum, amount);
        assert!(slices[0] >= slices[1]);
    }

    #[test]
    fn split_by_position_single_adapter_gets_everything() {
        let amount = U256::from(1_000_000u64);
        let slices = split_by_position(amount, &[U256::from(42_000_000u64)]).unwrap();
        assert_eq!(slices, alloc::vec![amount]);
    }

    #[test]
    fn split_by_position_zero_position_gets_zero_slice() {
        // D-11 exit-by-omission scenario: an adapter at position 0 must get a 0 slice so the
        // redeem loop can skip it instead of calling withdraw(0).
        let amount = U256::from(1_000_000u64);
        let positions = [U256::from(1_000_000u64), U256::ZERO];
        let slices = split_by_position(amount, &positions).unwrap();
        let sum: U256 = slices.iter().fold(U256::ZERO, |acc, s| acc + *s);
        assert_eq!(sum, amount);
        assert_eq!(slices[1], U256::ZERO);
    }

    #[test]
    fn split_by_position_all_zero_positions_reverts() {
        let amount = U256::from(1_000_000u64);
        let result = split_by_position(amount, &[U256::ZERO, U256::ZERO]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), errors::division_by_zero());
    }

    #[test]
    fn split_by_position_empty_positions_reverts() {
        let amount = U256::from(1_000_000u64);
        let result = split_by_position(amount, &[]);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), errors::division_by_zero());
    }

    #[test]
    fn reconcile_credit_shortfall_reverts() {
        let err = reconcile_credit(U256::from(100u64), U256::from(99u64));
        assert!(err.is_err()); // D-06: actual < owed -> whole-tx revert
    }

    #[test]
    fn reconcile_credit_exact_match_pays_owed() {
        let paid = reconcile_credit(U256::from(100u64), U256::from(100u64)).unwrap();
        assert_eq!(paid, U256::from(100u64));
    }

    #[test]
    fn reconcile_credit_surplus_caps_at_owed() {
        // Simulates a direct-USDC donation or sandwich inflating the core's balance beyond
        // `owed` mid-redeem (D-07's attack vector) — the user must NOT receive the surplus.
        let paid = reconcile_credit(U256::from(100u64), U256::from(1_000_000u64)).unwrap();
        assert_eq!(paid, U256::from(100u64));
    }
}
