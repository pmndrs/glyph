//! The shape stage: whole, incremental and multi-run reshaping of one paragraph.

use super::*;

/// Whether a rebuilt shaping-run list keeps the previous list's positional
/// topology: same count and, per index, the same text span and shaping
/// identity. Style VALUES may differ — that is what a metrics-only refresh
/// re-derives — but a merged, split, or re-spanned run list invalidates the
/// retained cluster arena's run indices.
pub(super) fn shaping_run_topology_stable(
    previous: &[crate::engine::shaping_state::ShapingRun],
    next: &[crate::engine::shaping_state::ShapingRun],
) -> bool {
    previous.len() == next.len()
        && previous.iter().zip(next).all(|(before, after)| {
            before.text_start == after.text_start
                && before.text_end == after.text_end
                && before.script == after.script
                && before.direction == after.direction
                && before.bidi_level == after.bidi_level
        })
}
impl ParagraphState {
    #[inline(never)]
    pub(super) fn prepare_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
    ) -> Result<(), EngineError> {
        self.discard_shape_candidate();
        if self.shape_still_valid() {
            return Ok(());
        }
        // Empty text has no shape, however an edit emptied it. Its one shaping run is empty,
        // and an incremental path would shape that run into an empty shaped run, which the
        // cluster build rejects.
        if self.text.active().units.is_empty() {
            self.shape.mark_prepared();
            return Ok(());
        }
        if self.committed_inline().is_none()
            && (self.try_prepare_incremental_shape(shaper, font_stacks, font_bindings)?
                || self.try_prepare_multi_run_shape(shaper)?
                || self.try_prepare_realigned_shape(shaper, font_stacks, font_bindings)?)
        {
            self.shape.mark_prepared();
            return Ok(());
        }
        let text = self.text.active().units.as_slice();
        let styles = &self.styles.active().arena;
        let runs = self.shaping_runs.active().runs();
        let max_stack_depth = seed_fallback_spans(
            &mut self.pending_fallback_spans,
            runs,
            font_stacks,
            font_bindings,
        )?;
        // Each pass shapes every span with its current font, then hands each missing cluster
        // to the next font of its stack; a pass that hands nothing on is the shape.
        for _ in 0..max_stack_depth.max(1) {
            shape_fallback_spans(
                shaper,
                self.shape.pending_mut(),
                &self.pending_fallback_spans,
                text,
                styles,
                runs,
            )?;
            collect_cluster_records(
                self.shape.pending_mut(),
                &mut self.fallback_cluster_scratch,
                &mut self.sort_pair_scratch,
            )?;
            self.fallback_span_scratch.clear();
            let changed = split_missing_clusters(
                &self.pending_fallback_spans,
                &self.fallback_cluster_scratch,
                runs,
                font_stacks,
                font_bindings,
                &mut self.fallback_span_scratch,
            )?;
            if !changed {
                // The raw owner about to be accepted was produced with this
                // registry's exact current font instance. A later dispose and
                // same-handle registration cannot reuse this serial.
                self.pending_shape_font_instance =
                    whole_run_font_handle(runs, self.shape.pending(), &self.pending_fallback_spans)
                        .and_then(|handle| shaper.font_instance(handle));
                self.shape.mark_prepared();
                return Ok(());
            }
            core::mem::swap(
                &mut self.pending_fallback_spans,
                &mut self.fallback_span_scratch,
            );
        }
        Err(EngineError::InvalidRequest)
    }

    /// Whether the committed shape still holds for the pending stages.
    ///
    /// Metric-only styles must refresh the retained run values consumed by cluster aggregation, but the underlying
    /// HarfRust result remains valid. Keeping those two invalidations distinct avoids reshaping on size, tracking,
    /// word-spacing, line-height, or baseline changes while still rebuilding advances from the new run styles.
    /// One exception: a metric change can MERGE adjacent runs whose layout styles became identical, and the
    /// retained shaped runs then index a run list that no longer exists — the shape must re-run whenever the
    /// rebuilt run list breaks positional topology with the committed one.
    fn shape_still_valid(&self) -> bool {
        !self.text.is_prepared()
            && !self.style_invalidation.shaping
            && !self.bidi.is_prepared()
            && self.committed_inline().is_none()
            && (!self.shaping_runs.is_prepared()
                || shaping_run_topology_stable(
                    self.shaping_runs.committed().runs(),
                    self.shaping_runs.pending().runs(),
                ))
    }

    pub(super) fn try_prepare_incremental_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
    ) -> Result<bool, EngineError> {
        let Some(edit) = bounding_text_edit(&self.text_edits) else {
            return Ok(false);
        };
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.active().runs();
        if old_runs.len() != new_runs.len() || old_runs.is_empty() {
            return Ok(false);
        }
        let Some(old_run_index) = edit_run(old_runs, new_runs, edit) else {
            return Ok(false);
        };
        let new_run_index = old_run_index;
        if old_run_index != new_run_index
            || !same_edit_run_topology(
                old_runs,
                new_runs,
                edit,
                old_run_index,
                self.style_invalidation
                    .shaping
                    .then_some((&self.styles.committed().arena, &self.styles.active().arena)),
            )?
        {
            return Ok(false);
        }
        let old_run = old_runs[old_run_index];
        let new_run = new_runs[new_run_index];
        let affected_source_run =
            u32::try_from(old_run_index).map_err(|_| EngineError::ResultTooLarge)?;
        let mut affected_fallbacks = self
            .fallback_spans
            .iter()
            .copied()
            .filter(|span| span.source_run == affected_source_run);
        let Some(fallback) = affected_fallbacks.next() else {
            return Ok(false);
        };
        if affected_fallbacks.next().is_some()
            || fallback.font_index != 0
            || fallback.text_start != old_run.text_start
            || fallback.text_end != old_run.text_end
        {
            return Ok(false);
        }
        let mut affected_shapes = self
            .shape
            .committed()
            .runs
            .iter()
            .copied()
            .enumerate()
            .filter(|(_, run)| run.source_run == affected_source_run);
        let Some((affected_shape_index, affected_shape)) = affected_shapes.next() else {
            return Ok(false);
        };
        if affected_shapes.next().is_some() {
            return Ok(false);
        }
        let sparse_scope = build_sparse_shape_windows(
            &self.text_edits,
            self.shape.committed(),
            affected_shape,
            old_run,
            &mut self.shape_window_scratch,
        )?;
        if !sparse_scope {
            // The ordinary length-changing route would shape the complete run.
            // Keep same-length sparse edits above on their existing path.
            if self.try_prepare_ascii_anchor_shape(
                shaper,
                font_stacks,
                font_bindings,
                edit,
                old_run,
                new_run,
                affected_shape_index,
                fallback,
            )? {
                push_fallback_span(
                    &mut self.pending_fallback_spans,
                    FallbackSpan {
                        text_end: new_run.text_end,
                        ..fallback
                    },
                )?;
                self.boundary_shape_scratch.clear();
                // None selects the full cluster/RunLocal/layout preparation;
                // this first candidate credits only full-run HarfRust work.
                self.incremental_shape_source_run = None;
                self.incremental_shape_source_runs.clear();
                self.incremental_shape_replaced = None;
                return Ok(true);
            }
            set_whole_shape_window(
                &mut self.shape_window_scratch,
                affected_shape,
                old_run,
                new_run,
            )?;
        }
        let mut verify_boundaries = sparse_scope;
        loop {
            match self.prepare_incremental_shape_scope(
                shaper,
                old_run_index,
                old_run,
                new_run,
                affected_shape_index,
                affected_shape,
                fallback,
                verify_boundaries,
            )? {
                ShapeAttempt::Prepared => break,
                ShapeAttempt::RetryWholeRun if verify_boundaries => {
                    set_whole_shape_window(
                        &mut self.shape_window_scratch,
                        affected_shape,
                        old_run,
                        new_run,
                    )?;
                    verify_boundaries = false;
                }
                ShapeAttempt::RetryWholeRun | ShapeAttempt::NeedsFallback => return Ok(false),
            }
        }
        for span in self.fallback_spans.iter().copied() {
            let (text_start, text_end) = if span.source_run == affected_source_run {
                (new_run.text_start, new_run.text_end)
            } else if span.source_run > affected_source_run {
                let delta = edit_delta(edit)?;
                (
                    shifted_text_offset(span.text_start, delta)?,
                    shifted_text_offset(span.text_end, delta)?,
                )
            } else {
                (
                    map_old_offset(span.text_start, edit)?,
                    map_old_offset(span.text_end, edit)?,
                )
            };
            self.pending_fallback_spans.push(FallbackSpan {
                text_start,
                text_end,
                ..span
            });
        }
        self.boundary_shape_scratch.clear();
        self.incremental_shape_source_run = Some(affected_source_run);
        // The existing sparse/whole-window producer remains authoritative but
        // does not mint this optional registration certificate.
        self.pending_shape_font_instance = None;
        Ok(true)
    }

    /// The source run each edit lies in, ascending and deduplicated, when every edit lies
    /// in one run and they span at least two.
    pub(super) fn edited_source_runs(&self) -> Result<Option<Vec<u32>>, EngineError> {
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.active().runs();
        let mut edited: Vec<u32> = Vec::new();
        edited
            .try_reserve(self.text_edit_parts.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for edit in self.text_edit_parts.iter().copied() {
            let Some(run) = edit_run(old_runs, new_runs, edit) else {
                return Ok(None);
            };
            let run = u32::try_from(run).map_err(|_| EngineError::ResultTooLarge)?;
            match edited.last() {
                Some(last) if *last == run => {}
                Some(last) if *last > run => return Ok(None),
                _ => edited.push(run),
            }
        }
        Ok((edited.len() >= 2).then_some(edited))
    }

    /// How far each run moved in text, when every run keeps its shaping properties and moves
    /// by the edited runs before it, and only an edited run changes length.
    pub(super) fn kept_run_shifts(&self, edited: &[u32]) -> Result<Option<Vec<i64>>, EngineError> {
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.active().runs();
        let languages = self
            .style_invalidation
            .shaping
            .then_some((&self.styles.committed().arena, &self.styles.active().arena));
        let mut shifts: Vec<i64> = Vec::new();
        shifts
            .try_reserve(old_runs.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        let mut delta = 0_i64;
        for (index, (&old, &new)) in old_runs.iter().zip(new_runs).enumerate() {
            let grown = i64::from(new.text_end)
                - i64::from(new.text_start)
                - (i64::from(old.text_end) - i64::from(old.text_start));
            if !same_shaping_properties(old, new)
                || languages.is_some_and(|(previous, next)| {
                    previous.resolved_language(old.style) != next.resolved_language(new.style)
                        || previous.resolved_features(old.style)
                            != next.resolved_features(new.style)
                })
                || i64::from(new.text_start) != i64::from(old.text_start) + delta
                || (grown != 0 && edited.binary_search(&(index as u32)).is_err())
            {
                return Ok(None);
            }
            shifts.push(delta);
            delta += grown;
        }
        Ok(Some(shifts))
    }

    /// Whether each edited run had one first-font fallback span covering it and one shaped run.
    pub(super) fn edited_runs_have_one_first_font_run(&self, edited: &[u32]) -> bool {
        let old_runs = self.shaping_runs.committed().runs();
        edited.iter().copied().all(|run| {
            let old = old_runs[run as usize];
            let mut spans = self
                .fallback_spans
                .iter()
                .filter(|span| span.source_run == run);
            let (Some(span), None) = (spans.next(), spans.next()) else {
                return false;
            };
            span.font_index == 0
                && span.text_start == old.text_start
                && span.text_end == old.text_end
                && self
                    .shape
                    .committed()
                    .runs
                    .iter()
                    .filter(|shaped| shaped.source_run == run)
                    .count()
                    == 1
        })
    }

    /// The fallback spans of this shape: an edited run's covers the run, every other moves
    /// with its run.
    pub(super) fn move_fallback_spans(
        &mut self,
        edited: &[u32],
        shifts: &[i64],
    ) -> Result<(), EngineError> {
        self.pending_fallback_spans.clear();
        for span in self.fallback_spans.iter().copied() {
            let shift = *shifts
                .get(span.source_run as usize)
                .ok_or(EngineError::InvalidRequest)?;
            let (text_start, text_end) = if edited.binary_search(&span.source_run).is_ok() {
                let run = self.shaping_runs.active().runs()[span.source_run as usize];
                (run.text_start, run.text_end)
            } else {
                (
                    shifted_text_offset(span.text_start, shift)?,
                    shifted_text_offset(span.text_end, shift)?,
                )
            };
            self.pending_fallback_spans.push(FallbackSpan {
                text_start,
                text_end,
                ..span
            });
        }
        Ok(())
    }

    /// Shapes `run` whole with one font into the boundary scratch and appends it to the
    /// pending shape as source run `source`. `false`, with the scratch holding the attempt,
    /// when a glyph is missing: the run needs a fallback font and the full shape decides it.
    pub(super) fn reshape_run_whole(
        &mut self,
        shaper: &mut ShaperRegistry,
        run: ShapingRun,
        source: usize,
        font_handle: u32,
        binding_handle: u32,
    ) -> Result<bool, EngineError> {
        self.boundary_shape_scratch.clear();
        let scratch = &mut self.boundary_shape_scratch;
        let styles = &self.styles.active().arena;
        shaper
            .with_shaped_range(
                font_handle,
                &self.text.pending().units,
                ShapeRunRef {
                    text_start: run.text_start,
                    text_end: run.text_end,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                ShapeRangeRef {
                    item_start: run.text_start,
                    item_end: run.text_end,
                    context_start: run.text_start,
                    context_end: run.text_end,
                    flags: 0x40,
                },
                |shaped| {
                    scratch.append(
                        source,
                        font_handle,
                        binding_handle,
                        run.text_start,
                        run.text_end,
                        shaped,
                    )
                },
            )
            .map_err(shaper_error)?;
        if self.boundary_shape_scratch.glyph_ids.contains(&0) {
            return Ok(false);
        }
        let source_run = u32::try_from(source).map_err(|_| EngineError::ResultTooLarge)?;
        let scratch = &self.boundary_shape_scratch;
        self.shape.pending_mut().append_text_range_from(
            scratch,
            0,
            source_run,
            run.text_start,
            run.text_end,
            0,
        )?;
        Ok(true)
    }

    /// Edits in several source runs: each edited run is reshaped whole, one shaping call per
    /// run, and every other run keeps its glyphs, moved by the edited runs before it. Only runs
    /// whose topology the edits kept, with one first-font fallback span and one shaped run
    /// each, qualify; a run that needs a fallback font declines the whole request.
    pub(super) fn try_prepare_multi_run_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
    ) -> Result<bool, EngineError> {
        let old_runs = self.shaping_runs.committed().runs();
        let new_runs = self.shaping_runs.active().runs();
        if self.text_edit_parts.len() < 2 || old_runs.len() != new_runs.len() || old_runs.is_empty()
        {
            return Ok(false);
        }
        let Some(edited) = self.edited_source_runs()? else {
            return Ok(false);
        };
        let Some(shifts) = self.kept_run_shifts(&edited)? else {
            return Ok(false);
        };
        if !self.edited_runs_have_one_first_font_run(&edited) {
            return Ok(false);
        }

        self.shape.pending_mut().clear();
        let shape_runs = self.shape.committed().runs.len();
        for shape_index in 0..shape_runs {
            let shaped_run = self.shape.committed().runs[shape_index];
            let source = shaped_run.source_run;
            if edited.binary_search(&source).is_err() {
                let shift = *shifts
                    .get(source as usize)
                    .ok_or(EngineError::InvalidRequest)?;
                let (pending, committed) = self.shape.derive_mut();
                pending.append_text_range_from(
                    committed,
                    shape_index,
                    source,
                    shaped_run.text_start,
                    shaped_run.text_end,
                    shift,
                )?;
                continue;
            }
            let new_run = self.shaping_runs.active().runs()[source as usize];
            let Some(fallback) = self
                .fallback_spans
                .iter()
                .copied()
                .find(|span| span.source_run == source)
            else {
                return Ok(false);
            };
            if !self.reshape_run_whole(
                shaper,
                new_run,
                source as usize,
                fallback.font_handle,
                fallback.binding_handle,
            )? {
                self.shape.pending_mut().clear();
                self.boundary_shape_scratch.clear();
                return Ok(false);
            }
        }
        self.boundary_shape_scratch.clear();
        self.move_fallback_spans(&edited, &shifts)?;
        self.incremental_shape_source_run = None;
        self.incremental_shape_source_runs = edited;
        self.pending_shape_font_instance = None;
        Ok(true)
    }

    pub(super) fn discard_shape_candidate(&mut self) {
        self.shape.pending_mut().clear();
        self.pending_shape_font_instance = None;
        self.shape_window_scratch.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.incremental_shape_source_run = None;
        self.incremental_shape_source_runs.clear();
        self.incremental_shape_replaced = None;
        self.shape.discard_candidate();
    }

    pub(super) fn commit_shape(&mut self) {
        if self.shape.is_prepared() {
            self.shape.commit();
            core::mem::swap(&mut self.fallback_spans, &mut self.pending_fallback_spans);
            self.accepted_shape_font_instance = self.pending_shape_font_instance.take();
        }
        self.discard_shape_candidate();
    }
}

pub(super) fn same_shaping_properties(left: ShapingRun, right: ShapingRun) -> bool {
    left.script == right.script
        && left.direction == right.direction
        && left.bidi_level == right.bidi_level
        && left.style.same_layout_sources(right.style)
}

/// The run that holds an edit in both texts, at one index. The side whose range is not empty
/// names it: inserted units belong to the run they landed in, removed units to the run they
/// left, even at a run's first or last unit. The other side must hold the edit at that index,
/// an empty range at either end of the run included.
pub(super) fn edit_run(
    old_runs: &[ShapingRun],
    new_runs: &[ShapingRun],
    edit: TextEdit,
) -> Option<usize> {
    let holds = |runs: &[ShapingRun], index: usize, start: usize, end: usize| {
        runs.get(index)
            .is_some_and(|run| (run.text_start as usize) <= start && end <= run.text_end as usize)
    };
    let index = if edit.new_end > edit.new_start {
        containing_run(new_runs, edit.new_start, edit.new_end)?
    } else {
        containing_run(old_runs, edit.old_start, edit.old_end)?
    };
    (holds(old_runs, index, edit.old_start, edit.old_end)
        && holds(new_runs, index, edit.new_start, edit.new_end))
    .then_some(index)
}

pub(super) fn containing_run(runs: &[ShapingRun], start: usize, end: usize) -> Option<usize> {
    let start = u32::try_from(start).ok()?;
    let end = u32::try_from(end).ok()?;
    runs.iter().position(|run| {
        run.text_start <= start && end <= run.text_end && run.text_start < run.text_end
    })
}

pub(super) fn edit_delta(edit: TextEdit) -> Result<i64, EngineError> {
    i64::try_from(edit.new_end)
        .and_then(|new_end| i64::try_from(edit.old_end).map(|old_end| new_end - old_end))
        .map_err(|_| EngineError::ResultTooLarge)
}

pub(super) fn map_old_offset(offset: u32, edit: TextEdit) -> Result<u32, EngineError> {
    let old_start = u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
    let old_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
    if offset <= old_start {
        Ok(offset)
    } else if offset >= old_end {
        shifted_text_offset(offset, edit_delta(edit)?)
    } else {
        Err(EngineError::InvalidRequest)
    }
}

pub(super) fn same_edit_run_topology(
    old_runs: &[ShapingRun],
    new_runs: &[ShapingRun],
    edit: TextEdit,
    affected: usize,
    styles: Option<(&StyleArena, &StyleArena)>,
) -> Result<bool, EngineError> {
    for (index, (&old, &new)) in old_runs.iter().zip(new_runs).enumerate() {
        if !same_shaping_properties(old, new)
            || styles.is_some_and(|(previous, next)| {
                previous.resolved_language(old.style) != next.resolved_language(new.style)
                    || previous.resolved_features(old.style) != next.resolved_features(new.style)
            })
        {
            return Ok(false);
        }
        // Runs after the affected one move by the whole edit, even from an insertion point
        // on their first unit: the inserted units belong to the affected run before them.
        let (expected_start, expected_end) = if index > affected {
            let delta = edit_delta(edit)?;
            (
                shifted_text_offset(old.text_start, delta),
                shifted_text_offset(old.text_end, delta),
            )
        } else {
            (
                map_old_offset(old.text_start, edit),
                map_old_offset(old.text_end, edit),
            )
        };
        if index == affected {
            let delta = edit_delta(edit)?;
            let old_start =
                u32::try_from(edit.old_start).map_err(|_| EngineError::ResultTooLarge)?;
            let old_end = u32::try_from(edit.old_end).map_err(|_| EngineError::ResultTooLarge)?;
            let start = if old.text_start <= old_start {
                old.text_start
            } else {
                shifted_text_offset(old.text_start, delta)?
            };
            let end = if old.text_end >= old_end {
                shifted_text_offset(old.text_end, delta)?
            } else {
                old.text_end
            };
            if new.text_start != start || new.text_end != end {
                return Ok(false);
            }
        } else if expected_start.ok() != Some(new.text_start)
            || expected_end.ok() != Some(new.text_end)
        {
            return Ok(false);
        }
    }
    Ok(true)
}

pub(super) fn shifted_text_offset(value: u32, delta: i64) -> Result<u32, EngineError> {
    let shifted = i64::from(value)
        .checked_add(delta)
        .ok_or(EngineError::ResultTooLarge)?;
    u32::try_from(shifted).map_err(|_| EngineError::ResultTooLarge)
}

pub(super) fn push_fallback_span(
    spans: &mut Vec<FallbackSpan>,
    span: FallbackSpan,
) -> Result<(), EngineError> {
    if let Some(previous) = spans.last_mut()
        && previous.source_run == span.source_run
        && previous.text_end == span.text_start
        && previous.font_index == span.font_index
        && previous.binding_handle == span.binding_handle
        && previous.font_handle == span.font_handle
    {
        previous.text_end = span.text_end;
        return Ok(());
    }
    spans
        .try_reserve(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    spans.push(span);
    Ok(())
}

/// One span per shaping run, in the first font of its stack. Returns the deepest stack.
fn seed_fallback_spans(
    spans: &mut Vec<FallbackSpan>,
    runs: &[ShapingRun],
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
) -> Result<usize, EngineError> {
    let mut max_stack_depth = 0usize;
    for (index, run) in runs.iter().copied().enumerate() {
        let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
        let binding_handle = *stack.fonts.first().ok_or(EngineError::FontStackMissing)?;
        let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
        max_stack_depth = max_stack_depth.max(stack.fonts.len());
        push_fallback_span(
            spans,
            FallbackSpan {
                source_run: u32::try_from(index).map_err(|_| EngineError::ResultTooLarge)?,
                text_start: run.text_start,
                text_end: run.text_end,
                font_index: 0,
                binding_handle,
                font_handle,
            },
        )?;
    }
    Ok(max_stack_depth)
}

/// Shapes every span with its font into a cleared `output`.
fn shape_fallback_spans(
    shaper: &mut ShaperRegistry,
    output: &mut ShapeArena,
    spans: &[FallbackSpan],
    text: &[u16],
    styles: &crate::engine::style_state::StyleArena,
    runs: &[ShapingRun],
) -> Result<(), EngineError> {
    output.clear();
    for span in spans.iter().copied() {
        let source_index =
            usize::try_from(span.source_run).map_err(|_| EngineError::InvalidRequest)?;
        let run = *runs.get(source_index).ok_or(EngineError::InvalidRequest)?;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.main_full_run_shape_calls += 1;
            work.main_full_run_shape_utf16_units +=
                span.text_end.saturating_sub(span.text_start) as usize;
        });
        shaper
            .with_shaped_run(
                span.font_handle,
                text,
                ShapeRunRef {
                    text_start: span.text_start,
                    text_end: span.text_end,
                    script: run.script,
                    language: styles.resolved_language(run.style),
                    features: styles.resolved_features(run.style),
                    direction: run.direction,
                    cluster_level: 0,
                    flags: 0x40,
                },
                |shaped| {
                    output.append(
                        source_index,
                        span.font_handle,
                        span.binding_handle,
                        span.text_start,
                        span.text_end,
                        shaped,
                    )
                },
            )
            .map_err(shaper_error)?;
    }
    Ok(())
}

/// Splits every span at its missing clusters, handing those to the next font of the span's
/// stack, into `next`. Returns whether any cluster moved to a next font.
fn split_missing_clusters(
    spans: &[FallbackSpan],
    records: &[ClusterRecord],
    runs: &[ShapingRun],
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    next: &mut Vec<FallbackSpan>,
) -> Result<bool, EngineError> {
    let mut changed = false;
    let mut cluster_index = 0usize;
    for span in spans.iter().copied() {
        while records.get(cluster_index).is_some_and(|record| {
            record.source_run < span.source_run
                || (record.source_run == span.source_run && record.cluster < span.text_start)
        }) {
            cluster_index += 1;
        }
        changed |= split_span_at_missing_clusters(
            span,
            &records[cluster_index..],
            runs,
            font_stacks,
            font_bindings,
            next,
        )?;
    }
    Ok(changed)
}

/// Splits one span at the missing clusters among `records` (which start at the span's first
/// cluster). Returns whether any cluster moved to the next font.
fn split_span_at_missing_clusters(
    span: FallbackSpan,
    records: &[ClusterRecord],
    runs: &[ShapingRun],
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    next: &mut Vec<FallbackSpan>,
) -> Result<bool, EngineError> {
    let stack_handle = runs
        .get(span.source_run as usize)
        .ok_or(EngineError::InvalidRequest)?
        .style
        .font_stack_handle;
    let stack = find_font_stack(font_stacks, stack_handle)?;
    let next_font_index = span.font_index.checked_add(1);
    let next_binding =
        next_font_index.and_then(|index| stack.fonts.get(usize::from(index)).copied());
    let mut changed = false;
    let mut cursor = span.text_start;
    for (record_index, record) in records.iter().copied().enumerate() {
        if record.source_run != span.source_run || record.cluster >= span.text_end {
            break;
        }
        let (true, Some(font_index), Some(binding_handle)) =
            (record.missing, next_font_index, next_binding)
        else {
            continue;
        };
        let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
        let cluster_start = record.cluster.max(cursor);
        let cluster_end = records
            .get(record_index + 1)
            .filter(|next| next.source_run == span.source_run)
            .map_or_else(
                || {
                    runs.get(span.source_run as usize)
                        .map_or(span.text_end, |run| run.text_end)
                },
                |next| next.cluster,
            )
            .min(span.text_end);
        if cursor < cluster_start {
            push_fallback_span(
                next,
                FallbackSpan {
                    text_start: cursor,
                    text_end: cluster_start,
                    ..span
                },
            )?;
        }
        if cluster_start < cluster_end {
            push_fallback_span(
                next,
                FallbackSpan {
                    text_start: cluster_start,
                    text_end: cluster_end,
                    font_index,
                    binding_handle,
                    font_handle,
                    ..span
                },
            )?;
            cursor = cluster_end;
            changed = true;
        }
    }
    if cursor < span.text_end || span.text_start == span.text_end {
        push_fallback_span(
            next,
            FallbackSpan {
                text_start: cursor,
                ..span
            },
        )?;
    }
    Ok(changed)
}

/// The font of a shape that is one run shaped whole in its first font, whose instance the
/// committed shape can then be keyed by.
fn whole_run_font_handle(
    runs: &[ShapingRun],
    shape: &ShapeArena,
    spans: &[FallbackSpan],
) -> Option<u32> {
    let [span] = spans else {
        return None;
    };
    (runs.len() == 1
        && shape.runs.len() == 1
        && span.source_run == 0
        && span.text_start == 0
        && span.text_end == runs[0].text_end
        && span.font_index == 0)
        .then_some(span.font_handle)
}
