//! Stable glyph ids and canonical layout-run revisions.

use super::*;

/// One stable-ID rule for both prepared owners. The previous owner is read through canonical
/// facts; the current owner supplies its cluster headers and the final ID destination. This
/// keeps General's indexed O(old+new+glyphs) behavior when a small leaf follows a long rope.
pub(crate) fn assign_stable_glyph_ids_from_view(
    previous: &dyn CanonicalClusterView,
    current_count: usize,
    mut current: impl FnMut(usize) -> Option<(u32, u32, u32)>,
    destination: &mut [u32],
    index: &mut IdentityIndex,
    next_id: &mut u32,
) -> Result<(), EngineError> {
    index
        .prepare(previous.identity_cluster_count())
        .map_err(identity_index_error)?;
    for cluster_index in 0..previous.identity_cluster_count() {
        let stable_text_id = previous
            .stable_text_id(cluster_index)
            .ok_or(EngineError::InvalidRequest)?;
        index
            .insert(
                stable_text_id,
                u32::try_from(cluster_index).map_err(|_| EngineError::ResultTooLarge)?,
            )
            .map_err(identity_index_error)?;
    }
    *next_id = (*next_id).max(1);
    for cluster_index in 0..current_count {
        let (stable_text_id, glyph_start, glyph_count) =
            current(cluster_index).ok_or(EngineError::InvalidRequest)?;
        let prior = index
            .get(stable_text_id)
            .and_then(|slot| previous.glyph_span(slot as usize));
        for ordinal in 0..glyph_count {
            let destination_index = usize::try_from(
                glyph_start
                    .checked_add(ordinal)
                    .ok_or(EngineError::ResultTooLarge)?,
            )
            .map_err(|_| EngineError::ResultTooLarge)?;
            let stable_id =
                if let Some((old_start, _)) = prior.filter(|(_, count)| ordinal < *count) {
                    let old_index = old_start
                        .checked_add(ordinal)
                        .ok_or(EngineError::ResultTooLarge)?;
                    previous
                        .stable_glyph_id(old_index as usize)
                        .filter(|id| *id != 0)
                        .ok_or(EngineError::InvalidRequest)?
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
            *destination
                .get_mut(destination_index)
                .ok_or(EngineError::InvalidRequest)? = stable_id;
        }
    }
    Ok(())
}

pub(crate) fn prepare_run_revision_index(
    previous: &dyn CanonicalClusterView,
    index: &mut IdentityIndex,
) -> Result<(), EngineError> {
    index
        .prepare(previous.layout_run_count())
        .map_err(identity_index_error)?;
    for run_index in 0..previous.layout_run_count() {
        let run = previous
            .layout_run(run_index)
            .ok_or(EngineError::InvalidRequest)?;
        let anchor = previous
            .stable_text_id(run.cluster_start as usize)
            .filter(|anchor| *anchor != 0)
            .ok_or(EngineError::InvalidRequest)?;
        index
            .insert(
                anchor,
                u32::try_from(run_index).map_err(|_| EngineError::ResultTooLarge)?,
            )
            .map_err(identity_index_error)?;
    }
    Ok(())
}

pub(crate) fn canonical_revision_for_run(
    current: RunCanonicalSubject<'_>,
    previous: &dyn CanonicalClusterView,
    previous_input: RunCanonicalInput<'_>,
    index: &IdentityIndex,
    next_revision: &mut u32,
    layout_dirty: Option<(&mut LayoutDirtyRanges, bool)>,
) -> Result<RunCanonicalRevision, EngineError> {
    let RunCanonicalSubject {
        view: current,
        run,
        input: current_input,
    } = current;
    let anchor = current
        .stable_text_id(run.cluster_start as usize)
        .filter(|anchor| *anchor != 0)
        .ok_or(EngineError::InvalidRequest)?;
    let previous_run = index
        .get(anchor)
        .and_then(|slot| previous.layout_run(slot as usize));
    let mut layout_dirty = layout_dirty;
    if previous_run.is_none()
        && let Some((dirty, _)) = layout_dirty.as_mut()
    {
        dirty.valid = false;
    }
    let retained = previous_run
        .map(|candidate| {
            runs_canonically_equal(
                current,
                run,
                current_input,
                previous,
                candidate,
                previous_input,
                layout_dirty
                    .as_mut()
                    .map(|(dirty, proven)| (&mut **dirty, *proven)),
            )
        })
        .transpose()?
        .filter(|equal| *equal)
        .and_then(|_| previous_run.and_then(|candidate| candidate.canonical_revision));
    let revision = match retained {
        Some(revision) => revision,
        None => RunCanonicalRevision::allocate(next_revision)?,
    };
    debug_assert_ne!(revision.get(), 0);
    Ok(revision)
}
impl ClusterArena {
    pub(crate) fn assign_stable_glyph_ids_in_range(
        &mut self,
        previous: &Self,
        cluster_start: usize,
        cluster_end: usize,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        let _clock = StageClock::start();
        index
            .prepare(cluster_end.saturating_sub(cluster_start))
            .map_err(identity_index_error)?;
        for cluster in cluster_start..cluster_end {
            index
                .insert(
                    previous.stable_ids[cluster],
                    u32::try_from(cluster).map_err(|_| EngineError::ResultTooLarge)?,
                )
                .map_err(identity_index_error)?;
        }
        *next_id = (*next_id).max(1);
        for cluster in cluster_start..cluster_end {
            let new_start = usize::try_from(self.glyph_starts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let new_count = usize::try_from(self.glyph_counts[cluster])
                .map_err(|_| EngineError::InvalidRequest)?;
            let previous_cluster = index
                .get(self.stable_ids[cluster])
                .and_then(|value| usize::try_from(value).ok());
            let previous_start = previous_cluster
                .and_then(|cluster| previous.glyph_starts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            let previous_count = previous_cluster
                .and_then(|cluster| previous.glyph_counts.get(cluster))
                .copied()
                .and_then(|value| usize::try_from(value).ok())
                .unwrap_or(0);
            for ordinal in 0..new_count {
                self.glyph_stable_ids[new_start + ordinal] = if ordinal < previous_count {
                    previous.glyph_stable_ids[previous_start + ordinal]
                } else {
                    let allocated = *next_id;
                    *next_id = next_id.checked_add(1).ok_or(EngineError::ResultTooLarge)?;
                    allocated
                };
            }
        }
        Ok(())
    }

    pub(crate) fn assign_stable_glyph_ids(
        &mut self,
        previous: &dyn CanonicalClusterView,
        index: &mut IdentityIndex,
        next_id: &mut u32,
    ) -> Result<(), EngineError> {
        let _clock = StageClock::start();
        reserve(&mut self.glyph_stable_ids, self.glyph_ids.len())?;
        self.glyph_stable_ids.resize(self.glyph_ids.len(), 0);
        if let Some(previous) = previous.cluster_arena() {
            #[cfg(any(test, feature = "debug-validation"))]
            let first_id = *next_id;
            let result = self.assign_stable_glyph_ids_from_arena(previous, index, next_id);
            #[cfg(any(test, feature = "debug-validation"))]
            if result.is_ok() {
                self.assert_glyph_ids_follow_the_view_rule(previous, first_id, *next_id);
            }
            return result;
        }
        assign_stable_glyph_ids_from_view(
            previous,
            self.stable_ids.len(),
            |cluster| {
                Some((
                    *self.stable_ids.get(cluster)?,
                    *self.glyph_starts.get(cluster)?,
                    *self.glyph_counts.get(cluster)?,
                ))
            },
            &mut self.glyph_stable_ids,
            index,
            next_id,
        )
    }

    /// Assigns canonical tokens after exact normalized run comparison; changed runs mint revisions.
    /// Absolute offsets and temporary shaping-run ordinals are traversal cursors, not identity.
    pub(crate) fn finalize_layout_run_revisions(
        &mut self,
        previous: &dyn CanonicalClusterView,
        current: RunCanonicalInput<'_>,
        committed: RunCanonicalInput<'_>,
        index: &mut IdentityIndex,
        next_revision: &mut u32,
        layout_dirty: Option<(&mut LayoutDirtyRanges, bool)>,
    ) -> Result<(), EngineError> {
        let _clock = StageClock::start();
        let styles_unchanged = layout_dirty.as_ref().is_some_and(|(_, proven)| *proven);
        let mut layout_dirty = layout_dirty.map(|(dirty, _)| dirty);
        if let Some(dirty) = layout_dirty.as_deref_mut() {
            dirty.clear();
            dirty.valid = self.starts.len() == previous.cluster_count()
                && self.layout_runs.runs.len() == previous.layout_run_count()
                && current.text.len() == committed.text.len();
        }
        if let Some(previous) = previous.cluster_arena() {
            #[cfg(any(test, feature = "debug-validation"))]
            let expected = self.revisions_by_the_view_rule(
                previous,
                current,
                committed,
                *next_revision,
                layout_dirty
                    .as_deref()
                    .map(|dirty| (dirty.valid, styles_unchanged)),
            );
            let result = self.finalize_revisions_from_arena(
                previous,
                current,
                committed,
                index,
                next_revision,
                layout_dirty
                    .as_deref_mut()
                    .map(|dirty| (dirty, styles_unchanged)),
            );
            #[cfg(any(test, feature = "debug-validation"))]
            if result.is_ok() {
                self.assert_revisions_follow_the_view_rule(
                    previous,
                    expected,
                    *next_revision,
                    layout_dirty.as_deref(),
                );
            }
            return result;
        }
        // An inline leaf pairs with nothing cluster by cluster.
        self.changes.reset();
        prepare_run_revision_index(previous, index)?;

        for run_index in 0..self.layout_runs.runs.len() {
            let run = self.layout_runs.runs[run_index];
            let revision = canonical_revision_for_run(
                RunCanonicalSubject {
                    view: self,
                    run,
                    input: current,
                },
                previous,
                committed,
                index,
                next_revision,
                layout_dirty
                    .as_deref_mut()
                    .map(|dirty| (dirty, styles_unchanged)),
            )?;
            self.layout_runs.runs[run_index].canonical_revision = Some(revision);
        }

        Ok(())
    }
}
