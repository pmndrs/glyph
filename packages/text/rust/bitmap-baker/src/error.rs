use std::string::{String, ToString};

use serde::Serialize;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BitmapBakeErrorCode {
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
pub struct BitmapBakeError {
    pub code: BitmapBakeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl BitmapBakeError {
    pub(crate) fn new(code: BitmapBakeErrorCode, message: impl ToString) -> Self {
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

pub(crate) fn overflow() -> BitmapBakeError {
    BitmapBakeError::new(
        BitmapBakeErrorCode::ArithmeticOverflow,
        "bitmap artifact size exceeds the supported range",
    )
}
