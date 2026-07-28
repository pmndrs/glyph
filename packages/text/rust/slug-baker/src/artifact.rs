use alloc::{format, string::String, vec::Vec};

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;

use pmndrs_text_slug_core::{
    Bounds, BuildError, DEFAULT_BAND_COUNT, GlyphBands, GlyphForPacking, GlyphGeometry, PackError,
    PackedSlug, PackerConfig, Point, Quadratic, build_bands, build_glyph_geometry, pack_glyphs,
    quantize_f16,
};
use pmndrs_text_slug_fontations::{FontOutlineError, font_glyph_geometry, glyph_count};
use skrifa::{FontRef, GlyphId};

use crate::{
    error::{SlugBakeError, SlugBakeErrorCode, overflow},
    glb::build_slug_glb,
    model::{
        SLUG_EXTENSION, SLUG_FORMAT_VERSION, SLUG_KIND, SLUG_PLANE_UNITS_PER_EM,
        SlugBakeArtifactV0, SlugBakeRequestV0, SlugBakeResultV0, SlugDescriptorV0,
        SlugPageReportV0, SlugPayloadReportV0,
    },
};

#[cfg(any(
    all(
        feature = "autoresearch-fixed32-bands",
        feature = "autoresearch-adaptive-bands"
    ),
    all(
        feature = "autoresearch-fixed32-bands",
        feature = "autoresearch-adaptive32-bands"
    ),
    all(
        feature = "autoresearch-adaptive-bands",
        feature = "autoresearch-adaptive32-bands"
    ),
    all(
        feature = "autoresearch-fixed32-bands",
        feature = "autoresearch-hull-bands"
    ),
    all(
        feature = "autoresearch-adaptive-bands",
        feature = "autoresearch-hull-bands"
    ),
    all(
        feature = "autoresearch-adaptive32-bands",
        feature = "autoresearch-hull-bands"
    )
))]
compile_error!("select exactly one Slug autoresearch feature");

const ADAPTIVE_MEAN_REFERENCE_TARGET: usize = 6;
const ADAPTIVE_BAND_COUNTS: [u16; 3] = [16, 32, 64];
const ADAPTIVE32_BAND_COUNTS: [u16; 2] = [16, 32];

/// Bake one deterministic analytic Slug resource from the exact shaping font source.
pub fn bake_slug(
    source: &[u8],
    request: SlugBakeRequestV0,
) -> Result<SlugBakeResultV0, SlugBakeError> {
    request.descriptor.validate()?;
    validate_hash("shapingHash", &request.shaping_hash)?;
    validate_hash("rasterKey", &request.raster_key)?;
    if request.raster_key != descriptor_raster_key(&request.descriptor) {
        return Err(SlugBakeError::new(
            SlugBakeErrorCode::InvalidIdentity,
            "raster key does not match the canonical Slug descriptor",
        )
        .at("/rasterKey"));
    }

    let packed = rasterize_font(source, request.font_face_index, request.glyph_count)?;
    let metadata_bytes = packed.record_bytes.len();
    let built = build_slug_glb(
        &request.raster_key,
        &request.shaping_hash,
        request.glyph_count,
        request.packaging.pages,
        &packed,
    )?;
    let raster_id = format!("slug-{}-{}.glb", request.shaping_hash, request.raster_key);
    let mut artifacts = Vec::new();
    artifacts
        .try_reserve_exact(1 + built.resources.len())
        .map_err(|_| overflow())?;
    artifacts.push(SlugBakeArtifactV0 {
        role: "raster".into(),
        id: raster_id,
        sha256: pmndrs_text_raster_artifact::sha256_hex(&built.bytes),
        bytes: built.bytes,
    });
    for resource in built.resources {
        if !resource.embedded {
            artifacts.push(SlugBakeArtifactV0 {
                role: "raster-page".into(),
                id: resource.id,
                bytes: resource.bytes,
                sha256: resource.sha256,
            });
        }
    }
    let serialized_bytes = artifacts.iter().try_fold(0_usize, |total, artifact| {
        total.checked_add(artifact.bytes.len()).ok_or_else(overflow)
    })?;
    let mut gpu_bytes = 0_usize;
    let mut pages = Vec::new();
    pages
        .try_reserve_exact(built.page_reports.len())
        .map_err(|_| overflow())?;
    for page in built.page_reports {
        gpu_bytes = gpu_bytes.checked_add(page.gpu_bytes).ok_or_else(overflow)?;
        pages.push(SlugPageReportV0 {
            width: page.width,
            height: page.height,
            format: "rgba16float".into(),
            mip_bytes: page.gpu_bytes,
            source: if page.embedded {
                "embedded"
            } else {
                "external"
            }
            .into(),
            encoded_bytes: page.encoded_bytes,
        });
    }
    Ok(SlugBakeResultV0 {
        raster_key: request.raster_key,
        kind: SLUG_KIND.into(),
        extension: SLUG_EXTENSION.into(),
        version: SLUG_FORMAT_VERSION,
        artifacts,
        report: SlugPayloadReportV0 {
            metadata_bytes,
            serialized_bytes,
            gpu_bytes,
            pages,
        },
    })
}

pub fn descriptor_raster_key(descriptor: &SlugDescriptorV0) -> String {
    let canonical = format!(
        "{{\"descriptor\":{{\"generatorVersion\":\"{}\"}},\"extension\":\"{}\",\"kind\":\"{}\",\"version\":{}}}",
        descriptor.generator_version, SLUG_EXTENSION, SLUG_KIND, SLUG_FORMAT_VERSION,
    );
    pmndrs_text_raster_artifact::sha256_hex(canonical.as_bytes())
}

fn rasterize_font(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
) -> Result<PackedSlug, SlugBakeError> {
    let font = FontRef::from_index(source, face_index).map_err(|error| {
        SlugBakeError::new(SlugBakeErrorCode::InvalidFontFace, error).at("/fontFaceIndex")
    })?;
    let actual_glyph_count = glyph_count(&font)
        .map_err(|error| SlugBakeError::new(SlugBakeErrorCode::InvalidFont, error))?;
    if actual_glyph_count != expected_glyph_count {
        return Err(SlugBakeError::new(
            SlugBakeErrorCode::InvalidGlyphCount,
            "source font glyph count does not match the shaping context",
        )
        .at("/glyphCount"));
    }

    let mut geometries = Vec::<Option<(GlyphGeometry, [i16; 4])>>::new();
    geometries
        .try_reserve_exact(usize::from(actual_glyph_count))
        .map_err(|_| overflow())?;
    crate::progress::report(0, u32::from(actual_glyph_count));
    for raw_glyph_id in 0..actual_glyph_count {
        crate::progress::report(u32::from(raw_glyph_id), u32::from(actual_glyph_count));
        let geometry = font_glyph_geometry(
            &font,
            GlyphId::new(u32::from(raw_glyph_id)),
            DEFAULT_BAND_COUNT,
        )
        .map_err(|error| outline_error(raw_glyph_id, error))?;
        geometries.push(match geometry {
            None => None,
            Some(geometry) => Some(prepare_geometry(geometry, raw_glyph_id)?),
        });
    }
    crate::progress::report(u32::from(actual_glyph_count), u32::from(actual_glyph_count));

    let mut glyphs = Vec::new();
    glyphs
        .try_reserve_exact(geometries.len())
        .map_err(|_| overflow())?;
    for geometry in &geometries {
        glyphs.push(match geometry {
            None => GlyphForPacking::Missing,
            Some((geometry, plane_bounds)) => GlyphForPacking::Present {
                plane_bounds: *plane_bounds,
                geometry,
            },
        });
    }
    pack_glyphs(&glyphs, PackerConfig::default()).map_err(pack_error)
}

/// Round every analytic input through the exact half-float payload before deriving bounds/bands.
fn prepare_geometry(
    geometry: GlyphGeometry,
    glyph_id: u16,
) -> Result<(GlyphGeometry, [i16; 4]), SlugBakeError> {
    let mut curves = geometry.curves;
    for curve in &mut curves {
        for point in [&mut curve.p0, &mut curve.p1, &mut curve.p2] {
            *point = Point::new(
                quantize_f16(point.x).map_err(pack_error)?,
                quantize_f16(point.y).map_err(pack_error)?,
            );
        }
    }
    let mut geometry = build_glyph_geometry(curves, geometry.contour_starts, DEFAULT_BAND_COUNT)
        .map_err(|error| outline_error(glyph_id, FontOutlineError::Geometry(error)))?;
    let plane_bounds = quantize_plane_bounds(geometry.bounds, glyph_id)?;
    let band_bounds = Bounds {
        min_x: f32::from(plane_bounds[0]) / f32::from(SLUG_PLANE_UNITS_PER_EM),
        min_y: f32::from(plane_bounds[1]) / f32::from(SLUG_PLANE_UNITS_PER_EM),
        max_x: f32::from(plane_bounds[2]) / f32::from(SLUG_PLANE_UNITS_PER_EM),
        max_y: f32::from(plane_bounds[3]) / f32::from(SLUG_PLANE_UNITS_PER_EM),
    };
    geometry.bounds = band_bounds;
    geometry.bands = select_bands(&geometry.curves, band_bounds)
        .map_err(|error| outline_error(glyph_id, FontOutlineError::Geometry(error)))?;
    Ok((geometry, plane_bounds))
}

fn select_bands(curves: &[Quadratic], bounds: Bounds) -> Result<GlyphBands, BuildError> {
    if cfg!(feature = "autoresearch-fixed32-bands") {
        return build_bands(curves, bounds, 32);
    }
    let adaptive_band_counts: &[u16] = if cfg!(feature = "autoresearch-adaptive-bands") {
        &ADAPTIVE_BAND_COUNTS
    } else if cfg!(feature = "autoresearch-adaptive32-bands") {
        &ADAPTIVE32_BAND_COUNTS
    } else {
        return build_bands(curves, bounds, DEFAULT_BAND_COUNT);
    };
    let mut selected = None;
    for &band_count in adaptive_band_counts {
        let bands = build_bands(curves, bounds, band_count)?;
        let reference_count = bands
            .horizontal
            .iter()
            .chain(&bands.vertical)
            .map(|band| band.curve_indices.len())
            .sum::<usize>();
        let target = usize::from(band_count) * 2 * ADAPTIVE_MEAN_REFERENCE_TARGET;
        selected = Some(bands);
        if reference_count <= target {
            break;
        }
    }
    selected.ok_or(BuildError::InvalidBandCount)
}

fn quantize_plane_bounds(bounds: Bounds, glyph_id: u16) -> Result<[i16; 4], SlugBakeError> {
    let scale = f32::from(SLUG_PLANE_UNITS_PER_EM);
    let values = [
        (bounds.min_x * scale).floor(),
        (bounds.min_y * scale).floor(),
        (bounds.max_x * scale).ceil(),
        (bounds.max_y * scale).ceil(),
    ];
    let mut output = [0_i16; 4];
    for (index, value) in values.into_iter().enumerate() {
        if !value.is_finite() || value < f32::from(i16::MIN) || value > f32::from(i16::MAX) {
            return Err(SlugBakeError::new(
                SlugBakeErrorCode::InvalidGlyphOutline,
                format!("glyph {glyph_id} plane bounds exceed the Slug V0 i16 domain"),
            ));
        }
        output[index] = value as i16;
    }
    Ok(output)
}

fn validate_hash(field: &str, value: &str) -> Result<(), SlugBakeError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Ok(());
    }
    Err(SlugBakeError::new(
        SlugBakeErrorCode::InvalidIdentity,
        format!("{field} must be a lowercase SHA-256 hex digest"),
    )
    .at(format!("/{field}")))
}

fn outline_error(glyph_id: u16, error: FontOutlineError) -> SlugBakeError {
    SlugBakeError::new(
        SlugBakeErrorCode::InvalidGlyphOutline,
        format!("unable to normalize Slug outline for glyph {glyph_id}: {error:?}"),
    )
}

fn pack_error(error: PackError) -> SlugBakeError {
    let code = match error {
        PackError::GlyphTooLarge => SlugBakeErrorCode::GlyphTooLarge,
        PackError::Allocation
        | PackError::ArithmeticOverflow
        | PackError::TooManyPages
        | PackError::U16Overflow
        | PackError::U32Overflow => SlugBakeErrorCode::ArithmeticOverflow,
        _ => SlugBakeErrorCode::InvalidGlyphOutline,
    };
    SlugBakeError::new(code, format!("unable to pack Slug font: {error:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SLUG_GENERATOR_VERSION;

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );

    #[test]
    fn bakes_dense_inter_records_deterministically() {
        let descriptor = SlugDescriptorV0 {
            generator_version: SLUG_GENERATOR_VERSION.into(),
        };
        let raster_key = descriptor_raster_key(&descriptor);
        let request = || SlugBakeRequestV0 {
            font_face_index: 0,
            glyph_count: 2937,
            shaping_hash: "11".repeat(32),
            raster_key: raster_key.clone(),
            packaging: crate::model::SlugPackagingV0 {
                artifact: crate::model::ArtifactPackaging::External,
                pages: crate::model::PagePackaging::Embedded,
            },
            descriptor: descriptor.clone(),
        };
        let first = bake_slug(INTER, request()).unwrap();
        let second = bake_slug(INTER, request()).unwrap();
        assert_eq!(first.artifacts[0].sha256, second.artifacts[0].sha256);
        assert_eq!(first.report.metadata_bytes, 2937 * 40);
    }

    #[cfg(any(
        feature = "autoresearch-adaptive-bands",
        feature = "autoresearch-adaptive32-bands"
    ))]
    #[test]
    fn adaptive_policy_keeps_sparse_glyphs_and_expands_dense_glyphs() {
        let bounds = Bounds {
            min_x: 0.0,
            min_y: 0.0,
            max_x: 1.0,
            max_y: 1.0,
        };
        let diagonal = Quadratic {
            p0: Point::new(0.0, 0.0),
            p1: Point::new(0.5, 0.5),
            p2: Point::new(1.0, 1.0),
        };
        let sparse = select_bands(&[diagonal; 2], bounds).unwrap();
        assert_eq!(sparse.horizontal.len(), 16);
        assert_eq!(sparse.vertical.len(), 16);
        let dense = select_bands(&[diagonal; 7], bounds).unwrap();
        let expected_dense_count = if cfg!(feature = "autoresearch-adaptive-bands") {
            64
        } else {
            32
        };
        assert_eq!(dense.horizontal.len(), expected_dense_count);
        assert_eq!(dense.vertical.len(), expected_dense_count);
    }
}
