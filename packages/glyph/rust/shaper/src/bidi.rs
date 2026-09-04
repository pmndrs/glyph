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

pub fn analyze_into(
    text: &[u16],
    direction: u8,
    output: &mut BidiAnalysis,
) -> Result<(), BidiError> {
    let default_level = match direction {
        DIRECTION_AUTO => None,
        DIRECTION_LTR => Some(LTR_LEVEL),
        DIRECTION_RTL => Some(RTL_LEVEL),
        _ => return Err(BidiError::InvalidDirection),
    };
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
    let mut start = 0usize;
    while start < output.levels.len() {
        let level = output.levels[start];
        // Level runs end at the next transition; the D-245 transition-mask
        // kernel scans sixteen levels per step on simd128 builds.
        let end = crate::engine::line_kernels::next_transition(&output.levels, start);
        output.runs.push(BidiRun {
            text_start: u32::try_from(start).map_err(|_| BidiError::ResultTooLarge)?,
            text_end: u32::try_from(end).map_err(|_| BidiError::ResultTooLarge)?,
            level,
        });
        start = end;
    }
    Ok(())
}

impl BidiAnalysis {
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
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), BidiError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| BidiError::ResultTooLarge)?;
    }
    Ok(())
}

pub struct Unicode17BidiData;

impl BidiDataSource for Unicode17BidiData {
    fn bidi_class(&self, character: char) -> BidiClass {
        // Deliberate: bigger raw, smaller gzip, faster per call. Do not "optimize" this back
        // to a range table to save raw bytes.
        // Two-stage trie, the shape ICU calls UTrie2: stage 1 maps the code point's high bits to a
        // deduplicated block, and the low bits index inside it. Two reads and no search, against a
        // binary probe per call before — this runs once per character on every bidi analysis.
        // `char` is a scalar value, so both indices are in range by construction.
        const SHIFT: usize = generated::BIDI_CLASS_BLOCK_SHIFT;
        let code_point = character as usize;
        let block = usize::from(generated::BIDI_CLASS_STAGE1[code_point >> SHIFT]);
        let slot = (block << SHIFT) | (code_point & ((1 << SHIFT) - 1));
        generated::BIDI_CLASS_VALUES[usize::from(generated::BIDI_CLASS_STAGE2[slot])]
    }

    fn bidi_matched_opening_bracket(&self, character: char) -> Option<BidiMatchedOpeningBracket> {
        let code_point = character as u32;
        generated::BIDI_BRACKETS
            .binary_search_by_key(&code_point, |entry| entry.0)
            .ok()
            .and_then(|index| {
                let (_, opening, is_open) = generated::BIDI_BRACKETS[index];
                Some(BidiMatchedOpeningBracket {
                    opening: char::from_u32(opening)?,
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
