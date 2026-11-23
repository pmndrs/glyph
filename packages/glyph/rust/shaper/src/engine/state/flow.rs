//! Flow layout and positioning of one paragraph, and the unclipped intrinsic inspection layout.

use super::*;

impl ParagraphState {
    #[inline(never)]
    pub(super) fn prepare_flow_layout(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        self.prepare_flow_lines(
            shaper,
            font_stacks,
            font_bindings,
            max_lines,
            max_slots_per_band,
            next_glyph_id,
        )?;
        // Every fragment, retained or composed, gets its line edges shaped alone (or none).
        let geometry = self.geometry.active();
        let shaper = RefCell::new(shaper);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper,
            text: self.text.active().units.as_slice(),
            runs: self.shaping_runs.active().runs(),
            styles: &self.styles.active().arena,
            clusters: self.clusters.active(),
        };
        attach_line_edges(
            &mut corrections,
            geometry,
            self.flow_layout.pending_mut(),
            (&mut self.pending_boundary_shape, &self.previous_edge_ids),
            next_glyph_id,
        )?;
        Ok(())
    }

    pub(super) fn prepare_flow_lines(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
        next_glyph_id: &mut u32,
    ) -> Result<(), EngineError> {
        #[cfg(feature = "stage-bench")]
        let _clock = oracle::stage_bench::clock::FLOW.guard();
        self.discard_flow_layout_candidate();
        // Positioning is derived from one specific flow: its per-line lanes describe the
        // lines that flow composed. Re-running the flow therefore invalidates any pending
        // positioning by construction, so dropping it here — at the single place a new
        // flow is staged — is what makes "positioning that describes a superseded flow"
        // unrepresentable rather than something each caller has to remember to repair.
        self.discard_positioned_candidate();
        self.pending_boundary_shape.clear();
        previous_edge_ids(
            &mut self.previous_edge_ids,
            self.clusters.committed(),
            &self.boundary_shape,
        );
        self.clusters.active_mut().ensure_word_breaks()?;
        self.clusters
            .active_mut()
            .ensure_placement_segment_anchors()?;
        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        let style_storage = &self.styles.active().arena;
        let runs = self.shaping_runs.active().runs();
        let text = self.text.active().units.as_slice();
        let localized_geometry_change = if self.geometry.is_prepared() {
            self.geometry
                .pending()
                .localized_change_from(self.geometry.committed())?
        } else {
            LocalizedGeometryChange::Unchanged
        };
        let geometry = self.geometry.active();
        let max_slots_per_band =
            usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?;
        let max_lines = usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?;
        let bidi = self.bidi.active();
        let shaper_cell = RefCell::new(&mut *shaper);
        let metrics_for = |handle| shaper_cell.borrow().font_metrics(handle);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper_cell,
            text,
            runs,
            styles: style_storage,
            clusters,
        };
        let first_font_for_stack = |stack_handle| {
            font_stacks
                .binary_search_by_key(&stack_handle, |stack| stack.handle)
                .ok()
                .and_then(|index| font_stacks[index].fonts.first().copied())
                .and_then(|handle| {
                    font_bindings
                        .iter()
                        .find(|binding| binding.handle == handle)
                        .map(|binding| binding.shaping_handle)
                })
        };
        if !self.style_invalidation.metrics
            && !self.clusters.is_prepared()
            && self.text_edits.is_empty()
            && !self.boundary_shape.has_ellipsis()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && let LocalizedGeometryChange::ExclusionBand(dirty) = localized_geometry_change
            && {
                let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
                pending_flow.rebuild_after_exclusion_change_until_state_converges(
                    committed_flow,
                    geometry,
                    clusters,
                    runs,
                    styles,
                    &mut self.flow_slot_scratch,
                    dirty,
                    (bidi, self.bidi.committed()),
                    max_lines,
                    max_slots_per_band,
                    metrics_for,
                    first_font_for_stack,
                    &mut corrections,
                )?
            }
        {
            self.flow_layout.mark_prepared();
            return Ok(());
        }
        if !self.geometry.is_prepared()
            && !self.style_invalidation.metrics
            && !self.boundary_shape.has_ellipsis()
            && geometry
                .constraints
                .iter()
                .all(|constraint| constraint.overflow != OVERFLOW_ELLIPSIS)
            && self.layout_dirty.valid
            && !self.layout_dirty.ranges.is_empty()
            && self.bidi.active().paragraph_levels.first()
                == self.bidi.committed().paragraph_levels.first()
            && {
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    work.flow_shape_windows += self.shape_window_scratch.len();
                    work.flow_shape_window_units += self
                        .shape_window_scratch
                        .iter()
                        .map(|window| (window.old_end - window.old_start) as usize)
                        .sum::<usize>();
                    work.flow_shape_window_first_start = self
                        .shape_window_scratch
                        .first()
                        .map_or(0, |window| window.old_start as usize);
                    work.flow_shape_window_last_end = self
                        .shape_window_scratch
                        .last()
                        .map_or(0, |window| window.old_end as usize);
                });
                let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
                pending_flow.rebuild_until_state_converges(
                    committed_flow,
                    geometry,
                    self.clusters.committed(),
                    clusters,
                    runs,
                    styles,
                    &mut self.flow_slot_scratch,
                    self.layout_dirty.ranges.iter().cloned(),
                    (bidi, self.bidi.committed()),
                    max_lines,
                    max_slots_per_band,
                    metrics_for,
                    first_font_for_stack,
                    &mut corrections,
                )?
            }
        {
            self.flow_layout.mark_prepared();
            return Ok(());
        }
        // A change of geometry alone leaves every input of the fitter but the measure as the
        // committed flow read it, so that flow's fits answer wherever the measure allows.
        let same_clusters = self.geometry.is_prepared()
            && !self.clusters.is_prepared()
            && !self.text.is_prepared()
            && !self.styles.is_prepared()
            && !self.unicode.is_prepared()
            && !self.bidi.is_prepared()
            && !self.shape.is_prepared()
            && !self.shaping_runs.is_prepared()
            && !self.style_invalidation.any();
        let (pending_flow, committed_flow) = self.flow_layout.derive_mut();
        pending_flow.build_with_drop_cap_context(
            same_clusters.then_some(committed_flow),
            geometry,
            clusters,
            runs,
            styles,
            &mut self.flow_slot_scratch,
            bidi,
            max_lines,
            max_slots_per_band,
            metrics_for,
            first_font_for_stack,
            &mut corrections,
        )?;
        // Text of hard breaks alone has no run: no font draws its marker, so its lines are
        // dropped without one.
        let mut ellipsis_index = if runs.is_empty() {
            self.flow_layout.pending().ellipsis_threads().len()
        } else {
            0
        };
        while ellipsis_index < self.flow_layout.pending_mut().ellipsis_threads().len() {
            let flow_thread_id = self.flow_layout.pending_mut().ellipsis_threads()[ellipsis_index];
            let line_index = self
                .flow_layout
                .pending_mut()
                .lines
                .iter()
                .rposition(|line| line.flow_thread_id == flow_thread_id)
                .ok_or(EngineError::InvalidRequest)?;
            let line = self.flow_layout.pending().lines[line_index];
            let fragment_index = self
                .flow_layout
                .pending()
                .line_fragment_start(line_index)
                .ok_or(EngineError::InvalidRequest)?
                .checked_add(usize::from(line.fragment_count))
                .and_then(|end| end.checked_sub(1))
                .ok_or(EngineError::InvalidRequest)?;
            let fragment = *self
                .flow_layout
                .pending_mut()
                .fragments
                .get(fragment_index)
                .ok_or(EngineError::InvalidRequest)?;
            let line_cluster_start = usize::try_from(fragment.line.cluster_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            let line_text_start = fragment.line.text_start;
            let source_shape = &mut self.boundary_shape_scratch;
            let ellipsis_shape = &mut self.ellipsis_shape_scratch;
            let ellipsis_text = &mut self.ellipsis_text_scratch;
            let mut final_candidate = None;
            let target = self
                .flow_layout
                .pending_mut()
                .truncate_for_ellipsis(flow_thread_id, clusters, |cluster_end, text_end| {
                    let candidate = prepare_boundary_candidate(
                        shaper,
                        text,
                        ellipsis_text,
                        source_shape,
                        ellipsis_shape,
                        clusters,
                        runs,
                        style_storage,
                        font_stacks,
                        font_bindings,
                        line_cluster_start,
                        line_text_start,
                        cluster_end,
                        text_end,
                    )?;
                    let retained_advance = clusters.advances[candidate.cluster_start..cluster_end]
                        .iter()
                        .copied()
                        .sum::<f64>();
                    final_candidate = Some(candidate);
                    Ok(EllipsisReplacement {
                        cluster_start: candidate.cluster_start,
                        advance_adjustment: candidate.source_advance + candidate.ellipsis_advance
                            - retained_advance,
                    })
                })?
                .ok_or(EngineError::InvalidRequest)?;
            let candidate = final_candidate.ok_or(EngineError::InvalidRequest)?;
            if usize::try_from(target.boundary_cluster_start).ok() != Some(candidate.cluster_start)
            {
                return Err(EngineError::InvalidRequest);
            }
            let source_span = if source_shape.runs.is_empty() {
                (
                    u32::try_from(self.pending_boundary_shape.shape.glyph_ids.len())
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    0,
                )
            } else {
                self.pending_boundary_shape
                    .shape
                    .append_from(source_shape, 0)?
            };
            let ellipsis_span = self
                .pending_boundary_shape
                .shape
                .append_from(ellipsis_shape, 0)?;
            append_boundary_source_ids(
                &mut self.pending_boundary_shape.stable_ids,
                &source_shape.clusters,
                (clusters, &self.previous_edge_ids),
                next_glyph_id,
            )?;
            let previous = self
                .boundary_shape
                .records
                .iter()
                .find(|record| record.flow_thread_id == flow_thread_id)
                .copied();
            let previous_ellipsis_ids = previous
                .and_then(|record| {
                    let start = usize::try_from(record.ellipsis_glyph_start).ok()?;
                    let end =
                        start.checked_add(usize::try_from(record.ellipsis_glyph_count).ok()?)?;
                    self.boundary_shape.stable_ids.get(start..end)
                })
                .unwrap_or(&[]);
            let ellipsis_count =
                usize::try_from(ellipsis_span.1).map_err(|_| EngineError::InvalidRequest)?;
            for ordinal in 0..ellipsis_count {
                let stable_id = previous_ellipsis_ids
                    .get(ordinal)
                    .copied()
                    .filter(|id| *id != 0)
                    .map_or_else(|| allocate_glyph_id(next_glyph_id), Ok)?;
                self.pending_boundary_shape.stable_ids.push(stable_id);
            }
            let boundary_index = u32::try_from(self.pending_boundary_shape.records.len())
                .map_err(|_| EngineError::ResultTooLarge)?;
            self.pending_boundary_shape.records.push(BoundaryShape {
                flow_thread_id,
                source_run: u32::try_from(candidate.source_run)
                    .map_err(|_| EngineError::ResultTooLarge)?,
                cluster_start: target.boundary_cluster_start,
                cluster_end: target.cluster_end,
                text_end: target.text_end,
                source_binding_handle: candidate.source_binding_handle,
                source_font_handle: candidate.source_font_handle,
                ellipsis_binding_handle: candidate.ellipsis_binding_handle,
                ellipsis_font_handle: candidate.ellipsis_font_handle,
                source_glyph_start: source_span.0,
                source_glyph_count: source_span.1,
                ellipsis_glyph_start: ellipsis_span.0,
                ellipsis_glyph_count: ellipsis_span.1,
                line_start: false,
            });
            if !self
                .flow_layout
                .pending_mut()
                .fragments
                .update(fragment_index, |fragment| {
                    fragment.boundary_index = boundary_index;
                })
                .map_err(|()| EngineError::ResultTooLarge)?
            {
                return Err(EngineError::InvalidRequest);
            }
            ellipsis_index += 1;
        }
        self.flow_layout.mark_prepared();
        Ok(())
    }

    pub(super) fn prepare_intrinsic_flow_layout(
        &mut self,
        shaper: &mut ShaperRegistry,
        font_stacks: &[RegisteredFontStack],
        font_bindings: &[RegisteredFontBinding],
        max_lines: u32,
        max_slots_per_band: u32,
    ) -> Result<(), EngineError> {
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.intrinsic_flow_preparations += 1);
        let source_geometry = self.geometry.active();
        self.intrinsic_geometry_scratch.clone_from(source_geometry);
        let constraint = self
            .intrinsic_geometry_scratch
            .constraints
            .first_mut()
            .ok_or(EngineError::InvalidRequest)?;
        let region_start =
            usize::try_from(constraint.region_start).map_err(|_| EngineError::InvalidRequest)?;
        let final_region = region_start
            .checked_add(usize::from(constraint.region_count))
            .and_then(|end| end.checked_sub(1))
            .ok_or(EngineError::InvalidRequest)?;
        let region = self
            .intrinsic_geometry_scratch
            .regions
            .get_mut(final_region)
            .ok_or(EngineError::InvalidRequest)?;
        const INTRINSIC_BLOCK_END: f32 = 16_777_216.0;
        constraint.max_lines = 0;
        constraint.viewport_block_end = INTRINSIC_BLOCK_END;
        constraint.overflow = OVERFLOW_VISIBLE;
        constraint.drop_cap_lines = 0;
        constraint.drop_cap_alignment = 0;
        constraint.drop_cap_side = 0;
        constraint.drop_cap_margin_inline = 0.0;
        constraint.drop_cap_margin_block = 0.0;
        region.record.block_end = INTRINSIC_BLOCK_END;

        let clusters = self.clusters.active();
        let styles = self.styles.active().resolved.segments();
        let shaper = RefCell::new(shaper);
        let mut corrections = ShapedBreakCorrections {
            shaper: &shaper,
            text: self.text.active().units.as_slice(),
            runs: self.shaping_runs.active().runs(),
            styles: &self.styles.active().arena,
            clusters,
        };
        self.intrinsic_flow_layout_scratch
            .build_with_drop_cap_context(
                None,
                &self.intrinsic_geometry_scratch,
                clusters,
                &[],
                styles,
                &mut self.intrinsic_flow_slot_scratch,
                self.bidi.active(),
                usize::try_from(max_lines).map_err(|_| EngineError::ResultTooLarge)?,
                usize::try_from(max_slots_per_band).map_err(|_| EngineError::ResultTooLarge)?,
                |handle| shaper.borrow().font_metrics(handle),
                |stack_handle| {
                    font_stacks
                        .binary_search_by_key(&stack_handle, |stack| stack.handle)
                        .ok()
                        .and_then(|index| font_stacks[index].fonts.first().copied())
                        .and_then(|handle| {
                            font_bindings
                                .iter()
                                .find(|binding| binding.handle == handle)
                                .map(|binding| binding.shaping_handle)
                        })
                },
                &mut corrections,
            )?;
        // Throwaway identities for the unpublished inspection flow.
        self.intrinsic_boundary_shape.clear();
        attach_line_edges(
            &mut corrections,
            &self.intrinsic_geometry_scratch,
            &mut self.intrinsic_flow_layout_scratch,
            (&mut self.intrinsic_boundary_shape, &[]),
            &mut (1 << 30),
        )
    }

    pub(super) fn inspection_positioned(&self) -> &PositionedGlyphArena {
        let clipped = self.clipped_inspection.active();
        if clipped.mode == IntrinsicInspection::Positioned {
            &clipped.positioned
        } else {
            self.positioned.active()
        }
    }

    pub(super) fn inspection_boundary_shape(&self) -> &BoundaryShapeArena {
        if self.clipped_inspection.active().mode == IntrinsicInspection::Positioned {
            &self.intrinsic_boundary_shape
        } else {
            self.visible_boundary_shape()
        }
    }

    pub(super) fn visible_boundary_shape(&self) -> &BoundaryShapeArena {
        if self.flow_layout.is_prepared() {
            &self.pending_boundary_shape
        } else {
            &self.boundary_shape
        }
    }

    pub(super) fn prepare_intrinsic_positioned(
        &mut self,
        shaper: &ShaperRegistry,
    ) -> Result<(), EngineError> {
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.intrinsic_positioning_preparations += 1
        });
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let previous = self.positioned.active();
        let mut next_run_canonical_revision = 1;
        let boundary_shape = &self.intrinsic_boundary_shape;
        let geometry = &self.intrinsic_geometry_scratch;
        self.clipped_inspection
            .pending_mut()
            .positioned
            .build_with_previous(
                previous,
                &self.intrinsic_flow_layout_scratch,
                None,
                None,
                text,
                clusters,
                clusters,
                runs,
                runs,
                boundary_shape,
                boundary_shape,
                styles,
                bidi,
                &mut next_run_canonical_revision,
                |thread| thread_typography(geometry, thread),
                |thread| thread_typography(geometry, thread),
                |handle| shaper.font_metrics(handle),
                |handle, glyph| shaper.font_glyph_extents(handle, glyph),
            )
    }

    pub(super) fn discard_flow_layout_candidate(&mut self) {
        self.flow_layout.pending_mut().clear();
        self.pending_boundary_shape.clear();
        self.flow_layout.discard_candidate();
    }

    pub(super) fn commit_flow_layout(&mut self) {
        if self.flow_layout.is_prepared() {
            // The boundary shape is the flow's own output and commits with it.
            core::mem::swap(&mut self.boundary_shape, &mut self.pending_boundary_shape);
        }
        self.flow_layout.commit();
        self.discard_flow_layout_candidate();
    }

    pub(super) fn prepare_positioned(
        &mut self,
        shaper: &ShaperRegistry,
    ) -> Result<(), EngineError> {
        let plan = self.positioning_plan();
        self.position(shaper, plan)
    }

    /// The one positioning implementation, eager or deferred: `plan` carries the facts about
    /// the staged stages that a deferred run can no longer read off their flags.
    #[inline(never)]
    pub(super) fn position(
        &mut self,
        shaper: &ShaperRegistry,
        plan: deferred_positioning::PositioningPlan,
    ) -> Result<(), EngineError> {
        self.discard_positioned_candidate();
        self.positioning = deferred_positioning::PositioningState::Current;
        let text = self.text.active().units.as_slice();
        let clusters = self.clusters.active();
        let runs = self.shaping_runs.active().runs();
        let previous_runs = self.shaping_runs.committed().runs();
        let styles = self.styles.active().resolved.segments();
        let bidi = self.bidi.active();
        let flow = self.flow_layout.active();
        let boundary_shape = if self.flow_layout.is_prepared() {
            &self.pending_boundary_shape
        } else {
            &self.boundary_shape
        };
        let geometry = self.geometry.active();
        let retained_flow = plan.retains_flow.then(|| self.flow_layout.committed());
        // Layout islands authorize semantic reuse only within this preparation.
        // Paint/effects invalidate positioning even when layout itself is unchanged.
        let recomposed_lines = if plan.recomposed_lines {
            flow.recomposed_line_ranges()
        } else {
            None
        };
        let (committed_positioned, pending_positioned) = self.positioned.pair_mut();
        pending_positioned.build_with_previous(
            committed_positioned,
            flow,
            retained_flow,
            recomposed_lines,
            text,
            clusters,
            self.clusters.committed(),
            runs,
            previous_runs,
            boundary_shape,
            &self.boundary_shape,
            styles,
            bidi,
            &mut self.pending_next_run_canonical_revision,
            |thread| thread_typography(geometry, thread),
            |thread| thread_typography(self.geometry.committed(), thread),
            |handle| shaper.font_metrics(handle),
            |handle, glyph| shaper.font_glyph_extents(handle, glyph),
        )?;
        self.positioned.mark_prepared();
        // A changed visible layout retires the prior derived inspection. Measurement
        // replaces this selection with full clipped positioning when requested.
        self.clipped_inspection.pending_mut().mode = IntrinsicInspection::None;
        self.clipped_inspection.mark_prepared();
        Ok(())
    }

    #[inline(never)]
    pub(super) fn discard_positioned_candidate(&mut self) {
        self.positioned.pending_mut().clear();
        self.positioned.discard_candidate();
        self.pending_next_run_canonical_revision = self.pending_source_run_canonical_revision;
    }

    pub(super) fn commit_positioned(&mut self) {
        self.positioned.commit();
        self.positioned.pending_mut().clear();
    }
}
