use alloc::vec::Vec;

use crate::{
    bidi::BidiAnalysis,
    unicode::{COMMON_SCRIPT, UnicodeAnalysis},
};

use super::{
    EngineError,
    style_state::{ResolvedStyle, StyleSegment},
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ShapingRun {
    pub text_start: u32,
    pub text_end: u32,
    pub script: u32,
    pub direction: u8,
    pub bidi_level: u8,
    pub style: ResolvedStyle,
}

#[derive(Default)]
pub(crate) struct ShapingRunArena {
    runs: Vec<ShapingRun>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShapedRun {
    pub source_run: u32,
    pub font_handle: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub glyph_start: u32,
    pub glyph_count: u32,
}

#[derive(Default)]
pub(crate) struct ShapeArena {
    pub runs: Vec<ShapedRun>,
    pub glyph_ids: Vec<u16>,
    pub clusters: Vec<u32>,
    pub x_advances: Vec<i32>,
    pub y_advances: Vec<i32>,
    pub x_offsets: Vec<i32>,
    pub y_offsets: Vec<i32>,
    pub glyph_flags: Vec<u16>,
}

impl ShapingRunArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        if self.runs.capacity() < capacity {
            self.runs
                .try_reserve_exact(capacity.saturating_sub(self.runs.len()))
                .map_err(|_| EngineError::ResultTooLarge)?;
        }
        Ok(())
    }

    pub(crate) fn build(
        &mut self,
        text: &[u16],
        styles: &[StyleSegment],
        unicode: &UnicodeAnalysis,
        bidi: &BidiAnalysis,
    ) -> Result<(), EngineError> {
        self.runs.clear();
        if styles.is_empty() {
            return Ok(());
        }
        if text.is_empty() {
            if let Some(segment) = styles.first() {
                let level = bidi
                    .levels
                    .first()
                    .or_else(|| bidi.paragraph_levels.first())
                    .copied()
                    .unwrap_or(0);
                self.push(ShapingRun {
                    text_start: segment.text_start,
                    text_end: segment.text_start,
                    script: COMMON_SCRIPT,
                    direction: direction(segment.style, level),
                    bidi_level: forced_level(segment.style, level),
                    style: segment.style,
                })?;
            }
            return Ok(());
        }
        let scripts = unicode.script_items();
        let mut style_index = 0usize;
        let mut script_index = 0usize;
        let mut bidi_index = 0usize;
        while style_index < styles.len()
            && script_index < scripts.len()
            && bidi_index < bidi.runs.len()
        {
            let style = styles[style_index];
            let script = scripts[script_index];
            let bidi_run = bidi.runs[bidi_index];
            let start = style
                .text_start
                .max(script.text_start)
                .max(bidi_run.text_start);
            let end = style.text_end.min(script.text_end).min(bidi_run.text_end);
            if start < end {
                self.push_drawable_fragments(
                    text,
                    start,
                    end,
                    ShapingRun {
                        text_start: start,
                        text_end: end,
                        script: script.script,
                        direction: direction(style.style, bidi_run.level),
                        bidi_level: forced_level(style.style, bidi_run.level),
                        style: style.style,
                    },
                )?;
            }
            let boundary = style.text_end.min(script.text_end).min(bidi_run.text_end);
            if boundary <= start {
                return Err(EngineError::InvalidRequest);
            }
            if style.text_end == boundary {
                style_index += 1;
            }
            if script.text_end == boundary {
                script_index += 1;
            }
            if bidi_run.text_end == boundary {
                bidi_index += 1;
            }
        }
        if style_index != styles.len()
            || script_index != scripts.len()
            || bidi_index != bidi.runs.len()
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(())
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub(crate) fn runs(&self) -> &[ShapingRun] {
        &self.runs
    }

    pub(crate) fn clear(&mut self) {
        self.runs.clear();
    }

    fn push_drawable_fragments(
        &mut self,
        text: &[u16],
        start: u32,
        end: u32,
        template: ShapingRun,
    ) -> Result<(), EngineError> {
        let mut fragment_start = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
        let mut offset = fragment_start;
        let end = usize::try_from(end).map_err(|_| EngineError::InvalidRequest)?;
        while offset < end {
            let unit = *text.get(offset).ok_or(EngineError::InvalidRequest)?;
            let hard_break = matches!(unit, 0x0a | 0x0b | 0x0c | 0x0d | 0x85 | 0x2028 | 0x2029);
            if hard_break {
                if fragment_start < offset {
                    self.push(ShapingRun {
                        text_start: u32::try_from(fragment_start)
                            .map_err(|_| EngineError::ResultTooLarge)?,
                        text_end: u32::try_from(offset).map_err(|_| EngineError::ResultTooLarge)?,
                        ..template
                    })?;
                }
                offset += 1;
                fragment_start = offset;
            } else {
                offset += if (0xd800..=0xdbff).contains(&unit) {
                    2
                } else {
                    1
                };
            }
        }
        if fragment_start < end {
            self.push(ShapingRun {
                text_start: u32::try_from(fragment_start)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                text_end: u32::try_from(end).map_err(|_| EngineError::ResultTooLarge)?,
                ..template
            })?;
        }
        Ok(())
    }

    fn push(&mut self, run: ShapingRun) -> Result<(), EngineError> {
        if let Some(previous) = self.runs.last_mut()
            && previous.text_end == run.text_start
            && previous.script == run.script
            && previous.direction == run.direction
            && previous.bidi_level == run.bidi_level
            && previous.style == run.style
        {
            previous.text_end = run.text_end;
            return Ok(());
        }
        self.runs
            .try_reserve(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.runs.push(run);
        Ok(())
    }
}

impl ShapeArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve_vec(&mut self.runs, capacity)?;
        reserve_vec(&mut self.glyph_ids, capacity)?;
        reserve_vec(&mut self.clusters, capacity)?;
        reserve_vec(&mut self.x_advances, capacity)?;
        reserve_vec(&mut self.y_advances, capacity)?;
        reserve_vec(&mut self.x_offsets, capacity)?;
        reserve_vec(&mut self.y_offsets, capacity)?;
        reserve_vec(&mut self.glyph_flags, capacity)
    }

    pub(crate) fn clear(&mut self) {
        self.runs.clear();
        self.glyph_ids.clear();
        self.clusters.clear();
        self.x_advances.clear();
        self.y_advances.clear();
        self.x_offsets.clear();
        self.y_offsets.clear();
        self.glyph_flags.clear();
    }

    pub(crate) fn append(
        &mut self,
        source_run: usize,
        font_handle: u32,
        text_start: u32,
        text_end: u32,
        shaped: &harfrust::GlyphBuffer,
    ) -> Result<(), u32> {
        let glyph_start =
            u32::try_from(self.glyph_ids.len()).map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?;
        let glyph_count =
            u32::try_from(shaped.len()).map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?;
        self.reserve(self.glyph_ids.len().saturating_add(shaped.len()))
            .map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?;
        self.runs.push(ShapedRun {
            source_run: u32::try_from(source_run).map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?,
            font_handle,
            text_start,
            text_end,
            glyph_start,
            glyph_count,
        });
        for (info, position) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
            self.glyph_ids
                .push(u16::try_from(info.glyph_id).map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?);
            self.clusters.push(info.cluster);
            self.x_advances.push(position.x_advance);
            self.y_advances.push(position.y_advance);
            self.x_offsets.push(position.x_offset);
            self.y_offsets.push(position.y_offset);
            self.glyph_flags.push(
                u16::try_from(info.flags().to_bits())
                    .map_err(|_| crate::STATUS_RESULT_TOO_LARGE)?,
            );
        }
        Ok(())
    }
}

fn reserve_vec<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), EngineError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

fn direction(style: ResolvedStyle, level: u8) -> u8 {
    if style.bidi_override {
        u8::from(style.direction == 2)
    } else {
        level & 1
    }
}

fn forced_level(style: ResolvedStyle, level: u8) -> u8 {
    let direction = direction(style, level);
    if level & 1 == direction {
        level
    } else {
        level.saturating_add(1)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        bidi::{DIRECTION_LTR, analyze},
        unicode::UnicodeAnalysis,
    };

    #[test]
    fn intersects_style_script_and_bidi_and_skips_hard_breaks() {
        let text: Vec<u16> = "abc\nאבג".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let bidi = analyze(&text, DIRECTION_LTR).unwrap();
        let base = ResolvedStyle::default();
        let mut override_style = base;
        override_style.direction = 1;
        override_style.bidi_override = true;
        let styles = [
            StyleSegment {
                text_start: 0,
                text_end: 4,
                style: base,
            },
            StyleSegment {
                text_start: 4,
                text_end: text.len() as u32,
                style: override_style,
            },
        ];
        let mut runs = ShapingRunArena::default();
        runs.reserve(16).unwrap();
        runs.build(&text, &styles, &unicode, &bidi).unwrap();
        assert_eq!(
            runs.runs()
                .iter()
                .map(|run| (run.text_start, run.text_end, run.direction, run.bidi_level))
                .collect::<Vec<_>>(),
            vec![(0, 3, 0, 0), (4, 7, 0, 2)]
        );
    }
}
