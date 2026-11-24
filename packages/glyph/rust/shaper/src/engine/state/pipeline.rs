//! One paragraph's stage pipeline: reuse, staged preparation and the commit of every stage.

use crate::cold_growth::ColdGrowth as _;

use super::*;

/// Stage ownership once, reserving publication-frontier growth before semantic mutation.
/// Measurement commits append at most one unpublished identity per staged owner and never allocate.
pub(super) fn admit_preparation_owner(
    staged: &mut Vec<u32>,
    unpublished: &mut Vec<u32>,
    id: u32,
) -> Result<(), EngineError> {
    let Err(index) = staged.binary_search(&id) else {
        return Ok(());
    };
    let additional = staged
        .len()
        .checked_add(1)
        .ok_or(EngineError::ResultTooLarge)?;
    unpublished
        .try_reserve_cold(additional)
        .map_err(|_| EngineError::ResultTooLarge)?;
    staged
        .try_reserve_cold(1)
        .map_err(|_| EngineError::ResultTooLarge)?;
    staged.insert(index, id);
    Ok(())
}
impl RetainedParagraph {
    pub(super) fn acknowledge_committed_preparation(&mut self) {
        if self.preparation_changed_since_publication {
            if let PreparedLayout::Inline(leaf) = self.state.prepared_layout.active_mut() {
                leaf.mark_published();
            } else {
                self.state.positioned.active_mut().mark_published();
            }
            self.preparation_changed_since_publication = false;
        }
        self.state.change_since_publication = ParagraphChange::default();
        self.published_owner_inline = Some(self.state.active_inline().is_some());
    }

    pub(super) fn commit_preparation(&mut self, publishing: bool) {
        let published_changes =
            publishing && (self.positioned_changed || self.preparation_changed_since_publication);
        if publishing {
            self.preparation_changed_since_publication = false;
            self.state.change_since_publication = ParagraphChange::default();
        } else if self.positioned_changed || self.state.has_pending_preparation() {
            self.preparation_changed_since_publication = true;
        }
        self.state.commit_all();
        if publishing {
            self.published_owner_inline = Some(self.state.active_inline().is_some());
        }
        if published_changes {
            if let PreparedLayout::Inline(leaf) = self.state.prepared_layout.active_mut() {
                leaf.mark_published();
            } else {
                self.state.positioned.active_mut().mark_published();
            }
        }
        self.positioned_changed = false;
    }
}

impl ParagraphState {
    pub(super) fn has_pending_preparation(&self) -> bool {
        self.text.is_prepared()
            || self.styles.is_prepared()
            || self.unicode.is_prepared()
            || self.bidi.is_prepared()
            || self.shaping_runs.is_prepared()
            || self.prepared_layout.is_prepared()
            || self.shape.is_prepared()
            || self.clusters.is_prepared()
            || self.geometry.is_prepared()
            || self.flow_layout.is_prepared()
            || self.positioned.is_prepared()
    }

    /// Clears paragraph identity and committed/pending semantics while retaining every allocation.
    #[inline(never)]
    pub(super) fn reset_for_reuse(&mut self) {
        self.reset_for_reuse_inner(false);
    }

    pub(super) fn reset_for_reuse_preserving_text_candidate(&mut self) {
        self.reset_for_reuse_inner(true);
    }

    pub(super) fn reset_for_reuse_inner(&mut self, preserve_text_candidate: bool) {
        self.change_since_publication = ParagraphChange::default();
        self.positioning = deferred_positioning::PositioningState::Current;
        self.intrinsic_widths_cache = None;
        {
            let (committed, pending) = self.text.pair_mut();
            committed.units.clear();
            committed.unit_ids.clear();
            if !preserve_text_candidate {
                pending.units.clear();
            }
            pending.unit_ids.clear();
        }
        self.pending_text_mirrors_committed = !preserve_text_candidate;
        {
            let (committed, pending) = self.text.pair_mut();
            committed.next_unit_id = 0;
            pending.next_unit_id = 0;
        }
        self.text.discard_candidate();
        self.text_edits.clear();
        self.text_edit_parts.clear();
        {
            let (committed, pending) = self.styles.pair_mut();
            committed.arena.clear();
            committed.resolved.clear();
            pending.arena.clear();
            pending.resolved.clear();
        }
        self.styles.discard_candidate();
        {
            let (committed, pending) = self.unicode.pair_mut();
            committed.clear();
            if !preserve_text_candidate {
                pending.clear();
            }
        }
        self.unicode.discard_candidate();
        self.unicode_reused_for_text_edit = false;
        self.pending_reused_ascii_facts = None;
        {
            let (committed, pending) = self.bidi.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.bidi.discard_candidate();
        {
            let (committed, pending) = self.shaping_runs.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shaping_runs.discard_candidate();
        let (committed_layout, pending_layout) = self.prepared_layout.pair_mut();
        for layout in [committed_layout, pending_layout] {
            if let PreparedLayout::Inline(leaf) = layout {
                leaf.clear();
            }
        }
        self.prepared_layout.discard_candidate();
        {
            let (committed, pending) = self.shape.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.shape.discard_candidate();
        self.accepted_shape_font_instance = None;
        self.pending_shape_font_instance = None;
        self.shape_window_scratch.clear();
        self.incremental_shape_source_run = None;
        self.incremental_shape_source_runs.clear();
        self.incremental_shape_replaced = None;
        {
            let (committed, pending) = self.clusters.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.clusters.discard_candidate();
        self.layout_dirty.clear();
        self.next_run_canonical_revision = 0;
        self.pending_source_run_canonical_revision = 0;
        self.pending_next_run_canonical_revision = 0;
        {
            let (committed, pending) = self.geometry.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.geometry.discard_candidate();
        {
            let (committed, pending) = self.flow_layout.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.flow_layout.discard_candidate();
        self.intrinsic_geometry_scratch.clear();
        self.intrinsic_flow_layout_scratch.clear();
        {
            let (committed, pending) = self.clipped_inspection.pair_mut();
            committed.mode = IntrinsicInspection::None;
            committed.positioned.clear();
            pending.mode = IntrinsicInspection::None;
            pending.positioned.clear();
        }
        self.clipped_inspection.discard_candidate();
        self.intrinsic_boundary_shape.clear();
        self.boundary_shape.clear();
        self.pending_boundary_shape.clear();
        self.boundary_shape_scratch.clear();
        self.ellipsis_shape_scratch.clear();
        self.ellipsis_text_scratch.clear();
        {
            let (committed, pending) = self.positioned.pair_mut();
            committed.clear();
            pending.clear();
        }
        self.positioned.discard_candidate();
        self.fallback_spans.clear();
        self.pending_fallback_spans.clear();
        self.fallback_span_scratch.clear();
        self.fallback_cluster_scratch.clear();
        self.style_mutation_scratch.clear();
        self.style_order_scratch.clear();
        self.style_nesting_scratch.clear();
        self.style_resolution_scratch.clear();
        self.style_invalidation = StyleInvalidation::default();
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn prepare(
        &mut self,
        shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
        style_mutations: crate::engine::semantic_wire::StyleMutationBatch<'_>,
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
        limits: crate::engine::frame::UpdateLimits,
        next_glyph_id: &mut u32,
        preflight_candidate: Option<&mut PreflightTextCandidate>,
        preflight_edits: &[TextEdit],
        positioning: deferred_positioning::PositioningDemand,
    ) -> Result<bool, EngineError> {
        let positioned_changed = self.prepare_stages(
            shaper,
            font_stacks,
            font_bindings,
            text_mutations,
            style_mutations,
            geometry,
            limits,
            next_glyph_id,
            preflight_candidate,
            preflight_edits,
            positioning,
        )?;
        self.accumulate_staged_change();
        Ok(positioned_changed)
    }

    #[allow(clippy::too_many_arguments)]
    pub(super) fn prepare_stages(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        text_mutations: crate::engine::semantic_wire::TextMutationBatch<'_>,
        style_mutations: crate::engine::semantic_wire::StyleMutationBatch<'_>,
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
        limits: crate::engine::frame::UpdateLimits,
        next_glyph_id: &mut u32,
        mut preflight_candidate: Option<&mut PreflightTextCandidate>,
        preflight_edits: &[TextEdit],
        positioning: deferred_positioning::PositioningDemand,
    ) -> Result<bool, EngineError> {
        #[cfg(test)]
        {
            self.preparation_count += 1;
        }
        // Positioning a read left owed runs first, against the predecessor it kept: every stage
        // below then compares against committed values that the positioned arena describes.
        if let Some(shaper) = shaper.as_deref() {
            self.settle_positioning(shaper)?;
        }
        self.prepare_text(
            text_mutations,
            preflight_candidate.as_deref_mut(),
            preflight_edits,
        )?;
        self.prepare_unicode(preflight_candidate)?;
        self.prepare_styles(style_mutations, |handle| {
            font_stacks
                .binary_search_by_key(&handle, |stack| stack.handle)
                .is_ok()
        })?;
        if self.staged_paint_only(geometry.is_empty()) {
            self.republish_retained_rows();
            return Ok(true);
        }
        self.prepare_bidi()?;
        self.prepare_shaping_runs()?;
        let mut cluster_geometry_changed = self.clusters.is_prepared();
        if let Some(shaper) = shaper.as_deref_mut() {
            match self.try_prepare_inline(
                shaper,
                font_stacks,
                font_bindings,
                geometry,
                limits,
                next_glyph_id,
            )? {
                InlineAttempt::Prepared => return Ok(true),
                InlineAttempt::Unchanged => return Ok(false),
                InlineAttempt::GeneralShape => {}
                InlineAttempt::Skipped => self.prepare_shape(shaper, font_stacks, font_bindings)?,
            }
            #[cfg(test)]
            if core::mem::take(&mut self.fail_after_shape_once) {
                return Err(EngineError::InvalidRequest);
            }
            cluster_geometry_changed = self.prepare_clusters(shaper, next_glyph_id)?;
        }
        let positioned_changed = self.prepare_geometry_and_layout(
            shaper,
            font_stacks,
            font_bindings,
            geometry,
            limits,
            next_glyph_id,
            cluster_geometry_changed,
            positioning,
        )?;
        if cluster_geometry_changed {
            self.intrinsic_widths_cache = None;
        }
        Ok(positioned_changed)
    }

    /// Prepares geometry, flow and positioning after the shared semantic prefix.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn prepare_geometry_and_layout(
        &mut self,
        shaper: Option<&mut ShaperRegistry>,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        geometry: crate::engine::semantic_wire::GeometryBatch<'_>,
        limits: crate::engine::frame::UpdateLimits,
        next_glyph_id: &mut u32,
        cluster_geometry_changed: bool,
        positioning: deferred_positioning::PositioningDemand,
    ) -> Result<bool, EngineError> {
        self.prepare_geometry(geometry)?;
        let flow_changed = cluster_geometry_changed
            || self.geometry.is_prepared()
            || self.style_invalidation.metrics;
        let positioned_changed = flow_changed || self.style_invalidation.positioning;
        // Reverting to accepted geometry must also revert the derived layout tail;
        // otherwise it would publish flow and positioning prepared for the prior width.
        if !flow_changed && (self.flow_layout.is_prepared() || self.positioned.is_prepared()) {
            self.discard_flow_layout_candidate();
            self.discard_positioned_candidate();
        }
        if let Some(shaper) = shaper {
            if flow_changed {
                self.prepare_flow_layout(
                    shaper,
                    font_stacks,
                    font_bindings,
                    limits.max_lines,
                    limits.max_slots_per_band,
                    next_glyph_id,
                )?;
                // Geometry-only resize equivalence: a third of alternating-width
                // resizes compose the exact lines the committed flow already
                // holds and would position bit-identically — the fit is cheap
                // and chunk-skipped, so proving input-equality here retires the
                // positioning, gather, diff, and publication tail for those
                // frames entirely (the resize analogue of the D-253 measure
                // adoption). The pending geometry still commits: it is real
                // planner state, and the equivalence proof is exactly the
                // statement that the retained flow and positioning answer it.
                if !self.clusters.is_prepared()
                    && !self.text.is_prepared()
                    && !self.styles.is_prepared()
                    && !self.unicode.is_prepared()
                    && !self.bidi.is_prepared()
                    && !self.shape.is_prepared()
                    && !self.shaping_runs.is_prepared()
                    && !self.style_invalidation.metrics
                    && !self.style_invalidation.positioning
                    && crate::engine::positioning::flow_positioning_equivalent(
                        self.flow_layout.pending(),
                        self.flow_layout.committed(),
                        self.clusters.committed(),
                        self.bidi.committed(),
                        |thread| thread_typography(self.geometry.pending(), thread),
                        |thread| thread_typography(self.geometry.committed(), thread),
                        (&self.pending_boundary_shape, &self.boundary_shape),
                    )?
                {
                    // The composed flow is the layout of the new geometry and commits with it:
                    // only positioning is proven unchanged. Fragment slots and anything else
                    // positioning does not read still follow the new width, and so does the
                    // unclipped layout a measurement derives, which is retired here because
                    // positioning, which otherwise retires it, does not run.
                    self.discard_positioned_candidate();
                    self.clipped_inspection.pending_mut().mode = IntrinsicInspection::None;
                    self.clipped_inspection.mark_prepared();
                    return Ok(false);
                }
            }
            if positioned_changed {
                match positioning {
                    deferred_positioning::PositioningDemand::Now => {
                        self.prepare_positioned(shaper)?;
                    }
                    deferred_positioning::PositioningDemand::Deferrable => {
                        self.skip_positioning();
                    }
                }
            }
        }
        Ok(positioned_changed)
    }

    pub(super) fn commit_all(&mut self) {
        if let deferred_positioning::PositioningState::Skipped(plan) = self.positioning {
            self.commit_deferring_positioning(plan);
            return;
        }
        self.commit_text();
        self.commit_styles();
        self.commit_unicode();
        self.commit_bidi();
        self.commit_shaping_runs();
        self.commit_shape();
        self.commit_clusters();
        self.commit_geometry();
        self.commit_flow_layout();
        self.commit_positioned();
        self.prepared_layout.commit();
        if let PreparedLayout::Inline(_) = self.prepared_layout.committed() {
            self.shape.pair_mut().0.clear();
            self.accepted_shape_font_instance = None;
            self.clusters.pair_mut().0.clear();
            self.flow_layout.pair_mut().0.clear();
            self.positioned.pair_mut().0.clear();
            self.fallback_spans.clear();
        }
        self.clipped_inspection.commit();
    }

    pub(super) fn initialize(&mut self) -> Result<(), EngineError> {
        {
            let (committed, pending) = self.styles.pair_mut();
            committed.arena.reserve_default()?;
            committed.resolved.reserve_default()?;
            pending.arena.reserve_default()?;
            pending.resolved.reserve_default()?;
        }
        reserve_vec(&mut self.style_mutation_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_order_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_sort_pair_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_nesting_scratch, DEFAULT_STYLE_CAPACITY)?;
        reserve_vec(&mut self.style_resolution_scratch, DEFAULT_STYLE_CAPACITY)
    }
}
