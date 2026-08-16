use serde_json::json;
use std::{string::ToString, vec::Vec};

use crate::{
    error::{BakeError, BakeErrorCode},
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
    provenance: ProvenanceV0,
) -> Result<GlbArtifact, BakeError> {
    let sfnt_offset = 0;
    let extents_offset = align4(shaping.sfnt.len());
    let availability_offset = extents_offset
        .checked_add(align4(shaping.extents.len()))
        .ok_or_else(overflow)?;
    let bin_len = availability_offset
        .checked_add(shaping.extents_availability.len())
        .ok_or_else(overflow)?;
    let mut bin = vec![0_u8; align4(bin_len)];
    bin[sfnt_offset..sfnt_offset + shaping.sfnt.len()].copy_from_slice(&shaping.sfnt);
    bin[extents_offset..extents_offset + shaping.extents.len()].copy_from_slice(&shaping.extents);
    bin[availability_offset..availability_offset + shaping.extents_availability.len()]
        .copy_from_slice(&shaping.extents_availability);

    let document = json!({
        "asset": { "version": "2.0", "generator": "@pmndrs/glyph" },
        "extensionsUsed": ["PMNDRS_font"],
        "extensionsRequired": ["PMNDRS_font"],
        "extensions": { "PMNDRS_font": {
            "version": 0,
            "shaping": {
                "format": "opentype-sfnt-harfrust-v0",
                "bufferView": 0,
                "hash": shaping.shaping_hash,
                "fontFunctions": {
                    "glyphExtentsBufferView": 1,
                    "glyphExtentsStride": 8,
                    "glyphExtentsAvailabilityBufferView": 2
                }
            },
            "metrics": shaping.metrics,
            "provenance": provenance,
            "rasters": []
        }},
        "buffers": [{ "byteLength": bin_len }],
        "bufferViews": [
            { "buffer": 0, "byteOffset": sfnt_offset, "byteLength": shaping.sfnt.len() },
            { "buffer": 0, "byteOffset": extents_offset, "byteLength": shaping.extents.len(), "byteStride": 8 },
            { "buffer": 0, "byteOffset": availability_offset, "byteLength": shaping.extents_availability.len() }
        ]
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn align4_rounds_up() {
        assert_eq!([align4(0), align4(1), align4(4), align4(5)], [0, 4, 4, 8]);
    }
}
