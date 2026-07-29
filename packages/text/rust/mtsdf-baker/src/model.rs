use alloc::{string::String, vec::Vec};

pub use pmndrs_text_raster_artifact::{ArtifactPackaging, PagePackaging};
use serde::{Deserialize, Serialize};

use crate::error::{MtsdfBakeError, MtsdfBakeErrorCode};

pub const MSDF_KIND: &str = "msdf";
pub const MSDF_EXTENSION: &str = "PMNDRS_font_distance_field";
pub const MSDF_FORMAT_VERSION: u8 = 0;
pub const MSDF_GENERATOR_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const MSDF_GENERATOR_LABEL: &str =
    concat!("@pmndrs/text MTSDF baker ", env!("CARGO_PKG_VERSION"));
pub const MTSDF_EM_SIZE: u16 = 64;
pub const MTSDF_PIXEL_RANGE: u16 = 8;
pub const MTSDF_PLANE_UNITS_PER_EM: u16 = MTSDF_EM_SIZE;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfDescriptorV0 {
    pub generator_version: String,
}

impl MtsdfDescriptorV0 {
    pub(crate) fn validate(&self) -> Result<(), MtsdfBakeError> {
        if self.generator_version != MSDF_GENERATOR_VERSION {
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "unsupported MTSDF generator version",
            )
            .at("/descriptor/generatorVersion"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfPackagingV0 {
    pub artifact: ArtifactPackaging,
    pub pages: PagePackaging,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfBakeRequestV0 {
    pub font_face_index: u32,
    pub glyph_count: u16,
    pub shaping_hash: String,
    pub raster_key: String,
    pub packaging: MtsdfPackagingV0,
    pub descriptor: MtsdfDescriptorV0,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakeArtifactV0 {
    pub role: String,
    pub id: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
    pub sha256: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfPageReportV0 {
    pub width: u16,
    pub height: u16,
    pub format: String,
    pub gpu_bytes: usize,
    pub source: String,
    pub encoded_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfPayloadReportV0 {
    pub metadata_bytes: usize,
    pub serialized_bytes: usize,
    pub gpu_bytes: usize,
    pub pages: Vec<MtsdfPageReportV0>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakeResultV0 {
    pub raster_key: String,
    pub kind: String,
    pub extension: String,
    pub version: u8,
    pub artifacts: Vec<MtsdfBakeArtifactV0>,
    pub report: MtsdfPayloadReportV0,
}
