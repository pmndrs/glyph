//! One frame's update request: staging planner input, preparing paragraphs and the renderer plan.

use crate::cold_growth::ColdGrowth as _;

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
        shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        publication_generation: u32,
    ) -> Result<PreparedUpdate, EngineError> {
        if !request.limits.all_nonzero() {
            return Err(EngineError::InvalidRequest);
        }
        let codec = update_codec(&self.codecs, request)?;
        let codec_fingerprint = codec.fingerprint();
        let cached_gather = self.gather_cache;
        let mut target = GatherTarget {
            workspace: &mut self.gather,
            cache: &mut self.gather_cache,
            prepared_cache: &mut self.prepared_gather_cache,
        };
        let planner = self
            .planners
            .get_mut(&request.root_id)
            .ok_or(EngineError::RootMissing)?;
        check_update_admission(planner, request, publication_generation, codec_fingerprint)?;
        let StagedInputs {
            implicit_paragraph,
            lifecycle_plan,
            spare_text_candidate_id,
            mut preflight_text_candidates,
            mut preflight_edit_scratch,
        } = stage_planner_inputs(
            planner,
            request,
            ParagraphInputScope::Indexed,
            &self.font_stacks,
        )?;
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
        target
            .workspace
            .set_projected_revision_cursor(next_content_revision);
        let pass = UpdatePass {
            request,
            codec,
            font_bindings: &self.font_bindings,
            font_stacks: &self.font_stacks,
            publication_generation,
            checkpoint,
            preparation_changed,
            gather_current: cached_gather == Some(current_gather_key),
            next_content_revision,
        };
        planner.semantic_records.clear();
        let preparation = planner
            .prepare_lifecycle(
                request.paragraph_mutations,
                request.paragraph_order_mutations,
                implicit_paragraph,
                request.limits.max_paragraphs,
                lifecycle_plan,
                spare_text_candidate_id,
            )
            .and_then(|()| {
                prepare_root_update(
                    planner,
                    shaper,
                    &mut target,
                    pass,
                    &mut next_glyph_id,
                    &mut preflight_text_candidates,
                    &preflight_edit_scratch,
                )
            });
        next_content_revision =
            next_content_revision.max(target.workspace.projected_revision_cursor());
        let gather_output_matches_next = match preparation {
            Ok(matches) => matches,
            Err(error) => {
                // A failed staged gather may already have minted selected-record revisions.
                // Burn those values before invalidation snapshots the root high water.
                planner.pending_next_content_revision = planner
                    .pending_next_content_revision
                    .max(next_content_revision);
                self.invalidate_root(request.root_id)?;
                return Err(error);
            }
        };
        // Preparation recorded the pre-gather value. Publication may have minted
        // additional selected-record revisions; commit must adopt that high water.
        planner.pending_next_content_revision = planner
            .pending_next_content_revision
            .max(next_content_revision);
        clear_preflight_text_candidates(&mut preflight_text_candidates);
        planner.preflight_text_candidates = preflight_text_candidates;
        preflight_edit_scratch.clear();
        planner.preflight_edit_scratch = preflight_edit_scratch;
        if gather_output_matches_next {
            *target.prepared_cache = Some(next_gather_key);
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

/// What one update request fixed before any paragraph of its root is prepared.
#[derive(Clone, Copy)]
struct UpdatePass<'u> {
    request: UpdateRequest<'u>,
    codec: &'u ValidatedCodec,
    font_bindings: &'u [RegisteredFontBinding],
    font_stacks: &'u [RegisteredFontStack],
    publication_generation: u32,
    /// The renderer rebuilds from nothing: a first publication, or a consumer that missed one.
    checkpoint: bool,
    /// Some paragraph was prepared (by a read) since the root's last publication.
    preparation_changed: bool,
    /// The gather workspace holds this root's last publication under this codec.
    gather_current: bool,
    next_content_revision: u32,
}

/// The engine's one gather workspace and the caches that say whose output it holds.
struct GatherTarget<'u> {
    workspace: &'u mut CodecGatherWorkspace,
    cache: &'u mut Option<GatherCacheKey>,
    prepared_cache: &'u mut Option<GatherCacheKey>,
}

/// The codec an update names, with the capability set it asks for.
#[inline(always)]
fn update_codec<'c>(
    codecs: &'c IdMap<ValidatedCodec>,
    request: UpdateRequest<'_>,
) -> Result<&'c ValidatedCodec, EngineError> {
    let codec = codecs
        .get(&request.codec_handle)
        .ok_or(EngineError::CodecMissing)?;
    if codec
        .capability_set(CapabilitySetId(request.capability_set))
        .is_none()
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(codec)
}

/// Refuses an update whose codec differs from the root's binding or whose revisions and
/// publication generations do not follow the root's.
#[inline(always)]
fn check_update_admission(
    planner: &PlannerState,
    request: UpdateRequest<'_>,
    publication_generation: u32,
    codec_fingerprint: u64,
) -> Result<(), EngineError> {
    if planner.codec_binding.is_some_and(|binding| {
        binding.handle != request.codec_handle || binding.fingerprint != codec_fingerprint
    }) {
        return Err(EngineError::InvalidRequest);
    }
    if request.expected_engine_revision != planner.revision.engine
        || request.consumed_revision > planner.revision.root
        || publication_generation == 0
        || request.acknowledged_publication_generation < planner.acknowledged_publication_generation
        || request.acknowledged_publication_generation >= publication_generation
    {
        return Err(EngineError::RevisionConflict);
    }
    Ok(())
}

/// Everything an update prepares after the root's lifecycle: paragraphs, placement slots, the
/// gathered plan and the measurement views. Returns whether the gather workspace then holds the
/// next revision's output.
#[inline(always)]
fn prepare_root_update(
    planner: &mut PlannerState,
    mut shaper: Option<&mut ShaperRegistry>,
    target: &mut GatherTarget<'_>,
    pass: UpdatePass<'_>,
    next_glyph_id: &mut u32,
    preflight_text_candidates: &mut [PreflightTextCandidate],
    preflight_edit_scratch: &[TextEdit],
) -> Result<bool, EngineError> {
    let request = pass.request;
    // A read may have left positioning owed; publication draws positions, so it settles
    // that first, against the predecessor the read kept.
    if let Some(shaper) = shaper.as_deref() {
        planner.settle_owed_positioning(shaper)?;
    }
    if reorder_only(planner, pass)
        && try_prepare_reorder_only(planner, target, pass, *next_glyph_id)?
    {
        return Ok(false);
    }
    planner.prepare_semantic_work_order()?;
    for order_index in 0..planner.order_sort_scratch.len() {
        let paragraph_id = planner.order_sort_scratch[order_index].1;
        prepare_dirty_paragraph(
            planner,
            shaper.as_deref_mut(),
            pass,
            paragraph_id,
            next_glyph_id,
            preflight_text_candidates,
            preflight_edit_scratch,
        )?;
    }
    let positioned_changed = prepare_update_placement(planner, pass)?;
    let gather_output_matches_next = if !pass.checkpoint
        && !positioned_changed
        && request.compositing_independent == planner.compositing_independent
    {
        planner.plan.prepare_reuse().map_err(plan_error)?;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.prepare_reuse_modes += 1);
        pass.gather_current
    } else {
        prepare_gathered_plan(planner, target, pass)?;
        true
    };
    append_update_measurements(planner, shaper, pass)?;
    planner.semantic_input_spans.clear();
    planner.pending_next_glyph_id = *next_glyph_id;
    planner.pending_next_content_revision = pass.next_content_revision;
    planner.pending_compositing_independent = request.compositing_independent;
    Ok(gather_output_matches_next)
}

/// Whether the update only reorders unchanged paragraphs of a published root.
#[inline(always)]
fn reorder_only(planner: &PlannerState, pass: UpdatePass<'_>) -> bool {
    !pass.checkpoint
        && !pass.preparation_changed
        && planner.lifecycle_changed
        && order_only_request(pass.request)
        && pass.request.compositing_independent == planner.compositing_independent
        && !planner_has_decorations(planner)
}

/// Re-sorts the published instances by their stable ids, reusing every prepared batch. Returns
/// whether the plan accepted the reorder; otherwise the update prepares as usual.
#[inline(always)]
fn try_prepare_reorder_only(
    planner: &mut PlannerState,
    target: &mut GatherTarget<'_>,
    pass: UpdatePass<'_>,
    next_glyph_id: u32,
) -> Result<bool, EngineError> {
    let mut stable_ids = core::mem::take(&mut planner.reorder_stable_ids);
    stable_ids.clear();
    let reorder_prepared =
        match collect_reorder_stable_ids(planner, pass.font_bindings, &mut stable_ids) {
            Ok(()) => planner.plan.prepare_reorder(
                pass.codec,
                CapabilitySetId(pass.request.capability_set),
                &stable_ids,
                pass.publication_generation,
            ),
            Err(error) => {
                planner.reorder_stable_ids = stable_ids;
                return Err(error);
            }
        };
    planner.reorder_stable_ids = stable_ids;
    if !reorder_prepared.map_err(plan_error)? {
        return Ok(false);
    }
    planner
        .placement_slots
        .prepare_reuse(pass.publication_generation)
        .map_err(placement_slot_error)?;
    planner.pending_placement_slot_count = planner.placement_slot_count;
    planner.session_placement_rows.clear();
    planner.pending_next_glyph_id = next_glyph_id;
    planner.pending_next_content_revision = pass.next_content_revision;
    planner.pending_compositing_independent = pass.request.compositing_independent;
    *target.cache = None;
    *target.prepared_cache = None;
    Ok(true)
}

/// The outlined glyphs of every active paragraph, in order.
#[inline(always)]
fn active_outlined_total(planner: &PlannerState) -> Result<usize, EngineError> {
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
        })
}

/// The stable ids of the drawn glyphs in publication order, which a reorder sorts instances by.
#[inline(always)]
fn collect_reorder_stable_ids(
    planner: &PlannerState,
    font_bindings: &[RegisteredFontBinding],
    stable_ids: &mut Vec<u32>,
) -> Result<(), EngineError> {
    let required = active_outlined_total(planner)?;
    stable_ids
        .try_reserve_cold(required)
        .map_err(|_| EngineError::ResultTooLarge)?;
    for ordered in planner.active_order() {
        let paragraph = planner
            .paragraph(ordered.id)
            .ok_or(EngineError::InvalidRequest)?;
        match paragraph.state.active_inline() {
            Some(leaf) => {
                push_inline_stable_ids(leaf, &paragraph.state, font_bindings, stable_ids)?
            }
            None => push_positioned_stable_ids(&paragraph.state, font_bindings, stable_ids)?,
        }
    }
    Ok(())
}

#[inline(always)]
fn push_inline_stable_ids(
    leaf: &InlineLeaf,
    state: &ParagraphState,
    font_bindings: &[RegisteredFontBinding],
    stable_ids: &mut Vec<u32>,
) -> Result<(), EngineError> {
    let styles = state.styles.active().resolved.segments();
    for source in leaf.outlined_sources() {
        let glyph = leaf.projected_source_row(source, source, 0, styles)?.glyph;
        if let Some(stable_id) = drawn_stable_id(font_bindings, glyph)? {
            stable_ids.push(stable_id);
        }
    }
    Ok(())
}

#[inline(always)]
fn push_positioned_stable_ids(
    state: &ParagraphState,
    font_bindings: &[RegisteredFontBinding],
    stable_ids: &mut Vec<u32>,
) -> Result<(), EngineError> {
    let positioned = state.positioned.active();
    let context = PositionedSourceContext {
        styles: state.styles.active().resolved.segments(),
        clusters: state.clusters.active(),
    };
    let boundary = state.visible_boundary_shape();
    let mut outlined = positioned.outlined_cursor(context.clusters, boundary);
    while let Some(mark) = outlined.next_mark()? {
        let occurrence = outlined.project(mark)?;
        let glyph = positioned
            .projected_occurrence_row(occurrence, mark.semantic_index, 0, context)?
            .glyph;
        if let Some(stable_id) = drawn_stable_id(font_bindings, glyph)? {
            stable_ids.push(stable_id);
        }
    }
    Ok(())
}

/// A gathered glyph's stable id, or `None` when no strike of its binding draws it.
#[inline]
fn drawn_stable_id(
    font_bindings: &[RegisteredFontBinding],
    glyph: crate::engine::codec_gather::LayoutGlyph,
) -> Result<Option<u32>, EngineError> {
    let binding = font_bindings
        .iter()
        .find(|binding| binding.handle == glyph.binding_handle)
        .ok_or_else(|| gather_error(GatherError::FontBindingMissing))?;
    if binding
        .binding
        .select(glyph.glyph_id, glyph.font_size, glyph.raster_pixel_ratio)
        .is_none()
    {
        return Ok(None);
    }
    if glyph.stable_id == 0 {
        return Err(EngineError::InvalidRequest);
    }
    Ok(Some(glyph.stable_id))
}

/// Prepares one paragraph the update carries input for, or that a read left pending.
#[inline(always)]
fn prepare_dirty_paragraph(
    planner: &mut PlannerState,
    shaper: Option<&mut ShaperRegistry>,
    pass: UpdatePass<'_>,
    paragraph_id: u32,
    next_glyph_id: &mut u32,
    preflight_text_candidates: &mut [PreflightTextCandidate],
    preflight_edit_scratch: &[TextEdit],
) -> Result<(), EngineError> {
    let request = pass.request;
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
        return Ok(());
    }
    admit_preparation_owner(
        &mut planner.pending_preparation_ids,
        &mut planner.unpublished_preparation_ids,
        paragraph_id,
    )?;
    let preflight_candidate = preflight_text_candidate_mut(preflight_text_candidates, paragraph_id);
    let paragraph = planner
        .paragraph_mut(paragraph_id)
        .ok_or(EngineError::InvalidRequest)?;
    paragraph.positioned_changed = paragraph
        .state
        .prepare(
            shaper,
            pass.font_stacks,
            pass.font_bindings,
            text,
            styles,
            geometry,
            request.limits,
            next_glyph_id,
            preflight_candidate,
            preflight_edit_scratch,
            deferred_positioning::PositioningDemand::Now,
        )
        .map_err(|error| error.in_paragraph(paragraph_id))?;
    Ok(())
}

/// Prepares the root's placement slots, or reuses them when nothing positioned changed. Returns
/// whether any positioned output changed.
#[inline(always)]
fn prepare_update_placement(
    planner: &mut PlannerState,
    pass: UpdatePass<'_>,
) -> Result<bool, EngineError> {
    let positioned_changed = pass.preparation_changed
        || planner.lifecycle_changed
        || !planner.unpublished_preparation_ids.is_empty()
        || planner.pending_preparation_ids.iter().any(|id| {
            planner
                .paragraph(*id)
                .is_some_and(|paragraph| paragraph.positioned_changed)
        });
    if positioned_changed || pass.checkpoint {
        planner.prepare_placement_slots(
            pass.publication_generation,
            pass.preparation_changed,
            pass.checkpoint,
        )?;
    } else {
        planner
            .placement_slots
            .prepare_reuse(pass.publication_generation)
            .map_err(placement_slot_error)?;
        planner.pending_placement_slot_count = planner.placement_slot_count;
        planner.session_placement_rows.clear();
    }
    Ok(positioned_changed)
}

/// Gathers the root's records (retained where the previous gather allows) and prepares the
/// renderer plan from them.
#[inline(always)]
fn prepare_gathered_plan(
    planner: &mut PlannerState,
    target: &mut GatherTarget<'_>,
    pass: UpdatePass<'_>,
) -> Result<(), EngineError> {
    let request = pass.request;
    let retainable = pass.gather_current && !pass.checkpoint;
    let sparse = retainable && planner.prepare_retained_order(RetainedOrderPurpose::Gather)?;
    let replacement = if retainable && !sparse {
        planner.prepare_replacement_gather_order()?
    } else {
        None
    };
    let record_count = match replacement {
        Some(count) => count,
        None if sparse => planner
            .gathered_source_count
            .ok_or(EngineError::InvalidRequest)?,
        None => active_outlined_total(planner)?,
    };
    *target.cache = None;
    *target.prepared_cache = None;
    let capability_set = CapabilitySetId(request.capability_set);
    // Decoration rows bypass the retained gather cursor arithmetic, so a retained plan with
    // any decorated paragraph must rebuild from a reset workspace; entering the
    // retained path and falling back mid-append would stack fresh rows onto the
    // previous update's buffers.
    let ranges_reusable = !owner_kind_changed(planner)
        && (sparse || replacement.is_some() || !planner_has_decorations(planner));
    let gather = &mut *target.workspace;
    let retained = gather_planner_records(
        gather,
        planner,
        pass,
        record_count,
        pass.gather_current && ranges_reusable,
        sparse,
        replacement.is_some(),
    )?;
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
    let output_scope = retained_output_scope(gather, planner.revision.root, sparse, retained);
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
            pass.codec
                .capability_set(capability_set)
                .ok_or(EngineError::InvalidRequest)?,
            pass.publication_generation,
            pass.checkpoint,
        )
        .map_err(plan_error)?;
    planner
        .plan
        .prepare_owned(
            pass.codec,
            capability_set,
            plan_input,
            pass.checkpoint,
            pass.publication_generation,
            request.acknowledged_publication_generation,
            output_scope,
            gather.bounds_changed(),
        )
        .map_err(plan_error)?;
    Ok(())
}

/// Whether a paragraph's published owner switched between the inline and general paths.
#[inline(always)]
fn owner_kind_changed(planner: &PlannerState) -> bool {
    planner.active_order().iter().any(|ordered| {
        planner.paragraph(ordered.id).is_some_and(|paragraph| {
            paragraph.gather_range.is_some()
                && paragraph.published_owner_inline
                    != Some(paragraph.state.active_inline().is_some())
        })
    })
}

/// Gathers every record of the root into the workspace, retaining the previous rows when
/// `attempt_retained` and the workspace admit it. Returns whether the gather was retained.
#[inline(always)]
fn gather_planner_records(
    gather: &mut CodecGatherWorkspace,
    planner: &mut PlannerState,
    pass: UpdatePass<'_>,
    record_count: usize,
    attempt_retained: bool,
    sparse: bool,
    replacement: bool,
) -> Result<bool, EngineError> {
    let capability_set = CapabilitySetId(pass.request.capability_set);
    let retained = attempt_retained
        && gather
            .begin_retained(pass.codec, record_count)
            .map_err(gather_error)?;
    if retained {
        append_planner_gather(
            gather,
            planner,
            pass.codec,
            capability_set,
            pass.font_bindings,
            true,
            sparse || replacement,
            replacement,
        )?;
    } else {
        gather
            .begin(pass.codec, record_count)
            .map_err(gather_error)?;
        append_planner_gather(
            gather,
            planner,
            pass.codec,
            capability_set,
            pass.font_bindings,
            false,
            false,
            false,
        )?;
    }
    Ok(retained)
}

/// The outputs a retained gather changed, for the plan to patch instead of rewrite.
#[inline(always)]
fn retained_output_scope(
    gather: &CodecGatherWorkspace,
    previous_revision: u32,
    sparse: bool,
    retained: bool,
) -> Option<crate::engine::render_plan_compiler::OwnedOutputScope<'_>> {
    if sparse && let Some(records) = gather.changed_output_intervals() {
        return Some(crate::engine::render_plan_compiler::OwnedOutputScope {
            previous_revision,
            scope: crate::engine::ordered_plan::RetainedOutputScope::ChangedIntervals(
                records,
                gather.changed_inputs(),
            ),
        });
    }
    gather
        .correspondence()
        .first()
        .filter(|_| retained)
        .map(|_| crate::engine::render_plan_compiler::OwnedOutputScope {
            previous_revision,
            scope: crate::engine::ordered_plan::RetainedOutputScope::Replacement(
                gather.correspondence(),
            ),
        })
}

/// Appends the measurement, inspection and glyph-fact views the update asks for.
#[inline(always)]
fn append_update_measurements(
    planner: &mut PlannerState,
    shaper: Option<&mut ShaperRegistry>,
    pass: UpdatePass<'_>,
) -> Result<(), EngineError> {
    if pass.request.semantic_view_mask
        & (crate::engine::frame::SEMANTIC_VIEW_MEASUREMENT
            | crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION
            | crate::engine::frame::SEMANTIC_VIEW_GLYPH_FACTS)
        == 0
    {
        return Ok(());
    }
    let mut records = core::mem::take(&mut planner.semantic_records);
    let query = append_due_measurements(planner, &mut records, shaper, pass);
    planner.semantic_records = records;
    query
}

#[inline(always)]
fn append_due_measurements(
    planner: &mut PlannerState,
    records: &mut Vec<crate::engine::semantic_view::SemanticRecord>,
    mut shaper: Option<&mut ShaperRegistry>,
    pass: UpdatePass<'_>,
) -> Result<(), EngineError> {
    let mask = pass.request.semantic_view_mask;
    let include_layout_inspection =
        mask & crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION != 0;
    // Glyph facts alone ask for the summaries, with their facts, of the paragraphs prepared
    // since the last publication only: the ones a summary-only read may have measured.
    let glyph_facts_only = mask
        & (crate::engine::frame::SEMANTIC_VIEW_MEASUREMENT
            | crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
        == 0
        && mask & crate::engine::frame::SEMANTIC_VIEW_GLYPH_FACTS != 0;
    for order_index in 0..planner.active_order().len() {
        let paragraph_id = planner.active_order()[order_index].id;
        if !measurement_due(
            planner,
            paragraph_id,
            glyph_facts_only,
            pass.preparation_changed,
        )? {
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
            records,
            &mut paragraph.state,
            paragraph_id,
            shaper.as_deref_mut(),
            pass.font_stacks,
            pass.font_bindings,
            pass.request.limits,
            include_layout_inspection,
            mask & crate::engine::frame::SEMANTIC_VIEW_BORROWED_LAYOUT != 0,
            // Publication positions every paragraph, so its views carry
            // glyph facts.
            GlyphFactDemand::Required,
        )
        .map_err(|error| error.in_paragraph(paragraph_id))?;
    }
    Ok(())
}

/// Whether the update's views answer for this paragraph.
#[inline(always)]
fn measurement_due(
    planner: &PlannerState,
    paragraph_id: u32,
    glyph_facts_only: bool,
    preparation_changed: bool,
) -> Result<bool, EngineError> {
    let input_unchanged = planner.semantic_input_spans(paragraph_id).is_empty();
    let paragraph = planner
        .paragraph(paragraph_id)
        .ok_or(EngineError::InvalidRequest)?;
    let positioned_changed =
        paragraph.positioned_changed || paragraph.preparation_changed_since_publication;
    if input_unchanged && !positioned_changed && !preparation_changed {
        return Ok(false);
    }
    // Glyph facts answer summaries of paragraphs prepared since the last
    // publication; a refused one was emptied and has none to answer.
    Ok(!(glyph_facts_only
        && (!planner.unpublished_preparation_ids.contains(&paragraph_id)
            || paragraph.state.geometry.active().constraints.is_empty())))
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
