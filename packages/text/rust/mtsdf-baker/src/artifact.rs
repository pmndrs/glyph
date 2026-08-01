use alloc::{format, string::String, vec::Vec};

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;
use pmndrs_text_mtsdf_core::{
    AtlasRegion, GenerateError, MtsdfGenerator, MtsdfTransform, ReadOutlineError,
};
use pmndrs_text_mtsdf_fontations::{font_outline_source, glyph_count};
use pmndrs_text_raster_artifact::{
    ABSENT_PAGE, AtlasPage, GlyphRecordTable, RasterizedPage, resolve_raster_coverage,
};
use skrifa::{FontRef, GlyphId, MetadataProvider};

#[cfg(feature = "profiling")]
use crate::profile::{BakePhase, BakeProfiler, PhaseTimer};
use crate::{
    error::{MtsdfBakeError, MtsdfBakeErrorCode, overflow},
    glb::build_mtsdf_glb,
    model::{
        MSDF_EXTENSION, MSDF_FORMAT_VERSION, MSDF_KIND, MtsdfBakeArtifactV0, MtsdfBakeRequestV0,
        MtsdfBakeResultV0, MtsdfBakeSettingsV0, MtsdfDescriptorV0, MtsdfPageReportV0,
        MtsdfPayloadReportV0,
    },
};

const ATLAS_LIMIT: u16 = 1024;
const ATLAS_GLYPH_GAP: u16 = 1;
const MAX_ATLAS_PAGES: usize = 60;

pub(crate) struct RasterizedMtsdf {
    pub(crate) records: Vec<u8>,
    pub(crate) pages: Vec<RasterizedPage>,
    pub(crate) coverage: Option<Vec<u8>>,
}

/// Bake one fixed, deterministic linear-RGBA8 MTSDF resource.
pub fn bake_mtsdf(
    source: &[u8],
    request: MtsdfBakeRequestV0,
) -> Result<MtsdfBakeResultV0, MtsdfBakeError> {
    #[cfg(feature = "profiling")]
    {
        bake_mtsdf_internal(source, request, &mut BakeProfiler::start())
    }
    #[cfg(not(feature = "profiling"))]
    {
        bake_mtsdf_internal(source, request)
    }
}

#[cfg(feature = "profiling")]
pub fn bake_mtsdf_profiled(
    source: &[u8],
    request: MtsdfBakeRequestV0,
) -> Result<crate::profile::ProfiledMtsdfBake, MtsdfBakeError> {
    let mut profiler = BakeProfiler::start();
    let result = bake_mtsdf_internal(source, request, &mut profiler)?;
    Ok(crate::profile::ProfiledMtsdfBake {
        result,
        profile: profiler.finish(),
    })
}

fn bake_mtsdf_internal(
    source: &[u8],
    request: MtsdfBakeRequestV0,
    #[cfg(feature = "profiling")] profiler: &mut BakeProfiler,
) -> Result<MtsdfBakeResultV0, MtsdfBakeError> {
    let settings = request.descriptor.validate()?;
    validate_hash("shapingHash", &request.shaping_hash)?;
    validate_hash("rasterKey", &request.raster_key)?;
    let expected_raster_key = descriptor_raster_key(&request.descriptor);
    if request.raster_key != expected_raster_key {
        return Err(MtsdfBakeError::new(
            MtsdfBakeErrorCode::InvalidIdentity,
            "raster key does not match the canonical MTSDF descriptor",
        )
        .at("/rasterKey"));
    }

    let rasterized = rasterize_font(
        source,
        request.font_face_index,
        request.glyph_count,
        settings,
        request.descriptor.coverage.as_ref(),
        #[cfg(feature = "profiling")]
        profiler,
    )?;
    let metadata_bytes = rasterized.records.len()
        + rasterized
            .coverage
            .as_ref()
            .map_or(0, |coverage| coverage.len());
    let built = build_mtsdf_glb(
        &request.raster_key,
        &request.shaping_hash,
        request.glyph_count,
        request.packaging.pages,
        settings,
        request.descriptor.coverage.as_ref(),
        &rasterized,
        #[cfg(feature = "profiling")]
        profiler,
    )?;
    let raster_id = format!("msdf-{}-{}.glb", request.shaping_hash, request.raster_key);
    let raster_hash = pmndrs_text_raster_artifact::sha256_hex(&built.bytes);
    let mut artifacts = Vec::new();
    artifacts
        .try_reserve_exact(1 + built.pages.len())
        .map_err(|_| overflow())?;
    artifacts.push(MtsdfBakeArtifactV0 {
        role: "raster".into(),
        id: raster_id,
        bytes: built.bytes,
        sha256: raster_hash,
    });
    let mut page_reports = Vec::new();
    page_reports
        .try_reserve_exact(built.pages.len())
        .map_err(|_| overflow())?;
    let mut gpu_bytes = 0_usize;
    for page in built.pages {
        let page_gpu_bytes = usize::from(page.width)
            .checked_mul(usize::from(page.height))
            .and_then(|texels| texels.checked_mul(4))
            .ok_or_else(overflow)?;
        gpu_bytes = gpu_bytes.checked_add(page_gpu_bytes).ok_or_else(overflow)?;
        page_reports.push(MtsdfPageReportV0 {
            width: page.width,
            height: page.height,
            format: "rgba8unorm".into(),
            gpu_bytes: page_gpu_bytes,
            source: if page.embedded {
                "embedded".into()
            } else {
                "external".into()
            },
            encoded_bytes: page.bytes.len(),
        });
        if !page.embedded {
            artifacts.push(MtsdfBakeArtifactV0 {
                role: "raster-page".into(),
                id: page.id,
                bytes: page.bytes,
                sha256: page.sha256,
            });
        }
    }
    let serialized_bytes = artifacts.iter().try_fold(0_usize, |total, artifact| {
        total.checked_add(artifact.bytes.len()).ok_or_else(overflow)
    })?;

    Ok(MtsdfBakeResultV0 {
        raster_key: request.raster_key,
        kind: MSDF_KIND.into(),
        extension: MSDF_EXTENSION.into(),
        version: MSDF_FORMAT_VERSION,
        artifacts,
        report: MtsdfPayloadReportV0 {
            metadata_bytes,
            serialized_bytes,
            gpu_bytes,
            pages: page_reports,
        },
    })
}

pub fn descriptor_raster_key(descriptor: &MtsdfDescriptorV0) -> String {
    let coverage = descriptor.coverage.as_ref().map(|coverage| {
        format!(
            "\"coverage\":{},",
            pmndrs_text_raster_artifact::canonical_raster_coverage_json(coverage)
        )
    });
    let coverage = coverage.as_deref().unwrap_or("");
    let descriptor_json = match (descriptor.em_size, descriptor.pixel_range) {
        (None, None) => format!(
            "{{{coverage}\"generatorVersion\":\"{}\"}}",
            descriptor.generator_version,
        ),
        (Some(em_size), Some(pixel_range)) => format!(
            "{{{coverage}\"emSize\":{em_size},\"generatorVersion\":\"{}\",\"pixelRange\":{pixel_range}}}",
            descriptor.generator_version,
        ),
        (Some(em_size), None) => format!(
            "{{{coverage}\"emSize\":{em_size},\"generatorVersion\":\"{}\"}}",
            descriptor.generator_version,
        ),
        (None, Some(pixel_range)) => format!(
            "{{{coverage}\"generatorVersion\":\"{}\",\"pixelRange\":{pixel_range}}}",
            descriptor.generator_version,
        ),
    };
    let canonical = format!(
        "{{\"descriptor\":{descriptor_json},\"extension\":\"{}\",\"kind\":\"{}\",\"version\":{}}}",
        MSDF_EXTENSION, MSDF_KIND, MSDF_FORMAT_VERSION,
    );
    pmndrs_text_raster_artifact::sha256_hex(canonical.as_bytes())
}

fn rasterize_font(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
    settings: MtsdfBakeSettingsV0,
    requested_coverage: Option<&pmndrs_text_raster_artifact::RasterCoverageV0>,
    #[cfg(feature = "profiling")] profiler: &mut BakeProfiler,
) -> Result<RasterizedMtsdf, MtsdfBakeError> {
    #[cfg(feature = "profiling")]
    let (font, actual_glyph_count, coverage) = profiler.measure(BakePhase::Selection, || {
        select_font(source, face_index, expected_glyph_count, requested_coverage)
    })?;
    #[cfg(not(feature = "profiling"))]
    let (font, actual_glyph_count, coverage) =
        select_font(source, face_index, expected_glyph_count, requested_coverage)?;

    let mut records = GlyphRecordTable::new(actual_glyph_count)?;
    let mut pages = Vec::new();
    pages
        .try_reserve_exact(MAX_ATLAS_PAGES)
        .map_err(|_| overflow())?;
    pages.push(AtlasPage::new(ATLAS_LIMIT, 4)?);
    let mut generator = MtsdfGenerator::default();

    let progress_total = coverage
        .as_ref()
        .map_or(actual_glyph_count, |selection| selection.selected_glyphs());
    #[cfg(feature = "profiling")]
    profiler.set_selected_glyphs(progress_total);
    crate::progress::report(0, u32::from(progress_total));
    let mut selected_index = 0_u32;
    for raw_glyph_id in 0..actual_glyph_count {
        if coverage
            .as_ref()
            .is_some_and(|selection| !selection.contains(raw_glyph_id))
        {
            records.mark_absent(raw_glyph_id)?;
            continue;
        }
        crate::progress::report(selected_index, u32::from(progress_total));
        selected_index = selected_index.saturating_add(1);
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(source) = font_outline_source(&font, glyph_id) else {
            records.mark_absent(raw_glyph_id)?;
            continue;
        };
        let units_per_em = source.units_per_em();
        #[cfg(feature = "profiling")]
        let outline_timer = PhaseTimer::start();
        let mut outline = match generator.read_outline(&source) {
            Ok(outline) => outline,
            Err(ReadOutlineError::EmptyOutline | ReadOutlineError::InvalidBounds) => {
                #[cfg(feature = "profiling")]
                profiler.finish_phase(BakePhase::OutlineExtraction, outline_timer);
                records.mark_absent(raw_glyph_id)?;
                continue;
            }
            Err(error) => return Err(outline_error(raw_glyph_id, error)),
        };
        #[cfg(feature = "profiling")]
        profiler.finish_phase(BakePhase::OutlineExtraction, outline_timer);
        #[cfg(feature = "profiling")]
        let edge_count = outline.edge_count();
        let quantized =
            QuantizedGlyph::new(outline.bounds(), units_per_em, raw_glyph_id, settings)?;
        #[cfg(feature = "profiling")]
        let texel_timer = PhaseTimer::start();
        let texels = outline
            .generate_mtsdf_with_transform(quantized.region, quantized.transform)
            .map_err(|error| generation_error(raw_glyph_id, error))?;
        #[cfg(feature = "profiling")]
        profiler.finish_phase(BakePhase::TexelGeneration, texel_timer);
        #[cfg(feature = "profiling")]
        let generated_texels = usize::from(quantized.width) * usize::from(quantized.height);
        #[cfg(feature = "profiling")]
        profiler.record_generated_glyph(generated_texels, edge_count);
        #[cfg(feature = "profiling")]
        let packing_timer = PhaseTimer::start();
        let mut page_index = pages.len() - 1;
        let atlas_bounds = if let Some(bounds) =
            pages[page_index].place(quantized.width, quantized.height, texels, ATLAS_GLYPH_GAP)?
        {
            bounds
        } else {
            if pages.len() == MAX_ATLAS_PAGES {
                return Err(overflow());
            }
            pages.push(AtlasPage::new(ATLAS_LIMIT, 4)?);
            page_index += 1;
            pages[page_index]
                .place(quantized.width, quantized.height, texels, ATLAS_GLYPH_GAP)?
                .ok_or_else(|| glyph_too_large(raw_glyph_id))?
        };
        if page_index >= usize::from(ABSENT_PAGE) {
            return Err(overflow());
        }
        records.write(
            raw_glyph_id,
            quantized.plane_bounds,
            atlas_bounds,
            u16::try_from(page_index).map_err(|_| overflow())?,
        )?;
        #[cfg(feature = "profiling")]
        profiler.finish_phase(BakePhase::Packing, packing_timer);
    }
    crate::progress::report(u32::from(progress_total), u32::from(progress_total));

    let mut finished_pages = Vec::new();
    finished_pages
        .try_reserve_exact(pages.len())
        .map_err(|_| overflow())?;
    for page in pages {
        #[cfg(feature = "profiling")]
        let packing_timer = PhaseTimer::start();
        let page = page.finish()?;
        #[cfg(feature = "profiling")]
        profiler.finish_phase(BakePhase::Packing, packing_timer);
        finished_pages.push(page);
    }
    Ok(RasterizedMtsdf {
        records: records.into_bytes(),
        pages: finished_pages,
        coverage: coverage.map(|selection| selection.bits().to_vec()),
    })
}

#[inline]
fn select_font<'source>(
    source: &'source [u8],
    face_index: u32,
    expected_glyph_count: u16,
    requested_coverage: Option<&pmndrs_text_raster_artifact::RasterCoverageV0>,
) -> Result<
    (
        FontRef<'source>,
        u16,
        Option<pmndrs_text_raster_artifact::ResolvedRasterCoverage>,
    ),
    MtsdfBakeError,
> {
    let font = FontRef::from_index(source, face_index).map_err(|error| {
        MtsdfBakeError::new(MtsdfBakeErrorCode::InvalidFontFace, error).at("/fontFaceIndex")
    })?;
    let actual_glyph_count = glyph_count(&font)
        .map_err(|error| MtsdfBakeError::new(MtsdfBakeErrorCode::InvalidFont, error))?;
    if actual_glyph_count != expected_glyph_count {
        return Err(MtsdfBakeError::new(
            MtsdfBakeErrorCode::InvalidGlyphCount,
            "source font glyph count does not match the shaping context",
        )
        .at("/glyphCount"));
    }
    let coverage = request_coverage(&font, actual_glyph_count, requested_coverage)?;
    Ok((font, actual_glyph_count, coverage))
}

fn request_coverage(
    font: &FontRef<'_>,
    glyph_count: u16,
    coverage: Option<&pmndrs_text_raster_artifact::RasterCoverageV0>,
) -> Result<Option<pmndrs_text_raster_artifact::ResolvedRasterCoverage>, MtsdfBakeError> {
    let Some(coverage) = coverage else {
        return Ok(None);
    };
    let charmap = font.charmap();
    resolve_raster_coverage(coverage, glyph_count, |character| {
        charmap
            .map(character)
            .and_then(|glyph_id| u16::try_from(glyph_id.to_u32()).ok())
    })
    .map(Some)
    .map_err(|error| {
        MtsdfBakeError::new(MtsdfBakeErrorCode::InvalidDescriptor, error).at("/descriptor/coverage")
    })
}

struct QuantizedGlyph {
    plane_bounds: [i16; 4],
    width: u16,
    height: u16,
    region: AtlasRegion,
    transform: MtsdfTransform,
}

impl QuantizedGlyph {
    fn new(
        source_bounds: pmndrs_text_mtsdf_core::Bounds,
        units_per_em: f32,
        glyph_id: u16,
        settings: MtsdfBakeSettingsV0,
    ) -> Result<Self, MtsdfBakeError> {
        let scale = f32::from(settings.em_size) / units_per_em;
        let left = checked_floor(source_bounds.min_x * scale, glyph_id)?;
        let bottom = checked_floor(source_bounds.min_y * scale, glyph_id)?;
        let right = checked_ceil(source_bounds.max_x * scale, glyph_id)?;
        let top = checked_ceil(source_bounds.max_y * scale, glyph_id)?;
        let field_padding = settings.field_padding();
        let padding = i32::try_from(field_padding).map_err(|_| overflow())?;
        let plane = [
            left - padding,
            bottom - padding,
            right + padding,
            top + padding,
        ];
        let plane_bounds =
            plane.map(|value| i16::try_from(value).map_err(|_| glyph_too_large(glyph_id)));
        let [left_plane, bottom_plane, right_plane, top_plane] = plane_bounds;
        let plane_bounds = [left_plane?, bottom_plane?, right_plane?, top_plane?];
        let inner_width = usize::try_from(right - left).map_err(|_| glyph_too_large(glyph_id))?;
        let inner_height = usize::try_from(top - bottom).map_err(|_| glyph_too_large(glyph_id))?;
        let region = AtlasRegion {
            inner_width,
            inner_height,
            padding_x: field_padding,
            padding_y: field_padding,
        };
        let width = u16::try_from(region.total_width().ok_or_else(overflow)?)
            .map_err(|_| glyph_too_large(glyph_id))?;
        let height = u16::try_from(region.total_height().ok_or_else(overflow)?)
            .map_err(|_| glyph_too_large(glyph_id))?;
        if width > ATLAS_LIMIT.saturating_sub(ATLAS_GLYPH_GAP * 2)
            || height > ATLAS_LIMIT.saturating_sub(ATLAS_GLYPH_GAP * 2)
        {
            return Err(glyph_too_large(glyph_id));
        }
        let inverse_scale = units_per_em / f32::from(settings.em_size);
        let transform_bounds = pmndrs_text_mtsdf_core::Bounds::new(
            left as f32 * inverse_scale,
            bottom as f32 * inverse_scale,
            right as f32 * inverse_scale,
            top as f32 * inverse_scale,
        );
        let full_distance_range =
            units_per_em * f32::from(settings.pixel_range) / f32::from(settings.em_size);
        let transform = MtsdfTransform::new(transform_bounds, full_distance_range)
            .ok_or_else(|| glyph_too_large(glyph_id))?;
        Ok(Self {
            plane_bounds,
            width,
            height,
            region,
            transform,
        })
    }
}

fn checked_floor(value: f32, glyph_id: u16) -> Result<i32, MtsdfBakeError> {
    checked_integer(value.floor(), glyph_id)
}

fn checked_ceil(value: f32, glyph_id: u16) -> Result<i32, MtsdfBakeError> {
    checked_integer(value.ceil(), glyph_id)
}

fn checked_integer(value: f32, glyph_id: u16) -> Result<i32, MtsdfBakeError> {
    if !value.is_finite() || value < i32::MIN as f32 || value > i32::MAX as f32 {
        return Err(glyph_too_large(glyph_id));
    }
    Ok(value as i32)
}

fn validate_hash(name: &str, value: &str) -> Result<(), MtsdfBakeError> {
    if value.len() != 64
        || !value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(MtsdfBakeError::new(
            MtsdfBakeErrorCode::InvalidIdentity,
            format!("{name} must be lowercase hexadecimal SHA-256"),
        )
        .at(format!("/{name}")));
    }
    Ok(())
}

fn outline_error(
    glyph_id: u16,
    error: ReadOutlineError<skrifa::outline::DrawError>,
) -> MtsdfBakeError {
    MtsdfBakeError::new(MtsdfBakeErrorCode::InvalidGlyphOutline, error)
        .at(format!("/glyphs/{glyph_id}"))
}

fn generation_error(glyph_id: u16, error: GenerateError) -> MtsdfBakeError {
    let code = match error {
        GenerateError::Allocation | GenerateError::OutputLimit => {
            MtsdfBakeErrorCode::ArithmeticOverflow
        }
        GenerateError::InvalidRegion | GenerateError::InvalidTransform => {
            MtsdfBakeErrorCode::InvalidGlyphOutline
        }
    };
    MtsdfBakeError::new(code, error).at(format!("/glyphs/{glyph_id}"))
}

fn glyph_too_large(glyph_id: u16) -> MtsdfBakeError {
    MtsdfBakeError::new(
        MtsdfBakeErrorCode::GlyphTooLarge,
        "glyph MTSDF does not fit the fixed V0 plane or atlas limits",
    )
    .at(format!("/glyphs/{glyph_id}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        MAX_MTSDF_EM_SIZE, MAX_MTSDF_PIXEL_RANGE, MSDF_GENERATOR_VERSION, MTSDF_EM_SIZE,
        MTSDF_PIXEL_RANGE, MTSDF_PLANE_UNITS_PER_EM, PagePackaging,
    };

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );
    const SHAPING_HASH: &str = "6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09";

    fn descriptor(em_size: Option<u16>, pixel_range: Option<u16>) -> MtsdfDescriptorV0 {
        MtsdfDescriptorV0 {
            coverage: None,
            generator_version: MSDF_GENERATOR_VERSION.into(),
            em_size,
            pixel_range,
        }
    }

    fn settings(em_size: u16, pixel_range: u16) -> MtsdfBakeSettingsV0 {
        MtsdfBakeSettingsV0 {
            em_size,
            pixel_range,
        }
    }

    #[test]
    fn descriptor_key_is_stable() {
        let descriptor = descriptor(None, None);
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93"
        );
    }

    #[test]
    fn custom_descriptor_keys_match_the_typescript_contract() {
        assert_eq!(
            descriptor_raster_key(&descriptor(Some(32), Some(4))),
            "9c8825cc24b9549e9cc923a17a32665770a4ec05be48e7439a0d5ac89f05afa1"
        );
        assert_eq!(
            descriptor_raster_key(&descriptor(Some(32), Some(6))),
            "fa8f5c03367db3652abb41659835618f989ad00c0dc0c39fac8dcf3e21ee16a8"
        );
    }

    #[test]
    fn bounded_descriptor_key_matches_the_typescript_contract() {
        let mut descriptor = descriptor(None, None);
        descriptor.coverage = Some(pmndrs_text_raster_artifact::RasterCoverageV0 {
            unicode_ranges: Some(vec![pmndrs_text_raster_artifact::RasterUnicodeRangeV0 {
                start: 65,
                end: 90,
            }]),
            text: Some("AB".into()),
            glyph_ids: Some(vec![3, 7]),
        });
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "4118e8f8787ea4de99492c4869059cca10b0ae69494b780699a421d5fe22fe4d"
        );
    }

    #[test]
    fn bounded_mtsdf_rasterizes_only_selected_font_local_glyphs() {
        let coverage = pmndrs_text_raster_artifact::RasterCoverageV0 {
            unicode_ranges: None,
            text: None,
            glyph_ids: Some(vec![43, 44]),
        };
        let rasterized = rasterize_font(
            INTER,
            0,
            2937,
            MtsdfBakeSettingsV0::DEFAULT,
            Some(&coverage),
            #[cfg(feature = "profiling")]
            &mut BakeProfiler::start(),
        )
        .unwrap();
        let coverage = rasterized.coverage.as_ref().unwrap();
        assert_eq!(coverage.len(), 2937_usize.div_ceil(8));
        assert_eq!(
            coverage.iter().map(|byte| byte.count_ones()).sum::<u32>(),
            2
        );
        for glyph_id in 0..2937 {
            let offset = glyph_id * 20 + 16;
            let page =
                u16::from_le_bytes(rasterized.records[offset..offset + 2].try_into().unwrap());
            if glyph_id == 43 || glyph_id == 44 {
                assert_ne!(page, 0xffff);
            } else {
                assert_eq!(page, 0xffff);
            }
        }
    }

    #[cfg(feature = "profiling")]
    #[test]
    fn phase_profiling_preserves_the_bake_and_counts_actual_work() {
        let mut descriptor = descriptor(None, None);
        descriptor.coverage = Some(pmndrs_text_raster_artifact::RasterCoverageV0 {
            unicode_ranges: None,
            text: None,
            glyph_ids: Some(vec![43, 44]),
        });
        let raster_key = descriptor_raster_key(&descriptor);
        let request = MtsdfBakeRequestV0 {
            font_face_index: 0,
            glyph_count: 2937,
            shaping_hash: SHAPING_HASH.into(),
            raster_key,
            packaging: crate::MtsdfPackagingV0 {
                artifact: crate::ArtifactPackaging::Embedded,
                pages: crate::PagePackaging::Embedded,
            },
            descriptor,
        };
        let expected = bake_mtsdf(INTER, request.clone()).unwrap();
        let profiled = bake_mtsdf_profiled(INTER, request).unwrap();
        assert_eq!(profiled.result, expected);
        assert_eq!(profiled.profile.counters.selected_glyphs, 2);
        assert_eq!(profiled.profile.counters.generated_glyphs, 2);
        assert!(profiled.profile.counters.generated_texels > 0);
        assert!(profiled.profile.counters.edges_visited > 0);
        assert!(profiled.profile.phases_ns.texel_generation > 0);
        assert!(profiled.profile.phases_ns.total >= profiled.profile.phases_ns.texel_generation);
    }

    #[test]
    fn descriptor_requires_one_canonical_bounded_settings_pair() {
        assert_eq!(
            descriptor(None, None).validate().unwrap(),
            MtsdfBakeSettingsV0::DEFAULT
        );
        assert_eq!(
            descriptor(Some(32), Some(5)).validate().unwrap(),
            settings(32, 5)
        );
        for invalid in [
            descriptor(Some(32), None),
            descriptor(None, Some(4)),
            descriptor(Some(MTSDF_EM_SIZE), Some(MTSDF_PIXEL_RANGE)),
            descriptor(Some(0), Some(4)),
            descriptor(Some(MAX_MTSDF_EM_SIZE + 1), Some(4)),
            descriptor(Some(32), Some(0)),
            descriptor(Some(32), Some(MAX_MTSDF_PIXEL_RANGE + 1)),
        ] {
            assert_eq!(
                invalid.validate().unwrap_err().code,
                MtsdfBakeErrorCode::InvalidDescriptor
            );
        }
    }

    #[test]
    fn quantized_glyph_uses_configured_scale_range_and_ceil_half_padding() {
        let bounds = pmndrs_text_mtsdf_core::Bounds::new(0.0, 0.0, 1000.0, 1000.0);
        for (pixel_range, expected_padding, expected_distance_range) in
            [(4, 2, 125.0), (5, 3, 156.25), (6, 3, 187.5)]
        {
            let quantized =
                QuantizedGlyph::new(bounds, 1000.0, 0, settings(32, pixel_range)).unwrap();
            assert_eq!(
                quantized.plane_bounds,
                [
                    -expected_padding,
                    -expected_padding,
                    32 + expected_padding,
                    32 + expected_padding,
                ]
            );
            assert_eq!(
                quantized.width,
                u16::try_from(32 + expected_padding * 2).unwrap()
            );
            assert_eq!(
                quantized.height,
                u16::try_from(32 + expected_padding * 2).unwrap()
            );
            assert_eq!(
                quantized.transform.full_distance_range_font_units(),
                expected_distance_range
            );
        }
    }

    #[test]
    fn custom_glb_records_the_authoritative_bake_settings() {
        let rasterized = RasterizedMtsdf {
            records: vec![0; 20],
            pages: vec![RasterizedPage {
                width: 1,
                height: 1,
                texels: vec![0; 4],
            }],
            coverage: None,
        };
        let built = build_mtsdf_glb(
            &"1".repeat(64),
            &"2".repeat(64),
            1,
            PagePackaging::Embedded,
            settings(32, 5),
            None,
            &rasterized,
            #[cfg(feature = "profiling")]
            &mut BakeProfiler::start(),
        )
        .unwrap();
        let json_length = u32::from_le_bytes(built.bytes[12..16].try_into().unwrap()) as usize;
        let root: serde_json::Value =
            serde_json::from_slice(&built.bytes[20..20 + json_length]).unwrap();
        let extension = &root["extensions"][MSDF_EXTENSION];
        assert_eq!(extension["emSize"], 32);
        assert_eq!(extension["pixelRange"], 5);
        assert_eq!(extension["planeUnitsPerEm"], 32);
    }

    #[test]
    #[ignore = "full Inter generation is the deterministic integration fixture"]
    fn inter_mtsdf_is_deterministic_and_packaging_preserves_records() {
        let settings = MtsdfBakeSettingsV0::DEFAULT;
        let rasterized = rasterize_font(
            INTER,
            0,
            2937,
            settings,
            None,
            #[cfg(feature = "profiling")]
            &mut BakeProfiler::start(),
        )
        .expect("rasterize Inter");
        assert_eq!(rasterized.records.len(), 2937 * 20);
        let descriptor = descriptor(None, None);
        let raster_key = descriptor_raster_key(&descriptor);
        let embedded = build_mtsdf_glb(
            &raster_key,
            SHAPING_HASH,
            2937,
            PagePackaging::Embedded,
            settings,
            None,
            &rasterized,
            #[cfg(feature = "profiling")]
            &mut BakeProfiler::start(),
        )
        .expect("embedded");
        let external = build_mtsdf_glb(
            &raster_key,
            SHAPING_HASH,
            2937,
            PagePackaging::External,
            settings,
            None,
            &rasterized,
            #[cfg(feature = "profiling")]
            &mut BakeProfiler::start(),
        )
        .expect("external");
        assert_eq!(embedded.pages.len(), external.pages.len());
        assert!(!embedded.pages.is_empty());
        for (embedded_page, external_page) in embedded.pages.iter().zip(&external.pages) {
            assert_eq!(embedded_page.bytes, external_page.bytes);
            assert_eq!(embedded_page.sha256, external_page.sha256);
        }
        assert_eq!(record_bytes(&embedded.bytes), record_bytes(&external.bytes));
    }

    fn record_bytes(glb: &[u8]) -> Vec<u8> {
        let json_length = u32::from_le_bytes(glb[12..16].try_into().expect("JSON length")) as usize;
        let root: serde_json::Value =
            serde_json::from_slice(&glb[20..20 + json_length]).expect("JSON");
        let extension = &root["extensions"][MSDF_EXTENSION];
        assert_eq!(extension["encoding"], "mtsdf");
        assert_eq!(extension["emSize"], MTSDF_EM_SIZE);
        assert_eq!(extension["pixelRange"], MTSDF_PIXEL_RANGE);
        assert_eq!(extension["planeUnitsPerEm"], MTSDF_PLANE_UNITS_PER_EM);
        let view_index = extension["recordBufferView"].as_u64().expect("view") as usize;
        let view = &root["bufferViews"][view_index];
        let offset = view["byteOffset"].as_u64().expect("offset") as usize;
        let length = view["byteLength"].as_u64().expect("length") as usize;
        let binary_start = 20 + json_length + 8;
        glb[binary_start + offset..binary_start + offset + length].to_vec()
    }
}
