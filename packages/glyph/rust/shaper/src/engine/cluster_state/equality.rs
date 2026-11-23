//! Canonical equality of runs and clusters across two arenas.

use super::*;

/// True exactly when the build scatter's destination equals every glyph's own
/// index: the shaped runs tile the glyph array in array order and the source
/// cluster ids never decrease across it, so per-cluster ordinals assign
/// sequentially. Simple-script LTR shaping satisfies this; any reordering
/// (RTL, Indic) falls back to the per-glyph scatter.
#[cfg(test)]
pub(super) fn scatter_is_identity(shape: &ShapeArena) -> bool {
    build::identity_range(
        shape,
        &build::ShapeScope {
            clusters: 0..0,
            source_runs: None,
            glyph_base: 0,
        },
    )
    .is_some()
}

pub(crate) fn runs_canonically_equal(
    current_clusters: &dyn CanonicalClusterView,
    current_run: LayoutRun,
    current: RunCanonicalInput<'_>,
    previous_clusters: &dyn CanonicalClusterView,
    previous_run: LayoutRun,
    previous: RunCanonicalInput<'_>,
    layout_dirty: Option<(&mut LayoutDirtyRanges, bool)>,
) -> Result<bool, EngineError> {
    let styles_unchanged = layout_dirty.as_ref().is_some_and(|(_, proven)| *proven);
    let mut layout_dirty = layout_dirty.map(|(dirty, _)| dirty);
    let current_range = run_cluster_range(current_clusters, current_run)?;
    let previous_range = run_cluster_range(previous_clusters, previous_run)?;
    if current_range.len() != previous_range.len()
        || current_run.glyph_count != previous_run.glyph_count
        || current_run.font_handle != previous_run.font_handle
    {
        if let Some(dirty) = layout_dirty {
            dirty.valid = false;
        }
        return Ok(false);
    }
    let text_equal = run_text_equal(
        current_clusters,
        current_range.clone(),
        current,
        previous_clusters,
        previous_range.clone(),
        previous,
    )?;
    if !text_equal && layout_dirty.as_ref().is_none_or(|dirty| !dirty.valid) {
        return Ok(false);
    }
    let mut equal = text_equal;
    for (current_index, previous_index) in current_range.zip(previous_range) {
        let current_cluster = current_clusters
            .cluster(current_index)
            .ok_or(EngineError::InvalidRequest)?;
        let previous_cluster = previous_clusters
            .cluster(previous_index)
            .ok_or(EngineError::InvalidRequest)?;
        if let Some(dirty) = layout_dirty.as_deref_mut()
            && dirty.valid
            && (current_index != previous_index
                || current_cluster.text_start != previous_cluster.text_start
                || current_cluster.text_end != previous_cluster.text_end
                || current_cluster.glyph_count != previous_cluster.glyph_count
                || (current_cluster.flags | previous_cluster.flags) & CLUSTER_BREAK_CORRECTION != 0)
        {
            dirty.valid = false;
        }
        let cluster_equal = clusters_canonically_equal(
            current_clusters,
            current_index,
            current,
            previous_clusters,
            previous_index,
            previous,
            ClusterComparison {
                text_equal,
                styles_unchanged: styles_unchanged
                    && layout_dirty.as_ref().is_some_and(|dirty| dirty.valid),
            },
        )?;
        if !cluster_equal {
            if let Some(dirty) = layout_dirty.as_deref_mut()
                && dirty.valid
            {
                dirty.record(current_cluster.text_start..current_cluster.text_end)?;
            }
            equal = false;
            if layout_dirty.as_ref().is_none_or(|dirty| !dirty.valid) {
                return Ok(false);
            }
        }
    }
    Ok(equal)
}

pub(super) fn clusters_canonically_equal(
    current_clusters: &dyn CanonicalClusterView,
    current_index: usize,
    current: RunCanonicalInput<'_>,
    previous_clusters: &dyn CanonicalClusterView,
    previous_index: usize,
    previous: RunCanonicalInput<'_>,
    comparison: ClusterComparison,
) -> Result<bool, EngineError> {
    #[cfg(test)]
    crate::engine::work_attribution::record(|work| work.canonical_cluster_comparisons += 1);
    let a = current_clusters
        .cluster(current_index)
        .ok_or(EngineError::InvalidRequest)?;
    let b = previous_clusters
        .cluster(previous_index)
        .ok_or(EngineError::InvalidRequest)?;
    let a_text_len = a
        .text_end
        .checked_sub(a.text_start)
        .filter(|length| *length != 0)
        .ok_or(EngineError::InvalidRequest)?;
    let b_text_len = b
        .text_end
        .checked_sub(b.text_start)
        .filter(|length| *length != 0)
        .ok_or(EngineError::InvalidRequest)?;
    Ok(!(a.stable_text_id != b.stable_text_id
        || a_text_len != b_text_len
        || a.advance.to_bits() != b.advance.to_bits()
        || a.advance_units != b.advance_units
        || a.units_per_em.to_bits() != b.units_per_em.to_bits()
        || a.flags != b.flags
        || a.font_handle != b.font_handle
        || a.glyph_count != b.glyph_count
        || a.shaped != b.shaped
        || a.unsafe_before != b.unsafe_before
        || !cluster_direction_equal(a, current, b, previous)?
        || (!comparison.styles_unchanged && {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| work.canonical_style_resolutions += 2);
            !geometric_style_equal(
                cluster_style(a, current.styles)?,
                current.style_arena,
                cluster_style(b, previous.styles)?,
                previous.style_arena,
            )
        })
        || !cluster_glyphs_equal(current_clusters, a, previous_clusters, b)?
        || (!comparison.text_equal && {
            let current_range = usize::try_from(a.text_start)
                .map_err(|_| EngineError::InvalidRequest)?
                ..usize::try_from(a.text_end).map_err(|_| EngineError::InvalidRequest)?;
            let previous_range = usize::try_from(b.text_start)
                .map_err(|_| EngineError::InvalidRequest)?
                ..usize::try_from(b.text_end).map_err(|_| EngineError::InvalidRequest)?;
            current
                .text
                .get(current_range.clone())
                .ok_or(EngineError::InvalidRequest)?
                != previous
                    .text
                    .get(previous_range.clone())
                    .ok_or(EngineError::InvalidRequest)?
                || current
                    .text_unit_ids
                    .get(current_range)
                    .ok_or(EngineError::InvalidRequest)?
                    != previous
                        .text_unit_ids
                        .get(previous_range)
                        .ok_or(EngineError::InvalidRequest)?
        })))
}

pub(super) fn run_cluster_range(
    clusters: &dyn CanonicalClusterView,
    run: LayoutRun,
) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(run.cluster_start).map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(run.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
    if start >= end || end > clusters.cluster_count() {
        return Err(EngineError::InvalidRequest);
    }
    let first = clusters.cluster(start).ok_or(EngineError::InvalidRequest)?;
    let last = clusters
        .cluster(end - 1)
        .ok_or(EngineError::InvalidRequest)?;
    let glyph_end = last
        .glyph_start
        .checked_add(last.glyph_count)
        .ok_or(EngineError::InvalidRequest)?;
    if first.glyph_start != run.glyph_start
        || glyph_end.checked_sub(run.glyph_start) != Some(run.glyph_count)
    {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start..end)
}

pub(super) fn run_text_equal(
    current_clusters: &dyn CanonicalClusterView,
    current_range: core::ops::Range<usize>,
    current: RunCanonicalInput<'_>,
    previous_clusters: &dyn CanonicalClusterView,
    previous_range: core::ops::Range<usize>,
    previous: RunCanonicalInput<'_>,
) -> Result<bool, EngineError> {
    #[cfg(test)]
    crate::engine::work_attribution::record(|work| work.canonical_text_validations += 1);
    if current.text.len() != current.text_unit_ids.len()
        || previous.text.len() != previous.text_unit_ids.len()
    {
        return Err(EngineError::InvalidRequest);
    }
    let current_text = run_text_range(current_clusters, current_range)?;
    let previous_text = run_text_range(previous_clusters, previous_range)?;
    Ok(current
        .text
        .get(current_text.clone())
        .ok_or(EngineError::InvalidRequest)?
        == previous
            .text
            .get(previous_text.clone())
            .ok_or(EngineError::InvalidRequest)?
        && current
            .text_unit_ids
            .get(current_text)
            .ok_or(EngineError::InvalidRequest)?
            == previous
                .text_unit_ids
                .get(previous_text)
                .ok_or(EngineError::InvalidRequest)?)
}

pub(super) fn run_text_range(
    clusters: &dyn CanonicalClusterView,
    range: core::ops::Range<usize>,
) -> Result<core::ops::Range<usize>, EngineError> {
    let start = usize::try_from(
        clusters
            .cluster(range.start)
            .ok_or(EngineError::InvalidRequest)?
            .text_start,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    let end = usize::try_from(
        clusters
            .cluster(range.end - 1)
            .ok_or(EngineError::InvalidRequest)?
            .text_end,
    )
    .map_err(|_| EngineError::InvalidRequest)?;
    if start >= end {
        return Err(EngineError::InvalidRequest);
    }
    Ok(start..end)
}

pub(super) fn geometric_style_equal(
    current: crate::engine::style_state::ResolvedStyle,
    current_arena: &StyleArena,
    previous: crate::engine::style_state::ResolvedStyle,
    previous_arena: &StyleArena,
) -> bool {
    current.font_stack_handle == previous.font_stack_handle
        && current.font_size.to_bits() == previous.font_size.to_bits()
        && current.letter_spacing.to_bits() == previous.letter_spacing.to_bits()
        && current.word_spacing.to_bits() == previous.word_spacing.to_bits()
        && current.baseline_shift.to_bits() == previous.baseline_shift.to_bits()
        && current.direction == previous.direction
        && current.bidi_override == previous.bidi_override
        && current_arena.resolved_language(current) == previous_arena.resolved_language(previous)
        && current_arena.resolved_features(current) == previous_arena.resolved_features(previous)
}

pub(super) fn cluster_direction_equal(
    a: CanonicalCluster,
    current: RunCanonicalInput<'_>,
    b: CanonicalCluster,
    previous: RunCanonicalInput<'_>,
) -> Result<bool, EngineError> {
    match (a.source_run, b.source_run) {
        (NO_SOURCE_RUN, NO_SOURCE_RUN) => Ok(true),
        (NO_SOURCE_RUN, _) | (_, NO_SOURCE_RUN) => Ok(false),
        (current_index, previous_index) => {
            let current_run = current
                .shaping_runs
                .get(usize::try_from(current_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            let previous_run = previous
                .shaping_runs
                .get(usize::try_from(previous_index).map_err(|_| EngineError::InvalidRequest)?)
                .ok_or(EngineError::InvalidRequest)?;
            Ok(current_run.direction == previous_run.direction
                && current_run.bidi_level == previous_run.bidi_level
                && current_run.script == previous_run.script)
        }
    }
}

pub(super) fn cluster_glyphs_equal(
    current: &dyn CanonicalClusterView,
    a: CanonicalCluster,
    previous: &dyn CanonicalClusterView,
    b: CanonicalCluster,
) -> Result<bool, EngineError> {
    let a_start = usize::try_from(a.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let b_start = usize::try_from(b.glyph_start).map_err(|_| EngineError::InvalidRequest)?;
    let count = usize::try_from(a.glyph_count).map_err(|_| EngineError::InvalidRequest)?;
    for ordinal in 0..count {
        let left = current
            .glyph(a_start + ordinal)
            .ok_or(EngineError::InvalidRequest)?;
        let right = previous
            .glyph(b_start + ordinal)
            .ok_or(EngineError::InvalidRequest)?;
        if left.glyph_id != right.glyph_id
            || left.x_advance != right.x_advance
            || left.x_offset != right.x_offset
            || left.y_offset != right.y_offset
            || left.flags != right.flags
            || left.stable_id != right.stable_id
        {
            return Ok(false);
        }
    }
    Ok(true)
}
