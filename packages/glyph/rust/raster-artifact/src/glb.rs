use serde_json::Value;
use std::vec::Vec;

use crate::RasterArtifactError;

pub fn append_buffer_view(
    binary: &mut Vec<u8>,
    views: &mut Vec<Value>,
    bytes: &[u8],
) -> Result<usize, RasterArtifactError> {
    while !binary.len().is_multiple_of(4) {
        binary.push(0);
    }
    let offset = binary.len();
    binary
        .try_reserve(bytes.len())
        .map_err(|_| RasterArtifactError::Allocation)?;
    binary.extend_from_slice(bytes);
    let index = views.len();
    views
        .try_reserve(1)
        .map_err(|_| RasterArtifactError::Allocation)?;
    views.push(serde_json::json!({
        "buffer": 0,
        "byteOffset": offset,
        "byteLength": bytes.len(),
    }));
    Ok(index)
}

pub fn encode_glb(root: &Value, mut binary: Vec<u8>) -> Result<Vec<u8>, RasterArtifactError> {
    let mut json_bytes =
        serde_json::to_vec(root).map_err(|_| RasterArtifactError::Serialization)?;
    while !json_bytes.len().is_multiple_of(4) {
        json_bytes.push(b' ');
    }
    while !binary.len().is_multiple_of(4) {
        binary.push(0);
    }
    let total_length = 12_usize
        .checked_add(8)
        .and_then(|value| value.checked_add(json_bytes.len()))
        .and_then(|value| value.checked_add(8))
        .and_then(|value| value.checked_add(binary.len()))
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(total_length)
        .map_err(|_| RasterArtifactError::Allocation)?;
    bytes.extend_from_slice(b"glTF");
    bytes.extend_from_slice(&2_u32.to_le_bytes());
    bytes.extend_from_slice(
        &u32::try_from(total_length)
            .map_err(|_| RasterArtifactError::ArithmeticOverflow)?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(
        &u32::try_from(json_bytes.len())
            .map_err(|_| RasterArtifactError::ArithmeticOverflow)?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(b"JSON");
    bytes.extend_from_slice(&json_bytes);
    bytes.extend_from_slice(
        &u32::try_from(binary.len())
            .map_err(|_| RasterArtifactError::ArithmeticOverflow)?
            .to_le_bytes(),
    );
    bytes.extend_from_slice(b"BIN\0");
    bytes.extend_from_slice(&binary);
    Ok(bytes)
}
