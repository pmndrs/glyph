use alloc::string::{String, ToString};

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum MtsdfBakeErrorCode {
    InvalidDescriptor,
    InvalidFont,
    InvalidFontFace,
    InvalidGlyphCount,
    InvalidIdentity,
    InvalidGlyphOutline,
    GlyphTooLarge,
    ArithmeticOverflow,
    SerializationFailed,
}

#[derive(Debug, Serialize, thiserror::Error)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct MtsdfBakeError {
    pub code: MtsdfBakeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl MtsdfBakeError {
    pub(crate) fn new(code: MtsdfBakeErrorCode, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string(),
            path: None,
        }
    }

    pub(crate) fn at(mut self, path: impl ToString) -> Self {
        self.path = Some(path.to_string());
        self
    }
}

impl From<pmndrs_glyph_raster_artifact::RasterArtifactError> for MtsdfBakeError {
    fn from(error: pmndrs_glyph_raster_artifact::RasterArtifactError) -> Self {
        use pmndrs_glyph_raster_artifact::RasterArtifactError;

        match error {
            RasterArtifactError::Allocation | RasterArtifactError::ArithmeticOverflow => overflow(),
            RasterArtifactError::InvalidTexture | RasterArtifactError::Serialization => {
                Self::new(MtsdfBakeErrorCode::SerializationFailed, error)
            }
        }
    }
}

pub(crate) fn overflow() -> MtsdfBakeError {
    MtsdfBakeError::new(
        MtsdfBakeErrorCode::ArithmeticOverflow,
        "MTSDF artifact size exceeds the supported range",
    )
}
