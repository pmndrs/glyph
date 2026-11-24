//! Incremental shaping that realigns an edited window: the general and ASCII-anchor variants.

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
        self.pending_shape_font_instance = None;
        Ok(true)
    }

    /// Optional producer replacement. Any uncertainty or tentative error
    /// restores the ordinary whole-run path's authority and error precedence.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn try_prepare_ascii_anchor_shape(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        edit: TextEdit,
        old_run: ShapingRun,
        new_run: ShapingRun,
        old_shape_index: usize,
        fallback: FallbackSpan,
    ) -> Result<bool, EngineError> {
        use crate::ascii_anchor_policy::{self as policy, AsciiUse};
        #[cfg(test)]
        if self.disable_ascii_anchor {
            return Ok(false);
        }
        if self.text_edits.len() != 1
            || edit.old_end - edit.old_start == edit.new_end - edit.new_start
            || old_shape_index != 0
            || self.shape.committed().runs.len() != 1
            || self.shaping_runs.committed().runs().len() != 1
            || self.shaping_runs.active().runs().len() != 1
            || old_run.text_start != 0
            || new_run.text_start != 0
            || usize::try_from(old_run.text_end).ok() != Some(self.text.committed().units.len())
            || usize::try_from(new_run.text_end).ok() != Some(self.text.active().units.len())
            || old_run.script != u32::from_be_bytes(*b"Latn")
            || new_run.script != old_run.script
            || old_run.direction != 0
            || new_run.direction != 0
            || fallback.source_run != 0
            || fallback.font_index != 0
            || fallback.text_start != 0
            || fallback.text_end != old_run.text_end
            || self.shape.committed().runs[0].glyph_start != 0
            || usize::try_from(self.shape.committed().runs[0].glyph_count).ok()
                != Some(self.shape.committed().glyph_ids.len())
            || self.accepted_shape_font_instance.is_none()
            || self.accepted_shape_font_instance != shaper.font_instance(fallback.font_handle)
        {
            return Ok(false);
        }
        // This optional route never changes error precedence: an unavailable
        // stack/binding simply falls through to the existing full producer.
        let Some(stack) = find_font_stack(font_stacks, new_run.style.font_stack_handle).ok() else {
            return Ok(false);
        };
        if stack.fonts.as_slice() != [fallback.binding_handle]
            || find_font_binding(font_bindings, fallback.binding_handle)
                .ok()
                .is_none_or(|binding| binding.shaping_handle != fallback.font_handle)
        {
            return Ok(false);
        }
        let old_styles = &self.styles.committed().arena;
        let new_styles = &self.styles.active().arena;
        if old_styles.resolved_language(old_run.style).is_some()
            || new_styles.resolved_language(new_run.style).is_some()
            || !old_styles.resolved_features(old_run.style).is_empty()
            || !new_styles.resolved_features(new_run.style).is_empty()
        {
            return Ok(false);
        }
        let old_use = AsciiUse::from_analysis(self.unicode.committed().printable_ascii_facts());
        let current_facts = self
            .pending_reused_ascii_facts
            .unwrap_or_else(|| self.unicode.active().printable_ascii_facts());
        let new_use = AsciiUse::from_analysis(current_facts);
        let (Some(old_use), Some(new_use)) = (old_use, new_use) else {
            return Ok(false);
        };
        if self.text.committed().units.len() > policy::WHOLE_UNITS_MAX
            || self.text.active().units.len() > policy::WHOLE_UNITS_MAX
        {
            return Ok(false);
        }
        let window = {
            let Ok(screen) = shaper.ascii_anchor_screen(fallback.font_handle) else {
                return Ok(false);
            };
            let Ok(window) = policy::fixed_window(
                screen,
                &self.text.committed().units,
                &self.text.active().units,
                edit.old_start,
                edit.old_end,
                edit.new_end,
                &old_use,
                &new_use,
            ) else {
                return Ok(false);
            };
            window
        };
        self.boundary_shape_scratch.clear();
        let styles = &self.styles.active().arena;
        let new_text = self.text.active().units.as_slice();
        let outer_start =
            u32::try_from(window.new_outer_left).map_err(|_| EngineError::ResultTooLarge)?;
        let outer_end =
            u32::try_from(window.new_outer_end).map_err(|_| EngineError::ResultTooLarge)?;
        #[cfg(test)]
        let before_item = crate::engine::work_attribution::snapshot();
        let shaped = shaper.with_shaped_range(
            fallback.font_handle,
            new_text,
            ShapeRunRef {
                text_start: 0,
                text_end: new_run.text_end,
                script: new_run.script,
                language: styles.resolved_language(new_run.style),
                features: styles.resolved_features(new_run.style),
                direction: 0,
                cluster_level: 0,
                flags: 0x40,
            },
            ShapeRangeRef {
                item_start: outer_start,
                item_end: outer_end,
                context_start: 0,
                context_end: new_run.text_end,
                flags: 0x40,
            },
            |glyphs| {
                self.boundary_shape_scratch.append(
                    0,
                    fallback.font_handle,
                    fallback.binding_handle,
                    outer_start,
                    outer_end,
                    glyphs,
                )
            },
        );
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.ascii_anchor_item_calls += work
                .harfrust_calls
                .saturating_sub(before_item.harfrust_calls);
            work.ascii_anchor_item_utf16_units += work
                .harfrust_utf16_units
                .saturating_sub(before_item.harfrust_utf16_units);
        });
        if shaped.is_err() || self.boundary_shape_scratch.glyph_ids.contains(&0) {
            self.boundary_shape_scratch.clear();
            return Ok(false);
        }
        let old = self.shape.committed();
        let fresh = &self.boundary_shape_scratch;
        let old_left = old.clusters.partition_point(|&cluster| {
            usize::try_from(cluster)
                .ok()
                .is_some_and(|cluster| cluster < window.old_inner_left)
        });
        let old_right = old.clusters.partition_point(|&cluster| {
            usize::try_from(cluster)
                .ok()
                .is_some_and(|cluster| cluster <= window.old_inner_right)
        });
        let new_left = fresh.clusters.partition_point(|&cluster| {
            usize::try_from(cluster)
                .ok()
                .is_some_and(|cluster| cluster < window.new_inner_left)
        });
        let new_right = fresh.clusters.partition_point(|&cluster| {
            usize::try_from(cluster)
                .ok()
                .is_some_and(|cluster| cluster <= window.new_inner_right)
        });
        if old.clusters.get(old_left).copied() != u32::try_from(window.old_inner_left).ok()
            || old_right
                .checked_sub(1)
                .and_then(|index| old.clusters.get(index).copied())
                != u32::try_from(window.old_inner_right).ok()
            || fresh.clusters.get(new_left).copied() != u32::try_from(window.new_inner_left).ok()
            || new_right
                .checked_sub(1)
                .and_then(|index| fresh.clusters.get(index).copied())
                != u32::try_from(window.new_inner_right).ok()
        {
            self.boundary_shape_scratch.clear();
            return Ok(false);
        }
        self.shape.pending_mut().clear();
        let old_left_unit =
            u32::try_from(window.old_inner_left).map_err(|_| EngineError::ResultTooLarge)?;
        let old_after_right =
            u32::try_from(window.old_inner_right + 1).map_err(|_| EngineError::ResultTooLarge)?;
        let new_left_unit =
            u32::try_from(window.new_inner_left).map_err(|_| EngineError::ResultTooLarge)?;
        let new_after_right =
            u32::try_from(window.new_inner_right + 1).map_err(|_| EngineError::ResultTooLarge)?;
        let delta = i64::from(new_run.text_end) - i64::from(old_run.text_end);
        let assembled = (|| -> Result<(), EngineError> {
            let (pending, committed) = self.shape.derive_mut();
            pending.append_glyph_range_from(committed, 0, 0, 0, old_left_unit, 0, old_left, 0)?;
            pending.append_glyph_range_from(
                fresh,
                0,
                0,
                new_left_unit,
                new_after_right,
                new_left,
                new_right,
                0,
            )?;
            pending.append_glyph_range_from(
                committed,
                0,
                0,
                old_after_right,
                old_run.text_end,
                old_right,
                committed.glyph_ids.len(),
                delta,
            )?;
            pending.collapse_appended_runs(0, 0, new_run.text_end)
        })();
        if assembled.is_err() {
            self.shape.pending_mut().clear();
            self.boundary_shape_scratch.clear();
            return Ok(false);
        }
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.ascii_anchor_splice_successes += 1);
        self.pending_shape_font_instance = shaper.font_instance(fallback.font_handle);
        Ok(true)
    }
}
