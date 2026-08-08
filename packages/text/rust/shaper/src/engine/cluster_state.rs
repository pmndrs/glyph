use alloc::vec::Vec;

use crate::{FontMetrics, unicode::UnicodeAnalysis};

use super::{
    EngineError,
    shaping_state::{ShapeArena, ShapingRun},
    style_state::StyleSegment,
};

pub(crate) const CLUSTER_SAFE_BEFORE: u8 = 1 << 0;
pub(crate) const CLUSTER_REQUIRED_BREAK: u8 = 1 << 1;
pub(crate) const CLUSTER_HARD_BREAK: u8 = 1 << 2;
pub(crate) const CLUSTER_ALLOWED_BREAK: u8 = 1 << 3;

const GLYPH_UNSAFE_TO_BREAK: u16 = 1;
const NO_SOURCE_RUN: u32 = u32::MAX;

#[derive(Default)]
pub(crate) struct ClusterArena {
    pub starts: Vec<u32>,
    pub ends: Vec<u32>,
    pub advances: Vec<f64>,
    pub flags: Vec<u8>,
    pub style_indexes: Vec<u32>,
    pub source_runs: Vec<u32>,
    pub font_handles: Vec<u32>,
    pub stable_ids: Vec<u32>,
    pub index_at: Vec<u32>,
    pub(super) shaped: Vec<u8>,
    pub(super) unsafe_before: Vec<u8>,
}

pub(crate) struct ClusterBuildInput<'a> {
    pub text: &'a [u16],
    pub text_unit_ids: &'a [u32],
    pub unicode: &'a UnicodeAnalysis,
    pub styles: &'a [StyleSegment],
    pub runs: &'a [ShapingRun],
    pub shape: &'a ShapeArena,
}

impl ClusterArena {
    pub(crate) fn reserve(&mut self, capacity: usize) -> Result<(), EngineError> {
        reserve(&mut self.starts, capacity)?;
        reserve(&mut self.ends, capacity)?;
        reserve(&mut self.advances, capacity)?;
        reserve(&mut self.flags, capacity)?;
        reserve(&mut self.style_indexes, capacity)?;
        reserve(&mut self.source_runs, capacity)?;
        reserve(&mut self.font_handles, capacity)?;
        reserve(&mut self.stable_ids, capacity)?;
        reserve(&mut self.index_at, capacity.saturating_add(1))?;
        reserve(&mut self.shaped, capacity)?;
        reserve(&mut self.unsafe_before, capacity)
    }

    pub(crate) fn build(
        &mut self,
        input: ClusterBuildInput<'_>,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        self.clear();
        if text.len() != text_unit_ids.len() || text_unit_ids.contains(&0) {
            return Err(EngineError::InvalidRequest);
        }
        let boundaries = unicode.grapheme_boundaries();
        let count = boundaries.len().saturating_sub(1);
        self.reserve(text.len().max(count))?;
        let mut style_index = 0usize;
        for boundaries in boundaries.windows(2) {
            let start = boundaries[0];
            let end = boundaries[1];
            while styles
                .get(style_index)
                .is_some_and(|style| style.text_end <= start)
            {
                style_index += 1;
            }
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            if style.text_start > start || style.text_end < end {
                return Err(EngineError::InvalidRequest);
            }
            let hard_break = is_hard_break(text, start)?;
            let word_spacing = if text.get(start as usize) == Some(&0x20) {
                style.style.word_spacing
            } else {
                0.0
            };
            self.starts.push(start);
            self.ends.push(end);
            self.advances.push(if hard_break {
                0.0
            } else {
                f64::from(style.style.letter_spacing + word_spacing)
            });
            self.flags
                .push(if hard_break { CLUSTER_HARD_BREAK } else { 0 });
            self.style_indexes
                .push(u32::try_from(style_index).map_err(|_| EngineError::ResultTooLarge)?);
            self.source_runs.push(NO_SOURCE_RUN);
            self.font_handles.push(0);
            self.stable_ids.push(
                *text_unit_ids
                    .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)?,
            );
            self.shaped.push(0);
            self.unsafe_before.push(0);
        }
        self.build_index(text.len())?;
        self.aggregate_shape(runs, shape, metrics_for)?;
        self.apply_break_flags(unicode)?;
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.starts.clear();
        self.ends.clear();
        self.advances.clear();
        self.flags.clear();
        self.style_indexes.clear();
        self.source_runs.clear();
        self.font_handles.clear();
        self.stable_ids.clear();
        self.index_at.clear();
        self.shaped.clear();
        self.unsafe_before.clear();
    }

    fn build_index(&mut self, text_length: usize) -> Result<(), EngineError> {
        let mut cluster = 0usize;
        for offset in 0..=text_length {
            while self
                .starts
                .get(cluster)
                .is_some_and(|start| *start < offset as u32)
            {
                cluster += 1;
            }
            self.index_at
                .push(u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?);
        }
        Ok(())
    }

    fn aggregate_shape(
        &mut self,
        runs: &[ShapingRun],
        shape: &ShapeArena,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<(), EngineError> {
        for shaped_run in &shape.runs {
            let source_index =
                usize::try_from(shaped_run.source_run).map_err(|_| EngineError::InvalidRequest)?;
            let source = runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
            let metrics = metrics_for(shaped_run.font_handle).ok_or(EngineError::InvalidRequest)?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(source.style.font_size) / f64::from(metrics.units_per_em);
            let start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let end = start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in start..end {
                let cluster = *shape
                    .clusters
                    .get(glyph)
                    .ok_or(EngineError::InvalidRequest)?;
                let cluster_index = self.cluster_at(cluster)?;
                let source_slot = &mut self.source_runs[cluster_index];
                let font_slot = &mut self.font_handles[cluster_index];
                if *source_slot == NO_SOURCE_RUN {
                    *source_slot = shaped_run.source_run;
                    *font_slot = shaped_run.font_handle;
                } else if *source_slot != shaped_run.source_run
                    || *font_slot != shaped_run.font_handle
                {
                    return Err(EngineError::InvalidRequest);
                }
                self.shaped[cluster_index] = 1;
                self.unsafe_before[cluster_index] |= u8::from(
                    shape
                        .glyph_flags
                        .get(glyph)
                        .is_some_and(|flags| flags & GLYPH_UNSAFE_TO_BREAK != 0),
                );
                self.advances[cluster_index] += f64::from(
                    shape
                        .x_advances
                        .get(glyph)
                        .copied()
                        .ok_or(EngineError::InvalidRequest)?
                        .unsigned_abs(),
                ) * scale;
            }
        }
        for index in 0..self.starts.len() {
            if self.shaped[index] != 0 && self.unsafe_before[index] == 0 {
                self.flags[index] |= CLUSTER_SAFE_BEFORE;
            }
        }
        Ok(())
    }

    fn apply_break_flags(&mut self, unicode: &UnicodeAnalysis) -> Result<(), EngineError> {
        for line_break in unicode.line_breaks() {
            let end = line_break.position;
            if self.ends.is_empty() && end == 0 {
                continue;
            }
            let preceding = self
                .ends
                .binary_search(&end)
                .map_err(|_| EngineError::InvalidRequest)?;
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
                continue;
            }
            let safe = end == self.ends.last().copied().unwrap_or(0)
                || self
                    .starts
                    .binary_search(&end)
                    .ok()
                    .is_some_and(|next| self.flags[next] & CLUSTER_SAFE_BEFORE != 0);
            if safe {
                self.flags[preceding] |= CLUSTER_ALLOWED_BREAK;
            }
        }
        Ok(())
    }

    fn cluster_at(&self, offset: u32) -> Result<usize, EngineError> {
        let index = *self
            .index_at
            .get(usize::try_from(offset).map_err(|_| EngineError::InvalidRequest)?)
            .ok_or(EngineError::InvalidRequest)?;
        let index = usize::try_from(index).map_err(|_| EngineError::InvalidRequest)?;
        if self.starts.get(index) != Some(&offset) {
            return Err(EngineError::InvalidRequest);
        }
        Ok(index)
    }
}

fn is_hard_break(text: &[u16], start: u32) -> Result<bool, EngineError> {
    let unit = *text
        .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(matches!(
        unit,
        0x0a | 0x0b | 0x0c | 0x0d | 0x85 | 0x2028 | 0x2029
    ))
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), EngineError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::{
        shaping_state::{ShapedRun, ShapingRun},
        style_state::{ResolvedStyle, StyleSegment},
    };
    use alloc::vec;

    #[test]
    fn aggregates_scaled_advances_spacing_and_legal_breaks() {
        let text: Vec<u16> = "a b\n".encode_utf16().collect();
        let mut unicode = UnicodeAnalysis::default();
        unicode.analyze(&text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 2.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 4,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 3,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let mut shape = ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![1, 2, 3],
            clusters: vec![0, 1, 2],
            x_advances: vec![500, 250, 500],
            y_advances: vec![0; 3],
            x_offsets: vec![0; 3],
            y_offsets: vec![0; 3],
            glyph_flags: vec![0; 3],
        };
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
            })
        };
        let mut clusters = ClusterArena::default();
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(clusters.starts, [0, 1, 2, 3]);
        assert_eq!(clusters.ends, [1, 2, 3, 4]);
        assert_eq!(clusters.advances, [9.0, 7.0, 9.0, 0.0]);
        assert_eq!(clusters.style_indexes, [0; 4]);
        assert_eq!(clusters.source_runs, [0, 0, 0, NO_SOURCE_RUN]);
        assert_eq!(clusters.font_handles, [9, 9, 9, 0]);
        assert_eq!(clusters.stable_ids, [1, 2, 3, 4]);
        assert_eq!(clusters.index_at, [0, 1, 2, 3, 4]);
        assert_eq!(clusters.flags[0], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[1],
            CLUSTER_SAFE_BEFORE | CLUSTER_ALLOWED_BREAK
        );
        assert_eq!(clusters.flags[2], CLUSTER_SAFE_BEFORE);
        assert_eq!(
            clusters.flags[3],
            CLUSTER_HARD_BREAK | CLUSTER_REQUIRED_BREAK
        );

        let capacities = (
            clusters.starts.capacity(),
            clusters.advances.capacity(),
            clusters.flags.capacity(),
            clusters.index_at.capacity(),
        );
        shape.glyph_flags[2] = GLYPH_UNSAFE_TO_BREAK;
        clusters
            .build(
                ClusterBuildInput {
                    text: &text,
                    text_unit_ids: &[1, 2, 3, 4],
                    unicode: &unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &shape,
                },
                metrics,
            )
            .unwrap();
        assert_eq!(
            capacities,
            (
                clusters.starts.capacity(),
                clusters.advances.capacity(),
                clusters.flags.capacity(),
                clusters.index_at.capacity(),
            )
        );
        assert_eq!(clusters.flags[1], CLUSTER_SAFE_BEFORE);
        assert_eq!(clusters.flags[2], 0);
    }
}
