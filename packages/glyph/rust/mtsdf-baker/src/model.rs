use alloc::{string::String, vec::Vec};

pub use pmndrs_glyph_raster_artifact::{
    ArtifactPackaging, PagePackaging, RasterCoverageV0, RasterUnicodeRangeV0,
};
use serde::{Deserialize, Serialize};

use crate::error::{MtsdfBakeError, MtsdfBakeErrorCode};

pub const MSDF_KIND: &str = "msdf";
pub const MSDF_EXTENSION: &str = "PMNDRS_font_distance_field";
pub const MSDF_FORMAT_VERSION: u8 = 0;
pub const MSDF_GENERATOR_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const MSDF_GENERATOR_LABEL: &str =
    concat!("@pmndrs/glyph MTSDF baker ", env!("CARGO_PKG_VERSION"));
pub const MTSDF_EM_SIZE: u16 = 64;
pub const MTSDF_PIXEL_RANGE: u16 = 8;
pub const MTSDF_PLANE_UNITS_PER_EM: u16 = MTSDF_EM_SIZE;
pub const MAX_MTSDF_EM_SIZE: u16 = 1022;
pub const MAX_MTSDF_PIXEL_RANGE: u16 = 1020;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct MtsdfBakeSettingsV0 {
    pub(crate) em_size: u16,
    pub(crate) pixel_range: u16,
}

impl MtsdfBakeSettingsV0 {
    pub(crate) const DEFAULT: Self = Self {
        em_size: MTSDF_EM_SIZE,
        pixel_range: MTSDF_PIXEL_RANGE,
    };

    pub(crate) fn field_padding(self) -> usize {
        usize::from(self.pixel_range / 2 + self.pixel_range % 2)
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfDescriptorV0 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coverage: Option<RasterCoverageV0>,
    pub generator_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub em_size: Option<u16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixel_range: Option<u16>,
}

impl MtsdfDescriptorV0 {
    pub(crate) fn validate(&self) -> Result<MtsdfBakeSettingsV0, MtsdfBakeError> {
        if let Some(coverage) = &self.coverage {
            coverage.validate().map_err(|error| {
                MtsdfBakeError::new(MtsdfBakeErrorCode::InvalidDescriptor, error)
                    .at("/descriptor/coverage")
            })?;
        }
        if self.generator_version != MSDF_GENERATOR_VERSION {
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "unsupported MTSDF generator version",
            )
            .at("/descriptor/generatorVersion"));
        }
        let (Some(em_size), Some(pixel_range)) = (self.em_size, self.pixel_range) else {
            if self.em_size.is_none() && self.pixel_range.is_none() {
                return Ok(MtsdfBakeSettingsV0::DEFAULT);
            }
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "custom MTSDF descriptors must provide both emSize and pixelRange",
            )
            .at("/descriptor"));
        };
        if em_size == 0 || em_size > MAX_MTSDF_EM_SIZE {
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "MTSDF emSize must be in 1..=1022",
            )
            .at("/descriptor/emSize"));
        }
        if pixel_range == 0 || pixel_range > MAX_MTSDF_PIXEL_RANGE {
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "MTSDF pixelRange must be in 1..=1020",
            )
            .at("/descriptor/pixelRange"));
        }
        let settings = MtsdfBakeSettingsV0 {
            em_size,
            pixel_range,
        };
        if settings == MtsdfBakeSettingsV0::DEFAULT {
            return Err(MtsdfBakeError::new(
                MtsdfBakeErrorCode::InvalidDescriptor,
                "the default 64/8 MTSDF settings must use the canonical fieldless descriptor",
            )
            .at("/descriptor"));
        }
        Ok(settings)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfPackagingV0 {
    pub artifact: ArtifactPackaging,
    pub pages: PagePackaging,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MtsdfBakeRequestV0 {
    pub source_fingerprint: String,
    pub font_face_index: u32,
    pub glyph_count: u16,
    pub shaping_fingerprint: String,
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
    pub fingerprint: String,
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
