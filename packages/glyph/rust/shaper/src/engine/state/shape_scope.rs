//! The scope of an incremental reshape: sparse windows bounded by safe boundaries.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl ParagraphState {
    #[allow(clippy::too_many_arguments)]
    pub(super) fn prepare_incremental_shape_scope(
        &mut self,
        shaper: &mut ShaperRegistry,
        source_run_index: usize,
        old_run: ShapingRun,
        new_run: ShapingRun,
        affected_shape_index: usize,
        affected_shape: ShapedRun,
        fallback: FallbackSpan,
        verify_boundaries: bool,
    ) -> Result<ShapeAttempt, EngineError> {
        self.shape.pending_mut().clear();
        let source_run =
            u32::try_from(source_run_index).map_err(|_| EngineError::ResultTooLarge)?;
        let run_count = self.shape.committed().runs.len();
        let delta = i64::from(new_run.text_end) - i64::from(old_run.text_end);
        for shape_index in 0..run_count {
            let shaped_run = *self
                .shape
                .committed()
                .runs
                .get(shape_index)
                .ok_or(EngineError::InvalidRequest)?;
            if shape_index != affected_shape_index {
                let run_delta = if shaped_run.text_start >= old_run.text_end {
                    delta
                } else {
                    0
                };
                let (pending, committed) = self.shape.derive_mut();
                pending.append_text_range_from(
                    committed,
                    shape_index,
                    shaped_run.source_run,
                    shaped_run.text_start,
                    shaped_run.text_end,
                    run_delta,
                )?;
                continue;
            }
            let rtl = old_run.direction == 1;
            let (run_glyph_start, run_glyph_end) =
                shaped_run_glyph_range(self.shape.committed(), affected_shape)?;
            let appended_run_start = self.shape.pending().runs.len();
            let mut cursor_text = if rtl {
                old_run.text_end
            } else {
                old_run.text_start
            };
            let mut cursor_glyph = run_glyph_start;
            for ordinal in 0..self.shape_window_scratch.len() {
                let window_index = if rtl {
                    self.shape_window_scratch.len() - ordinal - 1
                } else {
                    ordinal
                };
                let window = self.shape_window_scratch[window_index];
                let (retained_start, retained_end, retained_glyph_end) = if rtl {
                    (window.old_end, cursor_text, window.old_glyph_start)
                } else {
                    (cursor_text, window.old_start, window.old_glyph_start)
                };
                if retained_start < retained_end {
                    let (pending, committed) = self.shape.derive_mut();
                    pending.append_glyph_range_from(
                        committed,
                        affected_shape_index,
                        source_run,
                        retained_start,
                        retained_end,
                        cursor_glyph,
                        retained_glyph_end,
                        0,
                    )?;
                }
                self.boundary_shape_scratch.clear();
                let scratch = &mut self.boundary_shape_scratch;
                let styles = &self.styles.active().arena;
                #[cfg(test)]
                let before_window = crate::engine::work_attribution::snapshot();
                let shaped = shaper.with_shaped_range(
                    fallback.font_handle,
                    &self.text.pending().units,
                    ShapeRunRef {
                        text_start: new_run.text_start,
                        text_end: new_run.text_end,
                        script: new_run.script,
                        language: styles.resolved_language(new_run.style),
                        features: styles.resolved_features(new_run.style),
                        direction: new_run.direction,
                        cluster_level: 0,
                        flags: 0x40,
                    },
                    ShapeRangeRef {
                        item_start: window.probe_start,
                        item_end: window.probe_end,
                        context_start: new_run.text_start,
                        context_end: new_run.text_end,
                        flags: 0x40,
                    },
                    |shaped| {
                        scratch.append(
                            source_run_index,
                            fallback.font_handle,
                            fallback.binding_handle,
                            window.probe_start,
                            window.probe_end,
                            shaped,
                        )
                    },
                );
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.incremental_window_shape_calls += work
                        .harfrust_calls
                        .saturating_sub(before_window.harfrust_calls);
                    work.incremental_window_shape_utf16_units += work
                        .harfrust_utf16_units
                        .saturating_sub(before_window.harfrust_utf16_units);
                });
                shaped.map_err(shaper_error)?;
                if self.boundary_shape_scratch.glyph_ids.contains(&0) {
                    self.shape.pending_mut().clear();
                    self.boundary_shape_scratch.clear();
                    return Ok(ShapeAttempt::NeedsFallback);
                }
                if verify_boundaries
                    && !sparse_shape_boundaries_are_safe(
                        &self.boundary_shape_scratch,
                        window,
                        new_run.text_start,
                        new_run.text_end,
                    )
                {
                    self.shape.pending_mut().clear();
                    self.boundary_shape_scratch.clear();
                    return Ok(ShapeAttempt::RetryWholeRun);
                }
                // A complete sole run is already shaped in its final coordinates. Move its
                // owned columns into pending; the old empty pending arena becomes reusable
                // scratch, while committed shape remains available for reconciliation.
                if source_run_index == 0
                    && self.shaping_runs.committed().runs().len() == 1
                    && self.shaping_runs.active().runs().len() == 1
                    && run_count == 1
                    && affected_shape_index == 0
                    && self.shape_window_scratch.len() == 1
                    && old_run.text_start == 0
                    && new_run.text_start == 0
                    && usize::try_from(old_run.text_end).ok()
                        == Some(self.text.committed().units.len())
                    && usize::try_from(new_run.text_end).ok()
                        == Some(self.text.active().units.len())
                    && affected_shape.text_start == old_run.text_start
                    && affected_shape.text_end == old_run.text_end
                    && run_glyph_start == 0
                    && run_glyph_end == self.shape.committed().glyph_ids.len()
                    && window.old_start == old_run.text_start
                    && window.old_end == old_run.text_end
                    && window.old_glyph_start == run_glyph_start
                    && window.old_glyph_end == run_glyph_end
                    && window.new_start == new_run.text_start
                    && window.new_end == new_run.text_end
                    && window.probe_end == window.new_end
                {
                    #[cfg(test)]
                    crate::engine::work_attribution::record(|work| {
                        work.shape_scratch_arena_moves += 1;
                        work.shape_scratch_moved_glyphs +=
                            self.boundary_shape_scratch.glyph_ids.len();
                    });
                    core::mem::swap(&mut self.boundary_shape_scratch, self.shape.pending_mut());
                    return Ok(ShapeAttempt::Prepared);
                }
                {
                    let scratch = &self.boundary_shape_scratch;
                    self.shape.pending_mut().append_text_range_from(
                        scratch,
                        0,
                        source_run,
                        window.new_start,
                        window.new_end,
                        0,
                    )?;
                }
                cursor_text = if rtl {
                    window.old_start
                } else {
                    window.old_end
                };
                cursor_glyph = window.old_glyph_end;
            }
            let (retained_start, retained_end) = if rtl {
                (old_run.text_start, cursor_text)
            } else {
                (cursor_text, old_run.text_end)
            };
            if retained_start < retained_end {
                let (pending, committed) = self.shape.derive_mut();
                pending.append_glyph_range_from(
                    committed,
                    affected_shape_index,
                    source_run,
                    retained_start,
                    retained_end,
                    cursor_glyph,
                    run_glyph_end,
                    0,
                )?;
            }
            self.shape.pending_mut().collapse_appended_runs(
                appended_run_start,
                new_run.text_start,
                new_run.text_end,
            )?;
        }
        self.boundary_shape_scratch.clear();
        Ok(ShapeAttempt::Prepared)
    }
}

pub(super) fn build_sparse_shape_windows(
    edits: &[TextEdit],
    shape: &ShapeArena,
    shaped_run: ShapedRun,
    source_run: ShapingRun,
    windows: &mut Vec<ShapeWindow>,
) -> Result<bool, EngineError> {
    windows.clear();
    if edits.is_empty()
        || shaped_run.text_start != source_run.text_start
        || shaped_run.text_end != source_run.text_end
    {
        return Ok(false);
    }
    let mut previous_end =
        usize::try_from(source_run.text_start).map_err(|_| EngineError::ResultTooLarge)?;
    let run_end = usize::try_from(source_run.text_end).map_err(|_| EngineError::ResultTooLarge)?;
    for edit in edits.iter().copied() {
        if !edit.is_same_length()
            || edit.old_start != edit.new_start
            || edit.old_start == edit.old_end
            || edit.old_start < previous_end
            || edit.old_end > run_end
        {
            return Ok(false);
        }
        previous_end = edit.old_end;
    }
    windows
        .try_reserve_cold(edits.len())
        .map_err(|_| EngineError::ResultTooLarge)?;
    let (glyph_start, glyph_end) = shaped_run_glyph_range(shape, shaped_run)?;
    let rtl = match source_run.direction {
        0 => false,
        1 => true,
        _ => return Ok(false),
    };
    let run_start_boundary = if rtl { glyph_end } else { glyph_start };
    let run_start = SafeBoundary {
        text: source_run.text_start,
        glyph: run_start_boundary,
        preceding: source_run.text_start,
    };
    let mut builder = SparseWindowBuilder {
        edits,
        next_edit: 0,
        previous_boundary: source_run.text_start,
        previous_safe: run_start,
        window_start: run_start,
        rtl,
        windows,
    };
    let mut previous_cluster = None;
    if rtl {
        let mut glyph = glyph_end;
        while glyph > glyph_start {
            let group_end = glyph;
            let cluster = shape.clusters[glyph - 1];
            let mut group_start = glyph - 1;
            let mut safe = shape.glyph_flags[group_start] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            while group_start > glyph_start && shape.clusters[group_start - 1] == cluster {
                group_start -= 1;
                safe &= shape.glyph_flags[group_start] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            }
            if cluster < source_run.text_start
                || cluster >= source_run.text_end
                || previous_cluster.is_some_and(|previous| cluster < previous)
            {
                windows.clear();
                return Ok(false);
            }
            #[cfg(test)]
            crate::SPARSE_BOUNDARY_VISITS.with(|count| count.set(count.get() + 1));
            builder.visit(cluster, group_end, safe)?;
            previous_cluster = Some(cluster);
            glyph = group_start;
        }
    } else {
        let mut glyph = glyph_start;
        while glyph < glyph_end {
            let group_start = glyph;
            let cluster = shape.clusters[glyph];
            let mut group_end = glyph + 1;
            let mut safe = shape.glyph_flags[glyph] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
            while group_end < glyph_end && shape.clusters[group_end] == cluster {
                safe &= shape.glyph_flags[group_end] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0;
                group_end += 1;
            }
            if cluster < source_run.text_start
                || cluster >= source_run.text_end
                || previous_cluster.is_some_and(|previous| cluster < previous)
            {
                windows.clear();
                return Ok(false);
            }
            #[cfg(test)]
            crate::SPARSE_BOUNDARY_VISITS.with(|count| count.set(count.get() + 1));
            builder.visit(cluster, group_start, safe)?;
            previous_cluster = Some(cluster);
            glyph = group_end;
        }
    }
    let run_end_boundary = if rtl { glyph_start } else { glyph_end };
    builder.visit(source_run.text_end, run_end_boundary, true)?;
    if builder.next_edit != edits.len() {
        windows.clear();
        return Ok(false);
    }
    if let Some(window) = windows.last_mut()
        && window.probe_end == 0
    {
        window.probe_end = source_run.text_end;
    }
    Ok(!windows.is_empty())
}

/// A cluster boundary no glyph of the retained shape flags unsafe to concatenate across.
#[derive(Clone, Copy)]
pub(super) struct SafeBoundary {
    pub(super) text: u32,
    pub(super) glyph: usize,
    /// The cluster boundary before this one, or this one at the start of the run.
    pub(super) preceding: u32,
}

pub(super) struct SparseWindowBuilder<'a> {
    pub(super) edits: &'a [TextEdit],
    pub(super) next_edit: usize,
    /// The boundary of the last visit, safe or not.
    pub(super) previous_boundary: u32,
    pub(super) previous_safe: SafeBoundary,
    pub(super) window_start: SafeBoundary,
    pub(super) rtl: bool,
    pub(super) windows: &'a mut Vec<ShapeWindow>,
}
impl SparseWindowBuilder<'_> {
    pub(super) fn visit(
        &mut self,
        boundary: u32,
        glyph_boundary: usize,
        safe: bool,
    ) -> Result<(), EngineError> {
        if let Some(window) = self.windows.last_mut()
            && window.probe_end == 0
            && boundary > window.new_end
        {
            window.probe_end = boundary;
        }
        let preceding = core::mem::replace(&mut self.previous_boundary, boundary);
        if !safe {
            return Ok(());
        }
        let here = SafeBoundary {
            text: boundary,
            glyph: glyph_boundary,
            preceding,
        };
        while let Some(edit) = self.edits.get(self.next_edit).copied() {
            let edit_start =
                u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            let edit_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
            if boundary <= edit_start {
                self.window_start = here;
                break;
            }
            if boundary < edit_end {
                break;
            }
            self.push_window(boundary, glyph_boundary)?;
            self.next_edit += 1;
            let Some(next) = self.edits.get(self.next_edit) else {
                break;
            };
            let next_start =
                u32::try_from(next.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            if boundary <= next_start {
                self.window_start = here;
                break;
            }
            self.window_start = self.previous_safe;
        }
        self.previous_safe = here;
        Ok(())
    }

    pub(super) fn push_window(&mut self, end: u32, end_glyph: usize) -> Result<(), EngineError> {
        let SafeBoundary {
            text: start,
            glyph: start_glyph,
            preceding: probe_start,
        } = self.window_start;
        if start >= end {
            return Err(EngineError::InvalidRequest);
        }
        let (old_glyph_start, old_glyph_end) = if self.rtl {
            (end_glyph, start_glyph)
        } else {
            (start_glyph, end_glyph)
        };
        if old_glyph_start > old_glyph_end {
            return Err(EngineError::InvalidRequest);
        }
        if let Some(previous) = self.windows.last_mut()
            && start <= previous.old_end
        {
            previous.old_end = previous.old_end.max(end);
            previous.new_end = previous.new_end.max(end);
            previous.old_glyph_start = previous.old_glyph_start.min(old_glyph_start);
            previous.old_glyph_end = previous.old_glyph_end.max(old_glyph_end);
            previous.probe_end = 0;
            return Ok(());
        }
        self.windows
            .try_reserve_cold(1)
            .map_err(|_| EngineError::ResultTooLarge)?;
        self.windows.push(ShapeWindow {
            old_start: start,
            old_end: end,
            probe_start,
            new_start: start,
            new_end: end,
            probe_end: 0,
            old_glyph_start,
            old_glyph_end,
        });
        Ok(())
    }
}

pub(super) fn set_whole_shape_window(
    windows: &mut Vec<ShapeWindow>,
    shaped_run: ShapedRun,
    old_run: ShapingRun,
    new_run: ShapingRun,
) -> Result<(), EngineError> {
    let old_glyph_start =
        usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let old_glyph_end = old_glyph_start
        .checked_add(
            usize::try_from(shaped_run.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?;
    windows.clear();
    windows
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    windows.push(ShapeWindow {
        old_start: old_run.text_start,
        old_end: old_run.text_end,
        probe_start: new_run.text_start,
        new_start: new_run.text_start,
        new_end: new_run.text_end,
        probe_end: new_run.text_end,
        old_glyph_start,
        old_glyph_end,
    });
    Ok(())
}

pub(super) fn shaped_run_glyph_range(
    shape: &ShapeArena,
    shaped_run: ShapedRun,
) -> Result<(usize, usize), EngineError> {
    let start = usize::try_from(shaped_run.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(
            usize::try_from(shaped_run.glyph_count).map_err(|_| EngineError::InvalidRequest)?,
        )
        .ok_or(EngineError::InvalidRequest)?;
    if end > shape.glyph_ids.len() || end > shape.clusters.len() || end > shape.glyph_flags.len() {
        return Err(EngineError::InvalidRequest);
    }
    Ok((start, end))
}

pub(super) fn sparse_shape_boundaries_are_safe(
    shape: &ShapeArena,
    window: ShapeWindow,
    run_start: u32,
    run_end: u32,
) -> bool {
    (window.new_start == run_start || concat_boundary_is_safe(shape, window.new_start))
        && (window.new_end == run_end || concat_boundary_is_safe(shape, window.new_end))
}

pub(super) fn concat_boundary_is_safe(shape: &ShapeArena, boundary: u32) -> bool {
    let mut found = false;
    for (cluster, flags) in shape.clusters.iter().zip(&shape.glyph_flags) {
        if *cluster == boundary {
            found = true;
            if flags & GLYPH_FLAG_UNSAFE_TO_CONCAT != 0 {
                return false;
            }
        }
    }
    found
}
