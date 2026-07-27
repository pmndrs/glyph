//! Shared allocation-conscious primitives for lossless raster artifacts.

#![cfg_attr(not(feature = "std"), no_std)]

#[cfg(not(feature = "std"))]
extern crate alloc as std;

mod atlas;
mod glb;
mod ktx;
mod records;

pub use atlas::{AtlasPage, RasterizedPage};
pub use glb::{append_buffer_view, encode_glb};
pub use ktx::{KtxFormat, encode_ktx2};
pub use records::{ABSENT_PAGE, GLYPH_RECORD_STRIDE, GlyphRecordTable};

use core::fmt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::string::String;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactPackaging {
    Embedded,
    External,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PagePackaging {
    Embedded,
    External,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RasterArtifactError {
    Allocation,
    ArithmeticOverflow,
    InvalidTexture,
    Serialization,
}

impl fmt::Display for RasterArtifactError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::Allocation => "raster artifact allocation failed",
            Self::ArithmeticOverflow => "raster artifact size exceeds the supported range",
            Self::InvalidTexture => "texture dimensions do not match the texel payload",
            Self::Serialization => "raster artifact serialization failed",
        })
    }
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    use core::fmt::Write;

    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(64);
    for byte in digest {
        let _ = write!(output, "{byte:02x}");
    }
    output
}

pub(crate) fn zeroed_bytes(byte_length: usize) -> Result<std::vec::Vec<u8>, RasterArtifactError> {
    let mut bytes = std::vec::Vec::new();
    bytes
        .try_reserve_exact(byte_length)
        .map_err(|_| RasterArtifactError::Allocation)?;
    bytes.resize(byte_length, 0);
    Ok(bytes)
}
