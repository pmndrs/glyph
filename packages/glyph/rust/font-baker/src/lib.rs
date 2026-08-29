//! Portable `PMNDRS_font` shaping-data baker.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
#[macro_use]
extern crate alloc as std;

#[allow(dead_code)]
mod abi_contract;
mod error;
mod glb;
mod report;
mod sfnt;

#[cfg(feature = "subsetting")]
mod source_font;

#[cfg(target_arch = "wasm32")]
mod wasm;

pub use error::{BakeError, BakeErrorCode};
pub use report::{
    BakeArtifactV0, BakeDescriptorV0, BakeReportV0, BakeResultV0, BakeWarning,
    ContainerPayloadReport, FontMetricsV0, ProvenanceV0, ShapingPayloadReportV0,
    TablePayloadReport, TransportPayloadReport,
};
#[cfg(feature = "subsetting")]
pub use source_font::{
    FontInspectionV0, FontSelectionV0, GlyphInspectionV0, PreparedFontReportV0, PreparedFontV0,
    UnicodeRangeV0, inspect_font, prepare_font,
};

/// Return the compile-time-generated C ABI description embedded in this build.
pub fn abi_json() -> &'static str {
    include_str!(concat!(env!("OUT_DIR"), "/font-baker-abi-v0.json"))
}

use pmndrs_glyph_raster_artifact::{
    ARTIFACT_FINGERPRINT_V0, DESCRIPTOR_FINGERPRINT_V0, SOURCE_FINGERPRINT_V0, fingerprint128,
};
use std::{borrow::ToOwned, vec::Vec};

/// Bake one source font face into the canonical shaping-only `PMNDRS_font` GLB.
pub fn bake_font(source: &[u8], descriptor: BakeDescriptorV0) -> Result<BakeResultV0, BakeError> {
    let descriptor = descriptor.validate()?;
    let source_fingerprint = fingerprint128(source, SOURCE_FINGERPRINT_V0);
    let descriptor_fingerprint =
        fingerprint128(&descriptor.canonical_bytes(), DESCRIPTOR_FINGERPRINT_V0);
    let shaping = sfnt::build_shaping_payload(source, descriptor.font_face_index)?;
    let shaping_report = shaping.report.clone();
    let artifact = glb::build_font_glb(
        &shaping,
        ProvenanceV0 {
            source_fingerprint,
            descriptor_fingerprint,
            font_face_index: descriptor.font_face_index,
            baker_version: abi_contract::BAKER_VERSION.to_owned(),
            harfrust_version: abi_contract::HARFRUST_VERSION.to_owned(),
            harfbuzz_reference_version: abi_contract::HARFBUZZ_REFERENCE_VERSION.to_owned(),
            unicode_version: abi_contract::UNICODE_VERSION.to_owned(),
        },
    )?;
    let artifact_fingerprint = fingerprint128(&artifact.bytes, ARTIFACT_FINGERPRINT_V0);
    let artifact_id = format!("font-{}", shaping.shaping_fingerprint);
    let compressed = report::compressed_lengths(&artifact.bytes)?;
    let total_bytes = artifact.bytes.len();

    Ok(BakeResultV0 {
        artifacts: vec![BakeArtifactV0 {
            role: "font".to_owned(),
            id: artifact_id.clone(),
            bytes: artifact.bytes,
            fingerprint: artifact_fingerprint,
        }],
        report: BakeReportV0 {
            source: report::SourcePayloadReport {
                bytes: source.len(),
            },
            shared: report::SharedPayloadReport {
                shaping: shaping_report,
            },
            rasters: Vec::new(),
            containers: vec![ContainerPayloadReport {
                artifact_id: artifact_id.clone(),
                role: "font".to_owned(),
                json_bytes: artifact.json_bytes,
                padding_bytes: artifact.padding_bytes,
                total_bytes,
            }],
            transport: {
                let mut transport = vec![TransportPayloadReport {
                    artifact_id: artifact_id.clone(),
                    format: "raw".to_owned(),
                    bytes: total_bytes,
                }];
                if let Some((gzip_bytes, brotli_bytes)) = compressed {
                    transport.push(TransportPayloadReport {
                        artifact_id: artifact_id.clone(),
                        format: "gzip".to_owned(),
                        bytes: gzip_bytes,
                    });
                    transport.push(TransportPayloadReport {
                        artifact_id,
                        format: "brotli".to_owned(),
                        bytes: brotli_bytes,
                    });
                }
                transport
            },
        },
        warnings: Vec::new(),
    })
}
