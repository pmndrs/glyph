use alloc::{string::String, vec::Vec};

pub use pmndrs_glyph_raster_artifact::ArtifactPackaging;
use serde::{Deserialize, Serialize};

use crate::error::{SlugBakeError, SlugBakeErrorCode};

pub const SLUG_KIND: &str = "slug";
pub const SLUG_EXTENSION: &str = "PMNDRS_font_slug";
pub const SLUG_FORMAT_VERSION: u8 = 0;
pub const SLUG_GENERATOR_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SLUG_GENERATOR_LABEL: &str =
    concat!("@pmndrs/glyph Slug baker ", env!("CARGO_PKG_VERSION"));
pub const SLUG_PLANE_UNITS_PER_EM: u16 = 2048;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlugDescriptorV0 {
    pub generator_version: String,
}

impl SlugDescriptorV0 {
    pub(crate) fn validate(&self) -> Result<(), SlugBakeError> {
        if self.generator_version != SLUG_GENERATOR_VERSION {
            return Err(SlugBakeError::new(
                SlugBakeErrorCode::InvalidDescriptor,
                "unsupported Slug generator version",
            )
            .at("/descriptor/generatorVersion"));
        }
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlugPackagingV0 {
    pub artifact: ArtifactPackaging,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SlugBakeRequestV0 {
    pub source_fingerprint: String,
    pub font_face_index: u32,
    pub glyph_count: u16,
    pub shaping_fingerprint: String,
    pub raster_key: String,
    pub packaging: SlugPackagingV0,
    pub descriptor: SlugDescriptorV0,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlugBakeArtifactV0 {
    pub role: String,
    pub id: String,
    #[serde(skip)]
    pub bytes: Vec<u8>,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlugPageReportV0 {
    pub width: u16,
    pub height: u16,
    pub format: String,
    pub gpu_bytes: usize,
    pub source: String,
    pub encoded_bytes: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlugPayloadReportV0 {
    pub metadata_bytes: usize,
    pub serialized_bytes: usize,
    pub gpu_bytes: usize,
    pub pages: Vec<SlugPageReportV0>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SlugBakeResultV0 {
    pub raster_key: String,
    pub kind: String,
    pub extension: String,
    pub version: u8,
    pub artifacts: Vec<SlugBakeArtifactV0>,
    pub report: SlugPayloadReportV0,
}
