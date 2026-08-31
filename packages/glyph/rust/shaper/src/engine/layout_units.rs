//! F16.16 integer layout units (the integer-layout-units plan, slice 2).
//!
//! One layout unit is 1/65,536 of a caller-space unit. Glyph accepts layout in
//! renderer-local units, not only CSS pixels: Three.js routinely supplies font sizes
//! below one world unit. Six fractional bits made the quantization error of each tiny
//! cluster comparable to the cluster itself, so line fitting and justification could
//! disagree with the correctly scaled glyph geometry by roughly ten percent. The
//! wider i64 lane keeps the previous large-coordinate range while making sub-unit
//! layouts precise.
//!
//! The conversion below is THE rounding
//! contract that defines layout once integer fitting becomes authoritative:
//! round-half-up in units space, computed as `floor(value * 65,536 + 1/2)` with an
//! explicit no_std floor, so native and Wasm builds agree bit-for-bit and the
//! contract is trivially reproducible outside Rust. Integer sums are associative,
//! which is what admits the D-245 chunk kernels: lane-reordered accumulation equals
//! the scalar result exactly.

/// Fractional bits of one layout unit.
pub(crate) const LAYOUT_UNIT_BITS: u32 = 16;
/// Layout units per caller-space unit.
pub(crate) const LAYOUT_UNITS_PER_PIXEL: f64 = (1_i64 << LAYOUT_UNIT_BITS) as f64;

/// Converts a scaled caller-space value into F16.16 layout units under the rounding
/// contract. Values saturate at ±2^53 units so conversion to f64 remains exact for
/// ratio calculations; composing-stage additions saturate at the i64 accumulator boundary.
pub(crate) fn layout_units_from_scaled(value: f64) -> i64 {
    let scaled = value * LAYOUT_UNITS_PER_PIXEL + 0.5;
    saturating_floor_units(scaled)
}

/// Converts F16.16 layout units back to the caller-space value they quantized.
pub(crate) fn scaled_from_layout_units(units: i64) -> f64 {
    units as f64 / LAYOUT_UNITS_PER_PIXEL
}

/// Applies a declared non-negative ratio to a non-negative layout-unit
/// quantity exactly: within the plan's 2^53-unit magnitude precondition the
/// `i64 -> f64` conversion is exact, the single IEEE multiply carries relative
/// error 2^-53 — far below one unit at any admitted magnitude — and one
/// round-half-up lands the contract's single quantization. This replaced the
/// Q16 mul/shift family after review: the Q16 ratio's 2^-17 relative error
/// scales past the one-unit tolerance once a span's space sum exceeds ~2^16
/// units, and the fit's `<<16` comparisons overflowed i64 inside the admitted
/// magnitude range. IEEE f64 multiplication is bit-identical across native and
/// Wasm builds, so the shared-contract argument is unchanged.
pub(crate) fn apply_ratio(units: i64, ratio: f64) -> i64 {
    saturating_floor_units(units as f64 * ratio + 0.5)
}

/// `saturating_floor` widened to the layout-unit accumulator domain: i64 with
/// non-finite inputs kept total. Products of admitted magnitudes stay far
/// inside the exact f64 integer range, so saturation is a totality guard, not
/// a rounding path.
fn saturating_floor_units(value: f64) -> i64 {
    if value.is_nan() {
        return 0;
    }
    const LIMIT: f64 = 9_007_199_254_740_992.0; // 2^53
    if value >= LIMIT {
        return LIMIT as i64;
    }
    if value <= -LIMIT {
        return -(LIMIT as i64);
    }
    let truncated = value as i64;
    if value < truncated as f64 {
        truncated - 1
    } else {
        truncated
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rounding_contract_is_half_up_and_total() {
        assert_eq!(layout_units_from_scaled(0.0), 0);
        assert_eq!(layout_units_from_scaled(1.0), 65_536);
        // Exactly half a unit rounds up, in both signs.
        assert_eq!(layout_units_from_scaled(1.0 / 131_072.0), 1);
        assert_eq!(layout_units_from_scaled(-1.0 / 131_072.0), 0);
        assert_eq!(layout_units_from_scaled(-3.0 / 131_072.0), -1);
        // Just below half a unit rounds down.
        assert_eq!(layout_units_from_scaled(0.000_007_6), 0);
        assert_eq!(layout_units_from_scaled(-1.0), -65_536);
        // Non-finite inputs stay total.
        assert_eq!(layout_units_from_scaled(f64::NAN), 0);
        assert_eq!(
            layout_units_from_scaled(f64::INFINITY),
            9_007_199_254_740_992
        );
        assert_eq!(
            layout_units_from_scaled(f64::NEG_INFINITY),
            -9_007_199_254_740_992
        );
    }

    #[test]
    fn conversion_is_monotonic_and_inverts_within_one_unit() {
        let mut previous = i64::MIN;
        for step in -4096..4096 {
            let value = f64::from(step) * 0.173;
            let units = layout_units_from_scaled(value);
            assert!(units >= previous, "monotonic at step {step}");
            previous = units;
            let round_trip = scaled_from_layout_units(units);
            assert!(
                (round_trip - value).abs() <= 1.0 / LAYOUT_UNITS_PER_PIXEL,
                "inverse within one unit at step {step}: {round_trip} vs {value}"
            );
        }
    }

    #[test]
    fn ratio_application_rounds_half_up_once_and_stays_within_one_unit() {
        // Excess factors above one survive (a 3x word-space cap is excess 2.0).
        assert_eq!(apply_ratio(128, 2.0), 256);
        // 641 units x 0.5 = 320.5 rounds half-up to 321.
        assert_eq!(apply_ratio(641, 0.5), 321);
        assert_eq!(apply_ratio(0, 1.0), 0);
        assert_eq!(apply_ratio(128, 0.0), 0);
        // The review counterexample that retired the Q16 family: a 1,000,000-unit
        // space sum under the f32 minimum ratio 0.6666666865348816 must shrink by
        // the exactly-applied fraction, not a Q16 approximation 5 units short.
        let ratio = 1.0 - f64::from(0.666_666_7_f32);
        let capacity = apply_ratio(1_000_000, ratio);
        assert_eq!(capacity, 333_333);
        assert!((capacity as f64 - 1_000_000.0 * ratio).abs() < 1.0);
        // Totality: non-finite and out-of-range inputs saturate instead of wrapping.
        assert_eq!(apply_ratio(i64::MAX, 2.0), 9_007_199_254_740_992);
        assert_eq!(apply_ratio(1, f64::NAN), 0);
    }
}
