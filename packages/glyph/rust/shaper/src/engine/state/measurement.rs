//! Measuring paragraphs without publication: the read path, its commit and the summary it serializes.

use super::*;

impl TextEngine {
    /// Stages one paragraph-scoped synchronous preparation. Validation, shaping, flow, and
    /// positioning run for the selected paragraph without advancing renderer-plan revision,
    /// acknowledging a renderer fence, gathering, or compiling a plan. The Wasm boundary commits
    /// this transaction only after its requested semantic result has encoded successfully.
    #[cfg(test)]
    pub(crate) fn measure_paragraph_with_shaper(
        &mut self,
        shaper: &mut ShaperRegistry,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        self.measure_paragraph_inner(Some(shaper), request, paragraph_id)
    }

    #[cfg(test)]
    pub(crate) fn measure_paragraph(
        &mut self,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        self.measure_paragraph_inner(None, request, paragraph_id)
    }

    #[cfg(test)]
    pub(super) fn measure_paragraph_inner(
        &mut self,
        shaper: Option<&mut ShaperRegistry>,
        request: UpdateRequest<'_>,
        paragraph_id: u32,
    ) -> Result<MeasuredParagraph, EngineError> {
        let prepared =
            self.prepare_paragraphs(shaper, request, PreparationTarget::One(paragraph_id))?;
        match prepared.refused {
            None => Ok(prepared.witness),
            // This entry answers with one witness or one error, so it settles the refusal itself:
            // whatever else the request prepared is committed and the paragraph's error returned.
            Some((_, error)) => {
                self.commit_measure(prepared.witness)?;
                Err(error)
            }
        }
    }

    /// Discards the derived root when a prepared query cannot be delivered.
    /// The caller-owned text remains authoritative and can be replayed after reset.
    pub(crate) fn invalidate_after_measure_failure(
        &mut self,
        measured: MeasuredParagraph,
    ) -> Result<(), EngineError> {
        let planner = self
            .planners
            .get(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision
            || planner.preparation_revision != measured.preparation_revision
            || planner.measure_generation != measured.measure_generation
        {
            self.invalidate_root(measured.root_id)?;
            return Err(EngineError::RevisionConflict);
        }
        self.invalidate_root(measured.root_id)
    }

    /// Commits one successfully encoded paragraph preparation without advancing renderer-plan
    /// revision or publication acknowledgement. The renderer plan remains independently
    /// committed; a later publication compiles it from this preparation revision.
    pub(crate) fn commit_measure(
        &mut self,
        measured: MeasuredParagraph,
    ) -> Result<u32, EngineError> {
        let validation = self.planners.get(&measured.root_id).map(|planner| {
            if planner.revision != measured.revision
                || planner.preparation_revision != measured.preparation_revision
                || planner.measure_generation != measured.measure_generation
            {
                return Err(EngineError::RevisionConflict);
            }
            let preparation_changed = planner.lifecycle_changed
                || planner.pending_preparation_ids.iter().any(|id| {
                    planner
                        .paragraph(*id)
                        .is_some_and(|paragraph| paragraph.state.has_pending_preparation())
                });
            let revision = if preparation_changed {
                planner
                    .preparation_revision
                    .checked_add(1)
                    .ok_or(EngineError::RevisionExhausted)?
            } else {
                planner.preparation_revision
            };
            Ok(revision)
        });
        let revision = match validation {
            None => return Err(EngineError::RootMissing),
            Some(Ok(validated)) => validated,
            Some(Err(error)) => {
                // Encoding succeeded, so a failed adoption is an internal contract breach.
                // Retire the derived root and let the host rebuild it from accepted authored data.
                self.invalidate_root(measured.root_id)?;
                return Err(error);
            }
        };
        let planner = self
            .planners
            .get_mut(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        planner.codec_binding = Some(CodecBinding {
            handle: measured.codec_handle,
            fingerprint: measured.codec_fingerprint,
        });
        planner.commit_paragraphs(false);
        planner.preparation_revision = revision;
        planner.semantic_input_spans.clear();
        // Preparation changes no gathered rows or renderer revision. The published gather key
        // remains the comparison baseline until publication consumes the accumulated deltas.
        Ok(revision)
    }

    pub(crate) fn measured_semantic_views(
        &self,
        measured: MeasuredParagraph,
    ) -> Result<&[crate::engine::semantic_view::SemanticRecord], EngineError> {
        let planner = self
            .planners
            .get(&measured.root_id)
            .ok_or(EngineError::RootMissing)?;
        if planner.revision != measured.revision
            || planner.preparation_revision != measured.preparation_revision
            || planner.measure_generation != measured.measure_generation
        {
            return Err(EngineError::RevisionConflict);
        }
        Ok(&planner.semantic_records)
    }
}

/// Whether a measurement carries its paragraph's glyph facts: glyph and missing-glyph counts, line
/// glyph spans and ink.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::engine) enum GlyphFactDemand {
    /// Left deferred (`MEASUREMENT_FLAG_GLYPHS_DEFERRED`): the read answers from flow layout.
    Deferred,
    /// Carried when they cost nothing more (`SEMANTIC_VIEW_AVAILABLE_GLYPH_FACTS`), deferred
    /// otherwise.
    Available,
    /// Carried, positioning the paragraph if a read left it owed.
    Required,
}
impl GlyphFactDemand {
    /// The demand a request's semantic view mask states.
    pub(in crate::engine) fn of_view_mask(mask: u32) -> Self {
        if mask
            & (crate::engine::frame::SEMANTIC_VIEW_GLYPH_FACTS
                | crate::engine::frame::SEMANTIC_VIEW_LAYOUT_INSPECTION)
            != 0
        {
            Self::Required
        } else if mask & crate::engine::frame::SEMANTIC_VIEW_AVAILABLE_GLYPH_FACTS != 0 {
            Self::Available
        } else {
            Self::Deferred
        }
    }
}

/// Emits prepared measurements and optional inspection, building missing intrinsic layout in the shared pipeline.
// D-244 found outlining this stage size-neutral; keep its inputs explicit.
#[allow(clippy::too_many_arguments)]
pub(super) fn append_paragraph_measurement(
    records: &mut Vec<crate::engine::semantic_view::SemanticRecord>,
    state: &mut ParagraphState,
    paragraph_id: u32,
    mut shaper: Option<&mut ShaperRegistry>,
    font_stacks: &[RegisteredFontStack],
    font_bindings: &[RegisteredFontBinding],
    limits: crate::engine::frame::UpdateLimits,
    include_layout_inspection: bool,
    include_borrowed_layout: bool,
    glyph_facts: GlyphFactDemand,
) -> Result<(), EngineError> {
    // A measurement carries glyph facts exactly when its request asks for them, whatever the
    // paragraph's history: a summary-only read answers from flow layout whether or not its
    // positioning is owed, so equal requests over equal text return equal records. Only a
    // request that accepts them when available (a host that never compares records) gets them
    // from a paragraph that is positioned anyway.
    let required_glyph_facts =
        glyph_facts == GlyphFactDemand::Required || include_layout_inspection;
    if let Some(leaf) = state.active_inline() {
        // An inline leaf positions its glyphs as it prepares them.
        let include_glyph_facts = required_glyph_facts || glyph_facts == GlyphFactDemand::Available;
        let line = leaf.line.as_ref().ok_or(EngineError::InvalidRequest)?;
        let fragment = leaf.fragment.as_ref().ok_or(EngineError::InvalidRequest)?;
        let count =
            u32::try_from(leaf.semantic_count()).map_err(|_| EngineError::ResultTooLarge)?;
        let starts = [0];
        let counts = [count];
        let mut source = 0u32;
        return crate::engine::layout_query::append_measurement_from_inline_occurrences(
            records,
            paragraph_id,
            state.text.active().units.len(),
            leaf.clusters.len(),
            state.geometry.active(),
            line,
            fragment,
            leaf.inline_extent,
            if include_glyph_facts {
                leaf.semantic_count()
            } else {
                0
            },
            || {
                let row = leaf
                    .row(source)
                    .ok_or(EngineError::InvalidRequest)?
                    .semantic;
                source = source.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                Ok(row)
            },
            leaf.placement_translations(),
            include_glyph_facts.then_some((&starts[..], &counts[..])),
            None,
            leaf.intrinsics,
            include_layout_inspection || include_borrowed_layout,
            include_layout_inspection,
        );
    }
    let visible_consumed_clusters = {
        let flow_thread_id = state
            .geometry
            .active()
            .constraints
            .first()
            .ok_or(EngineError::InvalidRequest)?
            .flow_thread_id;
        crate::engine::layout_query::flow_consumed_clusters(
            flow_thread_id,
            state.flow_layout.active(),
        )?
    };
    let active_flow = state.flow_layout.active();
    let active_line_count = active_flow.lines.len();
    let has_ellipsis = !active_flow.ellipsis_threads().is_empty();
    let cluster_count = state.clusters.active().starts.len();
    let constraint = state
        .geometry
        .active()
        .constraints
        .first()
        .copied()
        .ok_or(EngineError::InvalidRequest)?;
    // Intrinsic widths depend on cluster advances/breaks and wrap; unchanged reads reuse them.
    let intrinsics = state
        .intrinsic_widths_cache
        .filter(|(wrap, _)| *wrap == constraint.wrap)
        .map(|(_, widths)| widths)
        .unwrap_or_else(|| {
            let widths = state.clusters.active().intrinsic_widths(constraint.wrap);
            state.intrinsic_widths_cache = Some((constraint.wrap, widths));
            widths
        });
    let needs_intrinsic = visible_consumed_clusters < cluster_count || has_ellipsis;
    let reuse_intrinsic = !state.has_pending_preparation()
        && state.clipped_inspection.active().mode != IntrinsicInspection::None;
    if needs_intrinsic && !reuse_intrinsic {
        state.prepare_intrinsic_flow_layout(
            shaper.as_deref_mut().ok_or(EngineError::InvalidRequest)?,
            font_stacks,
            font_bindings,
            limits.max_lines,
            limits.max_slots_per_band,
        )?;
    }
    let max_lines_truncated = constraint.max_lines != 0
        && active_line_count
            >= usize::try_from(constraint.max_lines).map_err(|_| EngineError::ResultTooLarge)?;
    let inspect_full_clipped_layout =
        needs_intrinsic && constraint.overflow == OVERFLOW_CLIP && !max_lines_truncated;
    // Positions that describe the current flow make the facts free, unless a clipped paragraph
    // would first have to position its full layout.
    let include_glyph_facts = required_glyph_facts
        || (glyph_facts == GlyphFactDemand::Available
            && !state.positioning_owed()
            && !inspect_full_clipped_layout);
    // Glyph facts and the full clipped layout count positioned glyphs, so they position now.
    if (inspect_full_clipped_layout || include_glyph_facts) && state.positioning_owed() {
        state.settle_positioning(shaper.as_deref().ok_or(EngineError::InvalidRequest)?)?;
    }
    if !include_glyph_facts && !inspect_full_clipped_layout {
        let flow_thread_id = constraint.flow_thread_id;
        let geometry = state.geometry.active();
        let intrinsic_extents = needs_intrinsic
            .then(|| {
                crate::engine::layout_query::flow_extents(
                    flow_thread_id,
                    &state.intrinsic_flow_layout_scratch,
                    state.clusters.active(),
                    thread_typography(geometry, flow_thread_id),
                )
            })
            .transpose()?;
        crate::engine::layout_query::append_measurement_from_flow(
            records,
            paragraph_id,
            state.text.active().units.len(),
            cluster_count,
            geometry,
            state.flow_layout.active(),
            state.clusters.active(),
            intrinsic_extents,
            intrinsics,
        )?;
        if !reuse_intrinsic {
            state.clipped_inspection.pending_mut().mode = if needs_intrinsic {
                IntrinsicInspection::Flow
            } else {
                IntrinsicInspection::None
            };
            state.clipped_inspection.mark_prepared();
        }
        return Ok(());
    }
    if inspect_full_clipped_layout && !reuse_intrinsic {
        state
            .prepare_intrinsic_positioned(shaper.as_deref().ok_or(EngineError::InvalidRequest)?)?;
    }
    let text = &state.text.active().units;
    let clusters = state.clusters.active();
    let geometry = state.geometry.active();
    let active_flow = state.flow_layout.active();
    let active_positioned = state.positioned.active();
    let flow = if inspect_full_clipped_layout {
        &state.intrinsic_flow_layout_scratch
    } else {
        active_flow
    };
    let positioned = if inspect_full_clipped_layout {
        if reuse_intrinsic {
            &state.clipped_inspection.active().positioned
        } else {
            &state.clipped_inspection.pending().positioned
        }
    } else {
        active_positioned
    };
    let intrinsic_extents = if needs_intrinsic {
        let flow_thread_id = geometry
            .constraints
            .first()
            .ok_or(EngineError::InvalidRequest)?
            .flow_thread_id;
        Some(crate::engine::layout_query::flow_extents(
            flow_thread_id,
            &state.intrinsic_flow_layout_scratch,
            clusters,
            thread_typography(geometry, flow_thread_id),
        )?)
    } else {
        None
    };
    let boundary = if inspect_full_clipped_layout {
        &state.intrinsic_boundary_shape
    } else if state.flow_layout.is_prepared() {
        &state.pending_boundary_shape
    } else {
        &state.boundary_shape
    };
    let (line_glyph_starts, line_glyph_counts) = positioned.semantic_line_glyph_spans();
    let mut cursor = positioned.occurrence_cursor(0, clusters, boundary)?;
    crate::engine::layout_query::append_measurement_from_occurrences(
        records,
        paragraph_id,
        text.len(),
        clusters.starts.len(),
        geometry,
        flow,
        positioned.occurrence_count(),
        || {
            cursor
                .next_row()?
                .map(|row| row.semantic)
                .ok_or(EngineError::InvalidRequest)
        },
        positioned.placement_translations(),
        positioned.line_ink(),
        line_glyph_starts,
        line_glyph_counts,
        Some(positioned.semantic_line_inline_extents()),
        clusters,
        intrinsic_extents,
        intrinsics,
        include_layout_inspection || include_borrowed_layout,
        include_layout_inspection,
    )?;
    if !reuse_intrinsic {
        state.clipped_inspection.pending_mut().mode = if inspect_full_clipped_layout {
            IntrinsicInspection::Positioned
        } else if needs_intrinsic {
            IntrinsicInspection::Flow
        } else {
            IntrinsicInspection::None
        };
        state.clipped_inspection.mark_prepared();
    }
    Ok(())
}
