use serde::Serialize;
use std::string::String;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BakeErrorCode {
    InvalidDescriptor,
    InvalidSelection,
    InvalidFont,
    UnsupportedContainer,
    UnsupportedVariableFont,
    UnsupportedShapingSystem,
    MissingTable,
    InvalidTable,
    InvalidGlyphExtents,
    IntegerOverflow,
    SerializationFailed,
    SubsettingFailed,
}

#[derive(Debug, Error, Serialize)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct BakeError {
    pub code: BakeErrorCode,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

impl BakeError {
    pub(crate) fn new(code: BakeErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            path: None,
        }
    }
}
