use read_fonts::{
    FontRef,
    collections::IntSet,
    tables::name::NameId,
    types::{GlyphId, Tag},
};
use serde::{Deserialize, Serialize};
use skera::{DEFAULT_DROP_TABLES, DEFAULT_LAYOUT_FEATURES, Plan, SubsetFlags};
use skrifa::{GlyphNameSource, MetadataProvider};
use std::{string::String, string::ToString, vec::Vec};

use crate::{BakeError, BakeErrorCode};

const MAX_UNICODE_RANGES: usize = 4_096;
const MAX_UNICODE: u32 = 0x10_ffff;
const SURROGATE_START: u32 = 0xd800;
const SURROGATE_END: u32 = 0xdfff;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnicodeRangeV0 {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FontSelectionV0 {
    pub format_version: u8,
    pub font_face_index: u32,
    pub unicode_ranges: Vec<UnicodeRangeV0>,
    #[serde(default)]
    pub allow_whole_face_fallback: bool,
}

#[derive(Debug)]
pub struct PreparedFontV0 {
    pub bytes: Vec<u8>,
    pub report: PreparedFontReportV0,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedFontReportV0 {
    pub format_version: u8,
    pub source_bytes: usize,
    pub prepared_bytes: usize,
    pub font_face_index: u32,
    pub preparation: FontPreparationV0,
    pub glyph_count: u32,
    pub fingerprint: String,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum FontPreparationV0 {
    Subset,
    WholeFaceFallback,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontInspectionV0 {
    pub format_version: u8,
    pub font_face_index: u32,
    pub glyph_count: u32,
    pub glyph_name_source: GlyphInspectionNameSource,
    pub glyphs: Vec<GlyphInspectionV0>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GlyphInspectionNameSource {
    Post,
    Cff,
    None,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GlyphInspectionV0 {
    pub code_point: u32,
    pub glyph_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

pub fn prepare_font(
    source: &[u8],
    selection: FontSelectionV0,
) -> Result<PreparedFontV0, BakeError> {
    let unicode_ranges = validate_selection(&selection)?;
    let font = parse_font(source, selection.font_face_index)?;
    let has_truetype_outlines = font.table_data(Tag::new(b"glyf")).is_some()
        && font.table_data(Tag::new(b"loca")).is_some();
    let cff = !has_truetype_outlines && font.table_data(Tag::new(b"CFF ")).is_some();
    let cff2 = !has_truetype_outlines && font.table_data(Tag::new(b"CFF2")).is_some();
    if cff || cff2 {
        let format = if cff { "CFF" } else { "CFF2" };
        if !selection.allow_whole_face_fallback {
            return Err(BakeError::new(
                BakeErrorCode::SubsettingFailed,
                format!(
                    "font face {} has {format} outlines; CFF/CFF2 Unicode subsetting is unsupported. Omit Unicode ranges to bake the whole face, or set allowWholeFaceFallback (CLI --allow-whole-face-fallback) to retain the whole source",
                    selection.font_face_index
                ),
            ));
        }
        let bytes = source.to_vec();
        let report = PreparedFontReportV0 {
            format_version: 0,
            source_bytes: source.len(),
            prepared_bytes: bytes.len(),
            font_face_index: selection.font_face_index,
            preparation: FontPreparationV0::WholeFaceFallback,
            glyph_count: font.glyph_names().num_glyphs(),
            fingerprint: pmndrs_glyph_raster_artifact::fingerprint128(
                &bytes,
                pmndrs_glyph_raster_artifact::SOURCE_FINGERPRINT_V0,
            ),
        };
        return Ok(PreparedFontV0 { bytes, report });
    }
    let mut unicodes = IntSet::<u32>::empty();
    for range in unicode_ranges {
        insert_scalar_range(&mut unicodes, range);
    }

    let glyphs = IntSet::<GlyphId>::empty();
    let drop_tables = DEFAULT_DROP_TABLES.iter().copied().collect::<IntSet<Tag>>();
    let mut layout_scripts = IntSet::<Tag>::empty();
    layout_scripts.invert();
    let layout_features = DEFAULT_LAYOUT_FEATURES
        .iter()
        .copied()
        .collect::<IntSet<Tag>>();
    let mut name_ids = IntSet::<NameId>::empty();
    name_ids.insert_range(NameId::from(0)..=NameId::from(6));
    let mut name_languages = IntSet::<u16>::empty();
    name_languages.insert(0x0409);
    let plan = Plan::new(
        &glyphs,
        &unicodes,
        &font,
        SubsetFlags::default(),
        &drop_tables,
        &layout_scripts,
        &layout_features,
        &name_ids,
        &name_languages,
    );
    let bytes = skera::subset_font(&font, &plan).map_err(|error| {
        BakeError::new(
            BakeErrorCode::SubsettingFailed,
            format!("font subsetting failed: {error}"),
        )
    })?;
    let prepared_font = parse_font(&bytes, 0)?;
    let glyph_count = prepared_font.glyph_names().num_glyphs();
    let report = PreparedFontReportV0 {
        format_version: 0,
        source_bytes: source.len(),
        prepared_bytes: bytes.len(),
        font_face_index: 0,
        preparation: FontPreparationV0::Subset,
        glyph_count,
        fingerprint: pmndrs_glyph_raster_artifact::fingerprint128(
            &bytes,
            pmndrs_glyph_raster_artifact::SOURCE_FINGERPRINT_V0,
        ),
    };
    Ok(PreparedFontV0 { bytes, report })
}

pub fn inspect_font(source: &[u8], font_face_index: u32) -> Result<FontInspectionV0, BakeError> {
    let font = parse_font(source, font_face_index)?;
    let names = font.glyph_names();
    let glyph_name_source = match names.source() {
        GlyphNameSource::Post => GlyphInspectionNameSource::Post,
        GlyphNameSource::Cff => GlyphInspectionNameSource::Cff,
        GlyphNameSource::Synthesized => GlyphInspectionNameSource::None,
    };
    let mut glyphs = Vec::new();
    for (code_point, glyph_id) in font.charmap().mappings() {
        let name = names
            .get(glyph_id)
            .filter(|value| !value.is_synthesized())
            .map(|value| value.as_str().to_string());
        glyphs.push(GlyphInspectionV0 {
            code_point,
            glyph_id: glyph_id.to_u32(),
            name,
        });
    }
    Ok(FontInspectionV0 {
        format_version: 0,
        font_face_index,
        glyph_count: names.num_glyphs(),
        glyph_name_source,
        glyphs,
    })
}

fn parse_font(source: &[u8], font_face_index: u32) -> Result<FontRef<'_>, BakeError> {
    FontRef::from_index(source, font_face_index).map_err(|error| {
        BakeError::new(
            BakeErrorCode::InvalidFont,
            format!("failed to parse font face {font_face_index}: {error}"),
        )
    })
}

fn validate_selection(selection: &FontSelectionV0) -> Result<&[UnicodeRangeV0], BakeError> {
    if selection.format_version != 0 {
        return Err(BakeError::new(
            BakeErrorCode::InvalidSelection,
            format!(
                "unsupported font selection format version {}",
                selection.format_version
            ),
        ));
    }
    if selection.unicode_ranges.is_empty() {
        return Err(BakeError::new(
            BakeErrorCode::InvalidSelection,
            "font selection requires at least one Unicode range",
        ));
    }
    if selection.unicode_ranges.len() > MAX_UNICODE_RANGES {
        return Err(BakeError::new(
            BakeErrorCode::InvalidSelection,
            format!("font selection exceeds {MAX_UNICODE_RANGES} Unicode ranges"),
        ));
    }
    let mut previous_end = None;
    for range in &selection.unicode_ranges {
        if range.start > range.end || range.end > MAX_UNICODE {
            return Err(BakeError::new(
                BakeErrorCode::InvalidSelection,
                "Unicode ranges must be ordered inclusive values within U+10FFFF",
            ));
        }
        if previous_end.is_some_and(|end| range.start <= end) {
            return Err(BakeError::new(
                BakeErrorCode::InvalidSelection,
                "Unicode ranges must be sorted and non-overlapping",
            ));
        }
        previous_end = Some(range.end);
    }
    Ok(&selection.unicode_ranges)
}

fn insert_scalar_range(unicodes: &mut IntSet<u32>, range: &UnicodeRangeV0) {
    if range.start < SURROGATE_START {
        unicodes.insert_range(range.start..=range.end.min(SURROGATE_START - 1));
    }
    if range.end > SURROGATE_END {
        unicodes.insert_range(range.start.max(SURROGATE_END + 1)..=range.end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const INTER: &[u8] =
        include_bytes!("../../../../../benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf");
    const DANCING: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf"
    );

    #[test]
    fn prepares_a_shaping_complete_ascii_subset() {
        let result = prepare_font(
            INTER,
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                allow_whole_face_fallback: false,
                unicode_ranges: vec![UnicodeRangeV0 {
                    start: 0x20,
                    end: 0x7e,
                }],
            },
        )
        .expect("ASCII subset");

        assert!(result.bytes.len() < INTER.len());
        assert!(matches!(
            result.report.preparation,
            FontPreparationV0::Subset
        ));
        assert!(result.report.glyph_count < 200);
        let font = FontRef::new(&result.bytes).expect("subset font");
        assert!(font.charmap().map('A').is_some());
        assert!(font.charmap().map('é').is_none());
    }

    #[test]
    fn cff_subset_requires_explicit_whole_face_fallback() {
        let selection = FontSelectionV0 {
            format_version: 0,
            font_face_index: 0,
            unicode_ranges: vec![UnicodeRangeV0 {
                start: u32::from('A'),
                end: u32::from('A'),
            }],
            allow_whole_face_fallback: false,
        };
        let error =
            prepare_font(DANCING, selection.clone()).expect_err("CFF subset is unsupported");
        assert_eq!(error.code, BakeErrorCode::SubsettingFailed);
        assert!(
            error
                .message
                .contains("CFF/CFF2 Unicode subsetting is unsupported")
        );

        let prepared = prepare_font(
            DANCING,
            FontSelectionV0 {
                allow_whole_face_fallback: true,
                ..selection
            },
        )
        .expect("explicit whole-face fallback");
        assert!(matches!(
            prepared.report.preparation,
            FontPreparationV0::WholeFaceFallback
        ));
        assert_eq!(prepared.bytes.as_slice(), DANCING);
        assert_eq!(prepared.report.prepared_bytes, DANCING.len());
        assert_eq!(prepared.report.font_face_index, 0);
        let original = FontRef::new(DANCING).expect("source face");
        let retained = FontRef::new(&prepared.bytes).expect("retained face");
        assert_eq!(
            retained
                .table_data(Tag::new(b"CFF "))
                .map(|table| table.as_bytes()),
            original
                .table_data(Tag::new(b"CFF "))
                .map(|table| table.as_bytes())
        );
        for character in ['A', 'B', 'é'] {
            assert_eq!(
                retained.charmap().map(character),
                original.charmap().map(character)
            );
        }
        assert_eq!(
            retained.glyph_names().num_glyphs(),
            original.glyph_names().num_glyphs()
        );
    }

    #[test]
    fn inspection_reports_exact_nominal_glyph_ids() {
        let inspection = inspect_font(INTER, 0).expect("inspect Inter");
        let capital_a = inspection
            .glyphs
            .iter()
            .find(|glyph| glyph.code_point == u32::from('A'))
            .expect("A mapping");

        assert_eq!(capital_a.glyph_id, 2);
        assert_eq!(capital_a.name.as_deref(), Some("A"));
        assert!(inspection.glyph_count > 2_000);
    }

    #[test]
    fn selection_rejects_overlapping_ranges_before_font_parsing() {
        let error = prepare_font(
            &[],
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                allow_whole_face_fallback: false,
                unicode_ranges: vec![
                    UnicodeRangeV0 {
                        start: 0x20,
                        end: 0x7e,
                    },
                    UnicodeRangeV0 {
                        start: 0x7e,
                        end: 0xff,
                    },
                ],
            },
        )
        .expect_err("overlapping selection");

        assert_eq!(error.code, BakeErrorCode::InvalidSelection);
    }
}
