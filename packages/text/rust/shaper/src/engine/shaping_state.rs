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
