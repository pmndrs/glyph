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

#[cfg(all(target_arch = "wasm32", not(feature = "std")))]
mod wasm;

pub use error::{BakeError, BakeErrorCode};
pub use report::{
    BakeArtifactV0, BakeDescriptorV0, BakeReportV0, BakeResultV0, BakeWarning,
    ContainerPayloadReport, FontMetricsV0, ProvenanceV0, ShapingPayloadReportV0,
    TablePayloadReport, TransportPayloadReport,
};

/// Return the compile-time-generated C ABI description embedded in this build.
pub fn abi_json() -> &'static str {
    include_str!(concat!(env!("OUT_DIR"), "/font-baker-abi-v0.json"))
}

use sha2::{Digest, Sha256};
use std::{borrow::ToOwned, string::String, vec::Vec};

/// Bake one source font face into the canonical shaping-only `PMNDRS_font` GLB.
pub fn bake_font(source: &[u8], descriptor: BakeDescriptorV0) -> Result<BakeResultV0, BakeError> {
    let descriptor = descriptor.validate()?;
    let source_hash = hex_sha256(source);
    let descriptor_hash = hex_sha256(&descriptor.canonical_bytes());
    let shaping = sfnt::build_shaping_payload(source, descriptor.font_face_index)?;
    let shaping_report = shaping.report.clone();
    let artifact = glb::build_font_glb(
        &shaping,
        ProvenanceV0 {
            source_hash,
            descriptor_hash,
            baker_version: abi_contract::BAKER_VERSION.to_owned(),
            harfrust_version: abi_contract::HARFRUST_VERSION.to_owned(),
            harfbuzz_reference_version: abi_contract::HARFBUZZ_REFERENCE_VERSION.to_owned(),
            unicode_version: abi_contract::UNICODE_VERSION.to_owned(),
        },
    )?;
    let artifact_hash = hex_sha256(&artifact.bytes);
    let artifact_id = format!("font-{}", shaping.shaping_hash);
    let compressed = report::compressed_lengths(&artifact.bytes)?;
    let total_bytes = artifact.bytes.len();

    Ok(BakeResultV0 {
        artifacts: vec![BakeArtifactV0 {
            role: "font".to_owned(),
            id: artifact_id.clone(),
            bytes: artifact.bytes,
            sha256: artifact_hash,
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

pub(crate) fn hex_sha256(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        use core::fmt::Write;
        let _ = write!(output, "{byte:02x}");
    }
    output
}
