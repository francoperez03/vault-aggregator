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
}
