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
    pub binding_handle: u32,
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

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct BoundaryShape {
    pub flow_thread_id: u32,
    pub source_run: u32,
    pub cluster_start: u32,
    pub cluster_end: u32,
    pub text_end: u32,
    pub source_binding_handle: u32,
    pub source_font_handle: u32,
    pub ellipsis_binding_handle: u32,
    pub ellipsis_font_handle: u32,
    pub source_glyph_start: u32,
    pub source_glyph_count: u32,
    pub ellipsis_glyph_start: u32,
    pub ellipsis_glyph_count: u32,
}

#[derive(Default)]
pub(crate) struct BoundaryShapeArena {
    pub records: Vec<BoundaryShape>,
    pub shape: ShapeArena,
    pub stable_ids: Vec<u32>,
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
        binding_handle: u32,
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
            binding_handle,
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

    pub(crate) fn append_from(
        &mut self,
        source: &Self,
        run_index: usize,
    ) -> Result<(u32, u32), EngineError> {
        let run = *source
            .runs
            .get(run_index)
            .ok_or(EngineError::InvalidRequest)?;
        let source_start =
            usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let source_end = source_start
            .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let glyph_start =
            u32::try_from(self.glyph_ids.len()).map_err(|_| EngineError::ResultTooLarge)?;
        self.reserve(
            self.glyph_ids
                .len()
                .saturating_add(source_end.saturating_sub(source_start)),
        )?;
        self.runs.push(ShapedRun { glyph_start, ..run });
        self.glyph_ids.extend_from_slice(
            source
                .glyph_ids
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.clusters.extend_from_slice(
            source
                .clusters
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.x_advances.extend_from_slice(
            source
                .x_advances
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.y_advances.extend_from_slice(
            source
                .y_advances
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.x_offsets.extend_from_slice(
            source
                .x_offsets
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.y_offsets.extend_from_slice(
            source
                .y_offsets
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        self.glyph_flags.extend_from_slice(
            source
                .glyph_flags
                .get(source_start..source_end)
                .ok_or(EngineError::InvalidRequest)?,
        );
        Ok((glyph_start, run.glyph_count))
    }

    pub(crate) fn append_text_range_from(
        &mut self,
        source: &Self,
        run_index: usize,
        source_run: u32,
        text_start: u32,
        text_end: u32,
        text_delta: i64,
    ) -> Result<(), EngineError> {
        if text_start > text_end {
            return Err(EngineError::InvalidRequest);
        }
        if text_start == text_end {
            return Ok(());
        }
        let run = *source
            .runs
            .get(run_index)
            .ok_or(EngineError::InvalidRequest)?;
        let run_start =
            usize::try_from(run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
        let run_end = run_start
            .checked_add(usize::try_from(run.glyph_count).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let mut selected_start = None;
        let mut selected_end = 0usize;
        let mut selection_finished = false;
        for glyph in run_start..run_end {
            let cluster = *source
                .clusters
                .get(glyph)
                .ok_or(EngineError::InvalidRequest)?;
            if cluster >= text_start && cluster < text_end {
                if selection_finished {
                    return Err(EngineError::InvalidRequest);
                }
                selected_start.get_or_insert(glyph);
                selected_end = glyph + 1;
            } else if selected_start.is_some() {
                selection_finished = true;
            }
        }
        let (selected_start, selected_end) =
            selected_start.map_or((run_start, run_start), |start| (start, selected_end));
        let glyph_start =
            u32::try_from(self.glyph_ids.len()).map_err(|_| EngineError::ResultTooLarge)?;
        let glyph_count = u32::try_from(selected_end - selected_start)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.reserve(
            self.glyph_ids
                .len()
                .saturating_add(selected_end - selected_start),
        )?;
        self.runs.push(ShapedRun {
            source_run,
            text_start: shifted_offset(text_start, text_delta)?,
            text_end: shifted_offset(text_end, text_delta)?,
            glyph_start,
            glyph_count,
            ..run
        });
        self.glyph_ids
            .extend_from_slice(&source.glyph_ids[selected_start..selected_end]);
        for &cluster in &source.clusters[selected_start..selected_end] {
            self.clusters.push(shifted_offset(cluster, text_delta)?);
        }
        self.x_advances
            .extend_from_slice(&source.x_advances[selected_start..selected_end]);
        self.y_advances
            .extend_from_slice(&source.y_advances[selected_start..selected_end]);
        self.x_offsets
            .extend_from_slice(&source.x_offsets[selected_start..selected_end]);
        self.y_offsets
            .extend_from_slice(&source.y_offsets[selected_start..selected_end]);
        self.glyph_flags
            .extend_from_slice(&source.glyph_flags[selected_start..selected_end]);
        Ok(())
    }
}

fn shifted_offset(value: u32, delta: i64) -> Result<u32, EngineError> {
    let shifted = i64::from(value)
        .checked_add(delta)
        .ok_or(EngineError::ResultTooLarge)?;
    u32::try_from(shifted).map_err(|_| EngineError::ResultTooLarge)
}

impl BoundaryShapeArena {
    pub(crate) fn clear(&mut self) {
        self.records.clear();
        self.shape.clear();
        self.stable_ids.clear();
    }

    pub(crate) fn reserve(&mut self, glyph_capacity: usize) -> Result<(), EngineError> {
        reserve_vec(&mut self.records, glyph_capacity.min(16))?;
        self.shape.reserve(glyph_capacity)?;
        reserve_vec(&mut self.stable_ids, glyph_capacity)
    }

    pub(crate) fn record(&self, index: u32) -> Option<BoundaryShape> {
        usize::try_from(index)
            .ok()
            .and_then(|index| self.records.get(index))
            .copied()
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

    #[test]
    fn copies_and_rebases_one_contiguous_text_range_in_shaping_order() {
        let source = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 7,
                binding_handle: 11,
                font_handle: 13,
                text_start: 0,
                text_end: 4,
                glyph_start: 0,
                glyph_count: 4,
            }],
            glyph_ids: vec![30, 20, 10, 0],
            clusters: vec![3, 2, 1, 0],
            x_advances: vec![3, 2, 1, 0],
            y_advances: vec![0; 4],
            x_offsets: vec![0; 4],
            y_offsets: vec![0; 4],
            glyph_flags: vec![0, 2, 0, 0],
        };
        let mut destination = ShapeArena::default();
        destination
            .append_text_range_from(&source, 0, 5, 1, 3, 2)
            .unwrap();
        assert_eq!(destination.glyph_ids, [20, 10]);
        assert_eq!(destination.clusters, [4, 3]);
        assert_eq!(destination.x_advances, [2, 1]);
        assert_eq!(destination.glyph_flags, [2, 0]);
        assert_eq!(
            destination.runs,
            [ShapedRun {
                source_run: 5,
                binding_handle: 11,
                font_handle: 13,
                text_start: 3,
                text_end: 5,
                glyph_start: 0,
                glyph_count: 2,
            }]
        );
    }
}
