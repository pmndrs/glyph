//! Optional glyph outlines: the face's own `glyf`/`loca` or `CFF ` table, unchanged, in a small
//! SFNT beside `head` and `maxp`. The runtime shaper decodes one glyph at a time, and the bake
//! validator proves every glyph decodes with that same decoder.

use read_fonts::{FontRef, types::Tag};
use std::{borrow::ToOwned, vec::Vec};

use crate::{
    error::{BakeError, BakeErrorCode},
    report::OutlinePayloadReportV0,
    sfnt,
};

pub(crate) struct OutlinePayload {
    pub sfnt: Vec<u8>,
    pub report: OutlinePayloadReportV0,
}

pub(crate) fn build_outline_payload(
    source: &[u8],
    face_index: u32,
) -> Result<OutlinePayload, BakeError> {
    let font = FontRef::from_index(source, face_index).map_err(|error| {
        BakeError::new(
            BakeErrorCode::InvalidFont,
            format!("failed to read font face {face_index}: {error}"),
        )
    })?;
    let has = |tag: &[u8; 4]| font.table_data(Tag::new(tag)).is_some();
    let (source_format, tables): (_, &[&[u8; 4]]) = if has(b"glyf") && has(b"loca") {
        ("truetype", &[b"head", b"maxp", b"glyf", b"loca"])
    } else if has(b"CFF ") {
        ("cff", &[b"head", b"maxp", b"CFF "])
    } else if has(b"CFF2") {
        return Err(BakeError::new(
            BakeErrorCode::UnsupportedOutlineFormat,
            format!(
                "font face {face_index} has CFF2 outlines, which are not supported; bake it without outlines"
            ),
        ));
    } else {
        return Err(BakeError::new(
            BakeErrorCode::MissingTable,
            format!("font face {face_index} has no glyph outlines; bake it without outlines"),
        ));
    };
    let (sfnt, tables) = sfnt::write_sfnt(&font, tables.iter().map(|tag| Tag::new(tag)))?;
    Ok(OutlinePayload {
        report: OutlinePayloadReportV0 {
            format: "opentype-sfnt-outlines-v0".to_owned(),
            source_format: source_format.to_owned(),
            sfnt_directory_bytes: 12 + 16 * tables.len(),
            tables,
            total_raw_bytes: sfnt.len(),
        },
        sfnt,
    })
}
