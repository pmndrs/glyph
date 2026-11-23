//! Truncating an overflowing thread with an ellipsis.

use super::*;

impl FlowLayoutArena {
    pub(crate) fn truncate_for_ellipsis(
        &mut self,
        flow_thread_id: u32,
        clusters: &ClusterArena,
        mut replacement_at: impl FnMut(usize, u32) -> Result<EllipsisReplacement, EngineError>,
    ) -> Result<Option<EllipsisTarget>, EngineError> {
        let Some(line_index) = self
            .lines
            .iter()
            .rposition(|line| line.flow_thread_id == flow_thread_id)
        else {
            return Ok(None);
        };
        let line = self.lines[line_index];
        let fragment_start = self
            .line_fragment_start(line_index)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_end = fragment_start
            .checked_add(usize::from(line.fragment_count))
            .ok_or(EngineError::InvalidRequest)?;
        let fragment_index = fragment_end
            .checked_sub(1)
            .ok_or(EngineError::InvalidRequest)?;
        let fragment = *self
            .fragments
            .get(fragment_index)
            .ok_or(EngineError::InvalidRequest)?;
        let cluster_count = clusters.starts.len();
        // Composition asked for the marker, and it is the one that knows a line was dropped: the
        // line that follows a final hard break holds no cluster, so a last line that consumed
        // every cluster and fits can still be followed by one that did not fit.
        let consumed =
            usize::try_from(fragment.line.cluster_end).map_err(|_| EngineError::InvalidRequest)?;
        let available = fragment.slot_end - fragment.slot_start;
        let cluster_start = usize::try_from(fragment.line.cluster_start)
            .map_err(|_| EngineError::InvalidRequest)?;
        let mut cluster_end = consumed.min(cluster_count);
        // The fitted line does not charge its terminating spaces to `advance`, but they are
        // among its clusters: ahead of the marker they are drawn and take room, and cut
        // away they give back exactly what they are charged here.
        // The marker now ends the line, so the island its fitted end was corrected for is never
        // drawn alone: the correction goes, and the reshaped run before the marker prices that
        // end instead.
        let mut source_advance = fragment.line.advance + fragment.line.hung_advance
            - scaled_from_layout_units(i64::from(fragment.line.end_correction.advance));
        while cluster_end > cluster_start
            && clusters.flags[cluster_end - 1] & CLUSTER_HARD_BREAK != 0
        {
            cluster_end -= 1;
            source_advance -= clusters.advances[cluster_end];
        }
        let mut text_end = cluster_text_end(clusters, cluster_end);
        let mut replacement = replacement_at(cluster_end, text_end)?;
        if replacement.cluster_start < cluster_start
            || replacement.cluster_start > cluster_end
            || !replacement.advance_adjustment.is_finite()
        {
            return Err(EngineError::InvalidRequest);
        }
        while cluster_end > cluster_start
            && source_advance + replacement.advance_adjustment > available
        {
            cluster_end -= 1;
            source_advance -= clusters.advances[cluster_end];
            text_end = cluster_text_end(clusters, cluster_end);
            replacement = replacement_at(cluster_end, text_end)?;
            if replacement.cluster_start < cluster_start
                || replacement.cluster_start > cluster_end
                || !replacement.advance_adjustment.is_finite()
            {
                return Err(EngineError::InvalidRequest);
            }
        }
        let cluster_end_record =
            u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?;
        let replacement_advance = (source_advance + replacement.advance_adjustment).max(0.0);
        // The replacement now terminates the line, so nothing hangs off its end any more:
        // whatever the fit trimmed is either gone with the truncated suffix or interior to
        // the ellipsis. Leaving the fitted value here would make RTL positioning discount a
        // space the retained range no longer contains.
        if !self
            .fragments
            .update(fragment_index, |fragment| {
                fragment.line.cluster_end = cluster_end_record;
                fragment.line.text_end = text_end;
                fragment.line.advance = replacement_advance;
                fragment.line.hung_advance = 0.0;
                fragment.line.end_correction = Correction::ZERO;
                fragment.line.hard_break = false;
            })
            .map_err(|()| EngineError::ResultTooLarge)?
        {
            return Err(EngineError::InvalidRequest);
        }
        Ok(Some(EllipsisTarget {
            fragment_index: u32::try_from(fragment_index)
                .map_err(|_| EngineError::ResultTooLarge)?,
            line_cluster_start: u32::try_from(cluster_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            boundary_cluster_start: u32::try_from(replacement.cluster_start)
                .map_err(|_| EngineError::ResultTooLarge)?,
            cluster_end: u32::try_from(cluster_end).map_err(|_| EngineError::ResultTooLarge)?,
            text_end,
        }))
    }
}

pub(super) fn cluster_text_end(clusters: &ClusterArena, cluster_end: usize) -> u32 {
    clusters
        .starts
        .get(cluster_end)
        .copied()
        .or_else(|| clusters.ends.last().copied())
        .unwrap_or(0)
}
