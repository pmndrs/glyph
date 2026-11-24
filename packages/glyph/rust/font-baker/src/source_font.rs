use read_fonts::{
    FontRef, TopLevelTable,
    collections::IntSet,
    tables::{cff::Cff, cff2::Cff2, name::NameId},
    types::{GlyphId, Tag},
};
use serde::{Deserialize, Serialize};
use skera::{DEFAULT_DROP_TABLES, DEFAULT_LAYOUT_FEATURES, Plan, SubsetFlags};
use skrifa::{GlyphNameSource, MetadataProvider};
use std::{string::String, string::ToString, vec::Vec};
use write_fonts::FontBuilder;

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
    pub glyph_count: u32,
    pub fingerprint: String,
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
    // skera has no CFF or CFF2 subsetter and leaves those tables out. Keeping every glyph at its source ID keeps the
    // source charstrings valid for the glyphs the subset retains, so the source table is copied in afterwards.
    let postscript_outlines = [Cff::TAG, Cff2::TAG]
        .into_iter()
        .find_map(|tag| font.table_data(tag).map(|data| (tag, data.as_bytes())));
    let flags = if postscript_outlines.is_some() {
        SubsetFlags::SUBSET_FLAGS_RETAIN_GIDS
    } else {
        SubsetFlags::default()
    };
    let plan = Plan::new(
        &glyphs,
        &unicodes,
        &font,
        flags,
        &drop_tables,
        &layout_scripts,
        &layout_features,
        &name_ids,
        &name_languages,
    );
    let mut bytes = skera::subset_font(&font, &plan).map_err(|error| {
        BakeError::new(
            BakeErrorCode::SubsettingFailed,
            format!("font subsetting failed: {error}"),
        )
    })?;
    if let Some((tag, outlines)) = postscript_outlines {
        let subset = parse_font(&bytes, 0)?;
        bytes = FontBuilder::new()
            .add_raw(tag, outlines)
            .copy_missing_tables(subset)
            .build();
    }
    let prepared_font = parse_font(&bytes, 0)?;
    let glyph_count = prepared_font.glyph_names().num_glyphs();
    let report = PreparedFontReportV0 {
        format_version: 0,
        source_bytes: source.len(),
        prepared_bytes: bytes.len(),
        font_face_index: 0,
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
    const DANCING_SCRIPT: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf"
    );
    const NOTO_SANS_CJK_JP: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf"
    );

    fn subset(source: &[u8], ranges: &[(u32, u32)]) -> PreparedFontV0 {
        prepare_font(
            source,
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                unicode_ranges: ranges
                    .iter()
                    .map(|&(start, end)| UnicodeRangeV0 { start, end })
                    .collect(),
            },
        )
        .expect("subset")
    }

    #[derive(Default)]
    struct CountingPen(usize);

    impl skrifa::outline::OutlinePen for CountingPen {
        fn move_to(&mut self, _x: f32, _y: f32) {
            self.0 += 1;
        }
        fn line_to(&mut self, _x: f32, _y: f32) {
            self.0 += 1;
        }
        fn quad_to(&mut self, _cx0: f32, _cy0: f32, _x: f32, _y: f32) {
            self.0 += 1;
        }
        fn curve_to(&mut self, _cx0: f32, _cy0: f32, _cx1: f32, _cy1: f32, _x: f32, _y: f32) {
            self.0 += 1;
        }
        fn close(&mut self) {}
    }

    fn outline_commands(font: &FontRef<'_>, character: char) -> usize {
        let glyph = font.charmap().map(character).expect("mapped character");
        let outline = font.outline_glyphs().get(glyph).expect("outline glyph");
        let mut pen = CountingPen::default();
        outline
            .draw(
                skrifa::outline::DrawSettings::unhinted(
                    skrifa::instance::Size::unscaled(),
                    skrifa::instance::LocationRef::default(),
                ),
                &mut pen,
            )
            .expect("draw outline");
        pen.0
    }

    #[test]
    fn prepares_a_shaping_complete_ascii_subset() {
        let result = prepare_font(
            INTER,
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                unicode_ranges: vec![UnicodeRangeV0 {
                    start: 0x20,
                    end: 0x7e,
                }],
            },
        )
        .expect("ASCII subset");

        assert!(result.bytes.len() < INTER.len());
        assert!(result.report.glyph_count < 200);
        let font = FontRef::new(&result.bytes).expect("subset font");
        assert!(font.charmap().map('A').is_some());
        assert!(font.charmap().map('é').is_none());
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

    #[test]
    fn cff_subsets_keep_their_outlines() {
        for (name, source, ranges, characters) in [
            (
                "name-keyed DancingScript",
                DANCING_SCRIPT,
                &[(0x20, 0x7e)][..],
                &['A', 'g'][..],
            ),
            (
                "CID-keyed NotoSansCJKjp",
                NOTO_SANS_CJK_JP,
                &[(0x20, 0x7e), (0x3041, 0x3096), (0x65e5, 0x65e5)][..],
                &['A', 'あ', '日'][..],
            ),
        ] {
            let prepared = subset(source, ranges);
            assert!(prepared.bytes.len() < source.len(), "{name} is smaller");
            let font = FontRef::new(&prepared.bytes).expect("subset font");
            assert!(
                font.outline_glyphs().format().is_some(),
                "{name} keeps an outline table"
            );
            let original = FontRef::new(source).expect("source font");
            for &character in characters {
                let commands = outline_commands(&font, character);
                assert!(commands > 0, "{name} {character} has an outline");
                assert_eq!(
                    commands,
                    outline_commands(&original, character),
                    "{name} {character} keeps its source outline"
                );
            }
        }
    }
}
