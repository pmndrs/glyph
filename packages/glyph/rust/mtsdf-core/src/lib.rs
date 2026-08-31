#![cfg_attr(not(any(feature = "std", test)), no_std)]

extern crate alloc;

mod color;
mod distance;
mod error_correction;
mod math;
mod outline;

use alloc::vec::Vec;
use core::{convert::Infallible, fmt};

pub use outline::{Bounds, OutlineSink, OutlineSource};

use crate::{
    color::color_edges,
    distance::{ContourDistance, Distance4},
    error_correction::{
        correct_interpolation_artifacts, mark_protected_corners, mark_protected_edges,
    },
    math::Point,
    outline::{BuildFailure, Edge, EdgeSoa, OutlineStorage},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GeneratorLimits {
    pub max_edges: usize,
    pub max_output_bytes: usize,
}

impl Default for GeneratorLimits {
    fn default() -> Self {
        Self {
            max_edges: 65_535,
            max_output_bytes: 256 * 1024 * 1024,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AtlasRegion {
    pub inner_width: usize,
    pub inner_height: usize,
    pub padding_x: usize,
    pub padding_y: usize,
}

/// Fixed sampling transform for an atlas region.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MtsdfTransform {
    bounds: Bounds,
    full_distance_range: f32,
}

impl MtsdfTransform {
    pub fn new(bounds: Bounds, full_distance_range_font_units: f32) -> Option<Self> {
        if !bounds.is_valid()
            || !full_distance_range_font_units.is_finite()
            || full_distance_range_font_units <= 0.0
        {
            return None;
        }
        Some(Self {
            bounds,
            full_distance_range: full_distance_range_font_units,
        })
    }

    pub fn bounds(self) -> Bounds {
        self.bounds
    }

    pub fn full_distance_range_font_units(self) -> f32 {
        self.full_distance_range
    }
}

impl AtlasRegion {
    pub fn total_width(self) -> Option<usize> {
        self.padding_x
            .checked_mul(2)
            .and_then(|padding| self.inner_width.checked_add(padding))
    }

    pub fn total_height(self) -> Option<usize> {
        self.padding_y
            .checked_mul(2)
            .and_then(|padding| self.inner_height.checked_add(padding))
    }

    fn output_byte_len(self) -> Option<usize> {
        self.total_width()?
            .checked_mul(self.total_height()?)?
            .checked_mul(4)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadOutlineError<E> {
    Source(E),
    Allocation,
    EdgeLimit,
    EmptyOutline,
    InvalidBounds,
    InvalidUnitsPerEm,
    MissingMove,
    NestedMove,
    NonFiniteCoordinate,
}

impl<E: fmt::Display> fmt::Display for ReadOutlineError<E> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Source(error) => write!(formatter, "outline source failed: {error}"),
            Self::Allocation => formatter.write_str("MTSDF outline allocation failed"),
            Self::EdgeLimit => formatter.write_str("MTSDF outline exceeded its edge limit"),
            Self::EmptyOutline => formatter.write_str("MTSDF outline is empty"),
            Self::InvalidBounds => formatter.write_str("MTSDF outline bounds are invalid"),
            Self::InvalidUnitsPerEm => formatter.write_str("MTSDF units per em are invalid"),
            Self::MissingMove => formatter.write_str("MTSDF outline command requires move_to"),
            Self::NestedMove => {
                formatter.write_str("MTSDF outline starts a new contour before close")
            }
            Self::NonFiniteCoordinate => {
                formatter.write_str("MTSDF outline contains a non-finite coordinate")
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenerateError {
    Allocation,
    InvalidRegion,
    InvalidTransform,
    OutputLimit,
}

impl fmt::Display for GenerateError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Allocation => formatter.write_str("MTSDF output allocation failed"),
            Self::InvalidRegion => formatter.write_str("MTSDF atlas region is invalid"),
            Self::InvalidTransform => formatter.write_str("MTSDF sampling transform is invalid"),
            Self::OutputLimit => formatter.write_str("MTSDF output exceeded its byte limit"),
        }
    }
}

#[cfg(feature = "std")]
impl<E> std::error::Error for ReadOutlineError<E> where E: fmt::Debug + fmt::Display {}

#[cfg(feature = "std")]
impl std::error::Error for GenerateError {}

#[derive(Default)]
struct GeneratorScratch {
    input: OutlineStorage,
    colored_edges: Vec<Edge>,
    colored_contours: Vec<core::ops::Range<usize>>,
    corners: Vec<usize>,
    hot_edges: EdgeSoa,
    contour_distances: Vec<ContourDistance>,
    #[cfg(feature = "adjacent-texel-tile-experiment")]
    contour_distances_tile: [Vec<ContourDistance>; 4],
    output: Vec<u8>,
    error_stencil: Vec<u8>,
    corner_protection: Vec<u8>,
}

pub struct MtsdfGenerator {
    limits: GeneratorLimits,
    scratch: GeneratorScratch,
}

impl Default for MtsdfGenerator {
    fn default() -> Self {
        Self::new(GeneratorLimits::default())
    }
}

impl MtsdfGenerator {
    pub fn new(limits: GeneratorLimits) -> Self {
        Self {
            limits,
            scratch: GeneratorScratch::default(),
        }
    }

    pub fn limits(&self) -> GeneratorLimits {
        self.limits
    }

    pub fn read_outline<'generator, Source: OutlineSource>(
        &'generator mut self,
        source: &Source,
    ) -> Result<GlyphOutline<'generator>, ReadOutlineError<Source::Error>> {
        let units_per_em = source.units_per_em();
        if !units_per_em.is_finite() || units_per_em <= 0.0 {
            return Err(ReadOutlineError::InvalidUnitsPerEm);
        }
        let bounds = source.bounds();
        if !bounds.is_valid() {
            return Err(ReadOutlineError::InvalidBounds);
        }

        self.scratch.input.clear();
        let mut sink = OutlineSink::new(&mut self.scratch.input, self.limits.max_edges);
        source.emit(&mut sink).map_err(ReadOutlineError::Source)?;
        sink.finish().map_err(map_build_failure)?;
        if self.scratch.input.edges.is_empty() {
            return Err(ReadOutlineError::EmptyOutline);
        }

        color_edges(
            &self.scratch.input.edges,
            &self.scratch.input.contours,
            &mut self.scratch.colored_edges,
            &mut self.scratch.colored_contours,
            &mut self.scratch.corners,
        )
        .map_err(map_build_failure)?;
        if self.scratch.colored_edges.len() > self.limits.max_edges.saturating_mul(3) {
            return Err(ReadOutlineError::EdgeLimit);
        }
        self.scratch
            .hot_edges
            .populate(&self.scratch.colored_edges, &self.scratch.colored_contours)
            .map_err(map_build_failure)?;

        Ok(GlyphOutline {
            generator: self,
            bounds,
            units_per_em,
        })
    }
}

fn map_build_failure<E>(failure: BuildFailure) -> ReadOutlineError<E> {
    match failure {
        BuildFailure::Allocation => ReadOutlineError::Allocation,
        BuildFailure::EdgeLimit => ReadOutlineError::EdgeLimit,
        BuildFailure::NonFiniteCoordinate => ReadOutlineError::NonFiniteCoordinate,
        BuildFailure::MissingMove => ReadOutlineError::MissingMove,
        BuildFailure::NestedMove => ReadOutlineError::NestedMove,
    }
}

pub struct GlyphOutline<'generator> {
    generator: &'generator mut MtsdfGenerator,
    bounds: Bounds,
    units_per_em: f32,
}

impl GlyphOutline<'_> {
    pub fn bounds(&self) -> Bounds {
        self.bounds
    }

    pub fn units_per_em(&self) -> f32 {
        self.units_per_em
    }

    #[cfg(feature = "profiling")]
    /// Number of color-split edges visited for every generated texel.
    pub fn edge_count(&self) -> usize {
        let edges = &self.generator.scratch.hot_edges;
        edges.lines.x0.len() + edges.quadratics.x0.len() + edges.cubics.x0.len()
    }

    pub fn generate_mtsdf(&mut self, region: AtlasRegion) -> Result<&[u8], GenerateError> {
        let transform = MtsdfTransform {
            bounds: self.bounds,
            full_distance_range: self.units_per_em,
        };
        self.generate_mtsdf_with_transform(region, transform)
    }

    pub fn generate_mtsdf_with_transform(
        &mut self,
        region: AtlasRegion,
        transform: MtsdfTransform,
    ) -> Result<&[u8], GenerateError> {
        if region.inner_width == 0 || region.inner_height == 0 {
            return Err(GenerateError::InvalidRegion);
        }
        let source_bounds = self.bounds;
        let bounds = transform.bounds;
        if bounds.min_x > source_bounds.min_x
            || bounds.min_y > source_bounds.min_y
            || bounds.max_x < source_bounds.max_x
            || bounds.max_y < source_bounds.max_y
        {
            return Err(GenerateError::InvalidTransform);
        }
        let Some(total_width) = region.total_width() else {
            return Err(GenerateError::InvalidRegion);
        };
        let Some(total_height) = region.total_height() else {
            return Err(GenerateError::InvalidRegion);
        };
        let Some(output_len) = region.output_byte_len() else {
            return Err(GenerateError::InvalidRegion);
        };
        if output_len > self.generator.limits.max_output_bytes {
            return Err(GenerateError::OutputLimit);
        }
        let output = &mut self.generator.scratch.output;
        if output_len > output.len() {
            output
                .try_reserve_exact(output_len - output.len())
                .map_err(|_| GenerateError::Allocation)?;
        }
        output.resize(output_len, 0);

        let contour_count = self.generator.scratch.hot_edges.contour_windings.len();
        let contour_distances = &mut self.generator.scratch.contour_distances;
        if contour_count > contour_distances.len() {
            contour_distances
                .try_reserve_exact(contour_count - contour_distances.len())
                .map_err(|_| GenerateError::Allocation)?;
            contour_distances.resize(contour_count, ContourDistance::default());
        } else {
            contour_distances.truncate(contour_count);
        }
        #[cfg(feature = "adjacent-texel-tile-experiment")]
        for contours in &mut self.generator.scratch.contour_distances_tile {
            if contour_count > contours.len() {
                contours
                    .try_reserve_exact(contour_count - contours.len())
                    .map_err(|_| GenerateError::Allocation)?;
                contours.resize(contour_count, ContourDistance::default());
            } else {
                contours.truncate(contour_count);
            }
        }

        let edges = &self.generator.scratch.hot_edges;
        let contour_distances = &mut self.generator.scratch.contour_distances;
        #[cfg(not(feature = "adjacent-texel-tile-experiment"))]
        for (output_y, row) in output.chunks_exact_mut(total_width * 4).enumerate() {
            let source_y = total_height - output_y - 1;
            let y_ratio =
                (source_y as f32 + 0.5 - region.padding_y as f32) / region.inner_height as f32;
            let y = bounds.min_y + bounds.height() * y_ratio;
            for (x, pixel) in row.chunks_exact_mut(4).enumerate() {
                let x_ratio =
                    (x as f32 + 0.5 - region.padding_x as f32) / region.inner_width as f32;
                let point = Point::new(bounds.min_x + bounds.width() * x_ratio, y);
                let lanes = Distance4::evaluate(
                    point,
                    edges,
                    transform.full_distance_range,
                    contour_distances,
                )
                .lanes();
                #[cfg(all(target_arch = "wasm32", feature = "simd128-experiment"))]
                pixel.copy_from_slice(&math::quantize_unorm4(lanes));
                #[cfg(not(all(target_arch = "wasm32", feature = "simd128-experiment")))]
                {
                    pixel[0] = math::quantize_unorm(lanes[0]);
                    pixel[1] = math::quantize_unorm(lanes[1]);
                    pixel[2] = math::quantize_unorm(lanes[2]);
                    pixel[3] = math::quantize_unorm(lanes[3]);
                }
            }
        }
        #[cfg(feature = "adjacent-texel-tile-experiment")]
        {
            let contour_distances_tile = &mut self.generator.scratch.contour_distances_tile;
            for (output_y, row) in output.chunks_exact_mut(total_width * 4).enumerate() {
                let source_y = total_height - output_y - 1;
                let y_ratio =
                    (source_y as f32 + 0.5 - region.padding_y as f32) / region.inner_height as f32;
                let y = bounds.min_y + bounds.height() * y_ratio;
                let tiled_width = total_width / 4 * 4;
                let (tiled, remainder) = row.split_at_mut(tiled_width * 4);
                for (tile_x, tile) in tiled.chunks_exact_mut(16).enumerate() {
                    let first_x = tile_x * 4;
                    let points = core::array::from_fn(|lane| {
                        let x = first_x + lane;
                        let x_ratio =
                            (x as f32 + 0.5 - region.padding_x as f32) / region.inner_width as f32;
                        Point::new(bounds.min_x + bounds.width() * x_ratio, y)
                    });
                    let distances = Distance4::evaluate_tile(
                        points,
                        edges,
                        transform.full_distance_range,
                        contour_distances_tile,
                    );
                    for (pixel, distance) in tile.chunks_exact_mut(4).zip(distances) {
                        let lanes = distance.lanes();
                        pixel[0] = math::quantize_unorm(lanes[0]);
                        pixel[1] = math::quantize_unorm(lanes[1]);
                        pixel[2] = math::quantize_unorm(lanes[2]);
                        pixel[3] = math::quantize_unorm(lanes[3]);
                    }
                }
                for (offset, pixel) in remainder.chunks_exact_mut(4).enumerate() {
                    let x = tiled_width + offset;
                    let x_ratio =
                        (x as f32 + 0.5 - region.padding_x as f32) / region.inner_width as f32;
                    let point = Point::new(bounds.min_x + bounds.width() * x_ratio, y);
                    let lanes = Distance4::evaluate(
                        point,
                        edges,
                        transform.full_distance_range,
                        contour_distances,
                    )
                    .lanes();
                    pixel[0] = math::quantize_unorm(lanes[0]);
                    pixel[1] = math::quantize_unorm(lanes[1]);
                    pixel[2] = math::quantize_unorm(lanes[2]);
                    pixel[3] = math::quantize_unorm(lanes[3]);
                }
            }
        }
        let horizontal_distance_delta = f64::from(bounds.width())
            / region.inner_width as f64
            / f64::from(transform.full_distance_range);
        let vertical_distance_delta = f64::from(bounds.height())
            / region.inner_height as f64
            / f64::from(transform.full_distance_range);
        mark_protected_corners(
            &self.generator.scratch.colored_edges,
            &self.generator.scratch.colored_contours,
            bounds,
            region,
            total_width,
            total_height,
            &mut self.generator.scratch.corner_protection,
        )
        .map_err(|()| GenerateError::Allocation)?;
        mark_protected_edges(
            output,
            total_width,
            total_height,
            horizontal_distance_delta,
            vertical_distance_delta,
            &mut self.generator.scratch.corner_protection,
        );
        correct_interpolation_artifacts(
            output,
            total_width,
            total_height,
            horizontal_distance_delta,
            vertical_distance_delta,
            &mut self.generator.scratch.error_stencil,
            &self.generator.scratch.corner_protection,
        )
        .map_err(|()| GenerateError::Allocation)?;
        Ok(output)
    }
}

pub fn median(red: u8, green: u8, blue: u8) -> u8 {
    red.min(green).max(red.max(green).min(blue))
}

pub type InfallibleReadError = ReadOutlineError<Infallible>;

#[cfg(test)]
mod tests {
    use super::*;

    const REGION: AtlasRegion = AtlasRegion {
        inner_width: 32,
        inner_height: 32,
        padding_x: 4,
        padding_y: 4,
    };

    struct Square;

    impl OutlineSource for Square {
        type Error = Infallible;

        fn units_per_em(&self) -> f32 {
            1_000.0
        }

        fn bounds(&self) -> Bounds {
            Bounds::new(100.0, 100.0, 900.0, 900.0)
        }

        fn emit(&self, sink: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
            sink.move_to(100.0, 100.0);
            sink.line_to(100.0, 900.0);
            sink.line_to(900.0, 900.0);
            sink.line_to(900.0, 100.0);
            sink.close();
            Ok(())
        }
    }

    #[test]
    fn square_is_deterministic_and_signed() {
        let mut generator = MtsdfGenerator::default();
        let first = generator
            .read_outline(&Square)
            .expect("square")
            .generate_mtsdf(REGION)
            .expect("MTSDF")
            .to_vec();
        let second = generator
            .read_outline(&Square)
            .expect("square")
            .generate_mtsdf(REGION)
            .expect("MTSDF")
            .to_vec();
        assert_eq!(first, second);
        let width = REGION.total_width().expect("width");
        let center = ((20 * width + 20) * 4) + 3;
        let outside = 3;
        assert!(first[center] > 128);
        assert!(first[outside] < 128);
        let hash = first.iter().fold(0x811c_9dc5_u32, |hash, byte| {
            (hash ^ u32::from(*byte)).wrapping_mul(0x0100_0193)
        });
        assert_eq!(hash, 0xe2a5_a9a1);
    }

    #[test]
    fn invalid_regions_are_typed_errors() {
        let mut generator = MtsdfGenerator::default();
        let mut outline = generator.read_outline(&Square).expect("square");
        assert_eq!(
            outline.generate_mtsdf(AtlasRegion {
                inner_width: 0,
                ..REGION
            }),
            Err(GenerateError::InvalidRegion)
        );
    }

    #[test]
    fn fixed_transform_preserves_scale_and_rejects_clipping() {
        let mut generator = MtsdfGenerator::default();
        let baseline = generator
            .read_outline(&Square)
            .expect("square")
            .generate_mtsdf(REGION)
            .expect("baseline")
            .to_vec();
        let equivalent = generator
            .read_outline(&Square)
            .expect("square")
            .generate_mtsdf_with_transform(
                REGION,
                MtsdfTransform::new(Square.bounds(), Square.units_per_em()).expect("transform"),
            )
            .expect("equivalent")
            .to_vec();
        assert_eq!(baseline, equivalent);

        let clipped = MtsdfTransform::new(Bounds::new(200.0, 200.0, 800.0, 800.0), 125.0)
            .expect("finite transform");
        assert_eq!(
            generator
                .read_outline(&Square)
                .expect("square")
                .generate_mtsdf_with_transform(REGION, clipped),
            Err(GenerateError::InvalidTransform)
        );
    }

    #[test]
    fn corner_and_output_scratch_are_reused_between_glyphs() {
        let mut generator = MtsdfGenerator::default();
        generator
            .read_outline(&Square)
            .expect("first square")
            .generate_mtsdf(REGION)
            .expect("first MTSDF");
        let first_capacities = (
            generator.scratch.corners.capacity(),
            generator.scratch.output.capacity(),
        );
        generator
            .read_outline(&Square)
            .expect("second square")
            .generate_mtsdf(REGION)
            .expect("second MTSDF");
        assert!(first_capacities.0 > 0);
        assert!(first_capacities.1 > 0);
        assert_eq!(
            first_capacities,
            (
                generator.scratch.corners.capacity(),
                generator.scratch.output.capacity(),
            )
        );
    }
}
