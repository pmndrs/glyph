use alloc::vec::Vec;
use unicode_bidi::{
    BidiClass, BidiDataSource, LTR_LEVEL, RTL_LEVEL, data_source::BidiMatchedOpeningBracket,
    utf16::BidiInfo,
};

mod generated {
    include!("generated/bidi_data.rs");
}

pub use generated::UNICODE_VERSION;

pub const DIRECTION_AUTO: u8 = 0;
pub const DIRECTION_LTR: u8 = 1;
pub const DIRECTION_RTL: u8 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BidiError {
    InvalidDirection,
    ResultTooLarge,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct BidiRun {
    pub text_start: u32,
    pub text_end: u32,
    pub level: u8,
}

/// What makes a bidi paragraph need the full algorithm, counted per paragraph.
///
/// Levels are all zero exactly when every count is zero and the base level is 0, so a local edit
/// keeps these up to date with `include`/`exclude` and reruns the paragraph when `is_zero`
/// changes. A window that holds no such character can still carry non-zero levels (digits after a
/// Hebrew letter), which is why the counts are per bidi paragraph and never per window.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct BidiParagraphCounts {
    /// Characters of class R, AL or AN.
    pub strong_rtl: u32,
    /// Embedding and isolate controls and their terminators: LRE, RLE, PDF, LRI, RLI, FSI, PDI.
    pub explicit: u32,
    /// Overrides: LRO, RLO.
    pub overrides: u32,
}

impl BidiParagraphCounts {
    pub fn is_zero(self) -> bool {
        self.strong_rtl == 0 && self.explicit == 0 && self.overrides == 0
    }

    /// Counts one UTF-16 unit of the given class code (`class_code`).
    pub fn include(&mut self, class: u8) {
        match class {
            1 | 2 | 6 => self.strong_rtl += 1,
            14 | 16 | 18..=22 => self.explicit += 1,
            15 | 17 => self.overrides += 1,
            _ => {}
        }
    }

    /// Removes one UTF-16 unit of the given class code, the inverse of `include`.
    pub fn exclude(&mut self, class: u8) {
        match class {
            1 | 2 | 6 => self.strong_rtl -= 1,
            14 | 16 | 18..=22 => self.explicit -= 1,
            15 | 17 => self.overrides -= 1,
            _ => {}
        }
    }
}

/// Bidi_Class B: the only class that ends a bidi paragraph. U+2028, U+000B and U+000C force a
/// line but are WS or S, so required line breaks are not bidi paragraph boundaries.
pub const CLASS_PARAGRAPH_SEPARATOR: u8 = 10;

#[derive(Default)]
pub struct BidiAnalysis {
    pub levels: Vec<u8>,
    pub classes: Vec<u8>,
    pub paragraph_starts: Vec<u32>,
    pub paragraph_ends: Vec<u32>,
    pub paragraph_levels: Vec<u8>,
    pub runs: Vec<BidiRun>,
}

pub fn analyze(text: &[u16], direction: u8) -> Result<BidiAnalysis, BidiError> {
    let mut output = BidiAnalysis::default();
    analyze_into(text, direction, &mut output)?;
    Ok(output)
}

/// Classifies once, splits at Bidi_Class B, and runs the full algorithm only on paragraphs whose
/// counts are not zero or whose base level is not 0. Equal to `analyze_whole_into` for every text.
pub fn analyze_into(
    text: &[u16],
    direction: u8,
    output: &mut BidiAnalysis,
) -> Result<(), BidiError> {
    let default_level = default_level(direction)?;
    output.clear();
    reserve(&mut output.levels, text.len())?;
    reserve(&mut output.classes, text.len())?;
    let mut start = 0usize;
    while start < text.len() {
        // Every Bidi_Class B character is a single BMP unit, so the paragraph end needs no table.
        let end = paragraph_end(text, start);
        output.finish_paragraph(text, start, end, default_level)?;
        start = end;
    }
    if text.is_empty() {
        output.finish_paragraph(text, 0, 0, default_level)?;
    }
    output.build_runs()
}

/// The whole-text reference: one `unicode-bidi` pass over every paragraph.
pub fn analyze_whole_into(
    text: &[u16],
    direction: u8,
    output: &mut BidiAnalysis,
) -> Result<(), BidiError> {
    let default_level = default_level(direction)?;
    let info = BidiInfo::new_with_data_source(&Unicode17BidiData, text, default_level);
    output.clear();
    output.reserve_for_analysis(text.len(), info.paragraphs.len().max(1))?;
    if info.paragraphs.is_empty() {
        output.paragraph_starts.push(0);
        output.paragraph_ends.push(0);
        output
            .paragraph_levels
            .push(default_level.unwrap_or(LTR_LEVEL).number());
    } else {
        for paragraph in &info.paragraphs {
            output
                .paragraph_starts
                .push(u32::try_from(paragraph.range.start).map_err(|_| BidiError::ResultTooLarge)?);
            output
                .paragraph_ends
                .push(u32::try_from(paragraph.range.end).map_err(|_| BidiError::ResultTooLarge)?);
            output.paragraph_levels.push(paragraph.level.number());
        }
    }
    output
        .levels
        .extend(info.levels.iter().map(|level| level.number()));
    output
        .classes
        .extend(info.original_classes.iter().copied().map(class_code));
    output.build_runs()
}

fn default_level(direction: u8) -> Result<Option<unicode_bidi::Level>, BidiError> {
    match direction {
        DIRECTION_AUTO => Ok(None),
        DIRECTION_LTR => Ok(Some(LTR_LEVEL)),
        DIRECTION_RTL => Ok(Some(RTL_LEVEL)),
        _ => Err(BidiError::InvalidDirection),
    }
}

/// The units of Bidi_Class B; `paragraph_separators_are_these_units` checks it against the table.
/// Written as non-short-circuit compares so the fold in `paragraph_end` vectorizes.
fn is_paragraph_separator(unit: u16) -> bool {
    (unit == 0x0a)
        | (unit == 0x0d)
        | (unit.wrapping_sub(0x1c) < 3)
        | (unit == 0x85)
        | (unit == 0x2029)
}

/// One past the first paragraph separator at or after `start`, or the end of the text.
fn paragraph_end(text: &[u16], start: usize) -> usize {
    let mut index = start;
    // Fold compare over 32 units, then locate inside the chunk that has one.
    while let Some(chunk) = text.get(index..index + 32) {
        let mut found = false;
        for unit in chunk {
            found |= is_paragraph_separator(*unit);
        }
        if found {
            break;
        }
        index += 32;
    }
    text[index..]
        .iter()
        .position(|unit| is_paragraph_separator(*unit))
        .map_or(text.len(), |offset| index + offset + 1)
}

fn is_low_surrogate(unit: u16) -> bool {
    (0xdc00..=0xdfff).contains(&unit)
}

/// The class code of the character at `index` and its length in units. An unpaired surrogate is
/// U+FFFD, as `unicode-bidi` decodes it.
fn unit_class(text: &[u16], index: usize) -> (u8, usize) {
    let unit = text[index];
    let (character, length) = if (0xd800..=0xdbff).contains(&unit) {
        match text.get(index + 1) {
            Some(low) if is_low_surrogate(*low) => (
                char::from_u32(
                    0x1_0000 + (((u32::from(unit) - 0xd800) << 10) | (u32::from(*low) - 0xdc00)),
                )
                .unwrap_or(char::REPLACEMENT_CHARACTER),
                2,
            ),
            _ => (char::REPLACEMENT_CHARACTER, 1),
        }
    } else {
        (
            char::from_u32(u32::from(unit)).unwrap_or(char::REPLACEMENT_CHARACTER),
            1,
        )
    };
    (class_code(Unicode17BidiData.bidi_class(character)), length)
}

impl BidiAnalysis {
    /// The counts of bidi paragraph `index`, read from the class lane.
    ///
    /// Not stored as a field so the analysis keeps its shape for every existing reader; a local
    /// edit takes them once per paragraph and maintains them with `include` and `exclude`.
    pub fn paragraph_counts(&self, index: usize) -> BidiParagraphCounts {
        let start = self.paragraph_starts[index] as usize;
        let end = self.paragraph_ends[index] as usize;
        let mut counts = BidiParagraphCounts::default();
        for class in &self.classes[start..end] {
            counts.include(*class);
        }
        counts
    }

    pub fn reserve(&mut self, text_capacity: usize) -> Result<(), BidiError> {
        self.reserve_for_analysis(text_capacity, 1)
    }

    fn reserve_for_analysis(
        &mut self,
        text_capacity: usize,
        paragraph_capacity: usize,
    ) -> Result<(), BidiError> {
        reserve(&mut self.levels, text_capacity)?;
        reserve(&mut self.classes, text_capacity)?;
        reserve(&mut self.runs, text_capacity)?;
        reserve(&mut self.paragraph_starts, paragraph_capacity)?;
        reserve(&mut self.paragraph_ends, paragraph_capacity)?;
        reserve(&mut self.paragraph_levels, paragraph_capacity)
    }

    pub(crate) fn clear(&mut self) {
        self.levels.clear();
        self.classes.clear();
        self.paragraph_starts.clear();
        self.paragraph_ends.clear();
        self.paragraph_levels.clear();
        self.runs.clear();
    }

    /// Records the paragraph `[start, end)` and resolves its levels.
    ///
    /// The class scan stops at the first character that needs the full algorithm, so a paragraph
    /// with RTL text is classified once, by `unicode-bidi`, as before.
    fn finish_paragraph(
        &mut self,
        text: &[u16],
        start: usize,
        end: usize,
        default_level: Option<unicode_bidi::Level>,
    ) -> Result<(), BidiError> {
        grow(&mut self.paragraph_starts)?;
        grow(&mut self.paragraph_ends)?;
        grow(&mut self.paragraph_levels)?;
        self.paragraph_starts
            .push(u32::try_from(start).map_err(|_| BidiError::ResultTooLarge)?);
        self.paragraph_ends
            .push(u32::try_from(end).map_err(|_| BidiError::ResultTooLarge)?);
        let mut plain = default_level != Some(RTL_LEVEL);
        let mut index = start;
        while plain && index < end {
            let (class, length) = unit_class(text, index);
            let mut counts = BidiParagraphCounts::default();
            counts.include(class);
            if counts.is_zero() {
                for _ in 0..length {
                    self.classes.push(class);
                }
                index += length;
            } else {
                plain = false;
            }
        }
        if plain {
            // No R, AL, AN, embedding, isolate or override, and the base level is 0 (P3, or an
            // explicit LTR direction): every level is 0 and the classes are the original ones.
            self.paragraph_levels.push(0);
            self.levels.resize(end, 0);
            return Ok(());
        }
        self.classes.truncate(start);
        let info =
            BidiInfo::new_with_data_source(&Unicode17BidiData, &text[start..end], default_level);
        self.paragraph_levels.push(
            info.paragraphs
                .first()
                .map_or(default_level.unwrap_or(LTR_LEVEL), |paragraph| {
                    paragraph.level
                })
                .number(),
        );
        self.levels
            .extend(info.levels.iter().map(|level| level.number()));
        // FSI resolves to LRI or RLI in the original classes (X5c).
        self.classes
            .extend(info.original_classes.iter().copied().map(class_code));
        Ok(())
    }

    fn build_runs(&mut self) -> Result<(), BidiError> {
        let mut start = 0usize;
        while start < self.levels.len() {
            let level = self.levels[start];
            // Level runs end at the next transition; the D-245 transition-mask
            // kernel scans sixteen levels per step on simd128 builds.
            let end = crate::engine::line_kernels::next_transition(&self.levels, start);
            grow(&mut self.runs)?;
            self.runs.push(BidiRun {
                text_start: u32::try_from(start).map_err(|_| BidiError::ResultTooLarge)?,
                text_end: u32::try_from(end).map_err(|_| BidiError::ResultTooLarge)?,
                level,
            });
            start = end;
        }
        Ok(())
    }
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), BidiError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| BidiError::ResultTooLarge)?;
    }
    Ok(())
}

/// Room for one more element, growing geometrically.
fn grow<T>(values: &mut Vec<T>) -> Result<(), BidiError> {
    if values.len() == values.capacity() {
        values
            .try_reserve(1)
            .map_err(|_| BidiError::ResultTooLarge)?;
    }
    Ok(())
}

pub struct Unicode17BidiData;

impl BidiDataSource for Unicode17BidiData {
    fn bidi_class(&self, character: char) -> BidiClass {
        // Deliberate: a trie, not a range table. Three reads and no search, against a binary
        // probe per call — this runs once per character on every bidi analysis. Do not
        // "optimize" this back to a range table to save raw bytes.
        // `char` is a scalar value, so every index is in range by construction.
        let index = crate::unicode::trie::lookup(
            generated::BIDI_CLASS_ROOT,
            generated::BIDI_CLASS_MIDDLE,
            generated::BIDI_CLASS_LEAVES,
            generated::BIDI_CLASS_LEAF_SHIFT,
            generated::BIDI_CLASS_MIDDLE_SHIFT,
            character as u32,
        );
        generated::BIDI_CLASS_VALUES[usize::from(index)]
    }

    fn bidi_matched_opening_bracket(&self, character: char) -> Option<BidiMatchedOpeningBracket> {
        // Every paired bracket is in the BMP.
        let code_point = u16::try_from(character as u32).ok()?;
        generated::BIDI_BRACKETS
            .binary_search_by_key(&code_point, |entry| entry.0)
            .ok()
            .and_then(|index| {
                let (_, opening, is_open) = generated::BIDI_BRACKETS[index];
                Some(BidiMatchedOpeningBracket {
                    opening: char::from_u32(u32::from(opening))?,
                    is_open,
                })
            })
    }
}

pub fn class_code(class: BidiClass) -> u8 {
    match class {
        BidiClass::L => 0,
        BidiClass::R => 1,
        BidiClass::AL => 2,
        BidiClass::EN => 3,
        BidiClass::ES => 4,
        BidiClass::ET => 5,
        BidiClass::AN => 6,
        BidiClass::CS => 7,
        BidiClass::NSM => 8,
        BidiClass::BN => 9,
        BidiClass::B => 10,
        BidiClass::S => 11,
        BidiClass::WS => 12,
        BidiClass::ON => 13,
        BidiClass::LRE => 14,
        BidiClass::LRO => 15,
        BidiClass::RLE => 16,
        BidiClass::RLO => 17,
        BidiClass::PDF => 18,
        BidiClass::LRI => 19,
        BidiClass::RLI => 20,
        BidiClass::FSI => 21,
        BidiClass::PDI => 22,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_equals_whole(text: &str) {
        let units: Vec<u16> = text.encode_utf16().collect();
        for direction in [DIRECTION_AUTO, DIRECTION_LTR, DIRECTION_RTL] {
            let mut dense = BidiAnalysis::default();
            let mut whole = BidiAnalysis::default();
            analyze_into(&units, direction, &mut dense).unwrap();
            analyze_whole_into(&units, direction, &mut whole).unwrap();
            assert_eq!(dense.levels, whole.levels, "levels {text:?} {direction}");
            assert_eq!(dense.classes, whole.classes, "classes {text:?} {direction}");
            assert_eq!(dense.paragraph_starts, whole.paragraph_starts, "{text:?}");
            assert_eq!(dense.paragraph_ends, whole.paragraph_ends, "{text:?}");
            assert_eq!(dense.paragraph_levels, whole.paragraph_levels, "{text:?}");
            assert_eq!(dense.runs, whole.runs, "runs {text:?} {direction}");
        }
    }

    #[test]
    fn per_paragraph_analysis_equals_the_whole_text_reference() {
        const TOKENS: &[&str] = &[
            "a",
            "b",
            " ",
            " ",
            "1",
            "2",
            ",",
            "(",
            ")",
            "[",
            "]",
            "+",
            "-",
            "\n",
            "\r",
            "\r\n",
            "\u{2029}",
            "\u{2028}",
            "\u{b}",
            "\u{1c}",
            "\u{85}",
            "\t",
            "א",
            "ב",
            "ب",
            "\u{661}",
            "\u{202a}",
            "\u{202b}",
            "\u{202c}",
            "\u{202d}",
            "\u{202e}",
            "\u{2066}",
            "\u{2067}",
            "\u{2068}",
            "\u{2069}",
            "\u{200f}",
            "\u{200e}",
            "\u{301}",
            "\u{1e900}",
            "\u{1d400}",
            "字",
            "word ",
            "%",
            "$",
        ];
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        assert_equals_whole("");
        let rounds = if cfg!(debug_assertions) {
            4_000
        } else {
            100_000
        };
        for round in 0..rounds {
            let length = 1 + (next() % 24) as usize;
            let ltr_only = round % 2 == 0;
            let mut text = String::new();
            for _ in 0..length {
                let pick = next() as usize;
                text.push_str(if ltr_only && !pick.is_multiple_of(5) {
                    ["a", " ", "1", "\n", "(", ")", "\u{2029}", "word "][(pick >> 8) % 8]
                } else {
                    TOKENS[(pick >> 8) % TOKENS.len()]
                });
            }
            assert_equals_whole(&text);
        }
        // An unpaired surrogate is U+FFFD in both.
        for units in [&[0xd800u16, 0x61][..], &[0x61, 0xdc00], &[0x5d0, 0xd800]] {
            let mut dense = BidiAnalysis::default();
            let mut whole = BidiAnalysis::default();
            analyze_into(units, DIRECTION_AUTO, &mut dense).unwrap();
            analyze_whole_into(units, DIRECTION_AUTO, &mut whole).unwrap();
            assert_eq!(dense.levels, whole.levels);
            assert_eq!(dense.classes, whole.classes);
        }
    }

    #[test]
    fn paragraph_separators_are_these_units() {
        for scalar in (0..=0x10_ffffu32).filter_map(char::from_u32) {
            let separator = Unicode17BidiData.bidi_class(scalar) == BidiClass::B;
            let unit = u16::try_from(scalar as u32).ok();
            assert_eq!(
                separator,
                unit.is_some_and(is_paragraph_separator),
                "U+{:04X}",
                scalar as u32
            );
        }
    }

    #[test]
    fn counts_are_per_bidi_paragraph_and_gate_the_zero_level_path() {
        // U+2028 and U+000B force a line but do not end a bidi paragraph; U+2029 and LF do.
        let text: Vec<u16> =
            "ab\u{2028}cd\u{b}ef\nא 1 2 3 4 5 6 7 8 9, 10 + 11 x\u{2029}\u{202d}a\u{202c}"
                .encode_utf16()
                .collect();
        let result = analyze(&text, DIRECTION_AUTO).unwrap();
        assert_eq!(result.paragraph_starts.len(), 3);
        assert!(result.paragraph_counts(0).is_zero());
        assert_eq!(
            result.paragraph_counts(1),
            BidiParagraphCounts {
                strong_rtl: 1,
                explicit: 0,
                overrides: 0
            }
        );
        assert_eq!(
            result.paragraph_counts(2),
            BidiParagraphCounts {
                strong_rtl: 0,
                explicit: 1,
                overrides: 1
            }
        );
        // Digits far from the one Hebrew letter are level 2: no window is level zero by itself.
        let second = result.paragraph_starts[1] as usize;
        assert_eq!(result.levels[second + 18], 2);
        assert!(result.levels[..second].iter().all(|level| *level == 0));
        // A count crossing zero is what a local edit watches.
        let mut counts = result.paragraph_counts(1);
        counts.exclude(class_code(BidiClass::R));
        assert!(counts.is_zero());
        counts.include(class_code(BidiClass::AN));
        assert!(!counts.is_zero());
    }

    #[test]
    fn generated_data_is_unicode_17_and_covers_new_defaults() {
        assert_eq!(UNICODE_VERSION, "17.0.0");
        assert_eq!(Unicode17BidiData.bidi_class('\u{0590}'), BidiClass::R);
        assert_eq!(Unicode17BidiData.bidi_class('\u{088F}'), BidiClass::AL);
        assert_eq!(Unicode17BidiData.bidi_class('\u{10940}'), BidiClass::R);
        assert_eq!(Unicode17BidiData.bidi_class('\u{10FFFF}'), BidiClass::BN);
    }

    #[test]
    fn bracket_data_normalizes_canonical_openings() {
        let bracket = Unicode17BidiData
            .bidi_matched_opening_bracket('\u{232A}')
            .expect("paired bracket");
        assert_eq!(bracket.opening, '\u{3008}');
        assert!(!bracket.is_open);
    }

    #[test]
    fn utf16_analysis_preserves_surrogate_levels() {
        let text: Vec<u16> = "A\u{1E900}B".encode_utf16().collect();
        let result = analyze(&text, DIRECTION_AUTO).expect("analysis");
        assert_eq!(result.levels.len(), text.len());
        assert_eq!(result.levels[1], result.levels[2]);
        assert_eq!(result.classes[1], result.classes[2]);
    }

    #[test]
    fn analysis_reuses_output_and_builds_equal_level_runs() {
        let text: Vec<u16> = "abc אבג".encode_utf16().collect();
        let mut result = BidiAnalysis::default();
        result.reserve(32).unwrap();
        analyze_into(&text, DIRECTION_AUTO, &mut result).unwrap();
        let capacities = [
            result.levels.capacity(),
            result.classes.capacity(),
            result.runs.capacity(),
        ];
        assert_eq!(result.runs.first().map(|run| run.text_start), Some(0));
        assert_eq!(
            result.runs.last().map(|run| run.text_end),
            Some(text.len() as u32)
        );
        assert!(result.runs.iter().any(|run| run.level & 1 == 1));
        analyze_into(&text, DIRECTION_AUTO, &mut result).unwrap();
        assert_eq!(
            [
                result.levels.capacity(),
                result.classes.capacity(),
                result.runs.capacity(),
            ],
            capacities
        );
    }
}
