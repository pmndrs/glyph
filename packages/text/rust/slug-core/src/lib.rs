//! Slug's portable outline normalization and band-acceleration core.
//!
//! The math is ported from `@three-flatland/slug` at
//! `2935a89fcd9999e8a8b3d3b733f7f7302285cd60`. This crate owns the same
//! quadratic representation and ordering invariants without retaining the
//! legacy JavaScript object graph or shaping implementation.

#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

mod packer;

pub use packer::{
    ABSENT_PAGE, DEFAULT_CURVE_WIDTH, DEFAULT_PAGE_CURVE_ROWS, GlyphForPacking, PackError,
    PackedSlug, PackerConfig, SLUG_GLYPH_RECORD_STRIDE, SlugGlyphRecord, SlugPage,
    SlugPageMetadata, pack_glyphs, quantize_f16,
};

use alloc::vec::Vec;

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;

pub const DEFAULT_BAND_COUNT: u16 = 16;
const BAND_EPSILON: f32 = 1.0 / 1024.0;
const AXIS_EPSILON: f32 = 1.0e-10;
const LINE_EPSILON_FONT_UNITS: f32 = 0.125;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

impl Point {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    fn midpoint(self, other: Self) -> Self {
        Self::new((self.x + other.x) * 0.5, (self.y + other.y) * 0.5)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Quadratic {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cubic {
    pub p0: Point,
    pub p1: Point,
    pub p2: Point,
    pub p3: Point,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bounds {
    pub min_x: f32,
    pub min_y: f32,
    pub max_x: f32,
    pub max_y: f32,
}

impl Bounds {
    pub const ZERO: Self = Self {
        min_x: 0.0,
        min_y: 0.0,
        max_x: 0.0,
        max_y: 0.0,
    };

    pub fn from_curves(curves: &[Quadratic]) -> Option<Self> {
        let first = curves.first()?;
        let mut x = AxisBounds::new(first.p0.x);
        let mut y = AxisBounds::new(first.p0.y);
        for curve in curves {
            x.include_quadratic(curve.p0.x, curve.p1.x, curve.p2.x);
            y.include_quadratic(curve.p0.y, curve.p1.y, curve.p2.y);
        }
        Some(Self {
            min_x: x.min,
            min_y: y.min,
            max_x: x.max,
            max_y: y.max,
        })
    }

    fn is_finite(self) -> bool {
        self.min_x.is_finite()
            && self.min_y.is_finite()
            && self.max_x.is_finite()
            && self.max_y.is_finite()
    }
}

struct AxisBounds {
    min: f32,
    max: f32,
}

impl AxisBounds {
    fn new(value: f32) -> Self {
        Self {
            min: value,
            max: value,
        }
    }

    fn include(&mut self, value: f32) {
        self.min = self.min.min(value);
        self.max = self.max.max(value);
    }

    /// Include the exact quadratic extent rather than the looser control hull.
    fn include_quadratic(&mut self, p0: f32, p1: f32, p2: f32) {
        self.include(p0);
        self.include(p2);
        let denominator = p0 - 2.0 * p1 + p2;
        if denominator == 0.0 {
            return;
        }
        let t = (p0 - p1) / denominator;
        if !(0.0..1.0).contains(&t) {
            return;
        }
        let one_minus_t = 1.0 - t;
        self.include(one_minus_t * one_minus_t * p0 + 2.0 * one_minus_t * t * p1 + t * t * p2);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Band {
    pub curve_indices: Vec<u16>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GlyphBands {
    pub horizontal: Vec<Band>,
    pub vertical: Vec<Band>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct GlyphGeometry {
    pub curves: Vec<Quadratic>,
    pub contour_starts: Vec<u16>,
    pub bounds: Bounds,
    pub bands: GlyphBands,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BuildError {
    Allocation,
    InvalidBandCount,
    InvalidContour,
    NonFiniteCoordinate,
    TooManyCurves,
}

/// Build the GPU-facing geometry retained from the legacy Slug pipeline.
pub fn build_glyph_geometry(
    curves: Vec<Quadratic>,
    contour_starts: Vec<u16>,
    band_count: u16,
) -> Result<GlyphGeometry, BuildError> {
    if band_count == 0 {
        return Err(BuildError::InvalidBandCount);
    }
    if curves.len() > usize::from(u16::MAX) {
        return Err(BuildError::TooManyCurves);
    }
    validate_contours(&contour_starts, curves.len())?;
    if curves.iter().any(|curve| {
        [curve.p0, curve.p1, curve.p2]
            .iter()
            .any(|point| !point.x.is_finite() || !point.y.is_finite())
    }) {
        return Err(BuildError::NonFiniteCoordinate);
    }
    let bounds = Bounds::from_curves(&curves).ok_or(BuildError::InvalidContour)?;
    if !bounds.is_finite() {
        return Err(BuildError::NonFiniteCoordinate);
    }
    let bands = build_bands(&curves, bounds, band_count)?;
    Ok(GlyphGeometry {
        curves,
        contour_starts,
        bounds,
        bands,
    })
}

fn validate_contours(contour_starts: &[u16], curve_count: usize) -> Result<(), BuildError> {
    if contour_starts.first().copied() != Some(0) || curve_count == 0 {
        return Err(BuildError::InvalidContour);
    }
    let mut previous = None;
    for start in contour_starts {
        let start = usize::from(*start);
        if start >= curve_count || previous.is_some_and(|value| start <= value) {
            return Err(BuildError::InvalidContour);
        }
        previous = Some(start);
    }
    Ok(())
}

pub fn build_bands(
    curves: &[Quadratic],
    bounds: Bounds,
    band_count: u16,
) -> Result<GlyphBands, BuildError> {
    if band_count == 0 {
        return Err(BuildError::InvalidBandCount);
    }
    Ok(GlyphBands {
        horizontal: build_axis_bands(curves, bounds, band_count, Axis::Horizontal)?,
        vertical: build_axis_bands(curves, bounds, band_count, Axis::Vertical)?,
    })
}

#[derive(Clone, Copy)]
enum Axis {
    Horizontal,
    Vertical,
}

fn build_axis_bands(
    curves: &[Quadratic],
    bounds: Bounds,
    band_count: u16,
    axis: Axis,
) -> Result<Vec<Band>, BuildError> {
    let count = usize::from(band_count);
    let mut bands = Vec::new();
    bands
        .try_reserve_exact(count)
        .map_err(|_| BuildError::Allocation)?;
    bands.resize_with(count, || Band {
        curve_indices: Vec::new(),
    });
    let (band_min, band_max) = match axis {
        Axis::Horizontal => (bounds.min_y, bounds.max_y),
        Axis::Vertical => (bounds.min_x, bounds.max_x),
    };
    let range = band_max - band_min;
    if range <= 0.0 {
        return Ok(bands);
    }
    let size = range / f32::from(band_count);
    for (curve_index, curve) in curves.iter().enumerate() {
        let [a, b, c] = match axis {
            Axis::Horizontal => [curve.p0.y, curve.p1.y, curve.p2.y],
            Axis::Vertical => [curve.p0.x, curve.p1.x, curve.p2.x],
        };
        let curve_min = a.min(b).min(c);
        let curve_max = a.max(b).max(c);
        if curve_max - curve_min < AXIS_EPSILON {
            continue;
        }
        let start = (((curve_min - band_min - BAND_EPSILON) / size).floor() as i32)
            .clamp(0, i32::from(band_count) - 1);
        let end = (((curve_max - band_min + BAND_EPSILON) / size).floor() as i32)
            .clamp(0, i32::from(band_count) - 1);
        let index = u16::try_from(curve_index).map_err(|_| BuildError::TooManyCurves)?;
        for band_index in start..=end {
            bands[band_index as usize]
                .curve_indices
                .try_reserve(1)
                .map_err(|_| BuildError::Allocation)?;
            bands[band_index as usize].curve_indices.push(index);
        }
    }
    for band in &mut bands {
        band.curve_indices.sort_by(|left, right| {
            let left = curve_sort_max(curves[usize::from(*left)], axis);
            let right = curve_sort_max(curves[usize::from(*right)], axis);
            right.total_cmp(&left)
        });
    }
    Ok(bands)
}

fn curve_sort_max(curve: Quadratic, axis: Axis) -> f32 {
    match axis {
        Axis::Horizontal => curve.p0.x.max(curve.p1.x).max(curve.p2.x),
        Axis::Vertical => curve.p0.y.max(curve.p1.y).max(curve.p2.y),
    }
}

/// Convert a line into Slug's slightly bowed degenerate quadratic.
pub fn line_to_quadratic(start: Point, end: Point, units_per_em: f32) -> Quadratic {
    let middle = start.midpoint(end);
    let dx = end.x - start.x;
    let dy = end.y - start.y;
    if dx.abs() < 1.0e-6 || dy.abs() < 1.0e-6 {
        return Quadratic {
            p0: start,
            p1: middle,
            p2: end,
        };
    }
    let epsilon = LINE_EPSILON_FONT_UNITS / units_per_em;
    let inverse_length = epsilon / (dx * dx + dy * dy).sqrt();
    Quadratic {
        p0: start,
        p1: Point::new(
            middle.x - dy * inverse_length,
            middle.y + dx * inverse_length,
        ),
        p2: end,
    }
}

/// Port of the legacy fixed cubic conversion: split once and fit two quadratics.
pub fn cubic_to_quadratics(cubic: Cubic) -> [Quadratic; 2] {
    let (first, second) = split_cubic(cubic);
    [fit_quadratic(first), fit_quadratic(second)]
}

fn fit_quadratic(cubic: Cubic) -> Quadratic {
    Quadratic {
        p0: cubic.p0,
        p1: Point::new(
            (-cubic.p0.x + 3.0 * cubic.p1.x + 3.0 * cubic.p2.x - cubic.p3.x) * 0.25,
            (-cubic.p0.y + 3.0 * cubic.p1.y + 3.0 * cubic.p2.y - cubic.p3.y) * 0.25,
        ),
        p2: cubic.p3,
    }
}

fn split_cubic(cubic: Cubic) -> (Cubic, Cubic) {
    let m01 = cubic.p0.midpoint(cubic.p1);
    let m12 = cubic.p1.midpoint(cubic.p2);
    let m23 = cubic.p2.midpoint(cubic.p3);
    let m012 = m01.midpoint(m12);
    let m123 = m12.midpoint(m23);
    let middle = m012.midpoint(m123);
    (
        Cubic {
            p0: cubic.p0,
            p1: m01,
            p2: m012,
            p3: middle,
        },
        Cubic {
            p0: middle,
            p1: m123,
            p2: m23,
            p3: cubic.p3,
        },
    )
}

#[cfg(test)]
mod tests {
    use alloc::vec;

    use super::*;

    fn curve(points: [f32; 6]) -> Quadratic {
        Quadratic {
            p0: Point::new(points[0], points[1]),
            p1: Point::new(points[2], points[3]),
            p2: Point::new(points[4], points[5]),
        }
    }

    fn unit_square() -> Vec<Quadratic> {
        vec![
            curve([0.0, 0.0, 0.5, 0.0, 1.0, 0.0]),
            curve([1.0, 0.0, 1.0, 0.5, 1.0, 1.0]),
            curve([1.0, 1.0, 0.5, 1.0, 0.0, 1.0]),
            curve([0.0, 1.0, 0.0, 0.5, 0.0, 0.0]),
        ]
    }

    #[test]
    fn exact_bounds_exclude_unreached_control_point() {
        let geometry = build_glyph_geometry(
            vec![curve([0.0, 0.0, 0.5, 2.0, 1.0, 0.0])],
            vec![0],
            DEFAULT_BAND_COUNT,
        )
        .unwrap();
        assert_eq!(geometry.bounds.min_x, 0.0);
        assert_eq!(geometry.bounds.max_x, 1.0);
        assert_eq!(geometry.bounds.max_y, 1.0);
    }

    #[test]
    fn bands_preserve_legacy_axis_filter_and_sort_order() {
        let curves = vec![
            curve([0.1, 0.0, 0.15, 0.5, 0.2, 1.0]),
            curve([0.8, 0.0, 0.85, 0.5, 0.9, 1.0]),
            curve([0.4, 0.0, 0.45, 0.5, 0.5, 1.0]),
            curve([0.0, 0.5, 0.5, 0.5, 1.0, 0.5]),
        ];
        let bands = build_bands(
            &curves,
            Bounds {
                min_x: 0.0,
                min_y: 0.0,
                max_x: 1.0,
                max_y: 1.0,
            },
            1,
        )
        .unwrap();
        assert_eq!(bands.horizontal[0].curve_indices, [1, 2, 0]);
        assert!(!bands.horizontal[0].curve_indices.contains(&3));
    }

    #[test]
    fn line_bowing_keeps_axis_aligned_lines_exact() {
        let horizontal = line_to_quadratic(Point::new(0.0, 0.0), Point::new(1.0, 0.0), 2048.0);
        assert_eq!(horizontal.p1, Point::new(0.5, 0.0));
        let diagonal = line_to_quadratic(Point::new(0.0, 0.0), Point::new(1.0, 1.0), 2048.0);
        assert_ne!(diagonal.p1, Point::new(0.5, 0.5));
    }

    #[test]
    fn fixed_cubic_conversion_is_continuous() {
        let converted = cubic_to_quadratics(Cubic {
            p0: Point::new(0.0, 0.0),
            p1: Point::new(0.0, 1.0),
            p2: Point::new(1.0, 1.0),
            p3: Point::new(1.0, 0.0),
        });
        assert_eq!(converted[0].p0, Point::new(0.0, 0.0));
        assert_eq!(converted[0].p2, converted[1].p0);
        assert_eq!(converted[1].p2, Point::new(1.0, 0.0));
    }

    #[test]
    fn unit_square_builds_default_bands() {
        let geometry = build_glyph_geometry(unit_square(), vec![0], DEFAULT_BAND_COUNT).unwrap();
        assert_eq!(geometry.bounds.min_x, 0.0);
        assert_eq!(geometry.bounds.max_y, 1.0);
        assert_eq!(geometry.bands.horizontal.len(), 16);
        assert_eq!(geometry.bands.vertical.len(), 16);
    }
}
