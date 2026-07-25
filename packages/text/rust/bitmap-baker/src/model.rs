use std::{string::String, vec::Vec};

use serde::{Deserialize, Serialize};

use crate::error::{BitmapBakeError, BitmapBakeErrorCode};

pub const BITMAP_KIND: &str = "bitmap";
pub const BITMAP_EXTENSION: &str = "PMNDRS_font_bitmap";
pub const BITMAP_FORMAT_VERSION: u8 = 0;
pub const BITMAP_GENERATOR_VERSION: &str = "0.0.0";
pub const GLYPH_RECORD_STRIDE: usize = 20;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BitmapDescriptorV0 {
    pub generator_version: String,
    pub strikes: Vec<u16>,
}

impl BitmapDescriptorV0 {
    pub(crate) fn validate(&self) -> Result<(), BitmapBakeError> {
        if self.generator_version != BITMAP_GENERATOR_VERSION {
            return Err(BitmapBakeError::new(
                BitmapBakeErrorCode::InvalidDescriptor,
                "unsupported bitmap generator version",
            )
            .at("/descriptor/generatorVersion"));
        }
        if self.strikes.is_empty() {
            return Err(BitmapBakeError::new(
                BitmapBakeErrorCode::InvalidDescriptor,
                "bitmap descriptor requires at least one strike",
            )
            .at("/descriptor/strikes"));
        }
        let mut previous = 0_u16;
        for (index, value) in self.strikes.iter().copied().enumerate() {
            if value == 0 || (index != 0 && value <= previous) {
                return Err(BitmapBakeError::new(
                    BitmapBakeErrorCode::InvalidDescriptor,
                    "bitmap strikes must be positive, unique, and strictly ascending",
                )
                .at("/descriptor/strikes"));
            }
            previous = value;
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BitmapPackagingV0 {
    pub artifact: ArtifactPackaging,
    pub pages: PagePackaging,
}

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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BitmapBakeRequestV0 {
    pub font_face_index: u32,
    pub glyph_count: u16,
    pub shaping_hash: String,
    pub raster_key: String,
    pub packaging: BitmapPackagingV0,
    pub descriptor: BitmapDescriptorV0,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitmapBakeArtifactV0 {
    pub role: String,
    pub id: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitmapPageReportV0 {
    pub width: u16,
    pub height: u16,
    pub format: String,
    pub mip_bytes: usize,
    pub source: String,
    pub encoded_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitmapPayloadReportV0 {
    pub metadata_bytes: usize,
    pub serialized_bytes: usize,
    pub gpu_bytes: usize,
    pub pages: Vec<BitmapPageReportV0>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BitmapBakeResultV0 {
    pub raster_key: String,
    pub kind: String,
    pub extension: String,
    pub version: u8,
    pub artifacts: Vec<BitmapBakeArtifactV0>,
    pub report: BitmapPayloadReportV0,
}
