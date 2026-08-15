use alloc::string::{String, ToString};

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SlugBakeErrorCode {
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
pub struct SlugBakeError {
    pub code: SlugBakeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl SlugBakeError {
    pub(crate) fn new(code: SlugBakeErrorCode, message: impl ToString) -> Self {
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

impl From<pmndrs_glyph_raster_artifact::RasterArtifactError> for SlugBakeError {
    fn from(error: pmndrs_glyph_raster_artifact::RasterArtifactError) -> Self {
        use pmndrs_glyph_raster_artifact::RasterArtifactError;

        match error {
            RasterArtifactError::Allocation | RasterArtifactError::ArithmeticOverflow => overflow(),
            RasterArtifactError::InvalidTexture | RasterArtifactError::Serialization => {
                Self::new(SlugBakeErrorCode::SerializationFailed, error)
            }
        }
    }
}

pub(crate) fn overflow() -> SlugBakeError {
    SlugBakeError::new(
        SlugBakeErrorCode::ArithmeticOverflow,
        "Slug artifact size exceeds the supported range",
    )
}
