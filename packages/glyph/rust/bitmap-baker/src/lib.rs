//! Portable `PMNDRS_font_bitmap` strike baker.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
#[macro_use]
extern crate alloc as std;

#[allow(dead_code)]
mod abi_contract;
mod error;
mod glb;
mod model;
mod progress;
mod rasterize;

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
mod wasm;

pub use error::{BitmapBakeError, BitmapBakeErrorCode};
pub use model::{
    ArtifactPackaging, BITMAP_GENERATOR_VERSION, BitmapBakeArtifactV0, BitmapBakeRequestV0,
    BitmapBakeResultV0, BitmapDescriptorV0, BitmapPackagingV0, BitmapPageReportV0,
    BitmapPayloadReportV0, MAX_BITMAP_PPEM, RasterCoverageV0, RasterUnicodeRangeV0,
};

/// Return the generated direct-memory ABI contract embedded in this build.
pub fn abi_json() -> &'static str {
    include_str!(concat!(env!("OUT_DIR"), "/bitmap-baker-abi-v0.json"))
}

use std::{
    string::{String, ToString},
    vec::Vec,
};

use crate::{
    error::BitmapBakeErrorCode::InvalidIdentity,
    model::{BITMAP_EXTENSION, BITMAP_FORMAT_VERSION, BITMAP_KIND},
};

/// Bake deterministic unhinted grayscale bitmap strikes into a companion GLB.
pub fn bake_bitmap(
    source: &[u8],
    request: BitmapBakeRequestV0,
) -> Result<BitmapBakeResultV0, BitmapBakeError> {
    request.descriptor.validate()?;
    validate_fingerprint("sourceFingerprint", &request.source_fingerprint)?;
    validate_fingerprint("shapingFingerprint", &request.shaping_fingerprint)?;
    validate_fingerprint("rasterKey", &request.raster_key)?;
    let expected_raster_key = descriptor_raster_key(&request.descriptor);
    if request.raster_key != expected_raster_key {
        return Err(BitmapBakeError::new(
            InvalidIdentity,
            "raster key does not match the canonical bitmap descriptor",
        )
        .at("/rasterKey"));
    }
    if pmndrs_glyph_raster_artifact::fingerprint128(
        source,
        pmndrs_glyph_raster_artifact::SOURCE_FINGERPRINT_V0,
    ) != request.source_fingerprint
    {
        return Err(BitmapBakeError::new(
            InvalidIdentity,
            "source fingerprint does not match the supplied font",
        )
        .at("/sourceFingerprint"));
    }

    let coverage = rasterize::resolve_coverage(
        source,
        request.font_face_index,
        request.glyph_count,
        request.descriptor.coverage.as_ref(),
    )?;
    let selected_glyphs = coverage
        .as_ref()
        .map_or(request.glyph_count, |selection| selection.selected_glyphs());
    let mut strikes = Vec::with_capacity(request.descriptor.strikes.len());
    let progress_total = u32::from(selected_glyphs)
        .saturating_mul(u32::try_from(request.descriptor.strikes.len()).unwrap_or(u32::MAX));
    for (strike_index, ppem) in request.descriptor.strikes.iter().copied().enumerate() {
        let strike = rasterize::rasterize_strike(
            source,
            request.font_face_index,
            request.glyph_count,
            ppem,
            coverage.as_ref(),
            u32::try_from(strike_index)
                .unwrap_or(u32::MAX)
                .saturating_mul(u32::from(selected_glyphs)),
            progress_total,
        )?;
        strikes.push(strike);
    }
    progress::report(progress_total, progress_total);
    let metadata_bytes = strikes
        .iter()
        .map(|strike| strike.records.len())
        .sum::<usize>()
        + coverage
            .as_ref()
            .map_or(0, |selection| selection.bits().len());
    let built = glb::build_bitmap_glb(
        &request.raster_key,
        &request.source_fingerprint,
        &request.shaping_fingerprint,
        request.glyph_count,
        &strikes,
        request.descriptor.coverage.as_ref(),
        coverage.as_ref().map(|selection| selection.bits()),
    )?;
    let raster_fingerprint = artifact_fingerprint(&built.bytes);
    let raster_id = format!(
        "bitmap-{}-{}.glb",
        request.shaping_fingerprint, request.raster_key
    );
    let artifacts = vec![BitmapBakeArtifactV0 {
        role: "raster".into(),
        id: raster_id,
        bytes: built.bytes,
        fingerprint: raster_fingerprint,
    }];
    let mut page_reports = Vec::with_capacity(built.pages.len());
    let mut gpu_bytes = 0_usize;
    for page in built.pages {
        let page_gpu_bytes = usize::from(page.width) * usize::from(page.height);
        gpu_bytes = gpu_bytes
            .checked_add(page_gpu_bytes)
            .ok_or_else(error::overflow)?;
        page_reports.push(BitmapPageReportV0 {
            width: page.width,
            height: page.height,
            format: "r8unorm".into(),
            gpu_bytes: page_gpu_bytes,
            source: "embedded".into(),
            encoded_bytes: page.bytes.len(),
        });
    }
    let serialized_bytes = artifacts.iter().map(|artifact| artifact.bytes.len()).sum();

    Ok(BitmapBakeResultV0 {
        raster_key: request.raster_key,
        kind: BITMAP_KIND.into(),
        extension: BITMAP_EXTENSION.into(),
        version: BITMAP_FORMAT_VERSION,
        artifacts,
        report: BitmapPayloadReportV0 {
            metadata_bytes,
            serialized_bytes,
            gpu_bytes,
            pages: page_reports,
        },
    })
}

pub fn descriptor_raster_key(descriptor: &BitmapDescriptorV0) -> String {
    let strikes = descriptor
        .strikes
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let coverage = descriptor.coverage.as_ref().map(|coverage| {
        format!(
            "\"coverage\":{},",
            pmndrs_glyph_raster_artifact::canonical_raster_coverage_json(coverage)
        )
    });
    let canonical = format!(
        "{{\"descriptor\":{{{}\"generatorVersion\":\"{}\",\"strikes\":[{}]}},\"extension\":\"{}\",\"kind\":\"{}\",\"version\":{}}}",
        coverage.as_deref().unwrap_or(""),
        descriptor.generator_version,
        strikes,
        BITMAP_EXTENSION,
        BITMAP_KIND,
        BITMAP_FORMAT_VERSION,
    );
    pmndrs_glyph_raster_artifact::fingerprint128(
        canonical.as_bytes(),
        pmndrs_glyph_raster_artifact::DESCRIPTOR_FINGERPRINT_V0,
    )
}

pub(crate) fn artifact_fingerprint(bytes: &[u8]) -> String {
    pmndrs_glyph_raster_artifact::fingerprint128(
        bytes,
        pmndrs_glyph_raster_artifact::ARTIFACT_FINGERPRINT_V0,
    )
}

fn validate_fingerprint(name: &str, value: &str) -> Result<(), BitmapBakeError> {
    if value.len() != 32
        || !value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(BitmapBakeError::new(
            InvalidIdentity,
            format!("{name} must be a lowercase 128-bit fingerprint"),
        )
        .at(format!("/{name}")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );
    const SHAPING_FINGERPRINT: &str = "0c522d6ea0db73ba74bcc389dc50263b";

    /// Drop one table's directory record, leaving its bytes stranded. This is
    /// the shape a CFF source reaches the raster bakers in: subsetting emits a
    /// font whose outline table is simply gone.
    fn without_table(source: &[u8], tag: &[u8; 4]) -> Vec<u8> {
        let mut bytes = source.to_vec();
        let count = usize::from(u16::from_be_bytes([bytes[4], bytes[5]]));
        let record = (0..count)
            .map(|index| 12 + index * 16)
            .find(|start| &bytes[*start..*start + 4] == tag)
            .expect("font carries the table being removed");
        // Shift the later records down over it; the table data never moves, so
        // every remaining offset stays valid and the tail 16 bytes go unread.
        bytes.copy_within(record + 16..12 + count * 16, record);
        bytes[4..6].copy_from_slice(&u16::try_from(count - 1).unwrap().to_be_bytes());
        bytes
    }

    #[test]
    fn a_font_without_outlines_is_refused_rather_than_baked_blank() {
        let stripped = without_table(INTER, b"glyf");
        // Identity is validated before the outline check, so the request must carry the
        // stripped source's own fingerprint or it fails as InvalidIdentity first.
        let mut request = request();
        request.source_fingerprint = pmndrs_glyph_raster_artifact::fingerprint128(
            &stripped,
            pmndrs_glyph_raster_artifact::SOURCE_FINGERPRINT_V0,
        );
        let error = bake_bitmap(&stripped, request)
            .expect_err("a font with no outline table must not bake");
        assert_eq!(error.code, BitmapBakeErrorCode::InvalidFont);
        assert!(
            error.message.contains("outline table"),
            "the message must name the cause: {}",
            error.message
        );
    }

    fn request() -> BitmapBakeRequestV0 {
        let descriptor = BitmapDescriptorV0 {
            coverage: None,
            generator_version: BITMAP_GENERATOR_VERSION.into(),
            strikes: vec![16],
        };
        BitmapBakeRequestV0 {
            source_fingerprint: pmndrs_glyph_raster_artifact::fingerprint128(
                INTER,
                pmndrs_glyph_raster_artifact::SOURCE_FINGERPRINT_V0,
            ),
            font_face_index: 0,
            glyph_count: 2937,
            shaping_fingerprint: SHAPING_FINGERPRINT.into(),
            raster_key: descriptor_raster_key(&descriptor),
            packaging: BitmapPackagingV0 {
                artifact: ArtifactPackaging::External,
            },
            descriptor,
        }
    }

    #[test]
    fn descriptor_key_matches_the_typescript_contract() {
        let descriptor = BitmapDescriptorV0 {
            coverage: None,
            generator_version: BITMAP_GENERATOR_VERSION.into(),
            strikes: vec![16, 32],
        };
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "0529767598b1d6ebf89e3ce623bcc2c1"
        );
    }

    #[test]
    fn bounded_descriptor_key_matches_the_typescript_contract() {
        let descriptor = BitmapDescriptorV0 {
            coverage: Some(RasterCoverageV0 {
                unicode_ranges: Some(vec![RasterUnicodeRangeV0 { start: 65, end: 90 }]),
                text: Some("AB".into()),
                glyph_ids: Some(vec![3, 7]),
            }),
            generator_version: BITMAP_GENERATOR_VERSION.into(),
            strikes: vec![16, 32],
        };
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "1337754c97c73e84d8d6d5429d514fb5"
        );
    }

    #[test]
    fn bounded_bitmap_rasterizes_only_selected_font_local_glyphs() {
        let mut bounded = request();
        bounded.descriptor.coverage = Some(RasterCoverageV0 {
            unicode_ranges: None,
            text: None,
            glyph_ids: Some(vec![43, 44]),
        });
        bounded.raster_key = descriptor_raster_key(&bounded.descriptor);
        let result = bake_bitmap(INTER, bounded).unwrap();
        let glb = &result.artifacts[0].bytes;
        let coverage = coverage_bytes(glb);
        assert_eq!(coverage.len(), 2937_usize.div_ceil(8));
        assert_eq!(coverage[43 / 8] & (1 << (43 % 8)), 1 << (43 % 8));
        assert_eq!(coverage[44 / 8] & (1 << (44 % 8)), 1 << (44 % 8));
        assert_eq!(
            coverage.iter().map(|byte| byte.count_ones()).sum::<u32>(),
            2
        );

        let records = record_bytes(glb);
        for glyph_id in 0..2937 {
            let offset = glyph_id * 20 + 16;
            let page = u16::from_le_bytes(records[offset..offset + 2].try_into().unwrap());
            if glyph_id == 43 || glyph_id == 44 {
                assert_ne!(page, 0xffff);
            } else {
                assert_eq!(page, 0xffff);
            }
        }
    }

    #[test]
    fn unicode_and_authored_text_seeds_resolve_through_the_selected_face() {
        let coverage = RasterCoverageV0 {
            unicode_ranges: Some(vec![RasterUnicodeRangeV0 { start: 65, end: 66 }]),
            text: Some("C".into()),
            glyph_ids: None,
        };
        let resolved = rasterize::resolve_coverage(INTER, 0, 2937, Some(&coverage))
            .unwrap()
            .unwrap();
        assert_eq!(resolved.selected_glyphs(), 3);

        let unmapped = RasterCoverageV0 {
            unicode_ranges: None,
            text: Some("\u{10ffff}".into()),
            glyph_ids: None,
        };
        let error = rasterize::resolve_coverage(INTER, 0, 2937, Some(&unmapped)).unwrap_err();
        assert_eq!(error.code, BitmapBakeErrorCode::InvalidDescriptor);
        assert_eq!(error.path.as_deref(), Some("/descriptor/coverage"));
    }

    #[test]
    fn inter_bitmap_is_deterministic_and_packaging_preserves_records() {
        let embedded_a = bake_bitmap(INTER, request()).unwrap();
        let embedded_b = bake_bitmap(INTER, request()).unwrap();
        assert_eq!(embedded_a.artifacts, embedded_b.artifacts);
        assert_eq!(embedded_a.report, embedded_b.report);
        assert_eq!(embedded_a.report.metadata_bytes, 2937 * 20);
        assert!(!embedded_a.report.pages.is_empty());
        assert!(
            embedded_a
                .artifacts
                .iter()
                .all(|artifact| artifact.role == "raster")
        );

        // Pages are always embedded, so a bake publishes exactly one artifact and never a
        // separate page file.
        assert_eq!(embedded_a.artifacts.len(), 1);
        assert!(
            embedded_a
                .report
                .pages
                .iter()
                .all(|page| page.source == "embedded")
        );
        assert_eq!(plane_units_per_em(&embedded_a.artifacts[0].bytes), 16);
        assert_native_pixel_geometry(&record_bytes(&embedded_a.artifacts[0].bytes));
    }

    #[test]
    fn artifact_names_include_font_and_raster_identity() {
        let first = bake_bitmap(INTER, request()).unwrap();
        let mut second_request = request();
        second_request.shaping_fingerprint = "0".repeat(32);
        let second = bake_bitmap(INTER, second_request).unwrap();

        assert_ne!(first.artifacts[0].id, second.artifacts[0].id);
        assert!(
            first
                .artifacts
                .iter()
                .all(|artifact| artifact.id.contains(SHAPING_FINGERPRINT))
        );
        assert!(
            second
                .artifacts
                .iter()
                .all(|artifact| artifact.id.contains(&"0".repeat(32)))
        );
    }

    #[test]
    fn descriptor_rejects_strikes_larger_than_the_atlas_can_represent() {
        let mut invalid = request();
        invalid.descriptor.strikes = vec![MAX_BITMAP_PPEM + 1];
        invalid.raster_key = descriptor_raster_key(&invalid.descriptor);

        let error = bake_bitmap(&[], invalid).unwrap_err();
        assert_eq!(error.code, BitmapBakeErrorCode::InvalidDescriptor);
        assert_eq!(error.path.as_deref(), Some("/descriptor/strikes"));
    }

    fn record_bytes(glb: &[u8]) -> Vec<u8> {
        let (root, bin_start) = glb_root(glb);
        let extension = &root["extensions"]["PMNDRS_font_bitmap"];
        assert_eq!(extension["version"], 0);
        let view_index = extension["strikes"][0]["recordBufferView"]
            .as_u64()
            .unwrap() as usize;
        let view = &root["bufferViews"][view_index];
        let offset = view["byteOffset"].as_u64().unwrap() as usize;
        let length = view["byteLength"].as_u64().unwrap() as usize;
        glb[bin_start + offset..bin_start + offset + length].to_vec()
    }

    fn plane_units_per_em(glb: &[u8]) -> u64 {
        let (root, _) = glb_root(glb);
        root["extensions"]["PMNDRS_font_bitmap"]["strikes"][0]["planeUnitsPerEm"]
            .as_u64()
            .unwrap()
    }

    fn coverage_bytes(glb: &[u8]) -> Vec<u8> {
        let (root, bin_start) = glb_root(glb);
        let extension = &root["extensions"]["PMNDRS_font_bitmap"];
        let view_index = extension["coverageBufferView"].as_u64().unwrap() as usize;
        let view = &root["bufferViews"][view_index];
        let offset = view["byteOffset"].as_u64().unwrap() as usize;
        let length = view["byteLength"].as_u64().unwrap() as usize;
        glb[bin_start + offset..bin_start + offset + length].to_vec()
    }

    fn glb_root(glb: &[u8]) -> (serde_json::Value, usize) {
        assert_eq!(&glb[..4], b"glTF");
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        assert_eq!(&glb[16..20], b"JSON");
        let root = serde_json::from_slice(&glb[20..20 + json_len]).unwrap();
        let bin_header = 20 + json_len;
        assert_eq!(&glb[bin_header + 4..bin_header + 8], b"BIN\0");
        (root, bin_header + 8)
    }

    fn assert_native_pixel_geometry(records: &[u8]) {
        for record in records.chunks_exact(20) {
            if u16::from_le_bytes(record[16..18].try_into().unwrap()) == 0xffff {
                continue;
            }
            let left = i16::from_le_bytes(record[0..2].try_into().unwrap());
            let bottom = i16::from_le_bytes(record[2..4].try_into().unwrap());
            let right = i16::from_le_bytes(record[4..6].try_into().unwrap());
            let top = i16::from_le_bytes(record[6..8].try_into().unwrap());
            let atlas_left = u16::from_le_bytes(record[8..10].try_into().unwrap());
            let atlas_top = u16::from_le_bytes(record[10..12].try_into().unwrap());
            let atlas_right = u16::from_le_bytes(record[12..14].try_into().unwrap());
            let atlas_bottom = u16::from_le_bytes(record[14..16].try_into().unwrap());
            assert_eq!(i32::from(right - left), i32::from(atlas_right - atlas_left));
            assert_eq!(i32::from(top - bottom), i32::from(atlas_bottom - atlas_top));
        }
    }
}
