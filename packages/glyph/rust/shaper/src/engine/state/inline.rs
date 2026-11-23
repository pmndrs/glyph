//! The inline fast path: a single-line paragraph prepared without the general stage pipeline.

use super::*;

impl ParagraphState {
    pub(super) fn bind_inline_placement_handles(
        &mut self,
        handles: &[crate::engine::placement_slot_arena::PlacementHandle],
    ) -> Result<(), EngineError> {
        let PreparedLayout::Inline(leaf) = self.prepared_layout.active_mut() else {
            return Err(EngineError::InvalidRequest);
        };
        if handles.len() != leaf.placement.segment_rows().len()
            || leaf.placement.instance_count()? != leaf.outlined_count()
        {
            return Err(EngineError::InvalidRequest);
        }
        for (index, handle) in handles.iter().copied().enumerate() {
            leaf.placement.set_placement_handle(index, Some(handle));
        }
        Ok(())
    }

    /// A single source run and font can write the final local rows directly. A failed
    /// one-line fit transfers that same raw shape to General instead of shaping twice.
    pub(super) fn try_prepare_inline(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
        limits: crate::engine::frame::UpdateLimits,
        next_glyph_id: &mut u32,
    ) -> Result<InlineAttempt, EngineError> {
        #[cfg(test)]
        if self.disable_inline {
            return Ok(InlineAttempt::Skipped);
        }
        if geometry.is_empty()
            && self.committed_inline().is_some()
            && !self.text.is_prepared()
            && !self.unicode.is_prepared()
            && !self.bidi.is_prepared()
            && !self.shaping_runs.is_prepared()
            && !self.geometry.is_prepared()
            && !self.style_invalidation.bidi
            && !self.style_invalidation.shaping
            && !self.style_invalidation.metrics
            && !self.style_invalidation.cluster_mapping
            && !self.style_invalidation.positioning
        {
            return Ok(InlineAttempt::Unchanged);
        }
        let text = self.text.active().units.as_slice();
        let runs = self.shaping_runs.active().runs();
        if text.is_empty()
            || text.len() > crate::engine::cluster_state::LAYOUT_CHUNK
            || runs.len() != 1
            || runs[0].text_start != 0
            || usize::try_from(runs[0].text_end).ok() != Some(text.len())
            || runs[0].direction != 0
            || runs[0].bidi_level != 0
            || (self.committed_inline().is_none() && !self.clusters.committed().starts.is_empty())
        {
            self.stage_general_owner_after_inline();
            return Ok(InlineAttempt::Skipped);
        }
        let run = runs[0];
        let stack = find_font_stack(font_stacks, run.style.font_stack_handle)?;
        if stack.fonts.len() != 1 {
            self.stage_general_owner_after_inline();
            return Ok(InlineAttempt::Skipped);
        }
        let reuse_shape = self.committed_inline().is_some()
            && !self.text.is_prepared()
            && !self.style_invalidation.shaping
            && !self.bidi.is_prepared()
            && (!self.shaping_runs.is_prepared()
                || shaping_run_topology_stable(self.shaping_runs.committed().runs(), runs));
        let (binding_handle, font_handle) = if reuse_shape {
            let old = self
                .committed_inline()
                .and_then(|leaf| leaf.shape.run())
                .ok_or(EngineError::InvalidRequest)?;
            (old.binding_handle, old.font_handle)
        } else {
            let binding_handle = stack.fonts[0];
            (
                binding_handle,
                find_font_binding(font_bindings, binding_handle)?.shaping_handle,
            )
        };
        let old_inline = self.committed_inline().is_some();
        self.shape.pending_mut().clear();
        self.shape_window_scratch.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.incremental_shape_source_run = None;
        self.incremental_shape_source_runs.clear();
        self.incremental_shape_replaced = None;
        self.shape.discard_candidate();
        let (candidate, previous_layout) = self.prepared_layout.derive_mut();
        if !matches!(candidate, PreparedLayout::Inline(_)) {
            *candidate = PreparedLayout::Inline(InlineLeaf::default());
        }
        let PreparedLayout::Inline(leaf) = candidate else {
            unreachable!()
        };
        leaf.clear();
        let captured = if reuse_shape {
            let PreparedLayout::Inline(old) = previous_layout else {
                return Err(EngineError::InvalidRequest);
            };
            leaf.shape.copy_from(&old.shape)?;
            true
        } else {
            let styles = &self.styles.active().arena;
            shaper
                .with_shaped_run(
                    font_handle,
                    text,
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
                    |shaped| {
                        if leaf.shape.capture_into(
                            0,
                            binding_handle,
                            font_handle,
                            run.text_start,
                            run.text_end,
                            shaped,
                        )? {
                            Ok(true)
                        } else {
                            self.shape.pending_mut().append(
                                0,
                                font_handle,
                                binding_handle,
                                run.text_start,
                                run.text_end,
                                shaped,
                            )?;
                            Ok(false)
                        }
                    },
                )
                .map_err(shaper_error)?
        };
        if !captured {
            push_fallback_span(
                &mut self.pending_fallback_spans,
                FallbackSpan {
                    source_run: 0,
                    text_start: run.text_start,
                    text_end: run.text_end,
                    font_index: 0,
                    binding_handle,
                    font_handle,
                },
            )?;
            self.shape.mark_prepared();
            *candidate = PreparedLayout::General;
            if old_inline {
                self.prepared_layout.mark_prepared();
            }
            return Ok(InlineAttempt::GeneralShape);
        }
        let styles = self.styles.active().resolved.segments();
        let eligible = leaf.build_clusters(
            text,
            &self.text.active().unit_ids,
            self.unicode.active(),
            styles,
            |handle| shaper.font_metrics(handle),
        )?;
        if eligible {
            let mut candidate_next_glyph_id = *next_glyph_id;
            let ids = match previous_layout {
                PreparedLayout::Inline(old) => leaf.assign_glyph_ids(
                    old,
                    &mut self.glyph_identity_index,
                    &mut candidate_next_glyph_id,
                )?,
                PreparedLayout::General => leaf.assign_glyph_ids(
                    self.clusters.committed(),
                    &mut self.glyph_identity_index,
                    &mut candidate_next_glyph_id,
                )?,
            };
            leaf.build_numeric_rows(&ids, styles, run.bidi_level, |handle, glyph| {
                shaper.font_glyph_extents(handle, glyph)
            })?;
            let current = RunCanonicalInput {
                text,
                text_unit_ids: &self.text.active().unit_ids,
                style_arena: &self.styles.active().arena,
                styles,
                shaping_runs: runs,
            };
            let committed = RunCanonicalInput {
                text: &self.text.committed().units,
                text_unit_ids: &self.text.committed().unit_ids,
                style_arena: &self.styles.committed().arena,
                styles: self.styles.committed().resolved.segments(),
                shaping_runs: self.shaping_runs.committed().runs(),
            };
            let mut revision = self.next_run_canonical_revision;
            match previous_layout {
                PreparedLayout::Inline(old) => leaf.finalize_revision(
                    old,
                    current,
                    committed,
                    &mut self.layout_run_identity_index,
                    &mut revision,
                )?,
                PreparedLayout::General => leaf.finalize_revision(
                    self.clusters.committed(),
                    current,
                    committed,
                    &mut self.layout_run_identity_index,
                    &mut revision,
                )?,
            }
            Self::prepare_geometry_stage(&mut self.geometry, geometry)?;
            let fit = leaf.build_one_line_flow(
                self.geometry.active(),
                styles,
                &mut self.flow_slot_scratch,
                limits,
                |handle| shaper.font_metrics(handle),
                |handle| {
                    find_font_stack(font_stacks, handle)
                        .ok()
                        .and_then(|stack| stack.fonts.first().copied())
                        .and_then(|binding| find_font_binding(font_bindings, binding).ok())
                        .map(|binding| binding.shaping_handle)
                },
            );
            if matches!(fit, Ok(true))
                && leaf
                    .build_one_line_placement(self.geometry.active())
                    .is_ok()
            {
                *next_glyph_id = candidate_next_glyph_id;
                self.pending_source_run_canonical_revision = revision;
                self.pending_next_run_canonical_revision = revision;
                self.prepared_layout.mark_prepared();
                self.intrinsic_widths_cache = None;
                return Ok(InlineAttempt::Prepared);
            }
        }
        // Fit errors from the speculative leaf are attributed by General's normal pipeline.
        leaf.shape.materialize_general(self.shape.pending_mut())?;
        push_fallback_span(
            &mut self.pending_fallback_spans,
            FallbackSpan {
                source_run: 0,
                text_start: run.text_start,
                text_end: run.text_end,
                font_index: 0,
                binding_handle,
                font_handle,
            },
        )?;
        self.shape.mark_prepared();
        *candidate = PreparedLayout::General;
        if old_inline {
            self.prepared_layout.mark_prepared();
        }
        Ok(InlineAttempt::GeneralShape)
    }

    pub(super) fn committed_inline(&self) -> Option<&InlineLeaf> {
        match self.prepared_layout.committed() {
            PreparedLayout::Inline(leaf) => Some(leaf),
            PreparedLayout::General => None,
        }
    }

    pub(super) fn stage_general_owner_after_inline(&mut self) {
        if self.committed_inline().is_some() {
            *self.prepared_layout.pending_mut() = PreparedLayout::General;
            self.prepared_layout.mark_prepared();
        }
    }
}
