use alloc::{format, string::String, vec::Vec};

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;
use pmndrs_text_mtsdf_core::{
    AtlasRegion, GenerateError, MtsdfGenerator, MtsdfTransform, ReadOutlineError,
};
use pmndrs_text_mtsdf_fontations::{font_outline_source, glyph_count};
use pmndrs_text_raster_artifact::{ABSENT_PAGE, AtlasPage, GlyphRecordTable, RasterizedPage};
use skrifa::{FontRef, GlyphId};

use crate::{
    error::{MtsdfBakeError, MtsdfBakeErrorCode, overflow},
    glb::build_mtsdf_glb,
    model::{
        MSDF_EXTENSION, MSDF_FORMAT_VERSION, MSDF_KIND, MTSDF_EM_SIZE, MTSDF_PIXEL_RANGE,
        MTSDF_PLANE_UNITS_PER_EM, MtsdfBakeArtifactV0, MtsdfBakeRequestV0, MtsdfBakeResultV0,
        MtsdfDescriptorV0, MtsdfPageReportV0, MtsdfPayloadReportV0,
    },
};

const ATLAS_LIMIT: u16 = 1024;
const ATLAS_GLYPH_GAP: u16 = 1;
const FIELD_PADDING: usize = (MTSDF_PIXEL_RANGE / 2) as usize;
const MAX_ATLAS_PAGES: usize = 60;

pub(crate) struct RasterizedMtsdf {
    pub(crate) records: Vec<u8>,
    pub(crate) pages: Vec<RasterizedPage>,
}

/// Bake one fixed, deterministic linear-RGBA8 MTSDF resource.
pub fn bake_mtsdf(
    source: &[u8],
    request: MtsdfBakeRequestV0,
) -> Result<MtsdfBakeResultV0, MtsdfBakeError> {
    request.descriptor.validate()?;
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

    let rasterized = rasterize_font(source, request.font_face_index, request.glyph_count)?;
    let metadata_bytes = rasterized.records.len();
    let built = build_mtsdf_glb(
        &request.raster_key,
        &request.shaping_hash,
        request.glyph_count,
        request.packaging.pages,
        &rasterized,
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
    let canonical = format!(
        "{{\"descriptor\":{{\"generatorVersion\":\"{}\"}},\"extension\":\"{}\",\"kind\":\"{}\",\"version\":{}}}",
        descriptor.generator_version, MSDF_EXTENSION, MSDF_KIND, MSDF_FORMAT_VERSION,
    );
    pmndrs_text_raster_artifact::sha256_hex(canonical.as_bytes())
}

fn rasterize_font(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
) -> Result<RasterizedMtsdf, MtsdfBakeError> {
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

    let mut records = GlyphRecordTable::new(actual_glyph_count)?;
    let mut pages = Vec::new();
    pages
        .try_reserve_exact(MAX_ATLAS_PAGES)
        .map_err(|_| overflow())?;
    pages.push(AtlasPage::new(ATLAS_LIMIT, 4)?);
    let mut generator = MtsdfGenerator::default();

    crate::progress::report(0, u32::from(actual_glyph_count));
    for raw_glyph_id in 0..actual_glyph_count {
        crate::progress::report(u32::from(raw_glyph_id), u32::from(actual_glyph_count));
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(source) = font_outline_source(&font, glyph_id) else {
            records.mark_absent(raw_glyph_id)?;
            continue;
        };
        let units_per_em = source.units_per_em();
        let mut outline = match generator.read_outline(&source) {
            Ok(outline) => outline,
            Err(ReadOutlineError::EmptyOutline | ReadOutlineError::InvalidBounds) => {
                records.mark_absent(raw_glyph_id)?;
                continue;
            }
            Err(error) => return Err(outline_error(raw_glyph_id, error)),
        };
        let quantized = QuantizedGlyph::new(outline.bounds(), units_per_em, raw_glyph_id)?;
        let texels = outline
            .generate_mtsdf_with_transform(quantized.region, quantized.transform)
            .map_err(|error| generation_error(raw_glyph_id, error))?;
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
    }
    crate::progress::report(u32::from(actual_glyph_count), u32::from(actual_glyph_count));

    let mut finished_pages = Vec::new();
    finished_pages
        .try_reserve_exact(pages.len())
        .map_err(|_| overflow())?;
    for page in pages {
        finished_pages.push(page.finish()?);
    }
    Ok(RasterizedMtsdf {
        records: records.into_bytes(),
        pages: finished_pages,
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
    ) -> Result<Self, MtsdfBakeError> {
        let scale = f32::from(MTSDF_PLANE_UNITS_PER_EM) / units_per_em;
        let left = checked_floor(source_bounds.min_x * scale, glyph_id)?;
        let bottom = checked_floor(source_bounds.min_y * scale, glyph_id)?;
        let right = checked_ceil(source_bounds.max_x * scale, glyph_id)?;
        let top = checked_ceil(source_bounds.max_y * scale, glyph_id)?;
        let padding = i32::try_from(FIELD_PADDING).map_err(|_| overflow())?;
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
            padding_x: FIELD_PADDING,
            padding_y: FIELD_PADDING,
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
        let inverse_scale = units_per_em / f32::from(MTSDF_PLANE_UNITS_PER_EM);
        let transform_bounds = pmndrs_text_mtsdf_core::Bounds::new(
            left as f32 * inverse_scale,
            bottom as f32 * inverse_scale,
            right as f32 * inverse_scale,
            top as f32 * inverse_scale,
        );
        let full_distance_range =
            units_per_em * f32::from(MTSDF_PIXEL_RANGE) / f32::from(MTSDF_EM_SIZE);
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
    use crate::model::{MSDF_GENERATOR_VERSION, PagePackaging};

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );
    const SHAPING_HASH: &str = "6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09";

    #[test]
    fn descriptor_key_is_stable() {
        let descriptor = MtsdfDescriptorV0 {
            generator_version: MSDF_GENERATOR_VERSION.into(),
        };
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "e944ba8d2856314856289466e82e471e0adc0775a7c9c3affec7c59bfdd8fe93"
        );
    }

    #[test]
    #[ignore = "full Inter generation is the deterministic integration fixture"]
    fn inter_mtsdf_is_deterministic_and_packaging_preserves_records() {
        let rasterized = rasterize_font(INTER, 0, 2937).expect("rasterize Inter");
        assert_eq!(rasterized.records.len(), 2937 * 20);
        let descriptor = MtsdfDescriptorV0 {
            generator_version: MSDF_GENERATOR_VERSION.into(),
        };
        let raster_key = descriptor_raster_key(&descriptor);
        let embedded = build_mtsdf_glb(
            &raster_key,
            SHAPING_HASH,
            2937,
            PagePackaging::Embedded,
            &rasterized,
        )
        .expect("embedded");
        let external = build_mtsdf_glb(
            &raster_key,
            SHAPING_HASH,
            2937,
            PagePackaging::External,
            &rasterized,
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
