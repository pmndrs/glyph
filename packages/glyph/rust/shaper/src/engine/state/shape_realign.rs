//! Incremental shaping after an edit that split or merged shaping runs.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl ParagraphState {
    /// An edit that split or merged shaping runs (a Latin letter typed between two Arabic
    /// words opens a run between the halves of one): the runs before the first that differs
    /// and after the last are kept, moved by the edit in text and in index, and the runs
    /// between them are reshaped whole with the first font of their stacks. A run that needs a
    /// fallback font declines to the full shape.
    pub(super) fn try_prepare_realigned_shape(
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
        if old_runs.is_empty() || new_runs.is_empty() || old_runs.len() == new_runs.len() {
            return Ok(false);
        }
        let delta = i64::try_from(self.text.active().units.len())
            .ok()
            .zip(i64::try_from(self.text.committed().units.len()).ok())
            .map(|(new, old)| new - old)
            .ok_or(EngineError::ResultTooLarge)?;
        let languages = self
            .style_invalidation
            .shaping
            .then_some((&self.styles.committed().arena, &self.styles.active().arena));
        let same = |old: ShapingRun, new: ShapingRun, shift: i64| {
            old.script == new.script
                && old.direction == new.direction
                && old.bidi_level == new.bidi_level
                && old.style == new.style
                && languages.is_none_or(|(previous, next)| {
                    previous.resolved_language(old.style) == next.resolved_language(new.style)
                        && previous.resolved_features(old.style)
                            == next.resolved_features(new.style)
                })
                && i64::from(old.text_start) + shift == i64::from(new.text_start)
                && i64::from(old.text_end) + shift == i64::from(new.text_end)
        };
        let shared = old_runs.len().min(new_runs.len());
        let kept_before = (0..shared)
            .take_while(|index| same(old_runs[*index], new_runs[*index], 0))
            .count();
        let kept_after = (0..shared - kept_before)
            .take_while(|offset| {
                same(
                    old_runs[old_runs.len() - 1 - offset],
                    new_runs[new_runs.len() - 1 - offset],
                    delta,
                )
            })
            .count();
        let old_middle = kept_before..old_runs.len() - kept_after;
        let new_middle = kept_before..new_runs.len() - kept_after;
        if old_middle.is_empty() || new_middle.is_empty() {
            return Ok(false);
        }
        // The edit lies in the replaced runs, in both texts.
        let old_text = old_runs[old_middle.start].text_start as usize
            ..old_runs[old_middle.end - 1].text_end as usize;
        let new_text = new_runs[new_middle.start].text_start as usize
            ..new_runs[new_middle.end - 1].text_end as usize;
        if edit.old_start < old_text.start
            || edit.old_end > old_text.end
            || edit.new_start < new_text.start
            || edit.new_end > new_text.end
        {
            return Ok(false);
        }
        let run_shift = new_runs.len() as i64 - old_runs.len() as i64;
        let to_u32 = |value: usize| u32::try_from(value).map_err(|_| EngineError::ResultTooLarge);
        let (old_first, old_last) = (to_u32(old_middle.start)?, to_u32(old_middle.end)?);

        self.shape.pending_mut().clear();
        let mut spans = core::mem::take(&mut self.pending_fallback_spans);
        spans.clear();
        let result = (|| -> Result<bool, EngineError> {
            // The kept runs before the edit, as they were.
            let committed_runs = self.shape.committed().runs.len();
            for shape_index in 0..committed_runs {
                let shaped_run = self.shape.committed().runs[shape_index];
                if shaped_run.source_run >= old_first {
                    continue;
                }
                let (pending, committed) = self.shape.derive_mut();
                pending.append_text_range_from(
                    committed,
                    shape_index,
                    shaped_run.source_run,
                    shaped_run.text_start,
                    shaped_run.text_end,
                    0,
                )?;
            }
            // The replaced runs, reshaped whole.
            for index in new_middle.clone() {
                let run = self.shaping_runs.active().runs()[index];
                let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
                let binding_handle = *stack.fonts.first().ok_or(EngineError::FontStackMissing)?;
                let font_handle = find_font_binding(font_bindings, binding_handle)?.shaping_handle;
                if !self.reshape_run_whole(shaper, run, index, font_handle, binding_handle)? {
                    return Ok(false);
                }
                let source_run = to_u32(index)?;
                spans
                    .try_reserve_cold(1)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                spans.push(FallbackSpan {
                    source_run,
                    text_start: run.text_start,
                    text_end: run.text_end,
                    font_index: 0,
                    binding_handle,
                    font_handle,
                });
            }
            // The kept runs after the edit, moved in text and in index.
            for shape_index in 0..committed_runs {
                let shaped_run = self.shape.committed().runs[shape_index];
                if shaped_run.source_run < old_last {
                    continue;
                }
                let source_run = u32::try_from(i64::from(shaped_run.source_run) + run_shift)
                    .map_err(|_| EngineError::ResultTooLarge)?;
                let (pending, committed) = self.shape.derive_mut();
                pending.append_text_range_from(
                    committed,
                    shape_index,
                    source_run,
                    shaped_run.text_start,
                    shaped_run.text_end,
                    delta,
                )?;
            }
            Ok(true)
        })();
        self.boundary_shape_scratch.clear();
        match result {
            Ok(true) => {}
            Ok(false) => {
                self.shape.pending_mut().clear();
                self.pending_fallback_spans = spans;
                self.pending_fallback_spans.clear();
                return Ok(false);
            }
            Err(error) => {
                self.shape.pending_mut().clear();
                self.pending_fallback_spans = spans;
                self.pending_fallback_spans.clear();
                return Err(error);
            }
        }
        // Fallback spans in run order: those before, the reshaped runs', those after, moved.
        let middle_spans = core::mem::take(&mut spans);
        spans
            .try_reserve_cold(self.fallback_spans.len() + middle_spans.len())
            .map_err(|_| EngineError::ResultTooLarge)?;
        for span in self.fallback_spans.iter().copied() {
            if span.source_run < old_first {
                spans.push(span);
            }
        }
        spans.extend_from_slice(&middle_spans);
        for span in self.fallback_spans.iter().copied() {
            if span.source_run >= old_last {
                spans.push(FallbackSpan {
                    source_run: u32::try_from(i64::from(span.source_run) + run_shift)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    text_start: shifted_text_offset(span.text_start, delta)?,
                    text_end: shifted_text_offset(span.text_end, delta)?,
                    ..span
                });
            }
        }
        self.pending_fallback_spans = spans;
        self.incremental_shape_source_run = None;
        self.incremental_shape_source_runs.clear();
        for index in new_middle.clone() {
            self.incremental_shape_source_runs.push(to_u32(index)?);
        }
        self.incremental_shape_replaced = Some((
            to_u32(new_middle.start)?..to_u32(new_middle.end)?,
            old_first..old_last,
        ));
        Ok(true)
    }
}
