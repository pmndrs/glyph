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

pub struct BidiAnalysis {
    pub levels: Vec<u8>,
    pub classes: Vec<u8>,
    pub paragraph_starts: Vec<u32>,
    pub paragraph_ends: Vec<u32>,
    pub paragraph_levels: Vec<u8>,
}

pub fn analyze(text: &[u16], direction: u8) -> Result<BidiAnalysis, ()> {
    let default_level = match direction {
        DIRECTION_AUTO => None,
        DIRECTION_LTR => Some(LTR_LEVEL),
        DIRECTION_RTL => Some(RTL_LEVEL),
        _ => return Err(()),
    };
    let info = BidiInfo::new_with_data_source(&Unicode17BidiData, text, default_level);
    let mut paragraph_starts = Vec::with_capacity(info.paragraphs.len().max(1));
    let mut paragraph_ends = Vec::with_capacity(info.paragraphs.len().max(1));
    let mut paragraph_levels = Vec::with_capacity(info.paragraphs.len().max(1));
    if info.paragraphs.is_empty() {
        paragraph_starts.push(0);
        paragraph_ends.push(0);
        paragraph_levels.push(default_level.unwrap_or(LTR_LEVEL).number());
    } else {
        for paragraph in &info.paragraphs {
            paragraph_starts.push(u32::try_from(paragraph.range.start).map_err(|_| ())?);
            paragraph_ends.push(u32::try_from(paragraph.range.end).map_err(|_| ())?);
            paragraph_levels.push(paragraph.level.number());
        }
    }
    Ok(BidiAnalysis {
        levels: info.levels.iter().map(|level| level.number()).collect(),
        classes: info
            .original_classes
            .iter()
            .copied()
            .map(class_code)
            .collect(),
        paragraph_starts,
        paragraph_ends,
        paragraph_levels,
    })
}

pub struct Unicode17BidiData;

impl BidiDataSource for Unicode17BidiData {
    fn bidi_class(&self, character: char) -> BidiClass {
        let code_point = character as u32;
        let mut low = 0usize;
        let mut high = generated::BIDI_CLASS_RANGES.len();
        while low < high {
            let middle = low + (high - low) / 2;
            let (start, end, class) = generated::BIDI_CLASS_RANGES[middle];
            if code_point < start {
                high = middle;
            } else if code_point >= end {
                low = middle + 1;
            } else {
                return class;
            }
        }
        BidiClass::L
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
}
