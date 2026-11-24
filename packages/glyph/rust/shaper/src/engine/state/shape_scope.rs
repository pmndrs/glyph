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
        verify: VerifyWindows,
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
                    // Text after a window that changed the run's length moved with it.
                    let moved = if retained_start >= window.old_end {
                        delta
                    } else {
                        0
                    };
                    let (pending, committed) = self.shape.derive_mut();
                    pending.append_glyph_range_from(
                        committed,
                        affected_shape_index,
                        source_run,
                        retained_start,
                        retained_end,
                        cursor_glyph,
                        retained_glyph_end,
                        moved,
                    )?;
                }
                self.boundary_shape_scratch.clear();
                let scratch = &mut self.boundary_shape_scratch;
                let styles = &self.styles.active().arena;
                #[cfg(test)]
                let before_window = crate::engine::work_attribution::snapshot();
                let mut kern_table_flagged = None;
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
                        flags: SHAPE_FLAGS,
                    },
                    ShapeRangeRef {
                        item_start: window.probe_start,
                        item_end: window.probe_end,
                        context_start: new_run.text_start,
                        context_end: new_run.text_end,
                        flags: SHAPE_FLAGS,
                    },
                    |shaped| {
                        kern_table_flagged = shaped.kern_table_flagged();
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
                let refused = match verify {
                    VerifyWindows::No => None,
                    VerifyWindows::Sparse => (!sparse_shape_boundaries_are_safe(
                        &self.boundary_shape_scratch,
                        window,
                        new_run.text_start,
                        new_run.text_end,
                    ))
                    .then_some(ShapeAttempt::RetryWholeRun),
                    VerifyWindows::Edit
                        if !kern_table_flags_hold(
                            self.shape.committed(),
                            run_glyph_start..run_glyph_end,
                            kern_table_flagged,
                        ) =>
                    {
                        Some(ShapeAttempt::RetryWholeRun)
                    }
                    VerifyWindows::Edit => {
                        let fresh = &self.boundary_shape_scratch;
                        let ends = edit_window_ends_hold(
                            RunClusters::of(self.shape.committed(), affected_shape, rtl)?,
                            RunClusters {
                                shape: fresh,
                                first: 0,
                                len: fresh.glyph_ids.len(),
                                rtl,
                            },
                            window,
                            old_run,
                            delta,
                        );
                        (ends != (true, true)).then_some(ShapeAttempt::Widen {
                            start: !ends.0,
                            end: !ends.1,
                        })
                    }
                };
                if let Some(refused) = refused {
                    self.shape.pending_mut().clear();
                    self.boundary_shape_scratch.clear();
                    return Ok(refused);
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
                let moved = if self
                    .shape_window_scratch
                    .last()
                    .is_some_and(|window| retained_start >= window.old_end)
                {
                    delta
                } else {
                    0
                };
                let (pending, committed) = self.shape.derive_mut();
                pending.append_glyph_range_from(
                    committed,
                    affected_shape_index,
                    source_run,
                    retained_start,
                    retained_end,
                    cursor_glyph,
                    run_glyph_end,
                    moved,
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
            let mut safe = unflagged(shape, group_start);
            while group_start > glyph_start && shape.clusters[group_start - 1] == cluster {
                group_start -= 1;
                safe &= unflagged(shape, group_start);
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
            let mut safe = unflagged(shape, glyph);
            while group_end < glyph_end && shape.clusters[group_end] == cluster {
                safe &= unflagged(shape, group_end);
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
            start_alone: false,
            end_alone: false,
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
        start_alone: false,
        end_alone: false,
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
    for (glyph, cluster) in shape.clusters.iter().enumerate() {
        if *cluster == boundary {
            found = true;
            if !unflagged(shape, glyph) {
                return false;
            }
        }
    }
    found
}

/// Clusters of the retained shape an edit window's probe shapes beyond each end. A lookup that
/// looks past the end of the probe flags its last clusters, so the probe ends further out than
/// fonts look ahead, and an end the fresh shape refuses is moved out instead.
const PROBE_MARGIN: usize = 4;

/// How many times one edit moves a refused end of its window further out before the run is
/// reshaped whole.
pub(super) const WINDOW_WIDENINGS: u8 = 3;

/// One shaped run's clusters by position in text order, whichever way its glyphs run. A
/// position is a count of glyphs from the run's first character.
#[derive(Clone, Copy)]
pub(super) struct RunClusters<'a> {
    pub(super) shape: &'a ShapeArena,
    pub(super) first: usize,
    pub(super) len: usize,
    pub(super) rtl: bool,
}

impl<'a> RunClusters<'a> {
    #[inline(never)]
    pub(super) fn of(
        shape: &'a ShapeArena,
        shaped_run: ShapedRun,
        rtl: bool,
    ) -> Result<Self, EngineError> {
        let (first, end) = shaped_run_glyph_range(shape, shaped_run)?;
        Ok(Self {
            shape,
            first,
            len: end - first,
            rtl,
        })
    }

    fn glyph(self, position: usize) -> usize {
        if self.rtl {
            self.first + self.len - 1 - position
        } else {
            self.first + position
        }
    }

    #[inline(never)]
    fn text(self, position: usize) -> u32 {
        self.shape.clusters[self.glyph(position)]
    }

    /// Where the cluster holding text offset `text` starts, or the first one after it.
    #[inline(never)]
    fn at_or_after(self, text: u32) -> usize {
        let (mut low, mut high) = (0, self.len);
        while low < high {
            let middle = low + (high - low) / 2;
            if self.text(middle) < text {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        low
    }

    /// Where the cluster after the one that starts at `position` starts.
    #[inline(never)]
    fn after(self, position: usize) -> usize {
        let text = self.text(position);
        let mut next = position + 1;
        while next < self.len && self.text(next) == text {
            next += 1;
        }
        next
    }

    /// Where the cluster before the one that starts at `position` starts.
    #[inline(never)]
    fn before(self, position: usize) -> usize {
        let text = self.text(position - 1);
        let mut previous = position - 1;
        while previous > 0 && self.text(previous - 1) == text {
            previous -= 1;
        }
        previous
    }

    /// Whether no glyph of the cluster that starts at `position` is flagged: unsafe to
    /// concatenate, or only for more than a simple pair. An end of the run is never flagged.
    #[inline(never)]
    fn free(self, position: usize, of_more_than_pairs: bool) -> bool {
        position == 0
            || position == self.len
            || (position..self.after(position)).all(|position| {
                let glyph = self.glyph(position);
                !self.shape.beyond_pairs[glyph]
                    && (of_more_than_pairs
                        || self.shape.glyph_flags[glyph] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0)
            })
    }

    /// Whether the cluster that starts at `position` and the one before it stand alone: nothing
    /// but a simple pair reaches into or out of either.
    #[inline(never)]
    fn stands_alone(self, position: usize) -> bool {
        position > 0
            && position < self.len
            && self.free(self.before(position), true)
            && self.free(position, true)
            && self.free(self.after(position), true)
    }

    /// Whether the glyphs at `count` positions from `start` are the glyphs `other` has from
    /// `other_start`.
    #[inline(never)]
    fn same_glyphs(self, start: usize, other: Self, other_start: usize, count: usize) -> bool {
        (0..count).all(|offset| {
            self.shape.glyph_ids[self.glyph(start + offset)]
                == other.shape.glyph_ids[other.glyph(other_start + offset)]
        })
    }
}

/// The window one edit of a run reshapes: from a boundary before the edit to one after it, each
/// either the run's or one the retained shape lets a fresh shape be spliced at.
///
/// A boundary no glyph flags unsafe to concatenate is one. So is a boundary between two
/// clusters outside the edit that stand alone (`RunClusters::stands_alone`): then only a pair
/// adjustment of the two glyphs beside the boundary reaches across it, the two glyphs alone
/// decide it, and both are the same glyphs in the old text and the new.
/// `widen` skips that many boundaries on each side, for an end a fresh shape refused.
#[inline(never)]
pub(super) fn build_edit_shape_window(
    edit: TextEdit,
    shape: &ShapeArena,
    shaped_run: ShapedRun,
    old_run: ShapingRun,
    new_run: ShapingRun,
    widen: (u8, u8),
    windows: &mut Vec<ShapeWindow>,
) -> Result<bool, EngineError> {
    windows.clear();
    let rtl = match old_run.direction {
        0 => false,
        1 => true,
        _ => return Ok(false),
    };
    let to_u32 = |value: usize| u32::try_from(value).map_err(|_| EngineError::ResultTooLarge);
    let (edit_start, edit_end) = (to_u32(edit.old_start)?, to_u32(edit.old_end)?);
    if shaped_run.text_start != old_run.text_start
        || shaped_run.text_end != old_run.text_end
        || edit.old_start != edit.new_start
        || edit_start < old_run.text_start
        || edit_end > old_run.text_end
    {
        return Ok(false);
    }
    let clusters = RunClusters::of(shape, shaped_run, rtl)?;
    let len = clusters.len;
    let text_at = |position: usize| {
        if position == len {
            old_run.text_end
        } else {
            clusters.text(position)
        }
    };

    // The last boundary before the edit, then outwards.
    let mut start = clusters.at_or_after(edit_start);
    let mut start_alone = false;
    let mut skip = widen.0;
    while start > 0 {
        let inner = start;
        start = clusters.before(start);
        if start == 0 {
            break;
        }
        let free = clusters.free(start, false);
        // The cluster between this boundary and the edit is not part of the edit.
        start_alone = !free && text_at(inner) <= edit_start && clusters.stands_alone(start);
        if free || start_alone {
            if skip == 0 {
                break;
            }
            skip -= 1;
        }
        start_alone = false;
    }
    // The first boundary after the edit, then outwards.
    let mut end = clusters.at_or_after(edit_end);
    if end < len && clusters.text(end) == edit_end {
        end = clusters.after(end);
    }
    let mut end_alone = false;
    let mut skip = widen.1;
    while end < len {
        let free = clusters.free(end, false);
        // The cluster between the edit and this boundary is not part of the edit.
        end_alone =
            !free && clusters.stands_alone(end) && clusters.text(clusters.before(end)) >= edit_end;
        if free || end_alone {
            if skip == 0 {
                break;
            }
            skip -= 1;
        }
        end_alone = false;
        end = clusters.after(end);
    }
    let (mut probe_start, mut probe_end) = (start, end);
    for _ in 0..PROBE_MARGIN {
        if probe_start > 0 {
            probe_start = clusters.before(probe_start);
        }
        if probe_end < len {
            probe_end = clusters.after(probe_end);
        }
    }
    let delta = i64::from(new_run.text_end) - i64::from(old_run.text_end);
    let (old_start, old_end) = (text_at(start), text_at(end));
    let new_end = shifted_text_offset(old_end, delta)?;
    if new_end <= old_start {
        return Ok(false);
    }
    let (old_glyph_start, old_glyph_end) = if rtl {
        (clusters.first + len - end, clusters.first + len - start)
    } else {
        (clusters.first + start, clusters.first + end)
    };
    windows
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    windows.push(ShapeWindow {
        old_start,
        old_end,
        probe_start: text_at(probe_start),
        new_start: old_start,
        new_end,
        probe_end: shifted_text_offset(text_at(probe_end), delta)?,
        old_glyph_start,
        old_glyph_end,
        start_alone,
        end_alone,
    });
    Ok(true)
}

/// Whether the fresh shape of an edit window's probe agrees to each end of the window: the
/// start, then the end. An end of the run needs no agreement.
///
/// A boundary the retained shape leaves unflagged holds when the fresh shape leaves it
/// unflagged too. A boundary between two clusters that stand alone holds when they stand alone
/// in the fresh shape as well and are the same glyphs there, so the pair adjustment across the
/// boundary is the retained one.
#[inline(never)]
pub(super) fn edit_window_ends_hold(
    old: RunClusters<'_>,
    fresh: RunClusters<'_>,
    window: ShapeWindow,
    old_run: ShapingRun,
    delta: i64,
) -> (bool, bool) {
    let moved = |text: u32, by: i64| u32::try_from(i64::from(text) + by).ok();
    let holds = |old_text: u32, by: i64, alone: bool| {
        let Some(new_text) = moved(old_text, by) else {
            return false;
        };
        let at = fresh.at_or_after(new_text);
        if at == fresh.len || fresh.text(at) != new_text {
            return false;
        }
        if !alone {
            return fresh.free(at, false);
        }
        // The probe reaches `PROBE_MARGIN` clusters past this boundary or to the end of the
        // run, so an end of the probe among the three boundaries read here is the run's.
        if !fresh.stands_alone(at) {
            return false;
        }
        let place = old.at_or_after(old_text);
        let (old_before, old_after) = (old.before(place), old.after(place));
        let (before, after) = (fresh.before(at), fresh.after(at));
        let old_after_text = if old_after == old.len {
            old_run.text_end
        } else {
            old.text(old_after)
        };
        let after_text = if after == fresh.len {
            window.probe_end
        } else {
            fresh.text(after)
        };
        moved(old.text(old_before), by) == Some(fresh.text(before))
            && moved(old_after_text, by) == Some(after_text)
            && old_after - old_before == after - before
            && place - old_before == at - before
            && old.same_glyphs(old_before, fresh, before, after - before)
    };
    (
        window.old_start == old_run.text_start || holds(window.old_start, 0, window.start_alone),
        window.old_end == old_run.text_end || holds(window.old_end, delta, window.end_alone),
    )
}

/// Whether a window of a run that kerns through a legacy `kern` table keeps the flags a cold
/// shape has. HarfRust flags every glyph of a buffer unsafe to concatenate when a subtable of
/// that table can match one of its glyphs, so the flag of a retained glyph depends on glyphs
/// anywhere in the run. `probe` is what the fresh probe reported (`None` without such a table).
///
/// A flagged probe means the new run is flagged whole, so every retained glyph must carry the
/// flag already. An unflagged probe means no glyph of the probe can match; the new run is then
/// unflagged only when the old one was, which a retained glyph without the flag proves.
#[inline(never)]
pub(super) fn kern_table_flags_hold(
    retained: &ShapeArena,
    run_glyphs: core::ops::Range<usize>,
    probe: Option<bool>,
) -> bool {
    let mut flagged = retained.glyph_flags[run_glyphs]
        .iter()
        .map(|flags| flags & GLYPH_FLAG_UNSAFE_TO_CONCAT != 0);
    match probe {
        None => true,
        Some(true) => flagged.all(|flagged| flagged),
        Some(false) => flagged.any(|flagged| !flagged),
    }
}

/// Whether a glyph is neither unsafe to concatenate nor marked beyond pairs, which a stage
/// HarfRust leaves unflagged (a `kern` state machine) sets alone.
fn unflagged(shape: &ShapeArena, glyph: usize) -> bool {
    shape.glyph_flags[glyph] & GLYPH_FLAG_UNSAFE_TO_CONCAT == 0 && !shape.beyond_pairs[glyph]
}
