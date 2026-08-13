//! F26.6 integer layout units (the integer-layout-units plan, slice 2).
//!
//! One layout unit is 1/64 of a layout pixel. The conversion below is THE rounding
//! contract that defines layout once integer fitting becomes authoritative:
//! round-half-up in units space, computed as `floor(value * 64 + 1/2)` with an
//! explicit no_std floor, so native and Wasm builds agree bit-for-bit and the
//! contract is trivially reproducible outside Rust. Integer sums are associative,
//! which is what admits the D-245 chunk kernels: lane-reordered accumulation equals
//! the scalar result exactly.

/// Fractional bits of one layout unit.
pub(crate) const LAYOUT_UNIT_BITS: u32 = 6;
/// Layout units per layout pixel.
pub(crate) const LAYOUT_UNITS_PER_PIXEL: f64 = (1_i64 << LAYOUT_UNIT_BITS) as f64;

/// Converts a scaled (pixel-space) value into F26.6 layout units under the rounding
/// contract, saturating at the i32 range (±2^25 layout pixels, far beyond any
/// paragraph the engine admits).
pub(crate) fn layout_units_from_scaled(value: f64) -> i32 {
    let scaled = value * LAYOUT_UNITS_PER_PIXEL + 0.5;
    saturating_floor(scaled)
}

/// Converts F26.6 layout units back to the pixel-space value they quantized.
pub(crate) fn scaled_from_layout_units(units: i64) -> f64 {
    units as f64 / LAYOUT_UNITS_PER_PIXEL
}

/// Q16 fixed-point ratio for fractions declared in `[0, 1)`, under the same
/// round-half-up contract. The result clamps to 65,535 so a fraction arbitrarily
/// close to one never quantizes out of the consumer's `[0, 65536)` domain.
pub(crate) fn ratio_q16(value: f64) -> i64 {
    i64::from(saturating_floor(value * 65_536.0 + 0.5)).min(65_535)
}

/// `floor` for finite f64 without `std` float intrinsics: truncate toward zero and
/// correct negatives with a fractional remainder. NaN saturates to 0 and infinities
/// to the i32 range, keeping the contract total.
fn saturating_floor(value: f64) -> i32 {
    if value.is_nan() {
        return 0;
    }
    if value >= f64::from(i32::MAX) {
        return i32::MAX;
    }
    if value <= f64::from(i32::MIN) {
        return i32::MIN;
    }
    let truncated = value as i64;
    let corrected = if value < truncated as f64 {
        truncated - 1
    } else {
        truncated
    };
    corrected as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_rounding_contract_is_half_up_and_total() {
        assert_eq!(layout_units_from_scaled(0.0), 0);
        assert_eq!(layout_units_from_scaled(1.0), 64);
        // Exactly half a unit rounds up, in both signs.
        assert_eq!(layout_units_from_scaled(1.0 / 128.0), 1);
        assert_eq!(layout_units_from_scaled(-1.0 / 128.0), 0);
        assert_eq!(layout_units_from_scaled(-3.0 / 128.0), -1);
        // Just below half a unit rounds down.
        assert_eq!(layout_units_from_scaled(0.0078), 0);
        assert_eq!(layout_units_from_scaled(-1.0), -64);
        // Non-finite inputs stay total.
        assert_eq!(layout_units_from_scaled(f64::NAN), 0);
        assert_eq!(layout_units_from_scaled(f64::INFINITY), i32::MAX);
        assert_eq!(layout_units_from_scaled(f64::NEG_INFINITY), i32::MIN);
    }

    #[test]
    fn conversion_is_monotonic_and_inverts_within_one_unit() {
        let mut previous = i32::MIN;
        for step in -4096..4096 {
            let value = f64::from(step) * 0.173;
            let units = layout_units_from_scaled(value);
            assert!(units >= previous, "monotonic at step {step}");
            previous = units;
            let round_trip = scaled_from_layout_units(i64::from(units));
            assert!(
                (round_trip - value).abs() <= 1.0 / LAYOUT_UNITS_PER_PIXEL,
                "inverse within one unit at step {step}: {round_trip} vs {value}"
            );
        }
    }

    #[test]
    fn q16_ratios_quantize_half_up_and_never_leave_the_consumer_domain() {
        assert_eq!(ratio_q16(0.5), 32_768);
        assert_eq!(ratio_q16(0.0), 0);
        // A fraction arbitrarily close to one clamps inside [0, 65536) instead of
        // quantizing out of the fit's accepted domain.
        assert_eq!(ratio_q16(0.999_999_9), 65_535);
        assert_eq!(ratio_q16(1.0 - f64::EPSILON), 65_535);
        for &fraction in &[0.25_f64, 0.33, 0.999] {
            let ratio = ratio_q16(fraction);
            assert!((0..65_536).contains(&ratio), "{fraction}");
            let round_trip = ratio as f64 / 65_536.0;
            assert!((round_trip - fraction).abs() <= 1.0 / 65_536.0, "{fraction}");
        }
    }
}
