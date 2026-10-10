//! Planner-scoped identity reconciles retained placement occurrences by logical key.
//! Dense slots use generations and remain quarantined until renderer acknowledgement.

use super::retained_rope::{RetainedRope, RopeRecord, RopeSummary};
use alloc::vec::Vec;
use core::{num::NonZeroU32, ops::Range};

/// Dense planner-local storage index. It has no meaning outside its owning [`PlacementSlotArena`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PlacementSlot(u32);

impl PlacementSlot {
    pub(crate) const fn get(self) -> u32 {
        self.0
    }
}

/// Nonzero, nonwrapping incarnation of one physical placement slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
struct PlacementGeneration(NonZeroU32);

impl PlacementGeneration {
    const INITIAL: Self = Self(NonZeroU32::MIN);

    pub(crate) const fn get(self) -> u32 {
        self.0.get()
    }

    fn next(self) -> Result<Self, PlacementSlotError> {
        let value = self
            .get()
            .checked_add(1)
            .ok_or(PlacementSlotError::GenerationExhausted)?;
        Ok(Self(
            NonZeroU32::new(value).ok_or(PlacementSlotError::GenerationExhausted)?,
        ))
    }
}

/// Opaque identity of one committed or prepared placement in a planner-local namespace.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PlacementHandle {
    slot: PlacementSlot,
    generation: PlacementGeneration,
}

impl PlacementHandle {
    pub(crate) const fn slot(self) -> PlacementSlot {
        self.slot
    }

    #[cfg(test)]
    const fn generation(self) -> PlacementGeneration {
        self.generation
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PlacementSlotError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    InvalidPublicationGeneration,
    AcknowledgementRegressed,
    DuplicateLogicalKey,
    GenerationExhausted,
    SlotExhausted,
    ArithmeticOverflow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlacementSlotState<Key> {
    generation: PlacementGeneration,
    occupant: Option<Key>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QuarantinedPlacementSlot {
    handle: PlacementHandle,
    after_publication_generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingWrite<Key> {
    handle: PlacementHandle,
    logical_key: Key,
}

impl RopeRecord for PlacementSlot {
    fn rope_summary(&self) -> RopeSummary {
        RopeSummary {
            records: 1,
            ..RopeSummary::default()
        }
    }
}

#[derive(Clone, Copy)]
struct IndexEdit<Key> {
    key: Key,
    removed: Option<PlacementSlot>,
    desired: Option<usize>,
}

/// Transactional dense placement storage owned by one retained planner/root.
/// `Key` contains the logical incarnation needed to prevent cross-paragraph reuse.
pub(crate) struct PlacementSlotArena<Key: Copy> {
    slots: Vec<PlacementSlotState<Key>>,
    /// Slots sorted by their committed occupant keys; key ownership stays in the dense table.
    committed_index: RetainedRope<PlacementSlot>,
    /// Physical slots in the preceding publication's desired-occurrence order.
    committed_order: RetainedRope<PlacementSlot>,
    free_slots: Vec<PlacementSlot>,
    quarantine: Vec<QuarantinedPlacementSlot>,
    assignments: Vec<PlacementHandle>,
    retirements: Vec<PlacementHandle>,
    writes: Vec<PendingWrite<Key>>,
    /// Slots removed from `free_slots` by the pending transaction, restored on abort.
    allocated_free_slots: Vec<PlacementSlot>,
    /// Sorted exact index built for the pending live set and swapped on commit.
    pending_index: RetainedRope<PlacementSlot>,
    /// Physical slots in a structurally changed pending desired-occurrence order.
    pending_order: RetainedRope<PlacementSlot>,
    index_edits: Vec<IndexEdit<Key>>,
    occurrence_edits: Vec<(Range<usize>, Range<usize>)>,
    pending_structural_change: bool,
    pending_slot_count: u32,
    pending_publication_generation: u32,
    committed_publication_generation: u32,
    acknowledged_publication_generation: u32,
    prepared: bool,
    #[cfg(test)]
    retained_prepare_count: u32,
    #[cfg(test)]
    structural_prepare_count: u32,
}

impl<Key: Copy> Default for PlacementSlotArena<Key> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            committed_index: RetainedRope::default(),
            committed_order: RetainedRope::default(),
            free_slots: Vec::new(),
            quarantine: Vec::new(),
            assignments: Vec::new(),
            retirements: Vec::new(),
            writes: Vec::new(),
            allocated_free_slots: Vec::new(),
            pending_index: RetainedRope::default(),
            pending_order: RetainedRope::default(),
            index_edits: Vec::new(),
            occurrence_edits: Vec::new(),
            pending_structural_change: false,
            pending_slot_count: 0,
            pending_publication_generation: 0,
            committed_publication_generation: 0,
            acknowledged_publication_generation: 0,
            prepared: false,
            #[cfg(test)]
            retained_prepare_count: 0,
            #[cfg(test)]
            structural_prepare_count: 0,
        }
    }
}

impl<Key> PlacementSlotArena<Key>
where
    Key: Copy + Ord,
{
    /// Releases slots whose renderer fence completed. Acknowledgement is monotonic external state
    /// and a later prepare or abort does not roll it back.
    pub(crate) fn acknowledge(
        &mut self,
        through_generation: u32,
    ) -> Result<(), PlacementSlotError> {
        if self.prepared {
            return Err(PlacementSlotError::AlreadyPrepared);
        }
        if through_generation < self.acknowledged_publication_generation {
            return Err(PlacementSlotError::AcknowledgementRegressed);
        }
        if through_generation > self.committed_publication_generation {
            return Err(PlacementSlotError::InvalidPublicationGeneration);
        }

        let reclaim_count = self
            .quarantine
            .iter()
            .filter(|entry| entry.after_publication_generation <= through_generation)
            .count();
        reserve(&mut self.free_slots, reclaim_count)?;

        let mut write = 0_usize;
        for read in 0..self.quarantine.len() {
            let entry = self.quarantine[read];
            if entry.after_publication_generation <= through_generation {
                self.free_slots.push(entry.handle.slot);
            } else {
                self.quarantine[write] = entry;
                write += 1;
            }
        }
        self.quarantine.truncate(write);
        self.acknowledged_publication_generation = through_generation;
        Ok(())
    }

    /// Reconciles a complete desired set; assignments retain `desired` order.
    /// Allocation, generation, and value checks finish before the transaction is prepared.
    pub(crate) fn prepare(
        &mut self,
        desired: &[Key],
        publication_generation: u32,
    ) -> Result<(), PlacementSlotError> {
        if self.prepared {
            return Err(PlacementSlotError::AlreadyPrepared);
        }
        if publication_generation == 0
            || publication_generation <= self.committed_publication_generation
            || publication_generation <= self.acknowledged_publication_generation
        {
            return Err(PlacementSlotError::InvalidPublicationGeneration);
        }
        u32::try_from(desired.len()).map_err(|_| PlacementSlotError::ArithmeticOverflow)?;

        self.begin_prepare(publication_generation)?;
        let result = self.prepare_retained(desired).and_then(|retained| {
            if retained {
                #[cfg(test)]
                {
                    self.retained_prepare_count += 1;
                }
                Ok(())
            } else {
                self.assignments.clear();
                self.writes.clear();
                #[cfg(test)]
                {
                    self.structural_prepare_count += 1;
                }
                self.prepare_structural(desired)
            }
        });

        if result.is_err() {
            self.abort();
        }
        result
    }

    /// Advances an unchanged committed set through one publication without rebuilding its keys.
    pub(crate) fn prepare_reuse(
        &mut self,
        publication_generation: u32,
    ) -> Result<(), PlacementSlotError> {
        if self.prepared {
            return Err(PlacementSlotError::AlreadyPrepared);
        }
        if publication_generation == 0
            || publication_generation <= self.committed_publication_generation
            || publication_generation <= self.acknowledged_publication_generation
        {
            return Err(PlacementSlotError::InvalidPublicationGeneration);
        }
        self.begin_prepare(publication_generation)?;
        self.prepared = true;
        Ok(())
    }

    /// Reconciles edited occurrence ranges, sharing the unchanged canonical order and key index.
    /// Assignments contain these ranges in input order; changed keys receive fresh physical slots.
    pub(crate) fn prepare_retained_subset(
        &mut self,
        desired: &[Key],
        ranges: impl Iterator<Item = Option<core::ops::Range<usize>>>,
        publication_generation: u32,
    ) -> Result<bool, PlacementSlotError> {
        self.prepare_reuse(publication_generation)?;
        let result = (|| {
            let mut cursor = 0usize;
            let mut previous_end = 0;
            for range in ranges {
                let Some(range) = range else {
                    return Ok(false);
                };
                if range.start < previous_end
                    || range.start > range.end
                    || range.end > self.committed_order.len()
                {
                    return Ok(false);
                }
                previous_end = range.end;
                let end = cursor
                    .checked_add(range.len())
                    .ok_or(PlacementSlotError::ArithmeticOverflow)?;
                if let Some((previous_range, previous_inputs)) = self.occurrence_edits.last_mut()
                    && previous_range.end == range.start
                    && previous_inputs.end == cursor
                {
                    previous_range.end = range.end;
                    previous_inputs.end = end;
                } else {
                    reserve(&mut self.occurrence_edits, 1)?;
                    self.occurrence_edits.push((range, cursor..end));
                }
                cursor = end;
            }
            if cursor != desired.len() {
                return Ok(false);
            }
            reserve(&mut self.assignments, desired.len())?;
            let mut retained = true;
            for edit in 0..self.occurrence_edits.len() {
                let (range, inputs) = self.occurrence_edits[edit].clone();
                for (occurrence, input) in range.zip(inputs) {
                    match self.committed_assignment(occurrence, desired[input])? {
                        Some(handle) => self.assignments.push(handle),
                        None => {
                            retained = false;
                            break;
                        }
                    }
                }
                if !retained {
                    break;
                }
            }
            if !retained {
                self.assignments.clear();
                self.prepare_structural_scope(desired)?;
            }
            Ok(true)
        })();
        if !matches!(result, Ok(true)) {
            self.abort();
        }
        result
    }

    pub(crate) fn committed_assignment(
        &self,
        occurrence: usize,
        key: Key,
    ) -> Result<Option<PlacementHandle>, PlacementSlotError> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.placement_slot_checks += 1);
        let Some(slot) = self.committed_order.get(occurrence).copied() else {
            return Ok(None);
        };
        let state = self.slot_state(slot)?;
        let occupant = state
            .occupant
            .as_ref()
            .ok_or(PlacementSlotError::ArithmeticOverflow)?;
        Ok((*occupant == key).then_some(PlacementHandle {
            slot,
            generation: state.generation,
        }))
    }

    fn prepare_retained(&mut self, desired: &[Key]) -> Result<bool, PlacementSlotError> {
        if desired.len() != self.committed_order.len() {
            return Ok(false);
        }
        reserve(&mut self.assignments, desired.len())?;
        for (index, placement) in desired.iter().enumerate() {
            let Some(handle) = self.committed_assignment(index, *placement)? else {
                return Ok(false);
            };
            self.assignments.push(handle);
        }
        self.prepared = true;
        Ok(true)
    }

    fn prepare_structural(&mut self, desired: &[Key]) -> Result<(), PlacementSlotError> {
        reserve(&mut self.occurrence_edits, 1)?;
        self.occurrence_edits
            .push((0..self.committed_order.len(), 0..desired.len()));
        self.prepare_structural_scope(desired)
    }

    /// Both complete and sparse reconciliation edit the same staged ordered roots.
    /// Clean index intervals are shared; only removed occurrences and desired keys are visited.
    fn prepare_structural_scope(&mut self, desired: &[Key]) -> Result<(), PlacementSlotError> {
        let complete = self.occurrence_edits.len() == 1
            && self.occurrence_edits[0].0 == (0..self.committed_order.len());
        let removed_count = if complete {
            0
        } else {
            self.occurrence_edits
                .iter()
                .try_fold(0usize, |total, (range, _)| {
                    total
                        .checked_add(range.len())
                        .ok_or(PlacementSlotError::ArithmeticOverflow)
                })?
        };
        let edits = removed_count
            .checked_add(desired.len())
            .ok_or(PlacementSlotError::ArithmeticOverflow)?;
        reserve(&mut self.index_edits, edits)?;
        reserve(&mut self.assignments, desired.len())?;
        reserve(&mut self.writes, desired.len())?;
        reserve(
            &mut self.retirements,
            if complete {
                self.committed_index.len()
            } else {
                removed_count
            },
        )?;
        if !complete {
            for (range, _) in &self.occurrence_edits {
                let mut cursor = self
                    .committed_order
                    .cursor_from(range.start)
                    .ok_or(PlacementSlotError::ArithmeticOverflow)?;
                let retained = cursor
                    .take(range.len())
                    .ok_or(PlacementSlotError::ArithmeticOverflow)?;
                for slot in retained.iter().copied() {
                    let key = self
                        .slot_state(slot)?
                        .occupant
                        .ok_or(PlacementSlotError::ArithmeticOverflow)?;
                    self.index_edits.push(IndexEdit {
                        key,
                        removed: Some(slot),
                        desired: None,
                    });
                }
            }
        }
        for (ordinal, key) in desired.iter().copied().enumerate() {
            self.index_edits.push(IndexEdit {
                key,
                removed: None,
                desired: Some(ordinal),
            });
        }
        let (removed_edits, desired_edits) = self.index_edits.split_at_mut(removed_count);
        for edits in [removed_edits, desired_edits] {
            if edits.windows(2).any(|pair| pair[0].key > pair[1].key) {
                edits.sort_unstable_by_key(|edit| edit.key);
            }
        }
        self.assignments.resize(
            desired.len(),
            PlacementHandle {
                slot: PlacementSlot(u32::MAX),
                generation: PlacementGeneration::INITIAL,
            },
        );
        // Cloning the owner keeps this borrowed ordered stream independent of arena mutations.
        let committed = self.committed_index.clone();
        let mut complete_removed = committed.iter().copied();
        let mut removed_cursor = 0;
        let mut desired_cursor = removed_count;
        let mut old = if complete {
            complete_removed
                .next()
                .map(|slot| self.keyed_slot(slot))
                .transpose()?
        } else {
            self.index_edits[..removed_count]
                .first()
                .and_then(|edit| edit.removed.map(|slot| (edit.key, slot)))
        };
        let mut retained_start = 0;
        while old.is_some() || desired_cursor < self.index_edits.len() {
            #[cfg(test)]
            super::work_attribution::record(|work| work.placement_reconciled_key_groups += 1);
            let next = self.index_edits.get(desired_cursor).copied();
            let key = match (old, next) {
                (Some((old_key, _)), Some(edit)) => old_key.min(edit.key),
                (Some((old_key, _)), None) => old_key,
                (None, Some(edit)) => edit.key,
                (None, None) => break,
            };
            let mut removed = None;
            if let Some((old_key, slot)) = old.filter(|(old_key, _)| *old_key == key) {
                removed = Some(slot);
                old = if complete {
                    complete_removed
                        .next()
                        .map(|slot| self.keyed_slot(slot))
                        .transpose()?
                } else {
                    removed_cursor += 1;
                    self.index_edits[..removed_count]
                        .get(removed_cursor)
                        .and_then(|edit| edit.removed.map(|slot| (edit.key, slot)))
                };
                if old.is_some_and(|(next_key, _)| next_key == old_key) {
                    return Err(PlacementSlotError::DuplicateLogicalKey);
                }
            }
            let mut ordinal = None;
            if let Some(edit) = next.filter(|edit| edit.key == key) {
                ordinal = edit.desired;
                desired_cursor += 1;
                if self
                    .index_edits
                    .get(desired_cursor)
                    .is_some_and(|edit| edit.key == key)
                {
                    return Err(PlacementSlotError::DuplicateLogicalKey);
                }
            }
            if !complete {
                let mut low = retained_start;
                let mut high = self.committed_index.len();
                while low < high {
                    let middle = low + (high - low) / 2;
                    let slot = self
                        .committed_index
                        .get(middle)
                        .copied()
                        .ok_or(PlacementSlotError::ArithmeticOverflow)?;
                    if self.keyed_slot(slot)?.0 < key {
                        low = middle + 1;
                    } else {
                        high = middle;
                    }
                }
                let existing = self
                    .committed_index
                    .get(low)
                    .copied()
                    .map(|slot| self.keyed_slot(slot))
                    .transpose()?
                    .filter(|entry| entry.0 == key);
                if existing.map(|entry| entry.1) != removed {
                    return Err(PlacementSlotError::DuplicateLogicalKey);
                }
                self.pending_index
                    .append_shared_range(&self.committed_index, retained_start..low)
                    .map_err(|_| PlacementSlotError::AllocationFailed)?;
                retained_start = low + usize::from(existing.is_some());
            }
            if let Some(input) = ordinal {
                let handle = self.assign_placement(&key, removed)?;
                self.pending_index
                    .push(handle.slot)
                    .map_err(|_| PlacementSlotError::AllocationFailed)?;
                self.assignments[input] = handle;
            } else if let Some(slot) = removed {
                self.retire_slot(slot)?;
            }
        }
        if !complete {
            self.pending_index
                .append_shared_range(
                    &self.committed_index,
                    retained_start..self.committed_index.len(),
                )
                .map_err(|_| PlacementSlotError::AllocationFailed)?;
        }
        self.pending_order = self.committed_order.clone();
        for (range, inputs) in &self.occurrence_edits {
            let mut replacement = RetainedRope::default();
            for handle in &self.assignments[inputs.clone()] {
                replacement
                    .push(handle.slot)
                    .map_err(|_| PlacementSlotError::AllocationFailed)?;
            }
            if !self
                .pending_order
                .replace_range(range.clone(), &replacement)
                .map_err(|_| PlacementSlotError::AllocationFailed)?
            {
                return Err(PlacementSlotError::ArithmeticOverflow);
            }
        }
        self.finish_structural_prepare()
    }

    fn assign_placement(
        &mut self,
        logical_key: &Key,
        existing: Option<PlacementSlot>,
    ) -> Result<PlacementHandle, PlacementSlotError> {
        let Some(slot) = existing else {
            let handle = self.allocate_slot()?;
            self.writes.push(PendingWrite {
                handle,
                logical_key: *logical_key,
            });
            return Ok(handle);
        };
        let state = self.slot_state(slot)?;
        let occupant = state
            .occupant
            .as_ref()
            .ok_or(PlacementSlotError::ArithmeticOverflow)?;
        if *occupant != *logical_key {
            return Err(PlacementSlotError::ArithmeticOverflow);
        }
        Ok(PlacementHandle {
            slot,
            generation: state.generation,
        })
    }

    fn retire_slot(&mut self, slot: PlacementSlot) -> Result<(), PlacementSlotError> {
        let state = self.slot_state(slot)?;
        if state.occupant.is_none() {
            return Err(PlacementSlotError::ArithmeticOverflow);
        }
        self.retirements.push(PlacementHandle {
            slot,
            generation: state.generation,
        });
        Ok(())
    }

    fn finish_structural_prepare(&mut self) -> Result<(), PlacementSlotError> {
        reserve(&mut self.quarantine, self.retirements.len())?;

        let required_slots = usize::try_from(self.pending_slot_count)
            .map_err(|_| PlacementSlotError::ArithmeticOverflow)?;
        let additional_slots = required_slots.saturating_sub(self.slots.len());
        reserve(&mut self.slots, additional_slots)?;
        self.pending_structural_change = true;
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn assignments(&self) -> Result<&[PlacementHandle], PlacementSlotError> {
        if !self.prepared {
            return Err(PlacementSlotError::NotPrepared);
        }
        Ok(&self.assignments)
    }

    pub(crate) fn required_slots(&self) -> Result<u32, PlacementSlotError> {
        if !self.prepared {
            return Err(PlacementSlotError::NotPrepared);
        }
        Ok(self.pending_slot_count)
    }

    /// Promotes a fully prepared transaction. This path is total and performs no allocation or
    /// arithmetic; committing with nothing prepared leaves committed state unchanged.
    pub(crate) fn commit(&mut self) {
        if !self.prepared {
            return;
        }

        for handle in self.retirements.iter().copied() {
            let state = &mut self.slots[handle.slot.0 as usize];
            debug_assert_eq!(state.generation, handle.generation);
            debug_assert!(state.occupant.is_some());
            state.occupant = None;
            self.quarantine.push(QuarantinedPlacementSlot {
                handle,
                after_publication_generation: self.pending_publication_generation,
            });
        }

        for write in self.writes.drain(..) {
            let slot_index = write.handle.slot.0 as usize;
            if slot_index == self.slots.len() {
                self.slots.push(PlacementSlotState {
                    generation: write.handle.generation,
                    occupant: Some(write.logical_key),
                });
            } else {
                let state = &mut self.slots[slot_index];
                debug_assert!(
                    state.occupant.is_none() || state.generation != write.handle.generation
                );
                state.generation = write.handle.generation;
                state.occupant = Some(write.logical_key);
            }
        }
        debug_assert_eq!(self.slots.len(), self.pending_slot_count as usize);

        if self.pending_structural_change {
            core::mem::swap(&mut self.committed_index, &mut self.pending_index);
            core::mem::swap(&mut self.committed_order, &mut self.pending_order);
        }
        self.committed_publication_generation = self.pending_publication_generation;
        self.finish_transaction();
    }

    /// Discards pending identities and returns acknowledged free slots to the allocator.
    pub(crate) fn abort(&mut self) {
        for slot in self.allocated_free_slots.drain(..).rev() {
            self.free_slots.push(slot);
        }
        self.finish_transaction();
    }

    fn begin_prepare(&mut self, publication_generation: u32) -> Result<(), PlacementSlotError> {
        self.assignments.clear();
        self.retirements.clear();
        self.writes.clear();
        self.allocated_free_slots.clear();
        self.pending_index.clear();
        self.pending_order.clear();
        self.index_edits.clear();
        self.occurrence_edits.clear();
        self.pending_structural_change = false;
        self.pending_slot_count =
            u32::try_from(self.slots.len()).map_err(|_| PlacementSlotError::ArithmeticOverflow)?;
        self.pending_publication_generation = publication_generation;
        Ok(())
    }

    fn finish_transaction(&mut self) {
        self.assignments.clear();
        self.retirements.clear();
        self.writes.clear();
        self.allocated_free_slots.clear();
        self.pending_index.clear();
        self.pending_order.clear();
        self.index_edits.clear();
        self.occurrence_edits.clear();
        self.pending_structural_change = false;
        self.pending_publication_generation = 0;
        self.prepared = false;
    }

    #[cfg(test)]
    fn prepare_counts(&self) -> (u32, u32) {
        (self.retained_prepare_count, self.structural_prepare_count)
    }

    #[cfg(test)]
    fn scratch_capacities(&self) -> [usize; 8] {
        [
            self.assignments.capacity(),
            self.retirements.capacity(),
            self.writes.capacity(),
            self.allocated_free_slots.capacity(),
            self.index_edits.capacity(),
            self.occurrence_edits.capacity(),
            self.slots.capacity(),
            self.quarantine.capacity(),
        ]
    }

    /// Only canonical index slots may be resolved before adoption. Prepared new slots receive
    /// their occupants in commit before either staged root becomes canonical.
    fn keyed_slot(&self, slot: PlacementSlot) -> Result<(Key, PlacementSlot), PlacementSlotError> {
        let key = self
            .slot_state(slot)?
            .occupant
            .ok_or(PlacementSlotError::ArithmeticOverflow)?;
        Ok((key, slot))
    }

    fn slot_state(
        &self,
        slot: PlacementSlot,
    ) -> Result<&PlacementSlotState<Key>, PlacementSlotError> {
        self.slots
            .get(slot.0 as usize)
            .ok_or(PlacementSlotError::ArithmeticOverflow)
    }

    fn allocate_slot(&mut self) -> Result<PlacementHandle, PlacementSlotError> {
        if let Some(&slot) = self.free_slots.last() {
            reserve(&mut self.allocated_free_slots, 1)?;
            let state = self.slot_state(slot)?;
            if state.occupant.is_some() {
                return Err(PlacementSlotError::ArithmeticOverflow);
            }
            let generation = state.generation.next()?;
            self.free_slots.pop();
            self.allocated_free_slots.push(slot);
            return Ok(PlacementHandle { slot, generation });
        }

        let slot = PlacementSlot(self.pending_slot_count);
        self.pending_slot_count = self
            .pending_slot_count
            .checked_add(1)
            .ok_or(PlacementSlotError::SlotExhausted)?;
        Ok(PlacementHandle {
            slot,
            generation: PlacementGeneration::INITIAL,
        })
    }
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), PlacementSlotError> {
    values
        .try_reserve(additional)
        .map_err(|_| PlacementSlotError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    const fn placement(key: u64) -> u64 {
        key
    }

    fn handles(arena: &PlacementSlotArena<u64>) -> Vec<PlacementHandle> {
        arena.assignments().unwrap().to_vec()
    }

    fn assert_index_matches_desired(arena: &PlacementSlotArena<u64>, desired: &[u64]) {
        let keys: Vec<_> = arena
            .committed_index
            .iter()
            .map(|slot| arena.slots[slot.get() as usize].occupant.unwrap())
            .collect();
        let mut expected = desired.to_vec();
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }

    fn committed_key(arena: &PlacementSlotArena<u64>, handle: PlacementHandle) -> Option<u64> {
        let state = arena.slots.get(handle.slot.0 as usize)?;
        (state.generation == handle.generation).then_some(*state.occupant.as_ref()?)
    }

    #[test]
    fn retained_order_uses_the_allocation_free_fast_path() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10), placement(20)], 1).unwrap();
        assert_eq!(arena.prepare_counts(), (0, 1));
        arena.commit();
        let warmed_capacities = arena.scratch_capacities();

        arena.prepare(&[placement(10), placement(20)], 2).unwrap();
        assert_eq!(arena.prepare_counts(), (1, 1));
        assert_eq!(arena.scratch_capacities(), warmed_capacities);
        assert!(arena.retirements.is_empty());
        let retained = handles(&arena);
        arena.commit();

        arena.prepare(&[placement(20), placement(10)], 3).unwrap();
        assert_eq!(arena.prepare_counts(), (1, 2));
        assert_eq!(handles(&arena), [retained[1], retained[0]]);
        assert!(arena.retirements.is_empty());
        arena.commit();
        arena.commit();
    }

    #[test]
    fn sparse_occurrence_ranges_preserve_canonical_order_through_abort_and_retry() {
        for count in [10_usize, 100, 1_000] {
            let desired: Vec<_> = (1..=count).map(|key| key as u64).collect();
            let mut arena = PlacementSlotArena::default();
            arena.prepare(&desired, 1).unwrap();
            let canonical = handles(&arena);
            arena.commit();
            let mut full = PlacementSlotArena::default();
            full.prepare(&desired, 1).unwrap();
            full.commit();
            let mut seed = 0x1234_5678_u32;
            for generation in 2..34 {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                let middle = 1 + seed as usize % (count - 2);
                let indices = [0, middle, count - 1];
                let subset = indices.map(|index| desired[index]);
                full.prepare(&desired, generation).unwrap();
                let full_handles = handles(&full);
                super::super::work_attribution::reset();
                assert!(
                    arena
                        .prepare_retained_subset(
                            &subset,
                            indices.into_iter().map(|index| Some(index..index + 1)),
                            generation
                        )
                        .unwrap()
                );
                assert_eq!(handles(&arena), indices.map(|index| full_handles[index]));
                assert_eq!(
                    super::super::work_attribution::snapshot().placement_slot_checks,
                    3
                );
                if generation % 3 == 0 {
                    arena.abort();
                    assert!(
                        arena
                            .prepare_retained_subset(
                                &subset,
                                indices.into_iter().map(|index| Some(index..index + 1)),
                                generation
                            )
                            .unwrap()
                    );
                }
                arena.commit();
                full.commit();
                assert_eq!(arena.committed_order, full.committed_order);
                assert_eq!(arena.committed_index, full.committed_index);
                assert_index_matches_desired(&arena, &desired);
                assert_index_matches_desired(&full, &desired);
                assert_eq!(arena.committed_order.len(), count);
                for (index, handle) in canonical.iter().copied().enumerate() {
                    assert_eq!(committed_key(&arena, handle), Some(desired[index]));
                }
            }
            let mut changed = desired.clone();
            changed[1] = u64::MAX;
            full.prepare(&changed, 34).unwrap();
            assert!(
                arena
                    .prepare_retained_subset(&[u64::MAX], [Some(1..2)].into_iter(), 34)
                    .unwrap()
            );
            assert_eq!(handles(&arena), [handles(&full)[1]]);
            arena.abort();
            full.abort();
            assert!(
                !arena
                    .prepare_retained_subset(
                        &desired[..2],
                        [Some(0..1), Some(0..1)].into_iter(),
                        34
                    )
                    .unwrap()
            );
            assert!(!arena.prepared);
            // A topology mismatch rejoins the existing complete reconciler; no new arena.
            arena.prepare(&desired, 34).unwrap();
            full.prepare(&desired, 34).unwrap();
            assert_eq!(handles(&arena), handles(&full));
            arena.commit();
            full.commit();
            let mut grown = desired.clone();
            grown.push(count as u64 + 1);
            let mut reordered = desired.clone();
            reordered.swap(0, count - 1);
            let mut changed = reordered.clone();
            changed[0] = u64::MAX - 1;
            for (generation, candidate) in (35..).zip([grown, desired.clone(), reordered, changed])
            {
                let previous_count = arena.committed_order.len();
                let prepared = arena
                    .prepare_retained_subset(
                        &candidate,
                        [Some(0..previous_count)].into_iter(),
                        generation,
                    )
                    .unwrap();
                if !prepared {
                    arena.prepare(&candidate, generation).unwrap();
                }
                full.prepare(&candidate, generation).unwrap();
                assert_eq!(handles(&arena), handles(&full));
                arena.commit();
                full.commit();
                assert_eq!(arena.committed_order, full.committed_order);
                assert_eq!(arena.committed_index, full.committed_index);
                assert_index_matches_desired(&arena, &candidate);
                assert_index_matches_desired(&full, &candidate);
            }
        }
    }

    #[test]
    fn adjacent_occurrence_ranges_share_full_reconciliation_and_rollback() {
        let mut desired: Vec<u64> = (1..=8).collect();
        let mut scoped = PlacementSlotArena::default();
        let mut full = PlacementSlotArena::default();
        scoped.prepare(&desired, 1).unwrap();
        scoped.commit();
        full.prepare(&desired, 1).unwrap();
        full.commit();
        for (generation, ranges) in [
            (2, vec![0..0, 0..2, 2..2, 2..5, 5..8, 8..8]),
            (3, vec![0..2, 4..6]),
            (4, vec![0..2, 2..4, 4..6, 6..8]),
        ] {
            let mut candidate = desired.clone();
            candidate.swap(0, 1);
            candidate[5] = 100 + generation as u64;
            let subset: Vec<_> = ranges
                .iter()
                .flat_map(|range| candidate[range.clone()].iter().copied())
                .collect();
            let expected_ranges = if generation == 3 { 2 } else { 1 };
            let order = scoped.committed_order.clone();
            let index = scoped.committed_index.clone();
            let slots = scoped.slots.clone();
            let free = scoped.free_slots.clone();
            let quarantine = scoped.quarantine.clone();
            full.prepare(&candidate, generation).unwrap();
            let expected = handles(&full);
            super::super::work_attribution::reset();
            assert!(
                scoped
                    .prepare_retained_subset(&subset, ranges.iter().cloned().map(Some), generation)
                    .unwrap()
            );
            let work = super::super::work_attribution::snapshot();
            assert_eq!(scoped.occurrence_edits.len(), expected_ranges);
            assert_eq!(
                handles(&scoped),
                ranges
                    .iter()
                    .flat_map(|range| expected[range.clone()].iter().copied())
                    .collect::<Vec<_>>()
            );
            if expected_ranges == 1 {
                // One changed first key ends the retained attempt. Complete reconciliation
                // streams the canonical index without per-key rope binary searches.
                assert_eq!(work.rope_point_queries, 1);
                assert_eq!(scoped.index_edits.len(), candidate.len());
            }
            scoped.abort();
            full.abort();
            assert_eq!(scoped.committed_order, order);
            assert_eq!(scoped.committed_index, index);
            assert_eq!(scoped.slots, slots);
            assert_eq!(scoped.free_slots, free);
            assert_eq!(scoped.quarantine, quarantine);
            full.prepare(&candidate, generation).unwrap();
            assert!(
                scoped
                    .prepare_retained_subset(&subset, ranges.iter().cloned().map(Some), generation)
                    .unwrap()
            );
            scoped.commit();
            full.commit();
            assert_eq!(scoped.committed_order, full.committed_order);
            assert_eq!(scoped.committed_index, full.committed_index);
            assert_index_matches_desired(&scoped, &candidate);
            scoped.acknowledge(generation).unwrap();
            full.acknowledge(generation).unwrap();
            desired = candidate;
        }
        let order = scoped.committed_order.clone();
        let slots = scoped.slots.clone();
        let free = scoped.free_slots.clone();
        let mut duplicate = desired.clone();
        duplicate[1] = duplicate[0];
        assert_eq!(
            scoped.prepare_retained_subset(&duplicate, [Some(0..4), Some(4..8)].into_iter(), 5),
            Err(PlacementSlotError::DuplicateLogicalKey)
        );
        assert_eq!(scoped.committed_order, order);
        assert_eq!(scoped.slots, slots);
        assert_eq!(scoped.free_slots, free);
        assert!(
            !scoped
                .prepare_retained_subset(&desired[..4], [Some(0..2), Some(1..3)].into_iter(), 5)
                .unwrap()
        );
        scoped.prepare(&desired, 5).unwrap();
        full.prepare(&desired, 5).unwrap();
        assert_eq!(handles(&scoped), handles(&full));
    }

    #[test]
    fn sparse_structural_edits_match_full_arena_with_quarantine_and_retry() {
        let mut desired: Vec<u64> = (1..=100).collect();
        let mut sparse = PlacementSlotArena::default();
        let mut full = PlacementSlotArena::default();
        sparse.prepare(&desired, 1).unwrap();
        sparse.commit();
        full.prepare(&desired, 1).unwrap();
        full.commit();
        let mut seed = 0x3456_789a_u32;
        for generation in 2..66 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let middle = 1 + seed as usize % 98;
            let indices = [0, middle, 99];
            let mut candidate = desired.clone();
            candidate.swap(0, 99);
            candidate[middle] = 1_000 + generation as u64;
            let subset = indices.map(|index| candidate[index]);
            let old = sparse
                .committed_assignment(middle, desired[middle])
                .unwrap()
                .unwrap();
            full.prepare(&candidate, generation).unwrap();
            assert!(
                sparse
                    .prepare_retained_subset(
                        &subset,
                        indices.into_iter().map(|index| Some(index..index + 1)),
                        generation
                    )
                    .unwrap()
            );
            let expected = handles(&full);
            assert_eq!(handles(&sparse), indices.map(|index| expected[index]));
            assert_ne!(handles(&sparse)[1].slot, old.slot);
            if generation % 3 == 0 {
                let before = sparse.free_slots.clone();
                sparse.abort();
                full.abort();
                full.prepare(&candidate, generation).unwrap();
                assert!(
                    sparse
                        .prepare_retained_subset(
                            &subset,
                            indices.into_iter().map(|index| Some(index..index + 1)),
                            generation
                        )
                        .unwrap()
                );
                assert_eq!(sparse.free_slots, before);
                assert_eq!(handles(&sparse), indices.map(|index| handles(&full)[index]));
            }
            sparse.commit();
            full.commit();
            assert_eq!(sparse.committed_order, full.committed_order);
            assert_eq!(sparse.committed_index, full.committed_index);
            assert_index_matches_desired(&sparse, &candidate);
            assert_index_matches_desired(&full, &candidate);
            assert!(sparse.quarantine.iter().any(|entry| entry.handle == old));
            // A renderer rejection does not acknowledge these retired slots. The next
            // full checkpoint retains canonical handles without reclaiming them.
            if generation % 2 == 0 {
                sparse.acknowledge(generation - 1).unwrap();
                full.acknowledge(generation - 1).unwrap();
            }
            desired = candidate;
        }
        let canonical_order = sparse.committed_order.clone();
        let free = sparse.free_slots.clone();
        assert_eq!(
            sparse.prepare_retained_subset(&[desired[1]], [Some(0..1)].into_iter(), 66),
            Err(PlacementSlotError::DuplicateLogicalKey)
        );
        assert_eq!(sparse.committed_order, canonical_order);
        assert_eq!(sparse.free_slots, free);
        assert!(!sparse.prepared);

        // Fail after a preceding new-key group has already popped an acknowledged free slot.
        desired.pop();
        sparse.prepare(&desired, 66).unwrap();
        sparse.commit();
        sparse.acknowledge(66).unwrap();
        full.prepare(&desired, 66).unwrap();
        full.commit();
        full.acknowledge(66).unwrap();
        let order = sparse.committed_order.clone();
        let index = sparse.committed_index.clone();
        let slots = sparse.slots.clone();
        let quarantine = sparse.quarantine.clone();
        let free = sparse.free_slots.clone();
        assert!(!free.is_empty());
        assert_eq!(
            sparse.prepare_retained_subset(
                &[0, desired[1]],
                [Some(0..1), Some(3..4)].into_iter(),
                67
            ),
            Err(PlacementSlotError::DuplicateLogicalKey)
        );
        assert_eq!(sparse.committed_order, order);
        assert_eq!(sparse.committed_index, index);
        assert_eq!(sparse.slots, slots);
        assert_eq!(sparse.quarantine, quarantine);
        assert_eq!(sparse.free_slots, free);
        desired[0] = 0;
        desired[3] = 5_000;
        full.prepare(&desired, 67).unwrap();
        assert!(
            sparse
                .prepare_retained_subset(&[0, 5_000], [Some(0..1), Some(3..4)].into_iter(), 67)
                .unwrap()
        );
        assert_eq!(handles(&sparse), [handles(&full)[0], handles(&full)[3]]);
        sparse.commit();
        full.commit();
        assert_eq!(sparse.committed_order, full.committed_order);
        assert_eq!(sparse.committed_index, full.committed_index);
        assert_index_matches_desired(&sparse, &desired);
        assert_index_matches_desired(&full, &desired);
    }

    #[test]
    fn unchanged_publication_reuses_the_complete_committed_set() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10), placement(20)], 1).unwrap();
        let committed = handles(&arena);
        arena.commit();

        arena.prepare_reuse(2).unwrap();
        assert!(arena.assignments().unwrap().is_empty());
        assert_eq!(arena.required_slots().unwrap(), 2);
        arena.commit();
        assert_eq!(committed_key(&arena, committed[0]), Some(10));
        assert_eq!(committed_key(&arena, committed[1]), Some(20));
        arena.acknowledge(2).unwrap();
    }

    #[test]
    fn retirement_quarantines_then_reuses_with_a_new_generation() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10), placement(20)], 1).unwrap();
        let original = handles(&arena);
        arena.commit();

        arena.prepare(&[placement(10)], 2).unwrap();
        assert_eq!(arena.retirements, [original[1]]);
        arena.commit();

        arena.prepare(&[placement(10), placement(30)], 3).unwrap();
        assert_eq!(handles(&arena)[1].slot().get(), 2);
        arena.commit();

        arena.acknowledge(2).unwrap();
        arena
            .prepare(&[placement(10), placement(30), placement(40)], 4)
            .unwrap();
        let reused = handles(&arena)[2];
        assert_eq!(reused.slot(), original[1].slot());
        assert_eq!(reused.generation().get(), 2);
        arena.commit();
        assert_eq!(committed_key(&arena, original[1]), None);
        assert_eq!(committed_key(&arena, reused), Some(40));
    }

    #[test]
    fn abort_restores_reclaimed_slots_and_committed_handles() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10)], 1).unwrap();
        let original = handles(&arena)[0];
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena.prepare(&[placement(20)], 3).unwrap();
        let aborted = handles(&arena)[0];
        assert_eq!(aborted.slot(), original.slot());
        arena.abort();
        assert_eq!(committed_key(&arena, original), None);

        arena.prepare(&[placement(30)], 3).unwrap();
        assert_eq!(handles(&arena)[0], aborted);
        arena.commit();
    }

    #[test]
    fn abort_restores_multiple_free_slots_in_exact_stack_order() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10), placement(20)], 1).unwrap();
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena.prepare(&[placement(30), placement(40)], 3).unwrap();
        let aborted = handles(&arena);
        arena.abort();

        arena.prepare(&[placement(30), placement(40)], 3).unwrap();
        assert_eq!(handles(&arena), aborted);
    }

    #[test]
    fn duplicate_keys_and_regressing_acknowledgement_are_rejected() {
        let mut arena = PlacementSlotArena::default();
        assert_eq!(
            arena.prepare(&[placement(10), placement(10)], 1),
            Err(PlacementSlotError::DuplicateLogicalKey)
        );
        arena.prepare(&[placement(10)], 1).unwrap();
        arena.commit();
        arena.acknowledge(1).unwrap();
        assert_eq!(
            arena.acknowledge(0),
            Err(PlacementSlotError::AcknowledgementRegressed)
        );
    }

    #[test]
    fn generation_exhaustion_never_wraps_or_changes_committed_state() {
        let generation = PlacementGeneration(NonZeroU32::new(u32::MAX).unwrap());
        let mut arena = PlacementSlotArena {
            slots: vec![PlacementSlotState {
                generation,
                occupant: None,
            }],
            free_slots: vec![PlacementSlot(0)],
            committed_publication_generation: 1,
            acknowledged_publication_generation: 1,
            ..PlacementSlotArena::default()
        };

        assert_eq!(
            arena.prepare(&[placement(10)], 2),
            Err(PlacementSlotError::GenerationExhausted)
        );
        assert_eq!(arena.free_slots, [PlacementSlot(0)]);
        assert_eq!(arena.assignments(), Err(PlacementSlotError::NotPrepared));
    }

    #[test]
    fn acknowledgement_survives_a_later_aborted_prepare() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10)], 1).unwrap();
        let original = handles(&arena)[0];
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena.prepare(&[placement(20)], 3).unwrap();
        assert_eq!(handles(&arena)[0].slot(), original.slot());
        arena.abort();

        arena.prepare(&[placement(30)], 3).unwrap();
        assert_eq!(handles(&arena)[0].slot(), original.slot());
    }

    #[test]
    fn acknowledged_churn_reuses_two_slots_and_plateaus_scratch_capacity() {
        let mut arena = PlacementSlotArena::default();
        arena.prepare(&[placement(10)], 1).unwrap();
        arena.commit();

        for publication in 2..=8 {
            arena.acknowledge(publication - 1).unwrap();
            arena
                .prepare(&[placement(publication as u64)], publication)
                .unwrap();
            arena.commit();
        }
        let warmed_capacities = arena.scratch_capacities();

        for publication in 9..=1_024 {
            arena.acknowledge(publication - 1).unwrap();
            arena
                .prepare(&[placement(publication as u64)], publication)
                .unwrap();
            arena.commit();
        }
        assert_eq!(arena.scratch_capacities(), warmed_capacities);
        assert_eq!(arena.slots.len(), 2);
        assert_eq!(arena.quarantine.len(), 1);
    }
}
