//! Retaining the previous gather's rows: walking owners and their clean sources.

use crate::cold_growth::ColdGrowth as _;

use super::*;

impl CodecGatherWorkspace {
    /// Caller-authored Flat owners keep one transactional rope traversal for the whole
    /// stream: a failure in any owner leaves every source row as it was.
    pub(super) fn retain_flat_owners<'owner, 'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        mut owners: impl Iterator<Item = Result<RetainedGatherOwner<'owner>, GatherError>> + Clone,
        mut binding_for_font: impl FnMut(u32) -> Option<&'binding FontRenderBinding>,
    ) -> Result<Option<RetainedGatherStop>, GatherError> {
        let mut sources = core::mem::take(&mut self.sources);
        // One immutable snapshot supplies selected-row prefix counts for gaps. It shares
        // the same source tree and exists only while the transactional executor stages its replacement.
        let previous_sources = sources.clone();
        let ranges = OwnerRanges {
            owners: owners.clone(),
            current: None,
            interval: 0,
        };
        let result = (|| {
            let mut current = None;
            let mut state = RetainedGatherCursor {
                source_cursor: self.retained_source_cursor,
                record_cursor: self.retained_cursor,
                rebuild: None,
                cached_font_handle: None,
                cached_binding: None,
                cached_program: None,
                input_plan: None,
            };
            sources
                .update_ordered_ranges(ranges, |source_index, previous_source| {
                    while current
                        .as_ref()
                        .is_none_or(|owner: &RetainedGatherOwner<'_>| {
                            source_index >= owner.range.end.source
                        })
                    {
                        if let Some(owner) = current.as_ref()
                            && owner.range.source_count() != owner.input.len()
                        {
                            let end = owner.retained_end(&previous_sources)?;
                            state.source_cursor = end.source;
                            state.record_cursor = end.record;
                            state.rebuild = Some(end.source - owner.range.start.source);
                            return Ok(RopeUpdate::Stop);
                        }
                        let owner = owners.next().ok_or(GatherError::InvalidSemanticShape)??;
                        #[cfg(test)]
                        {
                            // Authoritative owner offsets borrow the intervening clean rows,
                            // including decoration records that have no source glyph.
                            let previous_end = current
                                .as_ref()
                                .map_or_else(|| self.position(), |owner| owner.range.end);
                            crate::engine::work_attribution::record(|work| {
                                work.gather_paragraph_visits += 1;
                                work.gather_range_skips +=
                                    usize::from(previous_end != owner.range.start);
                            });
                        }
                        let reserve = match owner.intervals {
                            Some(ranges) => ranges
                                .iter()
                                .try_fold(0usize, |count, range| {
                                    count.checked_add(range.end.checked_sub(range.start)?)
                                })
                                .ok_or(GatherError::InvalidSemanticShape)?,
                            None => owner.input.len(),
                        };
                        self.dirty_mask_ranges
                            .try_reserve_cold(reserve)
                            .map_err(|_| GatherError::AllocationFailed)?;
                        state.source_cursor = owner.range.start.source;
                        state.record_cursor = owner.range.start.record;
                        state.cached_font_handle = None;
                        state.cached_binding = None;
                        state.cached_program = None;
                        state.input_plan = None;
                        current = Some(owner);
                    }
                    let owner = current.as_ref().ok_or(GatherError::InvalidSemanticShape)?;
                    let glyph_index = source_index
                        .checked_sub(owner.range.start.source)
                        .ok_or(GatherError::InvalidSemanticShape)?;
                    if source_index != state.source_cursor {
                        let before = previous_sources
                            .prefix_summary(state.source_cursor)
                            .ok_or(GatherError::InvalidSemanticShape)?;
                        let after = previous_sources
                            .prefix_summary(source_index)
                            .ok_or(GatherError::InvalidSemanticShape)?;
                        state.record_cursor += after.fragments - before.fragments;
                        state.source_cursor = source_index;
                    }
                    let GatherInput::Flat(input) = owner.input else {
                        return Err(GatherError::InvalidSemanticShape);
                    };
                    self.update_retained_source(
                        codec,
                        capability_set,
                        input,
                        glyph_index,
                        previous_source,
                        &mut state,
                        &mut binding_for_font,
                    )
                })
                .map_err(|error| match error {
                    crate::engine::retained_rope::RopeEditError::Storage => {
                        GatherError::AllocationFailed
                    }
                    crate::engine::retained_rope::RopeEditError::Callback(error) => error,
                })?;
            self.retained_cursor = state.record_cursor;
            self.retained_source_cursor = state.source_cursor;
            if let Some(index) = state.rebuild {
                return Ok(Some(RetainedGatherStop {
                    source_index: index,
                }));
            }
            let mut pending = current;
            loop {
                let owner = match pending.take() {
                    Some(owner) => owner,
                    None => match owners.next() {
                        Some(owner) => {
                            #[cfg(test)]
                            crate::engine::work_attribution::record(|work| {
                                work.gather_paragraph_visits += 1
                            });
                            owner?
                        }
                        None => break,
                    },
                };
                let end = owner.retained_end(&previous_sources)?;
                self.retained_cursor = end.record;
                self.retained_source_cursor = end.source;
                if owner.range.source_count() != owner.input.len() {
                    return Ok(Some(RetainedGatherStop {
                        source_index: end.source - owner.range.start.source,
                    }));
                }
            }
            Ok(None)
        })();
        self.sources = sources;
        result
    }

    /// Walks the dirty owners in order. Rows between two visited ranges are clean: their
    /// records are skipped by the selected-row count of the source rope.
    pub(super) fn retain_owners<'owner, 'binding>(
        &mut self,
        codec: &ValidatedCodec,
        capability_set: CapabilitySetId,
        owners: impl Iterator<Item = Result<RetainedGatherOwner<'owner>, GatherError>>,
        binding_for_font: &mut BindingLookup<'_, 'binding>,
        scratch: &mut [ColumnScratch],
    ) -> Result<Option<RetainedGatherStop>, GatherError> {
        let scratch = scratch.first_mut().ok_or(GatherError::AllocationFailed)?;
        // A stream that failed part-way left rows staged for a gather that was discarded.
        self.source_identities.clear();
        let mut state = RetainedGatherCursor {
            source_cursor: self.retained_source_cursor,
            record_cursor: self.retained_cursor,
            rebuild: None,
            cached_font_handle: None,
            cached_binding: None,
            cached_program: None,
            input_plan: None,
        };
        let mut bound = None;
        for owner in owners {
            let owner = owner?;
            #[cfg(test)]
            {
                // Authoritative owner offsets borrow the intervening clean rows,
                // including decoration records that have no source glyph.
                let previous_end = GatherPosition {
                    source: state.source_cursor,
                    record: state.record_cursor,
                };
                crate::engine::work_attribution::record(|work| {
                    work.gather_paragraph_visits += 1;
                    work.gather_range_skips += usize::from(previous_end != owner.range.start);
                });
            }
            let source_count = owner.input.len();
            let whole = 0..source_count;
            let intervals = owner.intervals.unwrap_or(core::slice::from_ref(&whole));
            let reserve = intervals
                .iter()
                .try_fold(0usize, |count, range| {
                    count.checked_add(range.end.checked_sub(range.start)?)
                })
                .ok_or(GatherError::InvalidSemanticShape)?;
            self.dirty_mask_ranges
                .try_reserve_cold(reserve)
                .map_err(|_| GatherError::AllocationFailed)?;
            state.source_cursor = owner.range.start.source;
            state.record_cursor = owner.range.start.record;
            state.cached_font_handle = None;
            state.cached_binding = None;
            state.cached_program = None;
            state.input_plan = None;
            let retained_count = owner.range.source_count().min(source_count);
            let mut rows = RowSource::new(owner.input);
            // Only a paragraph-run glyph is covered by the declaration; the first chunk that
            // cannot use it returns the rest of the owner to the full comparison.
            let mut placement_only = owner.rows == RowChange::Placement
                && matches!(owner.input, GatherInput::Projected(_));
            for range in intervals {
                if range.start > range.end || range.end > source_count {
                    return Err(GatherError::InvalidSemanticShape);
                }
                let range = range.start.min(retained_count)..range.end.min(retained_count);
                if range.is_empty() {
                    continue;
                }
                self.skip_clean_sources(&mut state, owner.range.start.source + range.start)?;
                // A Flat owner cannot join a stream of prepared owners.
                let rows = rows.as_mut().ok_or(GatherError::InvalidSemanticShape)?;
                self.retain_column_rows(
                    codec,
                    capability_set,
                    owner.input.transform_id(),
                    rows,
                    range,
                    &mut placement_only,
                    &mut state,
                    &mut bound,
                    binding_for_font,
                    scratch,
                )?;
                if state.rebuild.is_some() {
                    break;
                }
            }
            if state.rebuild.is_some() {
                break;
            }
            let end = owner.retained_end(&self.sources)?;
            state.source_cursor = end.source;
            state.record_cursor = end.record;
            if owner.range.source_count() != source_count {
                state.rebuild = Some(end.source - owner.range.start.source);
                break;
            }
        }
        self.retained_cursor = state.record_cursor;
        self.retained_source_cursor = state.source_cursor;
        self.adopt_source_identities()?;
        Ok(state
            .rebuild
            .map(|source_index| RetainedGatherStop { source_index }))
    }

    pub(super) fn skip_clean_sources(
        &self,
        state: &mut RetainedGatherCursor<'_, '_>,
        source: usize,
    ) -> Result<(), GatherError> {
        if source == state.source_cursor {
            return Ok(());
        }
        let before = self
            .sources
            .prefix_summary(state.source_cursor)
            .ok_or(GatherError::InvalidSemanticShape)?;
        let after = self
            .sources
            .prefix_summary(source)
            .ok_or(GatherError::InvalidSemanticShape)?;
        state.record_cursor += after
            .fragments
            .checked_sub(before.fragments)
            .ok_or(GatherError::InvalidSemanticShape)?;
        state.source_cursor = source;
        Ok(())
    }

    /// Compares one range of a prepared owner against its accepted records, a chunk at a
    /// time: the rows are paired with the accepted sources first, then every declared
    /// input is written as one column and compared with the accepted lane.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn retain_column_rows<'codec, 'binding>(
        &mut self,
        codec: &'codec ValidatedCodec,
        capability_set: CapabilitySetId,
        transform_id: u32,
        rows: &mut RowSource<'_>,
        range: Range<usize>,
        placement_only: &mut bool,
        state: &mut RetainedGatherCursor<'codec, 'binding>,
        bound: &mut Option<ColumnBinding<'codec, 'binding>>,
        binding_for_font: &mut BindingLookup<'_, 'binding>,
        scratch: &mut ColumnScratch,
    ) -> Result<(), GatherError> {
        let mut cursor = range.start;
        while cursor < range.end {
            // A test build reads every lane, so that it can hold the declaration to the
            // inputs a placed chunk does not compare.
            let lanes = if *placement_only && !cfg!(test) {
                Lanes::Placed
            } else {
                Lanes::All
            };
            rows.fill(&mut scratch.chunk, cursor, range.end - cursor, lanes)?;
            if scratch.chunk.len == 0 {
                return Err(GatherError::SourceFieldMissing);
            }
            if *placement_only {
                if let Some(selected) = self.pair_placed_chunk(transform_id, state, scratch) {
                    let len = scratch.chunk.len;
                    if selected != 0 {
                        let bound = ColumnBinding::resolve(
                            bound,
                            scratch.chunk.binding_handle,
                            binding_for_font,
                        )?;
                        #[cfg(test)]
                        scratch.chunk.select(bound.binding);
                        let plan = bound.plan(codec, capability_set)?;
                        self.compare_placement_columns(
                            plan,
                            state.record_cursor,
                            selected,
                            scratch,
                        )?;
                        self.adopt_retained_changes(state.record_cursor, selected, scratch, lanes)?;
                    }
                    #[cfg(test)]
                    crate::engine::work_attribution::record(|work| work.gather_glyph_visits += len);
                    state.source_cursor += len;
                    state.record_cursor += selected;
                    cursor += len;
                    continue;
                }
                *placement_only = false;
                if lanes == Lanes::Placed {
                    rows.fill(&mut scratch.chunk, cursor, range.end - cursor, Lanes::All)?;
                }
            }
            let len = scratch.chunk.len;
            let bound =
                ColumnBinding::resolve(bound, scratch.chunk.binding_handle, binding_for_font)?;
            scratch.chunk.select(bound.binding);
            let (accepted, selected, replaced) = self.pair_retained_chunk(
                codec,
                capability_set,
                transform_id,
                state,
                bound,
                scratch,
            )?;
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.gather_glyph_visits += accepted + usize::from(accepted < len);
            });
            if selected != 0 {
                let plan = bound.plan(codec, capability_set)?;
                self.compare_retained_columns(plan, state.record_cursor, selected, scratch)?;
                self.adopt_retained_changes(state.record_cursor, selected, scratch, Lanes::All)?;
            }
            self.stage_source_identities(state.source_cursor, replaced, &scratch.chunk)?;
            state.source_cursor += accepted;
            state.record_cursor += selected;
            cursor += accepted;
            if accepted < len {
                state.rebuild = Some(cursor);
                break;
            }
        }
        Ok(())
    }

    pub(super) fn take_column_scratch(&mut self) -> Result<Vec<ColumnScratch>, GatherError> {
        let mut scratch = core::mem::take(&mut self.column_scratch);
        if scratch.is_empty() {
            reserve(&mut scratch, 1)?;
            scratch.push(ColumnScratch {
                chunk: SourceChunk::new(),
                rows: [0; CHUNK],
                f32_values: [0.0; CHUNK],
                u32_values: [0; CHUNK],
                masks: [0; CHUNK],
                sources: [GatherSource::new(0, None); CHUNK],
            });
        }
        Ok(scratch)
    }
}
