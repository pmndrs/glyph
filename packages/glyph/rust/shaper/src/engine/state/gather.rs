//! Gathering codec records for the renderer plan from every prepared paragraph of a root.

use super::*;

#[allow(clippy::too_many_arguments)]
pub(super) fn append_planner_gather(
    gather: &mut CodecGatherWorkspace,
    planner: &mut PlannerState,
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
    retained: bool,
    sparse: bool,
    replacement: bool,
) -> Result<(), EngineError> {
    if retained && replacement {
        return replace_planner_gather(gather, planner, codec, capability_set, font_bindings);
    }
    let mut retaining = retained;
    let mut order_index = 0;
    if retaining && sparse {
        let owners = planner_gather_owners(planner);
        let stop = gather
            .append_retained_stream(codec, capability_set, owners, |handle| {
                font_bindings
                    .iter()
                    .find(|binding| binding.handle == handle)
                    .map(|binding| &binding.binding)
            })
            .map_err(gather_error)?;
        if stop.is_some() {
            return replace_planner_gather(gather, planner, codec, capability_set, font_bindings);
        } else {
            order_index = planner.order_sort_scratch.last().map_or(Ok(0), |entry| {
                usize::try_from(entry.0)
                    .map(|index| index + 1)
                    .map_err(|_| EngineError::InvalidRequest)
            })?;
            if order_index < planner.active_order().len() {
                let first = planner
                    .paragraph(planner.active_order()[order_index].id)
                    .and_then(|p| p.gather_range);
                let last = planner
                    .active_order()
                    .last()
                    .and_then(|ordered| planner.paragraph(ordered.id))
                    .and_then(|p| p.gather_range);
                if first
                    .zip(last)
                    .is_some_and(|(first, last)| gather.retain_unchanged(first.through(last)))
                {
                    order_index = planner.active_order().len();
                }
            }
            if order_index == planner.active_order().len() && gather.finish_retained() {
                return Ok(());
            }
        }
        gather.truncate_to_retained_prefix().map_err(gather_error)?;
        retaining = false;
    }
    while order_index < planner.active_order().len() {
        let ordered = planner.active_order()[order_index];
        let paragraph_index = planner
            .paragraphs
            .binary_search_by_key(&ordered.id, |paragraph| paragraph.id)
            .map_err(|_| EngineError::InvalidRequest)?;
        let paragraph = &planner.paragraphs[paragraph_index];
        // The exact workspace cache key is checked before entering this retained walk.
        // Pending binding/preparation owners and lifecycle changes cannot borrow old ranges.
        if retaining
            && !planner.lifecycle_changed
            && !paragraph.positioned_changed
            && !paragraph.preparation_changed_since_publication
            && planner
                .pending_preparation_ids
                .binary_search(&ordered.id)
                .is_err()
            && paragraph
                .gather_range
                .is_some_and(|range| gather.retain_unchanged(range))
        {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.gather_paragraph_visits += 1);
            order_index += 1;
            continue;
        }
        let start = gather.position();
        if let Some(leaf) = paragraph.state.active_inline() {
            let input = InlinePlanInput {
                transform_id: ordered.id,
                leaf,
                styles: paragraph.state.styles.active().resolved.segments(),
                selection: None,
                copied_placement_segments: None,
            };
            let binding_for_font = |handle| {
                font_bindings
                    .iter()
                    .find(|binding| binding.handle == handle)
                    .map(|binding| &binding.binding)
            };
            if retaining {
                let intervals = paragraph
                    .gather_range
                    .filter(|range| range.source_count() == leaf.outlined_count())
                    .and_then(|_| leaf.unpublished_source_intervals());
                match gather
                    .append_retained_scoped(
                        codec,
                        capability_set,
                        input,
                        intervals,
                        binding_for_font,
                    )
                    .map_err(gather_error)?
                {
                    RetainedGather::Complete => {}
                    RetainedGather::RebuildFrom(source_start) => {
                        gather.truncate_to_retained_prefix().map_err(gather_error)?;
                        gather
                            .append_from_source(
                                codec,
                                capability_set,
                                input.into(),
                                source_start,
                                binding_for_font,
                            )
                            .map_err(gather_error)?;
                        retaining = false;
                    }
                }
            } else {
                gather
                    .append_from_source(codec, capability_set, input.into(), 0, binding_for_font)
                    .map_err(gather_error)?;
            }
            planner.paragraphs[paragraph_index].gather_range = Some(gather.range_since(start));
            order_index += 1;
            continue;
        }
        let positioned = paragraph.state.positioned.active();
        let input = ProjectedPlanInput {
            transform_id: ordered.id,
            positioned,
            context: PositionedSourceContext {
                styles: paragraph.state.styles.active().resolved.segments(),
                clusters: paragraph.state.clusters.active(),
            },
            boundary: paragraph.state.visible_boundary_shape(),
            selection: None,
            copied_placement_segments: None,
        };
        let binding_for_font = |handle| {
            font_bindings
                .iter()
                .find(|binding| binding.handle == handle)
                .map(|binding| &binding.binding)
        };
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                ordered.id,
                planner.revision.engine.max(1),
                crate::engine::codec_gather::DecorationPass::Under,
            )
            .map_err(gather_error)?;
        if retaining {
            match gather
                .append_retained_rows(
                    codec,
                    capability_set,
                    input,
                    paragraph
                        .gather_range
                        .filter(|range| {
                            sparse
                                && (paragraph.positioned_changed
                                    || paragraph.preparation_changed_since_publication)
                                && range.source_count() == positioned.outlined_count()
                        })
                        .and_then(|_| positioned.unpublished_source_intervals()),
                    paragraph.state.row_change_since_publication(),
                    binding_for_font,
                )
                .map_err(gather_error)?
            {
                RetainedGather::Complete => {}
                RetainedGather::RebuildFrom(source_start) => {
                    gather.truncate_to_retained_prefix().map_err(gather_error)?;
                    gather
                        .append_from_source(
                            codec,
                            capability_set,
                            input.into(),
                            source_start,
                            binding_for_font,
                        )
                        .map_err(gather_error)?;
                    retaining = false;
                }
            }
        } else {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.gather_paragraph_visits += 1);
            gather
                .append_from_source(codec, capability_set, input.into(), 0, binding_for_font)
                .map_err(gather_error)?;
        }
        gather
            .append_decorations(
                codec,
                capability_set,
                positioned.decorations(),
                ordered.id,
                planner.revision.engine.max(1),
                crate::engine::codec_gather::DecorationPass::Over,
            )
            .map_err(gather_error)?;
        let range = gather.range_since(start);
        planner.paragraphs[paragraph_index].gather_range = Some(range);
        order_index += 1;
    }
    if retaining && !gather.finish_retained() {
        gather.truncate_to_retained_prefix().map_err(gather_error)?;
    }
    Ok(())
}

pub(super) fn planner_gather_owners(
    planner: &PlannerState,
) -> impl Iterator<Item = Result<RetainedGatherOwner<'_>, GatherError>> + Clone {
    planner.order_sort_scratch.iter().map(|entry| {
        let paragraph = planner
            .paragraph(entry.1)
            .ok_or(GatherError::InvalidSemanticShape)?;
        let positioned = paragraph.state.positioned.active();
        let range = paragraph
            .gather_range
            .ok_or(GatherError::InvalidSemanticShape)?;
        if let Some(leaf) = paragraph.state.active_inline() {
            return Ok(RetainedGatherOwner::inline(
                range,
                entry.1,
                leaf,
                paragraph.state.styles.active().resolved.segments(),
                (paragraph.positioned_changed || paragraph.preparation_changed_since_publication)
                    .then(|| leaf.unpublished_source_intervals())
                    .flatten(),
            ));
        }
        Ok(RetainedGatherOwner::positioned(
            range,
            entry.1,
            positioned,
            PositionedSourceContext {
                styles: paragraph.state.styles.active().resolved.segments(),
                clusters: paragraph.state.clusters.active(),
            },
            paragraph.state.visible_boundary_shape(),
            (paragraph.positioned_changed || paragraph.preparation_changed_since_publication)
                .then(|| positioned.unpublished_source_intervals())
                .flatten(),
        )
        .with_row_change(paragraph.state.row_change_since_publication()))
    })
}

pub(super) fn replace_planner_gather(
    gather: &mut CodecGatherWorkspace,
    planner: &mut PlannerState,
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    font_bindings: &[RegisteredFontBinding],
) -> Result<(), EngineError> {
    let owners = planner_gather_owners(planner);
    gather
        .replace_retained_owners(codec, capability_set, owners, |handle| {
            font_bindings
                .iter()
                .find(|binding| binding.handle == handle)
                .map(|binding| &binding.binding)
        })
        .map_err(gather_error)?;
    let mut owners = gather
        .correspondence()
        .iter()
        .filter(|entry| entry.owner.is_some());
    let mut current = owners.next();
    let mut shift = None;
    let first = planner
        .order_sort_scratch
        .first()
        .ok_or(EngineError::InvalidRequest)?;
    let first = usize::try_from(first.0).map_err(|_| EngineError::InvalidRequest)?;
    // Prefix coordinates do not move. Reconcile owner and suffix offsets once in renderer order.
    for index in first..planner.active_order().len() {
        let id = planner.active_order()[index].id;
        let paragraph = planner
            .paragraph_mut(id)
            .ok_or(EngineError::InvalidRequest)?;
        let old = paragraph.gather_range.ok_or(EngineError::InvalidRequest)?;
        paragraph.gather_range = Some(
            if let Some(entry) = current.filter(|entry| entry.owner == Some(id)) {
                if entry.old != old {
                    return Err(EngineError::InvalidRequest);
                }
                shift = Some((entry.old, entry.next));
                current = owners.next();
                entry.next
            } else if let Some((previous, next)) = shift {
                old.shifted_after(previous, next).map_err(gather_error)?
            } else {
                old
            },
        );
    }
    if current.is_some() || !gather.finish_retained() {
        return Err(EngineError::InvalidRequest);
    }
    Ok(())
}
