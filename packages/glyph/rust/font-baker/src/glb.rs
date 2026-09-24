use serde_json::json;
use std::{string::ToString, vec::Vec};

use crate::{
    error::{BakeError, BakeErrorCode},
    outline::OutlinePayload,
    report::ProvenanceV0,
    sfnt::ShapingPayload,
};

pub(crate) struct GlbArtifact {
    pub bytes: Vec<u8>,
    pub json_bytes: usize,
    pub padding_bytes: usize,
}

pub(crate) fn build_font_glb(
    shaping: &ShapingPayload,
    outlines: Option<&OutlinePayload>,
    provenance: ProvenanceV0,
) -> Result<GlbArtifact, BakeError> {
    let mut sections: Vec<(&[u8], Option<usize>)> = vec![
        (&shaping.sfnt, None),
        (&shaping.extents, Some(8)),
        (&shaping.extents_availability, None),
    ];
    if let Some(outlines) = outlines {
        sections.push((&outlines.sfnt, None));
    }
    let mut offsets = Vec::with_capacity(sections.len());
    let mut bin_len = 0_usize;
    for (bytes, _) in &sections {
        let offset = align4(bin_len);
        offsets.push(offset);
        bin_len = offset.checked_add(bytes.len()).ok_or_else(overflow)?;
    }
    let mut bin = vec![0_u8; align4(bin_len)];
    let mut buffer_views = Vec::with_capacity(sections.len());
    for ((bytes, stride), offset) in sections.iter().zip(&offsets) {
        bin[*offset..*offset + bytes.len()].copy_from_slice(bytes);
        let mut view = json!({ "buffer": 0, "byteOffset": offset, "byteLength": bytes.len() });
        if let Some(stride) = stride {
            view["byteStride"] = json!(stride);
        }
        buffer_views.push(view);
    }

    let mut font = json!({
        "version": 0,
        "shaping": {
            "format": "opentype-sfnt-harfrust-v0",
            "bufferView": 0,
            "fingerprint": shaping.shaping_fingerprint,
            "fontFunctions": {
                "glyphExtentsBufferView": 1,
                "glyphExtentsStride": 8,
                "glyphExtentsAvailabilityBufferView": 2
            }
        },
        "metrics": shaping.metrics,
        "provenance": provenance,
        "rasters": []
    });
    if outlines.is_some() {
        font["version"] = json!(1);
        font["outlines"] = json!({ "format": "opentype-sfnt-outlines-v0", "bufferView": 3 });
    }
    let document = json!({
        "asset": { "version": "2.0", "generator": "@pmndrs/glyph" },
        "extensionsUsed": ["PMNDRS_font"],
        "extensionsRequired": ["PMNDRS_font"],
        "extensions": { "PMNDRS_font": font },
        "buffers": [{ "byteLength": bin_len }],
        "bufferViews": buffer_views
    });
    let json_raw = serde_json::to_vec(&document)
        .map_err(|error| BakeError::new(BakeErrorCode::SerializationFailed, error.to_string()))?;
    let json_padded_len = align4(json_raw.len());
    let total_len = 12usize
        .checked_add(8 + json_padded_len)
        .and_then(|value| value.checked_add(8 + bin.len()))
        .ok_or_else(overflow)?;
    let mut bytes = Vec::with_capacity(total_len);
    bytes.extend_from_slice(&0x4654_6C67_u32.to_le_bytes());
    bytes.extend_from_slice(&2_u32.to_le_bytes());
    bytes.extend_from_slice(
        &u32::try_from(total_len)
            .map_err(|_| overflow())?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u32::try_from(json_padded_len)
            .map_err(|_| overflow())?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(&0x4E4F_534A_u32.to_le_bytes());
    bytes.extend_from_slice(&json_raw);
    bytes.resize(12 + 8 + json_padded_len, b' ');
    bytes.extend_from_slice(
        &u32::try_from(bin.len())
            .map_err(|_| overflow())?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(&0x004E_4942_u32.to_le_bytes());
    bytes.extend_from_slice(&bin);
    Ok(GlbArtifact {
        bytes,
        json_bytes: json_raw.len(),
        padding_bytes: json_padded_len - json_raw.len() + bin.len() - bin_len,
    })
}

fn align4(value: usize) -> usize {
    (value + 3) & !3
}
fn overflow() -> BakeError {
    BakeError::new(
        BakeErrorCode::IntegerOverflow,
        "GLB exceeds V0 addressable limits",
    )
}
