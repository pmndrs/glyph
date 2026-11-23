//! Writing one batch's records into its buffers: jobs, patches and retained runs.

use super::*;

/// One batch's changed-record write: what every range job reads.
pub(super) struct BatchWrite<'a> {
    pub(super) codec: &'a ValidatedCodec,
    pub(super) capability_set: CapabilitySetId,
    pub(super) capability: &'a crate::engine::codec::CapabilitySet,
    pub(super) input: OrderedPlanInput<'a>,
    pub(super) program: &'a crate::engine::codec::ProgramDescriptor,
    pub(super) prior: Option<BatchState>,
    pub(super) pending: PendingBatch,
    /// The batch moves to new storage, so every record is written.
    pub(super) replace: bool,
    /// Buffers the gather proved unchanged for every input.
    pub(super) unchanged_buffers: u32,
    /// The accepted bytes were encoded by this codec and capability set.
    pub(super) comparable_codec: bool,
    pub(super) old_buffers: &'a [PhysicalBufferState],
    pub(super) retained_input_slots: &'a [u32],
    pub(super) prior_instances: &'a RopeRange<'a, InstanceState>,
    pub(super) next_instances: &'a RopeRange<'a, InstanceState>,
}
impl BatchWrite<'_> {
    /// The aligned record ranges each physical buffer must rewrite, coalesced per buffer.
    pub(super) fn collect_buffer_ranges(
        &self,
        changed_ranges: &[RecordRange],
        buffer_ranges: &mut [Vec<RecordRange>; MAX_PHYSICAL_BUFFERS],
    ) -> Result<(), OrderedPlanError> {
        for ranges in buffer_ranges.iter_mut() {
            ranges.clear();
        }
        let program = self.program;
        for changed in changed_ranges.iter().copied() {
            let active_buffers = active_buffers_for_range(
                self.codec,
                self.capability_set,
                program,
                self.prior_instances,
                self.next_instances,
                self.input,
                changed,
                self.replace,
                self.retained_input_slots,
                self.prior.map_or(0, |batch| batch.instance_start),
            )?;
            for (schema_index, schema) in program.buffers.iter().enumerate() {
                if active_buffers & (1 << schema_index) == 0 {
                    continue;
                }
                reserve(&mut buffer_ranges[schema_index], 1)?;
                buffer_ranges[schema_index].push(align_record_range(
                    changed,
                    buffer_record_alignment(schema, self.capability.update_alignment),
                )?);
            }
        }
        for (schema_index, schema) in program.buffers.iter().enumerate() {
            coalesce_buffer_ranges(
                &mut buffer_ranges[schema_index],
                u32::from(schema.stride),
                self.capability,
                self.pending.state.instance_count,
            )?;
        }
        Ok(())
    }

    /// Encodes one aligned job into the payload and patches only the records that differ
    /// from the accepted bytes.
    pub(super) fn write_job(
        &self,
        job: RangeJob,
        output: &mut BatchWriteOutput<'_>,
    ) -> Result<(), OrderedPlanError> {
        let RangeJob {
            range: aligned,
            active_buffers,
        } = job;
        // A buffer none of whose inputs changed already holds the bytes this job would
        // write, wherever the job stays inside the records both plans keep live. Executing
        // it only to compare the result equal is what the gather's proof replaces.
        let active_buffers = if !self.replace
            && aligned.end <= self.pending.state.instance_count
            && self
                .prior
                .is_some_and(|batch| aligned.end <= batch.instance_count)
        {
            active_buffers & !self.unchanged_buffers
        } else {
            active_buffers
        };
        if active_buffers == 0 {
            return Ok(());
        }
        let mut compact_cursor = output.payload.len();
        let payload_starts = self.seed_job_payload(aligned, active_buffers, output.payload)?;
        self.encode_job_records(aligned, active_buffers, output.payload, &payload_starts)?;
        for (schema_index, schema) in self.program.buffers.iter().enumerate() {
            if active_buffers & (1 << schema_index) == 0 {
                continue;
            }
            self.emit_buffer_patch(
                aligned,
                schema_index,
                schema,
                payload_starts[schema_index],
                &mut compact_cursor,
                output,
            )?;
        }
        output.payload.truncate(compact_cursor);
        Ok(())
    }

    /// Appends one segment per active buffer, seeded with the prior bytes where they exist
    /// and zeros otherwise. Returns each segment's start.
    pub(super) fn seed_job_payload(
        &self,
        aligned: RecordRange,
        active_buffers: u32,
        payload: &mut Vec<u8>,
    ) -> Result<[usize; MAX_PHYSICAL_BUFFERS], OrderedPlanError> {
        let count = aligned.end - aligned.start;
        let mut payload_starts = [0_usize; MAX_PHYSICAL_BUFFERS];
        for (schema_index, schema) in self.program.buffers.iter().enumerate() {
            if active_buffers & (1 << schema_index) == 0 {
                continue;
            }
            let byte_count = usize::try_from(count)
                .ok()
                .and_then(|value| value.checked_mul(schema.stride()))
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let payload_start = payload.len();
            let payload_end = payload_start
                .checked_add(byte_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            reserve(payload, byte_count)?;
            payload_starts[schema_index] = payload_start;
            let mut copied_prior = false;
            if !self.replace
                && let Some(prior) = self.prior
            {
                let old_buffer = self
                    .old_buffers
                    .get(prior.buffer_start as usize + schema_index)
                    .ok_or(OrderedPlanError::InvalidIdentity)?;
                let source_start = aligned.start as usize * schema.stride();
                let source_end = source_start
                    .checked_add(byte_count)
                    .ok_or(OrderedPlanError::ArithmeticOverflow)?;
                if source_end <= old_buffer.bytes.len() {
                    payload.extend_from_slice(&old_buffer.bytes[source_start..source_end]);
                    copied_prior = true;
                }
            }
            if !copied_prior {
                payload.resize(payload_end, 0);
            }
        }
        Ok(payload_starts)
    }

    /// Overwrites the job's live records: runs whose inputs kept their slot are copied from
    /// the prior buffers, unchanged instances are left as seeded, and runs of changed
    /// consecutive inputs are encoded by the codec.
    pub(super) fn encode_job_records(
        &self,
        aligned: RecordRange,
        active_buffers: u32,
        payload: &mut [u8],
        payload_starts: &[usize; MAX_PHYSICAL_BUFFERS],
    ) -> Result<(), OrderedPlanError> {
        let count = aligned.end - aligned.start;
        let live_end = aligned.end.min(self.pending.state.instance_count) as usize;
        let start = aligned.start as usize;
        let prior_len = self.prior_instances.len();
        let next_range = self
            .next_instances
            .range(start..live_end)
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let previous_range = self
            .prior_instances
            .range(start.min(prior_len)..live_end.min(prior_len))
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        let mut previous = previous_range.iter();
        let mut records = next_range
            .iter()
            .enumerate()
            .map(|(offset, next)| (aligned.start + offset as u32, next, previous.next()))
            .peekable();
        let retained_source = |next: &InstanceState| {
            self.retained_input_slots
                .get(next.input_index as usize)
                .copied()
                .filter(|source| *source != NONE)
        };
        while let Some((run_start, next, previous)) = records.next() {
            if let Some(source) = retained_source(next) {
                let mut run_end = run_start + 1;
                while let Some((next_slot, next, _)) = records.peek()
                    && let Some(next_source) = retained_source(next)
                    && source.checked_add(*next_slot - run_start) == Some(next_source)
                {
                    records.next();
                    run_end += 1;
                }
                self.copy_retained_run(
                    source,
                    run_start..run_end,
                    aligned.start,
                    active_buffers,
                    payload,
                    payload_starts,
                )?;
                continue;
            }
            if instance_unchanged(previous, next, self.replace) {
                continue;
            }
            let input_start = next.input_index;
            let mut slot = run_start + 1;
            while let Some((next_slot, next, previous)) = records.peek()
                && !instance_unchanged(*previous, next, self.replace)
                && retained_source(next).is_none()
                && next.input_index == input_start + (*next_slot - run_start)
            {
                records.next();
                slot += 1;
            }
            execute_run(
                self.codec,
                self.capability_set,
                self.program,
                self.input,
                input_start as usize,
                slot - run_start,
                run_start - aligned.start,
                payload,
                payload_starts,
                count,
                active_buffers,
            )?;
        }
        Ok(())
    }

    /// Copies the prior encoding of the inputs retained at `source..` into job slots `run`.
    pub(super) fn copy_retained_run(
        &self,
        source: u32,
        run: Range<u32>,
        job_start: u32,
        active_buffers: u32,
        payload: &mut [u8],
        payload_starts: &[usize; MAX_PHYSICAL_BUFFERS],
    ) -> Result<(), OrderedPlanError> {
        let copied_records = run.end - run.start;
        let prior = self.prior.ok_or(OrderedPlanError::InvalidIdentity)?;
        let source_slot = source
            .checked_sub(prior.instance_start)
            .filter(|slot| {
                slot.checked_add(copied_records)
                    .is_some_and(|end| end <= prior.instance_count)
            })
            .ok_or(OrderedPlanError::InvalidIdentity)?;
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| work.clean_buffer_copy_runs += 1);
        for (schema_index, schema) in self.program.buffers.iter().enumerate() {
            if active_buffers & (1 << schema_index) == 0 {
                continue;
            }
            let old_buffer = self
                .old_buffers
                .get(prior.buffer_start as usize + schema_index)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            let source_start = (source_slot as usize)
                .checked_mul(schema.stride())
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let byte_count = (copied_records as usize)
                .checked_mul(schema.stride())
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let source_end = source_start
                .checked_add(byte_count)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let destination_start = payload_starts[schema_index]
                .checked_add(
                    ((run.start - job_start) as usize)
                        .checked_mul(schema.stride())
                        .ok_or(OrderedPlanError::ArithmeticOverflow)?,
                )
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let bytes = old_buffer
                .bytes
                .get(source_start..source_end)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            payload[destination_start..destination_start + byte_count].copy_from_slice(bytes);
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.clean_buffer_copy_bytes += byte_count;
            });
        }
        Ok(())
    }

    /// Patches one buffer with the job records that differ from its accepted bytes,
    /// compacting the written bytes to `compact_cursor` and mirroring them into a new
    /// allocation when the batch moves.
    pub(super) fn emit_buffer_patch(
        &self,
        aligned: RecordRange,
        schema_index: usize,
        schema: &BufferSchema,
        source_start: usize,
        compact_cursor: &mut usize,
        output: &mut BatchWriteOutput<'_>,
    ) -> Result<(), OrderedPlanError> {
        let count = aligned.end - aligned.start;
        let pending = self.pending;
        let byte_length = count
            .checked_mul(u32::from(schema.stride))
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let destination_offset = aligned
            .start
            .checked_mul(u32::from(schema.stride))
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let length =
            usize::try_from(byte_length).map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        let source_end = source_start
            .checked_add(length)
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let destination_start = usize::try_from(destination_offset)
            .map_err(|_| OrderedPlanError::ArithmeticOverflow)?;
        let destination_end = destination_start
            .checked_add(length)
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let capacity_bytes = pending
            .capacity
            .checked_mul(u32::from(schema.stride))
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        if source_end > output.payload.len()
            || destination_end
                > usize::try_from(capacity_bytes)
                    .map_err(|_| OrderedPlanError::ArithmeticOverflow)?
        {
            return Err(OrderedPlanError::InvalidIdentity);
        }
        let Some(written) = self.written_records(
            aligned,
            schema_index,
            schema,
            destination_start,
            &output.payload[source_start..],
        ) else {
            #[cfg(test)]
            crate::engine::work_attribution::record(|work| {
                work.ordered_equal_suppressed_bytes += length;
            });
            return Ok(());
        };
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.ordered_equal_suppressed_bytes +=
                length - (written.end - written.start) as usize * schema.stride();
        });
        let skipped = written.start as usize * schema.stride();
        let byte_length = (written.end - written.start)
            .checked_mul(u32::from(schema.stride))
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let length = byte_length as usize;
        let destination_offset = destination_offset
            .checked_add(skipped as u32)
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        let destination_start = destination_start + skipped;
        let destination_end = destination_start + length;
        let source_start = source_start + skipped;
        let source_end = source_start + length;
        // Active segments were appended in schema order. The compact destination never
        // passes this source, so it cannot overwrite a later segment or an earlier job.
        if *compact_cursor != source_start {
            output
                .payload
                .copy_within(source_start..source_end, *compact_cursor);
        }
        let compact_start = *compact_cursor;
        *compact_cursor = compact_cursor
            .checked_add(length)
            .ok_or(OrderedPlanError::ArithmeticOverflow)?;
        reserve(output.patches, 1)?;
        output.patches.push(PatchRecord {
            opcode: PATCH_WRITE,
            buffer_id: pending.buffer_ids[schema_index],
            buffer_generation: pending.buffer_generations[schema_index],
            destination_offset,
            byte_length,
            payload_start: u32::try_from(compact_start)
                .map_err(|_| OrderedPlanError::ArithmeticOverflow)?,
            ..PatchRecord::default()
        });
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.ordered_emitted_write_bytes += length;
        });
        if let Some(start) = pending.allocation_start {
            let allocation_index = start
                .checked_add(schema_index)
                .ok_or(OrderedPlanError::ArithmeticOverflow)?;
            let allocation = output
                .pending_allocations
                .get_mut(allocation_index)
                .and_then(Option::as_mut)
                .ok_or(OrderedPlanError::InvalidIdentity)?;
            allocation.state.bytes[destination_start..destination_end]
                .copy_from_slice(&output.payload[compact_start..*compact_cursor]);
        }
        Ok(())
    }

    /// The job records to write into one buffer, relative to the job start, or `None` when
    /// every record equals the accepted bytes. Prior-batch admission matches the batch key;
    /// prepare_batch copies its buffer identities and capacity when !replace. Matching
    /// codec/capability fingerprints then prove program and schema reuse. Only live-range and
    /// byte equality remain: the records both plans keep live are compared with the accepted
    /// bytes, and the write narrows to the aligned records that differ, plus any it adds past
    /// them.
    pub(super) fn written_records(
        &self,
        aligned: RecordRange,
        schema_index: usize,
        schema: &BufferSchema,
        destination_start: usize,
        encoded: &[u8],
    ) -> Option<Range<u32>> {
        let count = aligned.end - aligned.start;
        let comparable_records = if !self.replace && self.comparable_codec {
            self.prior.map_or(0, |batch| {
                aligned
                    .end
                    .min(self.pending.state.instance_count)
                    .min(batch.instance_count)
                    .saturating_sub(aligned.start)
            })
        } else {
            0
        };
        let comparable = match self.prior {
            Some(batch) if comparable_records != 0 => self
                .old_buffers
                .get(batch.buffer_start as usize + schema_index)
                .and_then(|old| {
                    old.bytes.get(
                        destination_start
                            ..destination_start + comparable_records as usize * schema.stride(),
                    )
                }),
            _ => None,
        };
        let Some(accepted) = comparable else {
            return Some(0..count);
        };
        #[cfg(test)]
        crate::engine::work_attribution::record(|work| {
            work.ordered_comparison_bytes += accepted.len();
        });
        differing_records(
            accepted,
            &encoded[..accepted.len()],
            schema.stride(),
            count,
            buffer_record_alignment(schema, self.capability.update_alignment),
            aligned.start,
        )
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn active_buffers_for_range(
    codec: &ValidatedCodec,
    capability_set: CapabilitySetId,
    program: &crate::engine::codec::ProgramDescriptor,
    previous: &RopeRange<'_, InstanceState>,
    next: &RopeRange<'_, InstanceState>,
    input: OrderedPlanInput<'_>,
    changed: RecordRange,
    replace: bool,
    retained_input_slots: &[u32],
    prior_start: u32,
) -> Result<u32, OrderedPlanError> {
    let all = (1_u32 << program.buffers.len()) - 1;
    if replace {
        return Ok(all);
    }
    let dependencies = codec
        .buffer_dependency_masks(capability_set, program.technique, program.variant)
        .ok_or(OrderedPlanError::ProgramMissing)?;
    let mut active = 0_u32;
    let next_range = next
        .range(changed.start as usize..changed.end as usize)
        .ok_or(OrderedPlanError::InvalidIdentity)?;
    let previous_range = previous
        .range(
            (changed.start as usize).min(previous.len())
                ..(changed.end as usize).min(previous.len()),
        )
        .ok_or(OrderedPlanError::InvalidIdentity)?;
    let mut previous = previous_range.iter();
    for (offset, next) in next_range.iter().enumerate() {
        if let Some(&source) = retained_input_slots.get(next.input_index as usize)
            && source != NONE
            && u64::from(source)
                != u64::from(prior_start) + u64::from(changed.start) + offset as u64
        {
            return Ok(all);
        }
        let Some(previous) = previous.next() else {
            return Ok(all);
        };
        let mut semantic_changes = input
            .semantic_change_masks
            .get(next.input_index as usize)
            .copied()
            .unwrap_or(crate::engine::positioning::ALL_SEMANTIC_CHANGES);
        if previous.placement_slot != next.placement_slot {
            semantic_changes |= crate::engine::positioning::SEMANTIC_PLACEMENT_SLOT_CHANGE;
        }
        if previous.stable_id != next.stable_id
            || semantic_changes == crate::engine::positioning::ALL_SEMANTIC_CHANGES
            || (previous.content_revision != next.content_revision && semantic_changes == 0)
        {
            return Ok(all);
        }
        for (index, &dependency) in dependencies.iter().enumerate() {
            if dependency & semantic_changes != 0 {
                active |= 1 << index;
            }
        }
    }
    Ok(active)
}

/// The records of a write job, relative to its first, that it must still write: from the first
/// aligned record whose bytes differ from the accepted ones to the last, and every record past
/// the `accepted` ones. `None` when the job writes nothing the host does not already hold.
pub(super) fn differing_records(
    accepted: &[u8],
    next: &[u8],
    stride: usize,
    count: u32,
    alignment: u32,
    first_record: u32,
) -> Option<Range<u32>> {
    let compared = (accepted.len() / stride) as u32;
    if compared == count && accepted == next {
        return None;
    }
    let first = first_difference(accepted, next).map_or(compared, |byte| (byte / stride) as u32);
    let end = if compared < count {
        count
    } else {
        last_difference(accepted, next).map_or(first, |byte| (byte / stride) as u32 + 1)
    };
    // The job starts aligned; realign the narrowed write to the same absolute grid.
    let start = (first_record + first) / alignment * alignment - first_record;
    let end = ((first_record + end).div_ceil(alignment) * alignment - first_record).min(count);
    Some(start..end)
}

pub(super) fn first_difference(left: &[u8], right: &[u8]) -> Option<usize> {
    let block = left
        .chunks(DIFFERENCE_BLOCK)
        .zip(right.chunks(DIFFERENCE_BLOCK))
        .position(|(left, right)| left != right)?;
    let base = block * DIFFERENCE_BLOCK;
    left[base..]
        .iter()
        .zip(&right[base..])
        .position(|(left, right)| left != right)
        .map(|offset| base + offset)
}

pub(super) fn last_difference(left: &[u8], right: &[u8]) -> Option<usize> {
    let length = left.len().min(right.len());
    let mut end = length;
    while end != 0 {
        let start = end.saturating_sub(DIFFERENCE_BLOCK);
        if left[start..end] != right[start..end] {
            return left[start..end]
                .iter()
                .zip(&right[start..end])
                .rposition(|(left, right)| left != right)
                .map(|offset| start + offset);
        }
        end = start;
    }
    None
}

pub(super) fn instance_unchanged(
    previous: Option<&InstanceState>,
    next: &InstanceState,
    replace: bool,
) -> bool {
    !replace
        && previous.is_some_and(|previous| {
            previous.stable_id == next.stable_id
                && previous.content_revision == next.content_revision
                && previous.placement_slot == next.placement_slot
        })
}
