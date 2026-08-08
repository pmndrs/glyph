use alloc::{string::String, vec::Vec};
use unicode_segmentation::UnicodeSegmentation;

use crate::line_break::{LineBreak, LineBreakAnalysis};

mod generated {
    include!("generated/script_data.rs");
}

pub use generated::UNICODE_VERSION;

pub const COMMON_SCRIPT: u32 = generated::COMMON_SCRIPT;
pub const INHERITED_SCRIPT: u32 = generated::INHERITED_SCRIPT;
pub const UNKNOWN_SCRIPT: u32 = generated::UNKNOWN_SCRIPT;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnicodeError {
    InvalidUtf16,
    ResultTooLarge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScriptItem {
    pub text_start: u32,
    pub text_end: u32,
    pub script: u32,
}

#[derive(Default)]
pub struct UnicodeAnalysis {
    utf8: String,
    line_breaks: LineBreakAnalysis,
    grapheme_boundaries: Vec<u32>,
    grapheme_scripts: Vec<u32>,
    candidate_offsets: Vec<u32>,
    candidate_tags: Vec<u32>,
    candidate_scratch: Vec<u32>,
    script_items: Vec<ScriptItem>,
}

impl UnicodeAnalysis {
    pub fn reserve(&mut self, utf16_capacity: usize) -> Result<(), UnicodeError> {
        reserve(
            &mut self.grapheme_boundaries,
            utf16_capacity.saturating_add(1),
        )?;
        reserve(&mut self.grapheme_scripts, utf16_capacity)?;
        reserve(
            &mut self.candidate_offsets,
            utf16_capacity.saturating_add(1),
        )?;
        reserve(&mut self.candidate_tags, utf16_capacity)?;
        reserve(&mut self.script_items, utf16_capacity)?;
        self.line_breaks.reserve(utf16_capacity)?;
        self.utf8
            .try_reserve(utf16_capacity.saturating_mul(3))
            .map_err(|_| UnicodeError::ResultTooLarge)
    }

    pub fn analyze(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.clear();
        self.reserve(text.len())?;
        encode_utf16(text, &mut self.utf8)?;
        self.line_breaks.analyze(text)?;
        self.segment_graphemes()?;
        self.resolve_grapheme_scripts(text)?;
        self.resolve_neutral_scripts();
        self.itemize_scripts()?;
        Ok(())
    }

    pub fn grapheme_boundaries(&self) -> &[u32] {
        &self.grapheme_boundaries
    }

    pub fn script_items(&self) -> &[ScriptItem] {
        &self.script_items
    }

    pub fn line_breaks(&self) -> &[LineBreak] {
        self.line_breaks.breaks()
    }

    fn clear(&mut self) {
        self.utf8.clear();
        self.grapheme_boundaries.clear();
        self.grapheme_scripts.clear();
        self.candidate_offsets.clear();
        self.candidate_tags.clear();
        self.candidate_scratch.clear();
        self.script_items.clear();
    }

    fn segment_graphemes(&mut self) -> Result<(), UnicodeError> {
        self.grapheme_boundaries.push(0);
        let mut utf16_end = 0usize;
        for grapheme in self.utf8.graphemes(true) {
            utf16_end = utf16_end
                .checked_add(grapheme.chars().map(char::len_utf16).sum::<usize>())
                .ok_or(UnicodeError::ResultTooLarge)?;
            self.grapheme_boundaries
                .push(u32::try_from(utf16_end).map_err(|_| UnicodeError::ResultTooLarge)?);
        }
        Ok(())
    }

    fn resolve_grapheme_scripts(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.candidate_offsets.push(0);
        for boundary in self.grapheme_boundaries.windows(2) {
            let start = usize::try_from(boundary[0]).map_err(|_| UnicodeError::ResultTooLarge)?;
            let end = usize::try_from(boundary[1]).map_err(|_| UnicodeError::ResultTooLarge)?;
            let mut preferred = COMMON_SCRIPT;
            let mut intersected = false;
            self.candidate_scratch.clear();
            let mut index = start;
            while index < end {
                let (character, consumed) = decode_scalar(text, index)?;
                index += consumed;
                let primary = script(character as u32).ok_or(UnicodeError::InvalidUtf16)?;
                if !is_neutral_script(primary) && preferred == COMMON_SCRIPT {
                    preferred = primary;
                }
                let extensions =
                    script_extensions(character as u32).ok_or(UnicodeError::InvalidUtf16)?;
                if !extensions
                    .iter()
                    .copied()
                    .any(|tag| !is_neutral_script(tag))
                {
                    continue;
                }
                if !intersected {
                    intersected = true;
                    self.candidate_scratch.extend(
                        extensions
                            .iter()
                            .copied()
                            .filter(|tag| !is_neutral_script(*tag)),
                    );
                } else {
                    self.candidate_scratch
                        .retain(|tag| extensions.contains(tag));
                }
            }
            self.grapheme_scripts.push(preferred);
            if intersected
                && !self.candidate_scratch.is_empty()
                && !self.candidate_scratch.contains(&preferred)
            {
                self.candidate_tags
                    .extend_from_slice(&self.candidate_scratch);
            }
            self.candidate_offsets.push(
                u32::try_from(self.candidate_tags.len())
                    .map_err(|_| UnicodeError::ResultTooLarge)?,
            );
        }
        Ok(())
    }

    fn resolve_neutral_scripts(&mut self) {
        let mut previous = COMMON_SCRIPT;
        for index in 0..self.grapheme_scripts.len() {
            let current = self.grapheme_scripts[index];
            if is_neutral_script(current) {
                if self.accepts_context(index, previous) {
                    self.grapheme_scripts[index] = previous;
                }
            } else {
                previous = current;
            }
        }
        let mut next = COMMON_SCRIPT;
        for index in (0..self.grapheme_scripts.len()).rev() {
            let current = self.grapheme_scripts[index];
            if is_neutral_script(current) {
                if self.accepts_context(index, next) {
                    self.grapheme_scripts[index] = next;
                }
            } else {
                next = current;
            }
        }
    }

    fn accepts_context(&self, index: usize, context: u32) -> bool {
        if is_neutral_script(context) {
            return false;
        }
        let start = self.candidate_offsets[index] as usize;
        let end = self.candidate_offsets[index + 1] as usize;
        start == end || self.candidate_tags[start..end].contains(&context)
    }

    fn itemize_scripts(&mut self) -> Result<(), UnicodeError> {
        for (index, boundaries) in self.grapheme_boundaries.windows(2).enumerate() {
            let item = ScriptItem {
                text_start: boundaries[0],
                text_end: boundaries[1],
                script: self.grapheme_scripts[index],
            };
            if let Some(previous) = self.script_items.last_mut()
                && previous.text_end == item.text_start
                && previous.script == item.script
            {
                previous.text_end = item.text_end;
            } else {
                self.script_items.push(item);
            }
        }
        if self.grapheme_scripts.len() + 1 != self.grapheme_boundaries.len() {
            return Err(UnicodeError::InvalidUtf16);
        }
        Ok(())
    }
}

pub fn script(code_point: u32) -> Option<u32> {
    lookup_partition(generated::SCRIPT_END_VALUES, code_point)
}

pub fn script_extensions(code_point: u32) -> Option<&'static [u32]> {
    let set = usize::try_from(lookup_partition(
        generated::SCRIPT_EXTENSION_END_VALUES,
        code_point,
    )?)
    .ok()?;
    let start = usize::try_from(*generated::SCRIPT_EXTENSION_OFFSETS.get(set)?).ok()?;
    let end = usize::try_from(*generated::SCRIPT_EXTENSION_OFFSETS.get(set + 1)?).ok()?;
    generated::SCRIPT_EXTENSION_TAGS.get(start..end)
}

fn lookup_partition(end_values: &[u32], code_point: u32) -> Option<u32> {
    if code_point > 0x10_ffff {
        return None;
    }
    let mut low = 0;
    let mut high = end_values.len() / 2;
    while low < high {
        let middle = low + (high - low) / 2;
        let offset = middle * 2;
        let end = end_values[offset];
        if code_point >= end {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    end_values.get(low.checked_mul(2)?.checked_add(1)?).copied()
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), UnicodeError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
    }
    Ok(())
}

fn encode_utf16(text: &[u16], output: &mut String) -> Result<(), UnicodeError> {
    let mut index = 0;
    while index < text.len() {
        let (character, consumed) = decode_scalar(text, index)?;
        output.push(character);
        index += consumed;
    }
    Ok(())
}

fn decode_scalar(text: &[u16], index: usize) -> Result<(char, usize), UnicodeError> {
    let first = text[index];
    if (0xd800..=0xdbff).contains(&first) {
        let second = text
            .get(index + 1)
            .copied()
            .filter(|unit| (0xdc00..=0xdfff).contains(unit))
            .ok_or(UnicodeError::InvalidUtf16)?;
        let scalar =
            0x1_0000 + (((u32::from(first) - 0xd800) << 10) | (u32::from(second) - 0xdc00));
        return char::from_u32(scalar)
            .map(|character| (character, 2))
            .ok_or(UnicodeError::InvalidUtf16);
    }
    if (0xdc00..=0xdfff).contains(&first) {
        return Err(UnicodeError::InvalidUtf16);
    }
    char::from_u32(u32::from(first))
        .map(|character| (character, 1))
        .ok_or(UnicodeError::InvalidUtf16)
}

fn is_neutral_script(script: u32) -> bool {
    matches!(script, COMMON_SCRIPT | INHERITED_SCRIPT | UNKNOWN_SCRIPT)
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn tag(value: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*value)
    }

    #[test]
    fn generated_tables_are_unicode_17_scalar_partitions() {
        assert_eq!(UNICODE_VERSION, "17.0.0");
        assert_eq!(script('A' as u32), Some(tag(b"Latn")));
        assert_eq!(script('\u{4e00}' as u32), Some(tag(b"Hani")));
        assert_eq!(script(0x10_ffff), Some(UNKNOWN_SCRIPT));
        assert_eq!(script(0x11_0000), None);
    }

    #[test]
    fn script_extensions_preserve_shared_marks() {
        let prolonged_sound_mark = script_extensions('\u{30fc}' as u32).expect("extensions");
        assert!(prolonged_sound_mark.contains(&tag(b"Hira")));
        assert!(prolonged_sound_mark.contains(&tag(b"Kana")));
    }

    #[test]
    fn analysis_segments_emoji_and_resolves_neutral_scripts() {
        let text: Vec<u16> = "Latin, हिन्दी 👩‍🚀 カー".encode_utf16().collect();
        let mut analysis = UnicodeAnalysis::default();
        analysis.reserve(64).unwrap();
        analysis.analyze(&text).unwrap();
        assert_eq!(analysis.grapheme_boundaries().first(), Some(&0));
        assert_eq!(
            analysis.grapheme_boundaries().last(),
            Some(&(text.len() as u32))
        );
        assert!(
            analysis
                .grapheme_boundaries()
                .windows(2)
                .any(|range| range[1] - range[0] == 5)
        );
        assert!(
            analysis
                .script_items()
                .iter()
                .any(|item| item.script == tag(b"Deva"))
        );
        assert!(
            analysis
                .script_items()
                .iter()
                .any(|item| item.script == tag(b"Kana"))
        );
    }

    #[test]
    fn analysis_reuses_reserved_storage_and_rejects_unpaired_surrogates() {
        let mut analysis = UnicodeAnalysis::default();
        analysis.reserve(64).unwrap();
        analysis
            .analyze(&"abc".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        let boundary_capacity = analysis.grapheme_boundaries.capacity();
        analysis
            .analyze(&"def".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert_eq!(analysis.grapheme_boundaries.capacity(), boundary_capacity);
        assert_eq!(analysis.analyze(&[0xd800]), Err(UnicodeError::InvalidUtf16));
    }
}
