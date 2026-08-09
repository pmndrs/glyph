use alloc::vec::Vec;

use crate::{FontMetrics, unicode::UnicodeAnalysis};

use super::{
    EngineError,
    identity_index::{IdentityIndex, IdentityIndexError},
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
    pub binding_handles: Vec<u32>,
    pub font_handles: Vec<u32>,
    pub stable_ids: Vec<u32>,
    pub glyph_starts: Vec<u32>,
    pub glyph_counts: Vec<u32>,
    pub glyph_indices: Vec<u32>,
    pub glyph_stable_ids: Vec<u32>,
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
        reserve(&mut self.binding_handles, capacity)?;
        reserve(&mut self.font_handles, capacity)?;
        reserve(&mut self.stable_ids, capacity)?;
        reserve(&mut self.glyph_starts, capacity)?;
        reserve(&mut self.glyph_counts, capacity)?;
        reserve(&mut self.glyph_indices, capacity.saturating_mul(2))?;
        reserve(&mut self.glyph_stable_ids, capacity.saturating_mul(2))?;
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
            self.binding_handles.push(0);
            self.font_handles.push(0);
            self.stable_ids.push(
                *text_unit_ids
                    .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                    .ok_or(EngineError::InvalidRequest)?,
            );
            self.glyph_starts.push(0);
            self.glyph_counts.push(0);
            self.shaped.push(0);
            self.unsafe_before.push(0);
        }
        self.build_index(text.len())?;
        self.aggregate_shape(runs, shape, metrics_for)?;
        self.apply_break_flags(unicode)?;
        Ok(())
    }

    pub(crate) fn rebuild_source_run_if_topology_is_stable(
        &mut self,
        previous: &Self,
        input: ClusterBuildInput<'_>,
        source_run: u32,
        metrics_for: impl Fn(u32) -> Option<FontMetrics>,
    ) -> Result<Option<(usize, usize)>, EngineError> {
        let ClusterBuildInput {
            text,
            text_unit_ids,
            unicode,
            styles,
            runs,
            shape,
        } = input;
        let boundaries = unicode.grapheme_boundaries();
        if text.len() != text_unit_ids.len()
            || text_unit_ids.contains(&0)
            || previous.index_at.len() != text.len().saturating_add(1)
            || boundaries.len().saturating_sub(1) != previous.starts.len()
            || boundaries
                .windows(2)
                .zip(&previous.starts)
                .any(|(pair, start)| pair[0] != *start)
            || boundaries
                .windows(2)
                .zip(&previous.ends)
                .any(|(pair, end)| pair[1] != *end)
            || shape.glyph_ids.len() != previous.glyph_indices.len()
            || [
                shape.clusters.len(),
                shape.x_advances.len(),
                shape.y_advances.len(),
                shape.x_offsets.len(),
                shape.y_offsets.len(),
                shape.glyph_flags.len(),
            ]
            .iter()
            .any(|length| *length != shape.glyph_ids.len())
        {
            return Ok(None);
        }
        let source_index = usize::try_from(source_run).map_err(|_| EngineError::InvalidRequest)?;
        let source = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
        let cluster_start = previous
            .starts
            .binary_search(&source.text_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let cluster_end = previous
            .ends
            .binary_search(&source.text_end)
            .map(|index| index + 1)
            .map_err(|_| EngineError::InvalidRequest)?;
        if cluster_start >= cluster_end
            || shape.runs.iter().any(|run| {
                let start = usize::try_from(run.glyph_start).ok();
                let end = start.and_then(|start| {
                    usize::try_from(run.glyph_count)
                        .ok()
                        .and_then(|count| start.checked_add(count))
                });
                start.is_none()
                    || end.is_none()
                    || end.is_some_and(|end| end > shape.glyph_ids.len())
            })
        {
            return Ok(None);
        }
        self.copy_from(previous)?;
        for cluster in cluster_start..cluster_end {
            let start = self.starts[cluster];
            let end = self.ends[cluster];
            let style_index = usize::try_from(self.style_indexes[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let style = styles.get(style_index).ok_or(EngineError::InvalidRequest)?;
            if style.text_start > start || style.text_end < end {
                self.clear();
                return Ok(None);
            }
            let hard_break = is_hard_break(text, start)?;
            let word_spacing = if text.get(start as usize) == Some(&0x20) {
                style.style.word_spacing
            } else {
                0.0
            };
            self.advances[cluster] = if hard_break {
                0.0
            } else {
                f64::from(style.style.letter_spacing + word_spacing)
            };
            self.flags[cluster] = if hard_break { CLUSTER_HARD_BREAK } else { 0 };
            self.source_runs[cluster] = NO_SOURCE_RUN;
            self.binding_handles[cluster] = 0;
            self.font_handles[cluster] = 0;
            self.stable_ids[cluster] = *text_unit_ids
                .get(usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            self.glyph_counts[cluster] = 0;
            self.shaped[cluster] = 0;
            self.unsafe_before[cluster] = 0;
        }
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let metrics = metrics_for(shaped_run.font_handle).ok_or(EngineError::InvalidRequest)?;
            if metrics.units_per_em == 0 {
                return Err(EngineError::InvalidRequest);
            }
            let scale = f64::from(source.style.font_size) / f64::from(metrics.units_per_em);
            let glyph_start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in glyph_start..glyph_end {
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                if cluster < cluster_start || cluster >= cluster_end {
                    return Err(EngineError::InvalidRequest);
                }
                if self.source_runs[cluster] == NO_SOURCE_RUN {
                    self.source_runs[cluster] = source_run;
                    self.binding_handles[cluster] = shaped_run.binding_handle;
                    self.font_handles[cluster] = shaped_run.font_handle;
                } else if self.source_runs[cluster] != source_run
                    || self.binding_handles[cluster] != shaped_run.binding_handle
                    || self.font_handles[cluster] != shaped_run.font_handle
                {
                    return Err(EngineError::InvalidRequest);
                }
                self.shaped[cluster] = 1;
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
                self.unsafe_before[cluster] |=
                    u8::from(shape.glyph_flags[glyph] & GLYPH_UNSAFE_TO_BREAK != 0);
                self.advances[cluster] += f64::from(shape.x_advances[glyph].unsigned_abs()) * scale;
            }
        }
        let adjacency_start = usize::try_from(previous.glyph_starts[cluster_start])
            .map_err(|_| EngineError::InvalidRequest)?;
        let adjacency_end = usize::try_from(previous.glyph_starts[cluster_end - 1])
            .ok()
            .and_then(|start| {
                usize::try_from(previous.glyph_counts[cluster_end - 1])
                    .ok()
                    .and_then(|count| start.checked_add(count))
            })
            .ok_or(EngineError::InvalidRequest)?;
        let mut cursor = adjacency_start;
        for cluster in cluster_start..cluster_end {
            self.glyph_starts[cluster] =
                u32::try_from(cursor).map_err(|_| EngineError::ResultTooLarge)?;
            cursor = cursor
                .checked_add(
                    usize::try_from(self.glyph_counts[cluster])
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::ResultTooLarge)?;
            self.glyph_counts[cluster] = 0;
        }
        if cursor != adjacency_end {
            self.clear();
            return Ok(None);
        }
        for shaped_run in shape.runs.iter().filter(|run| run.source_run == source_run) {
            let glyph_start =
                usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
            let glyph_end = glyph_start
                .checked_add(
                    usize::try_from(shaped_run.glyph_count)
                        .map_err(|_| EngineError::InvalidRequest)?,
                )
                .ok_or(EngineError::InvalidRequest)?;
            for glyph in glyph_start..glyph_end {
                let cluster = self.cluster_at(shape.clusters[glyph])?;
                let ordinal = usize::try_from(self.glyph_counts[cluster])
                    .map_err(|_| EngineError::InvalidRequest)?;
                let destination = usize::try_from(self.glyph_starts[cluster])
                    .ok()
                    .and_then(|start| start.checked_add(ordinal))
                    .ok_or(EngineError::ResultTooLarge)?;
                self.glyph_indices[destination] =
                    u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?;
                self.glyph_counts[cluster] = self.glyph_counts[cluster]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
            }
        }
        for cluster in cluster_start..cluster_end {
            if self.shaped[cluster] != 0 && self.unsafe_before[cluster] == 0 {
                self.flags[cluster] |= CLUSTER_SAFE_BEFORE;
            }
        }
        if cluster_start > 0 {
            self.flags[cluster_start - 1] &= !CLUSTER_ALLOWED_BREAK;
        }
        for line_break in unicode.line_breaks() {
            let Ok(preceding) = self.ends.binary_search(&line_break.position) else {
                continue;
            };
            if preceding < cluster_start.saturating_sub(1) || preceding >= cluster_end {
                continue;
            }
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
            } else {
                let safe = line_break.position == self.ends.last().copied().unwrap_or(0)
                    || self
                        .starts
                        .binary_search(&line_break.position)
                        .ok()
                        .is_some_and(|next| self.flags[next] & CLUSTER_SAFE_BEFORE != 0);
                if safe {
                    self.flags[preceding] |= CLUSTER_ALLOWED_BREAK;
                }
            }
        }
        Ok(Some((cluster_start, cluster_end)))
    }

    fn copy_from(&mut self, source: &Self) -> Result<(), EngineError> {
        self.clear();
        self.reserve(source.starts.len())?;
        reserve(&mut self.glyph_indices, source.glyph_indices.len())?;
        reserve(&mut self.glyph_stable_ids, source.glyph_stable_ids.len())?;
        reserve(&mut self.index_at, source.index_at.len())?;
        macro_rules! copy_lane {
            ($field:ident) => {
                self.$field.extend_from_slice(&source.$field);
            };
        }
        copy_lane!(starts);
        copy_lane!(ends);
        copy_lane!(advances);
        copy_lane!(flags);
        copy_lane!(style_indexes);
        copy_lane!(source_runs);
        copy_lane!(binding_handles);
        copy_lane!(font_handles);
        copy_lane!(stable_ids);
        copy_lane!(glyph_starts);
        copy_lane!(glyph_counts);
        copy_lane!(glyph_indices);
        copy_lane!(glyph_stable_ids);
        copy_lane!(index_at);
        copy_lane!(shaped);
        copy_lane!(unsafe_before);
        Ok(())
    }

    pub(crate) fn assign_stable_glyph_ids_in_range(
        &mut self,
        previous: &Self,
        cluster_start: usize,
        cluster_end: usize,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        index
            .prepare(cluster_end.saturating_sub(cluster_start))
            .map_err(identity_index_error)?;
        for cluster in cluster_start..cluster_end {
            index
                .insert(
                    previous.stable_ids[cluster],
                    u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        *next_id = (*next_id).max(1);
        for cluster in cluster_start..cluster_end {
            let new_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let new_count = usize::try_from(self.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let previous_cluster = index
                .get(self.stable_ids[cluster])
                .and_then(|value| usize::try_from(value).ok());
            let previous_start = previous_cluster
                .and_then(|cluster| previous.glyph_starts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            let previous_count = previous_cluster
                .and_then(|cluster| previous.glyph_counts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            for ordinal in 0..new_count {
                self.glyph_stable_ids[new_start + ordinal] = if ordinal < previous_count {
                    previous.glyph_stable_ids[previous_start + ordinal]
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
            }
        }
        Ok(())
    }

    pub(crate) fn assign_stable_glyph_ids(
        &mut self,
        previous: &Self,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        index
            .prepare(previous.stable_ids.len())
            .map_err(identity_index_error)?;
        for (cluster, &stable_id) in previous.stable_ids.iter().enumerate() {
            index
                .insert(
                    stable_id,
                    u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        reserve(&mut self.glyph_stable_ids, self.glyph_indices.len())?;
        self.glyph_stable_ids.resize(self.glyph_indices.len(), 0);
        *next_id = (*next_id).max(1);
        for cluster in 0..self.stable_ids.len() {
            let new_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let new_count = usize::try_from(self.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let previous_cluster = index
                .get(self.stable_ids[cluster])
                .and_then(|value| usize::try_from(value).ok());
            let previous_start = previous_cluster
                .and_then(|cluster| previous.glyph_starts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            let previous_count = previous_cluster
                .and_then(|cluster| previous.glyph_counts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            for ordinal in 0..new_count {
                let stable_id = if ordinal < previous_count {
                    *previous
                        .glyph_stable_ids
                        .get(previous_start + ordinal)
                        .filter(|id| **id != 0)
                        .ok_or(EngineError::InvalidRequest)?
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
                *self
                    .glyph_stable_ids
                    .get_mut(new_start + ordinal)
                    .ok_or(EngineError::InvalidRequest)? = stable_id;
            }
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.starts.clear();
        self.ends.clear();
        self.advances.clear();
        self.flags.clear();
        self.style_indexes.clear();
        self.source_runs.clear();
        self.binding_handles.clear();
        self.font_handles.clear();
        self.stable_ids.clear();
        self.glyph_starts.clear();
        self.glyph_counts.clear();
        self.glyph_indices.clear();
        self.glyph_stable_ids.clear();
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
        if shape.glyph_ids.len() != shape.clusters.len() {
            return Err(EngineError::InvalidRequest);
        }
        reserve(&mut self.glyph_indices, shape.glyph_ids.len())?;
        self.glyph_indices.resize(shape.glyph_ids.len(), 0);
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
                let binding_slot = &mut self.binding_handles[cluster_index];
                let font_slot = &mut self.font_handles[cluster_index];
                if *source_slot == NO_SOURCE_RUN {
                    *source_slot = shaped_run.source_run;
                    *binding_slot = shaped_run.binding_handle;
                    *font_slot = shaped_run.font_handle;
                } else if *source_slot != shaped_run.source_run
                    || *binding_slot != shaped_run.binding_handle
                    || *font_slot != shaped_run.font_handle
                {
                    return Err(EngineError::InvalidRequest);
                }
                self.shaped[cluster_index] = 1;
                self.glyph_counts[cluster_index] = self.glyph_counts[cluster_index]
                    .checked_add(1)
                    .ok_or(EngineError::ResultTooLarge)?;
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
        let mut glyph_start = 0_u32;
        for index in 0..self.glyph_starts.len() {
            self.glyph_starts[index] = glyph_start;
            glyph_start = glyph_start
                .checked_add(self.glyph_counts[index])
                .ok_or(EngineError::ResultTooLarge)?;
            self.glyph_counts[index] = 0;
        }
        if usize::try_from(glyph_start).ok() != Some(shape.glyph_ids.len()) {
            return Err(EngineError::InvalidRequest);
        }
        for shaped_run in &shape.runs {
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
                let ordinal = self.glyph_counts[cluster_index];
                let destination = self.glyph_starts[cluster_index]
                    .checked_add(ordinal)
                    .and_then(|value| usize::try_from(value).ok())
                    .ok_or(EngineError::ResultTooLarge)?;
                *self
                    .glyph_indices
                    .get_mut(destination)
                    .ok_or(EngineError::InvalidRequest)? =
                    u32::try_from(glyph).map_err(|_| EngineError::ResultTooLarge)?;
                self.glyph_counts[cluster_index] =
                    ordinal.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
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

fn identity_index_error(error: IdentityIndexError) -> EngineError {
    match error {
        IdentityIndexError::AllocationFailed | IdentityIndexError::ArithmeticOverflow => {
            EngineError::ResultTooLarge
        }
        IdentityIndexError::DuplicateIdentity => EngineError::InvalidRequest,
    }
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
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 3,
                glyph_start: 0,
                glyph_count: 3,
            }],
            glyph_ids: vec![3, 2, 1],
            clusters: vec![2, 1, 0],
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
        assert_eq!(clusters.glyph_starts, [0, 1, 2, 3]);
        assert_eq!(clusters.glyph_counts, [1, 1, 1, 0]);
        assert_eq!(clusters.glyph_indices, [2, 1, 0]);
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
            clusters.glyph_starts.capacity(),
            clusters.glyph_counts.capacity(),
            clusters.glyph_indices.capacity(),
            clusters.index_at.capacity(),
        );
        shape.glyph_flags[0] = GLYPH_UNSAFE_TO_BREAK;
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
                clusters.glyph_starts.capacity(),
                clusters.glyph_counts.capacity(),
                clusters.glyph_indices.capacity(),
                clusters.index_at.capacity(),
            )
        );
        assert_eq!(clusters.flags[1], CLUSTER_SAFE_BEFORE);
        assert_eq!(clusters.flags[2], 0);
    }

    #[test]
    fn stable_glyph_ids_follow_clusters_and_reuse_ordinals_transactionally() {
        let previous = ClusterArena {
            stable_ids: vec![10, 20],
            glyph_starts: vec![0, 2],
            glyph_counts: vec![2, 1],
            glyph_indices: vec![0, 1, 2],
            glyph_stable_ids: vec![1, 2, 3],
            ..ClusterArena::default()
        };
        let mut pending = ClusterArena {
            stable_ids: vec![30, 10, 20],
            glyph_starts: vec![0, 1, 2],
            glyph_counts: vec![1, 1, 2],
            glyph_indices: vec![0, 1, 2, 3],
            ..ClusterArena::default()
        };
        let mut index = IdentityIndex::default();
        let mut next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);

        let capacities = index.capacities();
        pending.glyph_stable_ids.clear();
        next_id = 4;
        pending
            .assign_stable_glyph_ids(&previous, &mut index, &mut next_id)
            .unwrap();
        assert_eq!(pending.glyph_stable_ids, [4, 1, 3, 5]);
        assert_eq!(next_id, 6);
        assert_eq!(index.capacities(), capacities);
    }

    #[test]
    fn retained_source_run_rebuild_matches_the_cold_cluster_oracle() {
        let old_text: Vec<u16> = "ab".encode_utf16().collect();
        let new_text: Vec<u16> = "ac".encode_utf16().collect();
        let mut old_unicode = UnicodeAnalysis::default();
        old_unicode.analyze(&old_text).unwrap();
        let mut new_unicode = UnicodeAnalysis::default();
        new_unicode.analyze(&new_text).unwrap();
        let style = ResolvedStyle::test_typography(16.0, 1.0, 0.0);
        let styles = [StyleSegment {
            text_start: 0,
            text_end: 2,
            style,
        }];
        let runs = [ShapingRun {
            text_start: 0,
            text_end: 2,
            script: u32::from_be_bytes(*b"Latn"),
            direction: 4,
            bidi_level: 0,
            style,
        }];
        let make_shape = |second_glyph, second_advance| ShapeArena {
            runs: vec![ShapedRun {
                source_run: 0,
                binding_handle: 19,
                font_handle: 9,
                text_start: 0,
                text_end: 2,
                glyph_start: 0,
                glyph_count: 2,
            }],
            glyph_ids: vec![1, second_glyph],
            clusters: vec![0, 1],
            x_advances: vec![500, second_advance],
            y_advances: vec![0; 2],
            x_offsets: vec![0; 2],
            y_offsets: vec![0; 2],
            glyph_flags: vec![0; 2],
        };
        let old_shape = make_shape(2, 500);
        let new_shape = make_shape(3, 600);
        let metrics = |_| {
            Some(FontMetrics {
                units_per_em: 1_000,
                ascender: 800,
                descender: -200,
                line_gap: 0,
            })
        };
        let mut previous = ClusterArena::default();
        previous
            .build(
                ClusterBuildInput {
                    text: &old_text,
                    text_unit_ids: &[10, 20],
                    unicode: &old_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &old_shape,
                },
                metrics,
            )
            .unwrap();
        let mut next_id = 1;
        previous
            .assign_stable_glyph_ids(
                &ClusterArena::default(),
                &mut IdentityIndex::default(),
                &mut next_id,
            )
            .unwrap();
        let mut cold = ClusterArena::default();
        cold.build(
            ClusterBuildInput {
                text: &new_text,
                text_unit_ids: &[10, 30],
                unicode: &new_unicode,
                styles: &styles,
                runs: &runs,
                shape: &new_shape,
            },
            metrics,
        )
        .unwrap();
        let mut cold_next_id = next_id;
        cold.assign_stable_glyph_ids(&previous, &mut IdentityIndex::default(), &mut cold_next_id)
            .unwrap();
        let mut retained = ClusterArena::default();
        let (cluster_start, cluster_end) = retained
            .rebuild_source_run_if_topology_is_stable(
                &previous,
                ClusterBuildInput {
                    text: &new_text,
                    text_unit_ids: &[10, 30],
                    unicode: &new_unicode,
                    styles: &styles,
                    runs: &runs,
                    shape: &new_shape,
                },
                0,
                metrics,
            )
            .unwrap()
            .unwrap();
        let mut retained_next_id = next_id;
        retained
            .assign_stable_glyph_ids_in_range(
                &previous,
                cluster_start,
                cluster_end,
                &mut IdentityIndex::default(),
                &mut retained_next_id,
            )
            .unwrap();
        macro_rules! assert_lane {
            ($field:ident) => {
                assert_eq!(retained.$field, cold.$field, stringify!($field));
            };
        }
        assert_lane!(starts);
        assert_lane!(ends);
        assert_lane!(advances);
        assert_lane!(flags);
        assert_lane!(style_indexes);
        assert_lane!(source_runs);
        assert_lane!(binding_handles);
        assert_lane!(font_handles);
        assert_lane!(stable_ids);
        assert_lane!(glyph_starts);
        assert_lane!(glyph_counts);
        assert_lane!(glyph_indices);
        assert_lane!(glyph_stable_ids);
        assert_lane!(index_at);
        assert_lane!(shaped);
        assert_lane!(unsafe_before);
        assert_eq!(retained_next_id, cold_next_id);
    }
}
