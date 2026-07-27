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
mod rasterize;

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
mod wasm;

pub use error::{BitmapBakeError, BitmapBakeErrorCode};
pub use model::{
    ArtifactPackaging, BITMAP_GENERATOR_VERSION, BitmapBakeArtifactV0, BitmapBakeRequestV0,
    BitmapBakeResultV0, BitmapDescriptorV0, BitmapPackagingV0, BitmapPageReportV0,
    BitmapPayloadReportV0, MAX_BITMAP_PPEM, PagePackaging,
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
    validate_hash("shapingHash", &request.shaping_hash)?;
    validate_hash("rasterKey", &request.raster_key)?;
    let expected_raster_key = descriptor_raster_key(&request.descriptor);
    if request.raster_key != expected_raster_key {
        return Err(BitmapBakeError::new(
            InvalidIdentity,
            "raster key does not match the canonical bitmap descriptor",
        )
        .at("/rasterKey"));
    }

    let mut strikes = Vec::with_capacity(request.descriptor.strikes.len());
    for ppem in request.descriptor.strikes.iter().copied() {
        let strike = rasterize::rasterize_strike(
            source,
            request.font_face_index,
            request.glyph_count,
            ppem,
        )?;
        strikes.push(strike);
    }
    let metadata_bytes = strikes
        .iter()
        .map(|strike| strike.records.len())
        .sum::<usize>();
    let built = glb::build_bitmap_glb(
        &request.raster_key,
        &request.shaping_hash,
        request.glyph_count,
        request.packaging.pages,
        &strikes,
    )?;
    let raster_id = format!("bitmap-{}-{}.glb", request.shaping_hash, request.raster_key);
    let raster_hash = hex_sha256(&built.bytes);
    let mut artifacts = vec![BitmapBakeArtifactV0 {
        role: "raster".into(),
        id: raster_id,
        bytes: built.bytes,
        sha256: raster_hash,
    }];
    let mut page_reports = Vec::with_capacity(built.pages.len());
    let mut gpu_bytes = 0_usize;
    for page in built.pages {
        let mip_bytes = usize::from(page.width) * usize::from(page.height);
        gpu_bytes = gpu_bytes
            .checked_add(mip_bytes)
            .ok_or_else(error::overflow)?;
        page_reports.push(BitmapPageReportV0 {
            width: page.width,
            height: page.height,
            format: "r8unorm".into(),
            mip_bytes,
            source: if page.embedded {
                "embedded".into()
            } else {
                "external".into()
            },
            encoded_bytes: page.bytes.len(),
        });
        if !page.embedded {
            artifacts.push(BitmapBakeArtifactV0 {
                role: "raster-page".into(),
                id: page.id,
                bytes: page.bytes,
                sha256: page.sha256,
            });
        }
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
    let canonical = format!(
        "{{\"descriptor\":{{\"generatorVersion\":\"{}\",\"strikes\":[{}]}},\"extension\":\"{}\",\"kind\":\"{}\",\"version\":{}}}",
        descriptor.generator_version, strikes, BITMAP_EXTENSION, BITMAP_KIND, BITMAP_FORMAT_VERSION,
    );
    hex_sha256(canonical.as_bytes())
}

pub(crate) fn hex_sha256(bytes: &[u8]) -> String {
    pmndrs_text_raster_artifact::sha256_hex(bytes)
}

fn validate_hash(name: &str, value: &str) -> Result<(), BitmapBakeError> {
    if value.len() != 64
        || !value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    {
        return Err(BitmapBakeError::new(
            InvalidIdentity,
            format!("{name} must be lowercase hexadecimal SHA-256"),
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
    const SHAPING_HASH: &str = "6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09";

    fn request(pages: PagePackaging) -> BitmapBakeRequestV0 {
        let descriptor = BitmapDescriptorV0 {
            generator_version: BITMAP_GENERATOR_VERSION.into(),
            strikes: vec![16],
        };
        BitmapBakeRequestV0 {
            font_face_index: 0,
            glyph_count: 2937,
            shaping_hash: SHAPING_HASH.into(),
            raster_key: descriptor_raster_key(&descriptor),
            packaging: BitmapPackagingV0 {
                artifact: ArtifactPackaging::External,
                pages,
            },
            descriptor,
        }
    }

    #[test]
    fn descriptor_key_matches_the_typescript_contract() {
        let descriptor = BitmapDescriptorV0 {
            generator_version: BITMAP_GENERATOR_VERSION.into(),
            strikes: vec![16, 32],
        };
        assert_eq!(
            descriptor_raster_key(&descriptor),
            "26e1ebd842adaa30a61b27bf182f244432a61890ed8882d141c270a95ff56783"
        );
    }

    #[test]
    fn inter_bitmap_is_deterministic_and_packaging_preserves_records() {
        let embedded_a = bake_bitmap(INTER, request(PagePackaging::Embedded)).unwrap();
        let embedded_b = bake_bitmap(INTER, request(PagePackaging::Embedded)).unwrap();
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

        let external = bake_bitmap(INTER, request(PagePackaging::External)).unwrap();
        assert_eq!(
            external.report.metadata_bytes,
            embedded_a.report.metadata_bytes
        );
        assert_eq!(external.report.gpu_bytes, embedded_a.report.gpu_bytes);
        assert!(
            external
                .artifacts
                .iter()
                .any(|artifact| artifact.role == "raster-page")
        );
        assert_eq!(
            record_bytes(&embedded_a.artifacts[0].bytes),
            record_bytes(&external.artifacts[0].bytes),
        );
        assert_eq!(plane_units_per_em(&embedded_a.artifacts[0].bytes), 16);
        assert_native_pixel_geometry(&record_bytes(&embedded_a.artifacts[0].bytes));
    }

    #[test]
    fn artifact_names_include_font_and_raster_identity() {
        let first = bake_bitmap(INTER, request(PagePackaging::External)).unwrap();
        let mut second_request = request(PagePackaging::External);
        second_request.shaping_hash = "0".repeat(64);
        let second = bake_bitmap(INTER, second_request).unwrap();

        assert_ne!(first.artifacts[0].id, second.artifacts[0].id);
        assert!(
            first
                .artifacts
                .iter()
                .all(|artifact| artifact.id.contains(SHAPING_HASH))
        );
        assert!(
            second
                .artifacts
                .iter()
                .all(|artifact| artifact.id.contains(&"0".repeat(64)))
        );
    }

    #[test]
    fn descriptor_rejects_strikes_larger_than_the_atlas_can_represent() {
        let mut invalid = request(PagePackaging::Embedded);
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
