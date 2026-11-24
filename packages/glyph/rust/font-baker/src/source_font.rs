use read_fonts::{
    FontRef, TopLevelTable,
    collections::IntSet,
    tables::{cff::Cff, cff2::Cff2, name::NameId},
    types::{GlyphId, Tag},
};
use serde::{Deserialize, Serialize};
use skera::{DEFAULT_DROP_TABLES, Plan, SubsetFlags};
use skrifa::{GlyphNameSource, MetadataProvider};
use std::{string::String, string::ToString, vec::Vec};
use write_fonts::FontBuilder;

use crate::{
    BakeError, BakeErrorCode,
    layout_features::{LayoutFeatureSelection, ResolvedLayoutFeatures},
    sfnt::{reject_envelope, reject_unsupported_face},
};

const MAX_UNICODE_RANGES: usize = 4_096;
const MAX_UNICODE: u32 = 0x10_ffff;
const LEGACY_KERN: Tag = Tag::new(b"kern");
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
    /// `--layout-features` tokens: `*` (first only) starts from every feature, otherwise the bake starts from
    /// hb-subset's default list; `tag` or `+tag` adds, `-tag` removes. `None` keeps the default list.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout_features: Option<Vec<String>>,
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
    /// Added layout features the source has no GSUB or GPOS feature for, sorted.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub missing_layout_features: Vec<String>,
    /// Source layout features this preparation did not keep, sorted. The core bake records them in the artifact.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub dropped_layout_features: Vec<String>,
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
    let feature_selection = selection
        .layout_features
        .as_deref()
        .map(LayoutFeatureSelection::parse)
        .transpose()?
        .unwrap_or_default();
    reject_envelope(source)?;
    let font = parse_font(source, selection.font_face_index)?;
    reject_unsupported_face(&font)?;
    let mut unicodes = IntSet::<u32>::empty();
    for range in unicode_ranges {
        insert_scalar_range(&mut unicodes, range);
    }
    let every_code_point = matches!(
        unicode_ranges,
        [UnicodeRangeV0 {
            start: 0,
            end: MAX_UNICODE
        }]
    );

    // A bake of every code point keeps the source's glyph count as well as its IDs (below): the last glyph is kept
    // explicitly, so the original source still rasterizes the prepared font glyph for glyph.
    let mut glyphs = IntSet::<GlyphId>::empty();
    if every_code_point {
        let count = font.glyph_names().num_glyphs();
        if count > 0 {
            glyphs.insert(GlyphId::new(count - 1));
        }
    }
    let drop_tables = DEFAULT_DROP_TABLES.iter().copied().collect::<IntSet<Tag>>();
    let mut layout_scripts = IntSet::<Tag>::empty();
    layout_scripts.invert();
    let ResolvedLayoutFeatures {
        kept: layout_features,
        missing: missing_layout_features,
        dropped: dropped_layout_features,
    } = feature_selection.resolve(&font);
    let mut name_ids = IntSet::<NameId>::empty();
    name_ids.insert_range(NameId::from(0)..=NameId::from(6));
    let mut name_languages = IntSet::<u16>::empty();
    name_languages.insert(0x0409);
    // skera has no CFF, CFF2 or legacy `kern` subsetter and leaves those tables out. Keeping every glyph at its source
    // ID keeps the source tables valid for the glyphs the subset retains, so they are copied in afterwards: a subset of
    // a kern-only font then kerns like a full bake. A bake of every code point (one without `--unicodes`) keeps source
    // glyph IDs too, so they stay the IDs `glyph glyphs` reports. The cost of retaining IDs is per-glyph metadata (glyph
    // extents and raster records) for the empty IDs below the highest kept glyph.
    let postscript_outlines = [Cff::TAG, Cff2::TAG]
        .into_iter()
        .find_map(|tag| font.table_data(tag).map(|data| (tag, data.as_bytes())));
    let legacy_kern = font.table_data(LEGACY_KERN).map(|data| data.as_bytes());
    let retain_glyph_ids =
        postscript_outlines.is_some() || legacy_kern.is_some() || every_code_point;
    let flags = if retain_glyph_ids {
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
    if postscript_outlines.is_some() || legacy_kern.is_some() {
        let subset = parse_font(&bytes, 0)?;
        let mut builder = FontBuilder::new();
        if let Some((tag, outlines)) = postscript_outlines {
            builder.add_raw(tag, outlines);
        }
        if let Some(kern) = legacy_kern {
            builder.add_raw(LEGACY_KERN, kern);
        }
        bytes = builder.copy_missing_tables(subset).build();
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
        missing_layout_features,
        dropped_layout_features,
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
    const SOURCE_SERIF: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf"
    );
    const DANCING_SCRIPT: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf"
    );
    const NOTO_SANS_CJK_JP: &[u8] = include_bytes!(
        "../../../../../benches/fixtures/fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf"
    );

    fn subset(source: &[u8], ranges: &[(u32, u32)]) -> PreparedFontV0 {
        subset_with_features(source, ranges, None).expect("subset")
    }

    fn subset_with_features(
        source: &[u8],
        ranges: &[(u32, u32)],
        layout_features: Option<&[&str]>,
    ) -> Result<PreparedFontV0, BakeError> {
        prepare_font(
            source,
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                layout_features: layout_features
                    .map(|tags| tags.iter().map(|tag| tag.to_string()).collect()),
                unicode_ranges: ranges
                    .iter()
                    .map(|&(start, end)| UnicodeRangeV0 { start, end })
                    .collect(),
            },
        )
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

    fn layout_feature_tags(font: &FontRef<'_>) -> String {
        let mut tags = crate::layout_features::source_feature_tags(font)
            .iter()
            .map(|tag| tag.to_string())
            .collect::<Vec<_>>();
        tags.sort();
        tags.join(" ")
    }

    const ASCII: &[(u32, u32)] = &[(0x20, 0x7e)];
    const EVERY_CODE_POINT: &[(u32, u32)] = &[(0, MAX_UNICODE)];

    #[test]
    fn prepares_a_shaping_complete_ascii_subset() {
        let result = subset(INTER, ASCII);
        assert!(result.bytes.len() < INTER.len());
        let font = FontRef::new(&result.bytes).expect("subset font");
        assert!(font.charmap().map('A').is_some());
        assert!(font.charmap().map('é').is_none());
    }

    /// Each selection's features and glyph count equal `hb-subset --unicodes=20-7e` (HarfBuzz 14.4.0) with the
    /// matching `--layout-features` options, an independent subsetter run on the same input.
    #[test]
    fn ascii_selections_match_hb_subset() {
        for (name, source, tokens, features, glyphs) in [
            // `hb-subset` defaults: the common set.
            (
                "Source Serif 4",
                SOURCE_SERIF,
                None,
                "dnom frac kern liga locl numr",
                167,
            ),
            ("Inter", INTER, None, "calt dnom frac kern numr", 178),
            (
                "Inter",
                INTER,
                Some(&[][..]),
                "calt dnom frac kern numr",
                178,
            ),
            // `--layout-features+=smcp,onum`
            (
                "Source Serif 4",
                SOURCE_SERIF,
                Some(&["smcp", "+onum"][..]),
                "dnom frac kern liga locl numr onum smcp",
                224,
            ),
            // `--layout-features-=liga`
            (
                "Source Serif 4",
                SOURCE_SERIF,
                Some(&["-liga"][..]),
                "dnom frac kern locl numr",
                158,
            ),
            // `--layout-features='*'`. Source Serif's `ss01`/`ss02` are Cyrillic alternates an ASCII subset drops.
            (
                "Source Serif 4",
                SOURCE_SERIF,
                Some(&["*"][..]),
                "aalt c2sc case dnom frac kern liga lnum locl numr onum ordn pnum sinf size smcp subs sups tnum zero",
                330,
            ),
            // `--layout-features='*' --layout-features-=ss01,ss02`
            (
                "Inter",
                INTER,
                Some(&["*", "-ss01", "-ss02"][..]),
                "aalt calt case cpsp cv01 cv02 cv03 cv04 cv05 cv06 cv08 cv09 cv10 cv11 cv12 cv13 dlig dnom frac kern \
                 numr ordn pnum salt sinf ss03 ss04 ss05 ss06 ss07 subs sups tnum zero",
                484,
            ),
        ] {
            let prepared = subset_with_features(source, ASCII, tokens).expect("subset");
            let font = FontRef::new(&prepared.bytes).expect("subset font");
            assert_eq!(layout_feature_tags(&font), features, "{name} {tokens:?}");
            assert_eq!(prepared.report.glyph_count, glyphs, "{name} {tokens:?}");
        }
    }

    #[test]
    fn a_full_bake_and_a_subset_bake_keep_the_same_features() {
        // A bake without `--unicodes` prepares every code point with the same default, so for the same code points the
        // two agree. A full bake keeps source glyph IDs.
        for (name, source) in [("Source Serif 4", SOURCE_SERIF), ("Inter", INTER)] {
            let source_font = FontRef::new(source).expect("source font");
            let full = subset(source, EVERY_CODE_POINT);
            let full_font = FontRef::new(&full.bytes).expect("full font");
            let mapped = source_font
                .charmap()
                .mappings()
                .map(|(code_point, _)| (code_point, code_point))
                .collect::<Vec<_>>();
            let covered = subset(source, &mapped);
            let covered_font = FontRef::new(&covered.bytes).expect("covered font");
            assert_eq!(
                layout_feature_tags(&full_font),
                layout_feature_tags(&covered_font),
                "{name}"
            );
            assert_eq!(
                full.report.dropped_layout_features,
                covered.report.dropped_layout_features
            );
            assert_eq!(
                full_font.charmap().map('A'),
                source_font.charmap().map('A'),
                "{name} keeps glyph IDs"
            );
            assert_eq!(
                full.report.glyph_count,
                source_font.glyph_names().num_glyphs(),
                "{name} keeps the glyph count"
            );
        }
    }

    #[test]
    fn the_default_drops_discretionary_features_and_reports_them() {
        let prepared = subset(SOURCE_SERIF, EVERY_CODE_POINT);
        let font = FontRef::new(&prepared.bytes).expect("full font");
        let kept = layout_feature_tags(&font);
        for tag in ["smcp", "c2sc", "onum", "tnum", "zero", "ss01"] {
            assert!(!kept.split(' ').any(|kept| kept == tag), "{tag} dropped");
            assert!(
                prepared
                    .report
                    .dropped_layout_features
                    .iter()
                    .any(|dropped| dropped == tag),
                "{tag} reported"
            );
        }
        // `hb-subset --unicodes='*' --retain-gids` keeps the same features.
        assert_eq!(kept, "ccmp dnom frac kern liga locl mark mkmk numr");

        let every = subset_with_features(SOURCE_SERIF, EVERY_CODE_POINT, Some(&["*"]))
            .expect("every feature");
        assert!(every.report.dropped_layout_features.is_empty());
        let without = subset_with_features(SOURCE_SERIF, EVERY_CODE_POINT, Some(&["*", "-ss01"]))
            .expect("all but ss01");
        assert_eq!(without.report.dropped_layout_features, ["ss01"]);
    }

    #[test]
    fn shaping_floor_features_survive_and_cannot_be_removed() {
        let prepared =
            subset_with_features(INTER, EVERY_CODE_POINT, Some(&["-liga", "-kern", "-calt"]))
                .expect("subset");
        let font = FontRef::new(&prepared.bytes).expect("subset font");
        assert_eq!(
            layout_feature_tags(&font),
            "ccmp dnom frac locl mark mkmk numr"
        );
        let error = subset_with_features(INTER, ASCII, Some(&["-mark"])).expect_err("floor");
        assert_eq!(error.code, BakeErrorCode::InvalidSelection);
        assert!(error.message.contains("'mark'"), "{}", error.message);
    }

    #[test]
    fn layout_feature_selection_reports_absent_tags() {
        let prepared =
            subset_with_features(INTER, ASCII, Some(&["smcp", "ss01", "zzzz"])).expect("subset");
        assert_eq!(prepared.report.missing_layout_features, ["smcp", "zzzz"]);
    }

    #[test]
    fn preparation_refuses_faces_the_shaping_payload_cannot_represent() {
        let mut variable = INTER.to_vec();
        let table_count = u16::from_be_bytes([variable[4], variable[5]]) as usize;
        let record = (0..table_count)
            .map(|index| 12 + index * 16)
            .find(|&record| &variable[record..record + 4] == b"GSUB")
            .expect("GSUB record");
        variable[record..record + 4].copy_from_slice(b"fvar");
        let error = prepare_font(
            &variable,
            FontSelectionV0 {
                format_version: 0,
                font_face_index: 0,
                layout_features: None,
                unicode_ranges: vec![UnicodeRangeV0 {
                    start: 0x20,
                    end: 0x7e,
                }],
            },
        )
        .expect_err("variable face");
        assert_eq!(error.code, BakeErrorCode::UnsupportedVariableFont);
    }

    /// Inter with its GPOS removed and a legacy `kern` table holding `pairs`, as a kern-only font is built.
    fn kern_only_inter(pairs: &[(char, char, i16)]) -> (Vec<u8>, Vec<(u16, u16, i16)>) {
        let source = FontRef::new(INTER).expect("Inter");
        let mut ids = pairs
            .iter()
            .map(|&(left, right, value)| {
                let id = |c| source.charmap().map(c).expect("mapped").to_u32() as u16;
                (id(left), id(right), value)
            })
            .collect::<Vec<_>>();
        ids.sort();
        let mut kern = Vec::new();
        kern.extend_from_slice(&0u16.to_be_bytes()); // version
        kern.extend_from_slice(&1u16.to_be_bytes()); // nTables
        kern.extend_from_slice(&0u16.to_be_bytes()); // subtable version
        kern.extend_from_slice(&((14 + 6 * ids.len()) as u16).to_be_bytes());
        kern.extend_from_slice(&1u16.to_be_bytes()); // horizontal, format 0
        kern.extend_from_slice(&(ids.len() as u16).to_be_bytes());
        kern.extend_from_slice(&[0, 6, 0, 0, 0, 0]); // searchRange, entrySelector, rangeShift
        for (left, right, value) in &ids {
            kern.extend_from_slice(&left.to_be_bytes());
            kern.extend_from_slice(&right.to_be_bytes());
            kern.extend_from_slice(&value.to_be_bytes());
        }
        let mut builder = FontBuilder::new();
        for record in source.table_directory().table_records() {
            let tag = record.tag();
            if tag != Tag::new(b"GPOS") {
                builder.add_raw(tag, source.table_data(tag).expect("table").as_bytes());
            }
        }
        builder.add_raw(LEGACY_KERN, kern);
        (builder.build(), ids)
    }

    /// The kerning value a legacy `kern` format 0 table gives a glyph pair.
    fn legacy_kerning(font: &FontRef<'_>, left: u16, right: u16) -> Option<i16> {
        let kern = font.table_data(LEGACY_KERN)?;
        let bytes = kern.as_bytes();
        let pairs = u16::from_be_bytes([bytes[10], bytes[11]]) as usize;
        (0..pairs).map(|index| 18 + index * 6).find_map(|at| {
            let pair = (
                u16::from_be_bytes([bytes[at], bytes[at + 1]]),
                u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]),
            );
            (pair == (left, right)).then(|| i16::from_be_bytes([bytes[at + 4], bytes[at + 5]]))
        })
    }

    #[test]
    fn a_subset_of_a_kern_only_font_kerns_like_a_full_bake() {
        let (source, pairs) = kern_only_inter(&[('A', 'V', -120), ('T', 'o', -90)]);
        for ranges in [ASCII, EVERY_CODE_POINT] {
            let prepared = subset(&source, ranges);
            let font = FontRef::new(&prepared.bytes).expect("prepared font");
            for &(left_char, right_char, _) in &[('A', 'V', 0), ('T', 'o', 0)] {
                let left = font.charmap().map(left_char).expect("mapped").to_u32() as u16;
                let right = font.charmap().map(right_char).expect("mapped").to_u32() as u16;
                let expected = pairs
                    .iter()
                    .find(|pair| (pair.0, pair.1) == (left, right))
                    .map(|pair| pair.2);
                assert!(
                    expected.is_some(),
                    "{ranges:?} keeps source glyph IDs for {left_char}{right_char}"
                );
                assert_eq!(
                    legacy_kerning(&font, left, right),
                    expected,
                    "{ranges:?} {left_char}{right_char} kerning"
                );
            }
        }
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
                layout_features: None,
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
