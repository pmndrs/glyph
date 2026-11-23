//! One frame's update request: staging planner input, preparing paragraphs and the renderer plan.

use super::*;

impl TextEngine {
    #[cfg(test)]
    pub(crate) fn prepare_update(
        &mut self,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        self.prepare_update_inner(None, request, publication_generation)
    }

    pub(crate) fn prepare_update_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        self.prepare_update_inner(Some(shaper), request, publication_generation)
    }

    pub(super) fn prepare_update_inner(
        &mut self,
        mut shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let codec = self
            .codecs
            .get(&request.codec_handle)
            .ok_or(EngineError::CodecMissing)?;
        if codec
            .capability_set(CapabilitySetId(request.capability_set))
            .is_none()
        {
            return Err(EngineError::InvalidRequest);
        }
        let codec_fingerprint = codec.fingerprint();
        let cached_gather = self.gather_cache;
        let font_bindings = &self.font_bindings;
        let font_stacks = &self.font_stacks;
        let gather = &mut self.gather;
        let gather_cache = &mut self.gather_cache;
        let prepared_gather_cache = &mut self.prepared_gather_cache;
        let planner = self
            .planners
            .get_mut(&request.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.codec_binding.is_some_and(|binding| {
            binding.handle != request.codec_handle || binding.fingerprint != codec_fingerprint
        }) {
            return Err(EngineError::InvalidRequest);
        }
        if request.expected_engine_revision != planner.revision.engine
            || request.consumed_revision > planner.revision.root
            || publication_generation == 0
            || request.acknowledged_publication_generation
                < planner.acknowledged_publication_generation
            || request.acknowledged_publication_generation >= publication_generation
        {
            return Err(EngineError::RevisionConflict);
        }
        let StagedInputs {
            implicit_paragraph,
            lifecycle_plan,
            spare_text_candidate_id,
            mut preflight_text_candidates,
            mut preflight_edit_scratch,
        } = stage_planner_inputs(planner, request, ParagraphInputScope::Indexed, font_stacks)?;
        let next = match (
            planner.revision.engine.checked_add(1),
            planner.revision.root.checked_add(1),
        ) {
            (Some(engine), Some(root)) => RootRevision { engine, root },
            _ => return Err(EngineError::RevisionExhausted),
        };
        // Accept the renderer's monotonic fence before preparing. Failure recovery preserves
        // this fence when it rebuilds the derived root.
        if !planner.placement_acknowledgement_rebased {
            planner
                .placement_slots
                .acknowledge(request.acknowledged_publication_generation)
                .map_err(placement_slot_error)?;
        }
        planner.acknowledged_publication_generation = request.acknowledged_publication_generation;
        let current_gather_key = GatherCacheKey {
            root_id: request.root_id,
            revision: planner.revision,
            codec_handle: request.codec_handle,
            codec_fingerprint,
            capability_set: request.capability_set,
        };
        let next_gather_key = GatherCacheKey {
            revision: next,
            ..current_gather_key
        };
        let checkpoint =
            planner.revision.root == 0 || request.consumed_revision != planner.revision.root;
        let preparation_changed =
            planner.preparation_revision != planner.published_preparation_revision;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.prepare_checkpoints += usize::from(checkpoint);
            work.prepare_changed += usize::from(preparation_changed);
        });
        let (mut next_glyph_id, mut next_content_revision) = (
            planner.next_glyph_id.max(1),
            planner.next_content_revision.max(1),
        );
        gather.set_projected_revision_cursor(next_content_revision);
        let mut gather_output_matches_next = false;
        let preparation = (|| {
            planner.semantic_records.clear();
            planner.prepare_lifecycle(
                request.paragraph_mutations,
                request.paragraph_order_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
                lifecycle_plan,
                spare_text_candidate_id,
            )?;
            // A read may have left positioning owed; publication draws positions, so it settles
            // that first, against the predecessor the read kept.
            if let Some(shaper) = shaper.as_deref() {
                planner.settle_owed_positioning(shaper)?;
            }
            if !checkpoint
                && !preparation_changed
                && planner.lifecycle_changed
                && order_only_request(request)
                && request.compositing_independent == planner.compositing_independent
                && !planner_has_decorations(planner)
            {
                let mut stable_ids = core::mem::take(&mut planner.reorder_stable_ids);
                stable_ids.clear();
                let stable_id_result = (|| {
                    let required =
                        planner
                            .active_order()
                            .iter()
                            .try_fold(0usize, |total, ordered| {
                                let paragraph = planner
                                    .paragraph(ordered.id)
                                    .ok_or(EngineError::InvalidRequest)?;
                                total
                                    .checked_add(paragraph.state.active_outlined_count())
                                    .ok_or(EngineError::ResultTooLarge)
                            })?;
                    stable_ids
                        .try_reserve(required)
                        .map_err(|_| EngineError::ResultTooLarge)?;
                    for ordered in planner.active_order() {
                        let paragraph = planner
                            .paragraph(ordered.id)
                            .ok_or(EngineError::InvalidRequest)?;
                        if let Some(leaf) = paragraph.state.active_inline() {
                            for source in leaf.outlined_sources() {
                                let row = leaf.projected_source_row(
                                    source,
                                    source,
                                    0,
                                    paragraph.state.styles.active().resolved.segments(),
                                )?;
                                let glyph = row.glyph;
                                let binding = font_bindings
                                    .iter()
                                    .find(|binding| binding.handle == glyph.binding_handle)
                                    .ok_or_else(|| gather_error(GatherError::FontBindingMissing))?;
                                if binding
                                    .binding
                                    .select(
                                        glyph.glyph_id,
                                        glyph.font_size,
                                        glyph.raster_pixel_ratio,
                                    )
                                    .is_none()
                                {
                                    continue;
                                }
                                if glyph.stable_id == 0 {
                                    return Err(EngineError::InvalidRequest);
                                }
                                stable_ids.push(glyph.stable_id);
                            }
                            continue;
                        }
                        let positioned = paragraph.state.positioned.active();
                        let context = PositionedSourceContext {
                            styles: paragraph.state.styles.active().resolved.segments(),
                            clusters: paragraph.state.clusters.active(),
                        };
                        let boundary = paragraph.state.visible_boundary_shape();
                        let mut outlined = positioned.outlined_cursor(context.clusters, boundary);
                        while let Some(mark) = outlined.next_mark()? {
                            let occurrence = outlined.project(mark)?;
                            let glyph = positioned
                                .projected_occurrence_row(
                                    occurrence,
                                    mark.semantic_index,
                                    0,
                                    context,
                                )?
                                .glyph;
                            let binding = font_bindings
                                .iter()
                                .find(|binding| binding.handle == glyph.binding_handle)
                                .ok_or_else(|| gather_error(GatherError::FontBindingMissing))?;
                            if binding
                                .binding
                                .select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
                                .is_none()
                            {
                                continue;
                            }
                            if glyph.stable_id == 0 {
                                return Err(EngineError::InvalidRequest);
                            }
                            stable_ids.push(glyph.stable_id);
                        }
                    }
                    Ok(())
                })();
                let reorder_prepared = match stable_id_result {
                    Ok(()) => planner.plan.prepare_reorder(
                        codec,
                        CapabilitySetId(request.capability_set),
                        &stable_ids,
                        publication_generation,
                    ),
                    Err(error) => {
                        planner.reorder_stable_ids = stable_ids;
                        return Err(error);
                    }
                };
                planner.reorder_stable_ids = stable_ids;
                if reorder_prepared.map_err(plan_error)? {
                    planner
                        .placement_slots
                        .prepare_reuse(publication_generation)
                        .map_err(placement_slot_error)?;
                    planner.pending_placement_slot_count = planner.placement_slot_count;
                    planner.session_placement_rows.clear();
                    planner.pending_next_glyph_id = next_glyph_id;
                    planner.pending_next_content_revision = next_content_revision;
                    planner.pending_compositing_independent = request.compositing_independent;
                    *gather_cache = None;
                    *prepared_gather_cache = None;
                    return Ok(());
                }
            }
            planner.prepare_semantic_work_order()?;
            for order_index in 0..planner.order_sort_scratch.len() {
                let paragraph_id = planner.order_sort_scratch[order_index].1;
                let spans = planner.semantic_input_spans(paragraph_id);
                let text = request
                    .text_mutations
                    .span(spans.text)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let styles = request
                    .style_mutations
                    .span(spans.styles)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let geometry = request
                    .geometry
                    .spans(spans.constraints, spans.inline_objects)
                    .map_err(|_| EngineError::InvalidRequest)?;
                let paragraph = planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?;
                if spans.is_empty() && !paragraph.state.has_pending_preparation() {
                    paragraph.positioned_changed = false;
                    continue;
                }
                admit_preparation_owner(
                    &mut planner.pending_preparation_ids,
                    &mut planner.unpublished_preparation_ids,
                    paragraph_id,
                )?;
                let preflight_candidate =
                    preflight_text_candidate_mut(&mut preflight_text_candidates, paragraph_id);
                let prepared = {
                    let paragraph = planner
                        .paragraph_mut(paragraph_id)
                        .ok_or(EngineError::InvalidRequest)?;
                    paragraph.state.prepare(
                        shaper.as_deref_mut(),
                        font_stacks,
                        font_bindings,
                        text,
                        styles,
                        geometry,
                        request.limits,
                        &mut next_glyph_id,
                        preflight_candidate,
                        &preflight_edit_scratch,
                        deferred_positioning::PositioningDemand::Now,
                    )
                };
                planner
                    .paragraph_mut(paragraph_id)
                    .ok_or(EngineError::InvalidRequest)?
                    .positioned_changed =
                    prepared.map_err(|error| error.in_paragraph(paragraph_id))?;
            }
            let positioned_changed = preparation_changed
                || planner.lifecycle_changed
                || !planner.unpublished_preparation_ids.is_empty()
                || planner.pending_preparation_ids.iter().any(|id| {
                    planner
                        .paragraph(*id)
                        .is_some_and(|paragraph| paragraph.positioned_changed)
                });
            if positioned_changed || checkpoint {
                planner.prepare_placement_slots(
                    publication_generation,
                    preparation_changed,
                    checkpoint,
                )?;
            } else {
                planner
                    .placement_slots
                    .prepare_reuse(publication_generation)
                    .map_err(placement_slot_error)?;
                planner.pending_placement_slot_count = planner.placement_slot_count;
                planner.session_placement_rows.clear();
            }
            let reuse_ordered_plan = !checkpoint
                && !positioned_changed
                && request.compositing_independent == planner.compositing_independent;
            if reuse_ordered_plan {
                planner.plan.prepare_reuse().map_err(plan_error)?;
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| work.prepare_reuse_modes += 1);
                gather_output_matches_next = cached_gather == Some(current_gather_key);
            } else {
                let sparse = cached_gather == Some(current_gather_key)
                    && !checkpoint
                    && planner.prepare_retained_order(RetainedOrderPurpose::Gather)?;
                let replacement =
                    if cached_gather == Some(current_gather_key) && !checkpoint && !sparse {
                        planner.prepare_replacement_gather_order()?
                    } else {
                        None
                    };
                let record_count = if let Some(count) = replacement {
                    count
                } else if sparse {
                    planner
                        .gathered_source_count
                        .ok_or(EngineError::InvalidRequest)?
                } else {
                    planner
                        .active_order()
                        .iter()
                        .try_fold(0usize, |total, ordered| {
                            let paragraph = planner
                                .paragraph(ordered.id)
                                .ok_or(EngineError::InvalidRequest)?;
                            total
                                .checked_add(paragraph.state.active_outlined_count())
                                .ok_or(EngineError::ResultTooLarge)
                        })?
                };
                *gather_cache = None;
                *prepared_gather_cache = None;
                let capability_set = CapabilitySetId(request.capability_set);
                // Decoration rows bypass the retained gather cursor arithmetic, so a retained plan with
                // any decorated paragraph must rebuild from a reset workspace; entering the
                // retained path and falling back mid-append would stack fresh rows onto the
                // previous update's buffers.
                let owner_kind_changed = planner.active_order().iter().any(|ordered| {
                    planner.paragraph(ordered.id).is_some_and(|paragraph| {
                        paragraph.gather_range.is_some()
                            && paragraph.published_owner_inline
                                != Some(paragraph.state.active_inline().is_some())
                    })
                });
                let ranges_reusable = !owner_kind_changed
                    && (sparse || replacement.is_some() || !planner_has_decorations(planner));
                let attempted_retained =
                    cached_gather == Some(current_gather_key) && ranges_reusable;
                let retained = attempted_retained
                    && gather
                        .begin_retained(codec, record_count)
                        .map_err(gather_error)?;
                if retained {
                    append_planner_gather(
                        gather,
                        planner,
                        codec,
                        capability_set,
                        font_bindings,
                        true,
                        sparse || replacement.is_some(),
                        replacement.is_some(),
                    )?;
                }
                if !retained {
                    gather.begin(codec, record_count).map_err(gather_error)?;
                    append_planner_gather(
                        gather,
                        planner,
                        codec,
                        capability_set,
                        font_bindings,
                        false,
                        false,
                        false,
                    )?;
                }
                #[cfg(test)]
                crate::engine::work_attribution::record(|work| {
                    if retained && sparse {
                        work.prepare_retained_sparse_modes += 1;
                    } else if retained && replacement.is_some() {
                        work.prepare_retained_replacement_modes += 1;
                    } else {
                        work.prepare_fresh_modes += 1;
                    }
                    work.gather_output_source_rows += gather.diagnostic_source_count();
                    work.gather_output_selected_rows += gather.view().plan_input().glyphs.len();
                    work.prepared_positioned_source_rows += record_count;
                });
                planner.gathered_source_count = if ranges_reusable {
                    Some(record_count)
                } else {
                    None
                };
                let output_scope = if sparse {
                    gather.changed_output_intervals().map(|records| {
                        crate::engine::render_plan_compiler::OwnedOutputScope {
                            previous_revision: planner.revision.root,
                            scope:
                                crate::engine::ordered_plan::RetainedOutputScope::ChangedIntervals(
                                    records,
                                    gather.changed_inputs(),
                                ),
                        }
                    })
                } else {
                    None
                }
                .or_else(|| {
                    gather
                        .correspondence()
                        .first()
                        .filter(|_| retained)
                        .map(|_| crate::engine::render_plan_compiler::OwnedOutputScope {
                            previous_revision: planner.revision.root,
                            scope: crate::engine::ordered_plan::RetainedOutputScope::Replacement(
                                gather.correspondence(),
                            ),
                        })
                });
                let gathered = gather.view();
                let mut plan_input = gathered.plan_input();
                plan_input.order_independent = request.compositing_independent;
                planner
                    .plan
                    .prepare_session(
                        SessionPlacementInput {
                            placement_rows: &planner.session_placement_rows,
                            placement_capacity: planner.pending_placement_slot_count,
                        },
                        codec
                            .capability_set(capability_set)
                            .ok_or(EngineError::InvalidRequest)?,
                        publication_generation,
                        checkpoint,
                    )
                    .map_err(plan_error)?;
                planner
                    .plan
                    .prepare_owned(
                        codec,
                        CapabilitySetId(request.capability_set),
                        plan_input,
                        checkpoint,
                        publication_generation,
                        request.acknowledged_publication_generation,
                        output_scope,
                        gather.bounds_changed(),
                    )
                    .map_err(plan_error)?;
                gather_output_matches_next = true;
            }
            let include_layout_inspection = request.semantic_view_mask
                & crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
                != 0;
            // Glyph facts alone ask for the summaries, with their facts, of the paragraphs prepared
            // since the last publication only: the ones a summary-only read may have measured.
            let glyph_facts_only = request.semantic_view_mask
                & (crate::engine::frame::SEMANTIC_VIEW_MEASUREMENT
                    | crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
                == 0
                && request.semantic_view_mask & crate::engine::frame::SEMANTIC_VIEW_GLYPH_FACTS
                    != 0;
            if request.semantic_view_mask
                & (crate::engine::frame::SEMANTIC_VIEW_MEASUREMENT
                    | crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
                    | crate::engine::frame::SEMANTIC_VIEW_GLYPH_FACTS)
                != 0
            {
                let mut records = core::mem::take(&mut planner.semantic_records);
                let query = (|| {
                    for order_index in 0..planner.active_order().len() {
                        let paragraph_id = planner.active_order()[order_index].id;
                        let input_unchanged = planner.semantic_input_spans(paragraph_id).is_empty();
                        let paragraph = planner
                            .paragraph(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?;
                        let positioned_changed = paragraph.positioned_changed
                            || paragraph.preparation_changed_since_publication;
                        if input_unchanged && !positioned_changed && !preparation_changed {
                            continue;
                        }
                        // Glyph facts answer summaries of paragraphs prepared since the last
                        // publication; a refused one was emptied and has none to answer.
                        if glyph_facts_only
                            && (!planner.unpublished_preparation_ids.contains(&paragraph_id)
                                || paragraph.state.geometry.active().constraints.is_empty())
                        {
                            continue;
                        }
                        admit_preparation_owner(
                            &mut planner.pending_preparation_ids,
                            &mut planner.unpublished_preparation_ids,
                            paragraph_id,
                        )?;
                        let paragraph = planner
                            .paragraph_mut(paragraph_id)
                            .ok_or(EngineError::InvalidRequest)?;
                        append_paragraph_measurement(
                            &mut records,
                            &mut paragraph.state,
                            paragraph_id,
                            shaper.as_deref_mut(),
                            font_stacks,
                            font_bindings,
                            request.limits,
                            include_layout_inspection,
                            request.semantic_view_mask
                                & crate::engine::frame::SEMANTIC_VIEW_BORROWED_LAYOUT
                                != 0,
                            // Publication positions every paragraph, so its views carry
                            // glyph facts.
                            GlyphFactDemand::Required,
                        )
                        .map_err(|error| error.in_paragraph(paragraph_id))?;
                    }
                    Ok(())
                })();
                planner.semantic_records = records;
                query?;
            }
            planner.semantic_input_spans.clear();
            planner.pending_next_glyph_id = next_glyph_id;
            planner.pending_next_content_revision = next_content_revision;
            planner.pending_compositing_independent = request.compositing_independent;
            Ok(())
        })();
        next_content_revision = next_content_revision.max(gather.projected_revision_cursor());
        if let Err(error) = preparation {
            // A failed staged gather may already have minted selected-record revisions.
            // Burn those values before invalidation snapshots the root high water.
            planner.pending_next_content_revision = planner
                .pending_next_content_revision
                .max(next_content_revision);
            self.invalidate_root(request.root_id)?;
            return Err(error);
        }
        // The closure recorded the pre-gather value. Publication may have minted
        // additional selected-record revisions; commit must adopt that high water.
        planner.pending_next_content_revision = planner
            .pending_next_content_revision
            .max(next_content_revision);
        clear_preflight_text_candidates(&mut preflight_text_candidates);
        planner.preflight_text_candidates = preflight_text_candidates;
        preflight_edit_scratch.clear();
        planner.preflight_edit_scratch = preflight_edit_scratch;
        if gather_output_matches_next {
            *prepared_gather_cache = Some(next_gather_key);
        }
        Ok(PreparedUpdate {
            root_id: request.root_id,
            previous: planner.revision,
            next,
            required_base_revision: if checkpoint { 0 } else { planner.revision.root },
            checkpoint,
            codec_handle: request.codec_handle,
            capability_set: request.capability_set,
            codec_fingerprint,
            preparation_revision: planner.preparation_revision,
        })
    }
}

/// Whether any live paragraph carries decoration records, using pending state when prepared —
/// the same view `append_planner_gather` reads.
pub(super) fn planner_has_decorations(planner: &PlannerState) -> bool {
    planner.active_order().iter().any(|ordered| {
        planner.paragraph(ordered.id).is_some_and(|paragraph| {
            let positioned = paragraph.state.positioned.active();
            !positioned.decorations().is_empty()
        })
    })
}

pub(super) fn order_only_request(request: UpdateRequest<'_>) -> bool {
    request.paragraph_mutations.len() == 0
        && request.paragraph_order_mutations.len() != 0
        && request.text_mutations.len() == 0
        && request.style_mutations.len() == 0
        && request.geometry.constraint_count() == 0
        && request.geometry.region_count() == 0
        && request.geometry.exclusion_count() == 0
        && request.geometry.inline_object_count() == 0
        && request.semantic_view_mask == 0
}

pub(super) fn request_semantic_paragraph_id(
    request: UpdateRequest<'_>,
) -> Result<Option<u32>, EngineError> {
    let mut paragraph_id = None;
    for index in 0..request.text_mutations.len() {
        merge_paragraph_id(
            &mut paragraph_id,
            request.text_mutations.paragraph_id(index),
        )?;
    }
    for index in 0..request.style_mutations.len() {
        merge_paragraph_id(
            &mut paragraph_id,
            request.style_mutations.paragraph_id(index),
        )?;
    }
    let geometry_count = request
        .geometry
        .constraint_count()
        .checked_add(request.geometry.inline_object_count())
        .ok_or(EngineError::InvalidRequest)?;
    for index in 0..geometry_count {
        merge_paragraph_id(&mut paragraph_id, request.geometry.paragraph_id(index))?;
    }
    Ok(paragraph_id)
}

pub(super) fn merge_paragraph_id(
    current: &mut Option<u32>,
    candidate: Option<u32>,
) -> Result<(), EngineError> {
    let candidate = candidate.ok_or(EngineError::InvalidRequest)?;
    if current.is_some_and(|value| value != candidate) {
        return Err(EngineError::InvalidRequest);
    }
    *current = Some(candidate);
    Ok(())
}
