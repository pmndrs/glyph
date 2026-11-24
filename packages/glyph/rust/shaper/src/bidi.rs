use crate::cold_growth::ColdGrowth as _;
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
    // Level 0 is what a plain paragraph has; a resolved one overwrites its range of both lanes.
    output.levels.resize(text.len(), 0);
    output.classes.resize(text.len(), 0);
    let mut resolved = false;
    let mut start = 0usize;
    while start < text.len() {
        let scan = if default_level == Some(RTL_LEVEL) {
            PlainScan::Resolve
        } else {
            classify_plain(text, &mut output.classes, start)
        };
        let end = match scan {
            PlainScan::Plain { end } => end,
            // Every Bidi_Class B character is a single BMP unit, so the end needs no table.
            PlainScan::Resolve => paragraph_end(text, start),
        };
        output.push_paragraph(start, end)?;
        if matches!(scan, PlainScan::Plain { .. }) {
            // No R, AL, AN, embedding, isolate or override, and the base level is 0 (P3, or an
            // explicit LTR direction): every level is 0 and the classes are the original ones.
            output.paragraph_levels.push(0);
        } else {
            resolved = true;
            output.resolve_paragraph(text, start, end, default_level);
        }
        start = end;
    }
    if text.is_empty() {
        output.push_paragraph(0, 0)?;
        output
            .paragraph_levels
            .push(u8::from(default_level == Some(RTL_LEVEL)));
    }
    if resolved {
        output.build_runs()
    } else {
        output.build_plain_run()
    }
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

/// `class_code` of each trie value, so a lookup yields the code with no enum round trip.
static VALUE_CODES: [u8; 32] = {
    let mut codes = [0u8; 32];
    let mut index = 0;
    while index < generated::BIDI_CLASS_VALUES.len() {
        codes[index] = class_code(generated::BIDI_CLASS_VALUES[index]);
        index += 1;
    }
    codes
};

/// The class code of `code_point`, which must be at most U+10FFFF: `trie::lookup` over the class
/// trie, written out so the ASCII table below is built from the same tables at compile time.
const fn code_point_class(code_point: u32) -> u8 {
    const LEAF: u32 = generated::BIDI_CLASS_LEAF_SHIFT;
    const MIDDLE: u32 = generated::BIDI_CLASS_MIDDLE_SHIFT;
    let code_point = code_point as usize;
    let block = generated::BIDI_CLASS_ROOT[code_point >> (LEAF + MIDDLE)] as usize;
    let middle = (block << MIDDLE) | ((code_point >> LEAF) & ((1 << MIDDLE) - 1));
    let leaf = generated::BIDI_CLASS_MIDDLE[middle] as usize;
    let value = generated::BIDI_CLASS_LEAVES[(leaf << LEAF) | (code_point & ((1 << LEAF) - 1))];
    VALUE_CODES[value as usize]
}

/// The class code of every ASCII unit. None of them needs the full algorithm.
static ASCII_CODES: [u8; 128] = {
    let mut codes = [0u8; 128];
    let mut unit = 0;
    while unit < 128 {
        codes[unit] = code_point_class(unit as u32);
        unit += 1;
    }
    codes
};

/// The class codes `BidiParagraphCounts::include` counts, one bit per code: R, AL, AN and every
/// embedding, isolate and override control. A paragraph with none of them at base level 0 is
/// level 0 throughout.
const NEEDS_RESOLUTION: u32 = (1 << 1) | (1 << 2) | (1 << 6) | (0x1ff << 14);

/// The class code of the character at `index` and its length in units. An unpaired surrogate is
/// U+FFFD, as `unicode-bidi` decodes it.
fn unit_class(text: &[u16], index: usize) -> (u8, usize) {
    let unit = text[index];
    if !(0xd800..=0xdfff).contains(&unit) {
        return (code_point_class(u32::from(unit)), 1);
    }
    match text.get(index + 1) {
        Some(low) if unit <= 0xdbff && is_low_surrogate(*low) => (
            code_point_class(
                0x1_0000 + (((u32::from(unit) - 0xd800) << 10) | (u32::from(*low) - 0xdc00)),
            ),
            2,
        ),
        _ => (code_point_class(char::REPLACEMENT_CHARACTER as u32), 1),
    }
}

/// What the plain scan of one bidi paragraph found.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PlainScan {
    /// No character needs the full algorithm; `end` is one past the paragraph separator, or the
    /// text length, and every class code before it is written.
    Plain { end: usize },
    /// A character needs the full algorithm. The class lane holds nothing to keep from the
    /// paragraph start on.
    Resolve,
}

/// The paragraph ended, needs the full algorithm, or continues at the unit given.
enum Walk {
    Ended(usize),
    Resolve,
    Continue(usize),
}

const SEPARATOR: u32 = 1 << CLASS_PARAGRAPH_SEPARATOR;

/// Classifies the bidi paragraph that starts at `start`, writing class codes from there on.
///
/// Sixteen units at a time: an all-ASCII lane reads one table entry per unit, a lane of other
/// BMP units reads the trie, and both fold what they saw into one answer. Only a lane with a
/// surrogate, a paragraph separator or a character that needs the full algorithm is walked
/// character by character, as the tail of the text is. A lane may write codes past the
/// paragraph it ends in; the next paragraph writes them again.
fn classify_plain(text: &[u16], classes: &mut [u8], start: usize) -> PlainScan {
    const LANE: usize = 16;
    let mut index = start;
    while let (Some(units), Some(codes)) = (
        text.get(index..index + LANE),
        classes.get_mut(index..index + LANE),
    ) {
        let mut any = 0u16;
        let mut surrogate = false;
        for unit in units {
            any |= *unit;
            surrogate |= *unit & 0xf800 == 0xd800;
        }
        let walk = if any < 0x80 {
            // No ASCII unit needs the full algorithm, so only a separator stops the lane.
            let mut separator = false;
            for (code, unit) in codes.iter_mut().zip(units) {
                *code = ASCII_CODES[usize::from(*unit & 0x7f)];
                separator |= *code == CLASS_PARAGRAPH_SEPARATOR;
            }
            separator
        } else if surrogate {
            true
        } else {
            let mut seen = 0u32;
            for (code, unit) in codes.iter_mut().zip(units) {
                *code = code_point_class(u32::from(*unit));
                seen |= 1 << *code;
            }
            seen & (NEEDS_RESOLUTION | SEPARATOR) != 0
        };
        index = if walk {
            match walk_plain(text, classes, index, index + LANE) {
                Walk::Ended(end) => return PlainScan::Plain { end },
                Walk::Resolve => return PlainScan::Resolve,
                Walk::Continue(next) => next,
            }
        } else {
            index + LANE
        };
    }
    match walk_plain(text, classes, index, text.len()) {
        Walk::Ended(end) => PlainScan::Plain { end },
        Walk::Resolve => PlainScan::Resolve,
        Walk::Continue(_) => PlainScan::Plain { end: text.len() },
    }
}

/// `classify_plain` one character at a time over the characters that start in `[index, to)`.
fn walk_plain(text: &[u16], classes: &mut [u8], mut index: usize, to: usize) -> Walk {
    while index < to {
        let (class, length) = unit_class(text, index);
        if NEEDS_RESOLUTION >> class & 1 != 0 {
            return Walk::Resolve;
        }
        classes[index] = class;
        if length == 2 {
            // The low surrogate `unit_class` paired.
            classes[index + 1] = class;
        }
        index += length;
        if class == CLASS_PARAGRAPH_SEPARATOR {
            return Walk::Ended(index);
        }
    }
    Walk::Continue(index)
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

    fn push_paragraph(&mut self, start: usize, end: usize) -> Result<(), BidiError> {
        grow(&mut self.paragraph_starts)?;
        grow(&mut self.paragraph_ends)?;
        grow(&mut self.paragraph_levels)?;
        self.paragraph_starts
            .push(u32::try_from(start).map_err(|_| BidiError::ResultTooLarge)?);
        self.paragraph_ends
            .push(u32::try_from(end).map_err(|_| BidiError::ResultTooLarge)?);
        Ok(())
    }

    /// Runs the full algorithm on the paragraph `[start, end)`, which `push_paragraph` recorded,
    /// and writes its level, levels and classes. The lanes already span the text.
    fn resolve_paragraph(
        &mut self,
        text: &[u16],
        start: usize,
        end: usize,
        default_level: Option<unicode_bidi::Level>,
    ) {
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
        for (level, resolved) in self.levels[start..end].iter_mut().zip(&info.levels) {
            *level = resolved.number();
        }
        // FSI resolves to LRI or RLI in the original classes (X5c).
        for (class, original) in self.classes[start..end]
            .iter_mut()
            .zip(&info.original_classes)
        {
            *class = class_code(*original);
        }
    }

    /// The one level run of a text whose paragraphs are all plain.
    fn build_plain_run(&mut self) -> Result<(), BidiError> {
        if self.levels.is_empty() {
            return Ok(());
        }
        grow(&mut self.runs)?;
        self.runs.push(BidiRun {
            text_start: 0,
            text_end: u32::try_from(self.levels.len()).map_err(|_| BidiError::ResultTooLarge)?,
            level: 0,
        });
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
            .try_reserve_exact_cold(capacity.saturating_sub(values.len()))
            .map_err(|_| BidiError::ResultTooLarge)?;
    }
    Ok(())
}

/// Room for one more element, growing geometrically.
fn grow<T>(values: &mut Vec<T>) -> Result<(), BidiError> {
    if values.len() == values.capacity() {
        values
            .try_reserve_cold(1)
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

pub const fn class_code(class: BidiClass) -> u8 {
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
            // Every eighth text is long enough to cross several sixteen-unit lanes.
            let length = 1 + (next() % if round % 8 == 7 { 96 } else { 24 }) as usize;
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
    fn class_code_tables_equal_the_trie_and_the_counts() {
        for scalar in (0..=0x10_ffffu32).filter_map(char::from_u32) {
            let code = class_code(Unicode17BidiData.bidi_class(scalar));
            assert_eq!(
                code_point_class(scalar as u32),
                code,
                "U+{:04X}",
                scalar as u32
            );
            if let Some(ascii) = ASCII_CODES.get(scalar as usize) {
                assert_eq!(*ascii, code, "U+{:04X}", scalar as u32);
            }
        }
        for code in 0..=22u8 {
            let mut counts = BidiParagraphCounts::default();
            counts.include(code);
            assert_eq!(
                NEEDS_RESOLUTION >> code & 1 != 0,
                !counts.is_zero(),
                "{code}"
            );
        }
        assert!(
            ASCII_CODES
                .iter()
                .all(|code| NEEDS_RESOLUTION >> code & 1 == 0)
        );
    }

    /// The ASCII lane is sixteen units wide: every interesting unit lands at every offset of a
    /// lane, alone and beside a second one, in texts that end inside and on a lane edge.
    #[test]
    fn plain_classification_equals_the_reference_at_every_lane_offset() {
        const UNITS: &[&[u16]] = &[
            &[0xe9],
            &[0x5b57],
            &[0x301],
            &[0x200d],
            &[0x2028],
            &[0x2029],
            &[0x0a],
            &[0x85],
            &[0x5d0],
            &[0x628],
            &[0x661],
            &[0x202a],
            &[0x202e],
            &[0x2067],
            &[0x2069],
            &[0xd835, 0xdc00],
            &[0xd83a, 0xdd00],
            &[0xd800],
            &[0xdc00],
            &[0xfffd],
        ];
        let filler: Vec<u16> = "The quick (brown) fox, 12.5% + $3 - 4/5: [ok]\t!"
            .encode_utf16()
            .collect();
        for length in [1usize, 15, 16, 17, 31, 32, 33, 48, 50] {
            for first in UNITS {
                for offset in 0..length {
                    for (second, gap) in [(None, 0), (Some(UNITS[1]), 1), (Some(UNITS[8]), 17)] {
                        let mut units: Vec<u16> = (0..length)
                            .map(|index| filler[index % filler.len()])
                            .collect();
                        units.splice(offset..offset, first.iter().copied());
                        if let Some(second) = second {
                            let at = (offset + first.len() + gap).min(units.len());
                            units.splice(at..at, second.iter().copied());
                        }
                        for direction in [DIRECTION_AUTO, DIRECTION_LTR, DIRECTION_RTL] {
                            let mut dense = BidiAnalysis::default();
                            let mut whole = BidiAnalysis::default();
                            analyze_into(&units, direction, &mut dense).unwrap();
                            analyze_whole_into(&units, direction, &mut whole).unwrap();
                            assert_eq!(dense.levels, whole.levels, "{units:x?} {direction}");
                            assert_eq!(dense.classes, whole.classes, "{units:x?} {direction}");
                            assert_eq!(dense.paragraph_levels, whole.paragraph_levels);
                            assert_eq!(dense.paragraph_starts, whole.paragraph_starts);
                            assert_eq!(dense.paragraph_ends, whole.paragraph_ends);
                            assert_eq!(dense.runs, whole.runs, "{units:x?} {direction}");
                        }
                    }
                }
            }
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
