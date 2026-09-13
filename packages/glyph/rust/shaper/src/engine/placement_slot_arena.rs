//! Planner-scoped stable identity for retained placement occurrences.
//!
//! An occurrence's logical key reconciles it with the preceding committed publication. The dense
//! slot is only physical storage, and its generation prevents a stale handle from naming reused
//! storage. Removed slots remain quarantined until the renderer acknowledges their retirement.

use alloc::vec::Vec;
use core::num::NonZeroU32;

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

/// One desired live placement identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DesiredPlacement<Key> {
    logical_key: Key,
}

impl<Key> DesiredPlacement<Key> {
    pub(crate) const fn new(logical_key: Key) -> Self {
        Self { logical_key }
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
struct Occupant<Key> {
    logical_key: Key,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlacementSlotState<Key> {
    generation: PlacementGeneration,
    occupant: Option<Occupant<Key>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QuarantinedPlacementSlot {
    handle: PlacementHandle,
    after_publication_generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingWrite<Key> {
    handle: PlacementHandle,
    occupant: Occupant<Key>,
}

/// Transactional dense placement storage owned by exactly one retained planner/root.
///
/// `Key` must contain every logical-incarnation component needed to prevent cross-paragraph reuse.
pub(crate) struct PlacementSlotArena<Key> {
    slots: Vec<PlacementSlotState<Key>>,
    /// Sorted exact index of committed logical keys.
    committed_index: Vec<(Key, PlacementSlot)>,
    /// Physical slots in the preceding publication's desired-occurrence order.
    committed_order: Vec<PlacementSlot>,
    free_slots: Vec<PlacementSlot>,
    quarantine: Vec<QuarantinedPlacementSlot>,
    assignments: Vec<PlacementHandle>,
    retirements: Vec<PlacementHandle>,
    writes: Vec<PendingWrite<Key>>,
    /// Slots removed from `free_slots` by the pending transaction, restored on abort.
    allocated_free_slots: Vec<PlacementSlot>,
    /// Sorted exact index built for the pending live set and swapped on commit.
    pending_index: Vec<(Key, PlacementSlot)>,
    /// Physical slots in a structurally changed pending desired-occurrence order.
    pending_order: Vec<PlacementSlot>,
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

impl<Key> Default for PlacementSlotArena<Key> {
    fn default() -> Self {
        Self {
            slots: Vec::new(),
            committed_index: Vec::new(),
            committed_order: Vec::new(),
            free_slots: Vec::new(),
            quarantine: Vec::new(),
            assignments: Vec::new(),
            retirements: Vec::new(),
            writes: Vec::new(),
            allocated_free_slots: Vec::new(),
            pending_index: Vec::new(),
            pending_order: Vec::new(),
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
    /// Releases physical slots whose renderer retirement fence has completed.
    ///
    /// Acknowledgement is external monotonic state: once accepted, a later prepare/abort does not
    /// roll it back.
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

    /// Reconciles a complete desired live set against the preceding committed set.
    ///
    /// Assignments have the same order as `desired`. All allocation, generation, and exact-value
    /// checks complete before the transaction becomes observable as prepared.
    pub(crate) fn prepare(
        &mut self,
        desired: &[DesiredPlacement<Key>],
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

    fn prepare_retained(
        &mut self,
        desired: &[DesiredPlacement<Key>],
    ) -> Result<bool, PlacementSlotError> {
        if desired.len() != self.committed_order.len() {
            return Ok(false);
        }
        reserve(&mut self.assignments, desired.len())?;
        for (index, placement) in desired.iter().enumerate() {
            let slot = self.committed_order[index];
            let state = self.slot_state(slot)?;
            let occupant = state
                .occupant
                .as_ref()
                .ok_or(PlacementSlotError::ArithmeticOverflow)?;
            if occupant.logical_key != placement.logical_key {
                return Ok(false);
            }
            self.assignments.push(PlacementHandle {
                slot,
                generation: state.generation,
            });
        }
        self.prepared = true;
        Ok(true)
    }

    fn prepare_structural(
        &mut self,
        desired: &[DesiredPlacement<Key>],
    ) -> Result<(), PlacementSlotError> {
        if desired
            .windows(2)
            .any(|pair| pair[0].logical_key == pair[1].logical_key)
        {
            return Err(PlacementSlotError::DuplicateLogicalKey);
        }
        if desired
            .windows(2)
            .all(|pair| pair[0].logical_key < pair[1].logical_key)
        {
            return self.prepare_sorted_structural(desired);
        }
        self.prepare_indexed_structural(desired)
    }

    fn prepare_sorted_structural(
        &mut self,
        desired: &[DesiredPlacement<Key>],
    ) -> Result<(), PlacementSlotError> {
        reserve(&mut self.pending_index, desired.len())?;
        reserve(&mut self.pending_order, desired.len())?;
        reserve(&mut self.assignments, desired.len())?;
        reserve(&mut self.writes, desired.len())?;
        reserve(&mut self.retirements, self.slots.len())?;

        let mut committed = 0usize;
        for placement in desired {
            while let Some(&(key, slot)) = self.committed_index.get(committed) {
                if key >= placement.logical_key {
                    break;
                }
                self.retire_slot(slot)?;
                committed += 1;
            }
            let existing = self
                .committed_index
                .get(committed)
                .copied()
                .filter(|(key, _)| *key == placement.logical_key)
                .map(|(_, slot)| slot);
            if existing.is_some() {
                committed += 1;
            }
            let handle = self.assign_placement(placement, existing)?;
            self.pending_index
                .push((placement.logical_key, handle.slot));
            self.pending_order.push(handle.slot);
            self.assignments.push(handle);
        }
        while let Some(&(_, slot)) = self.committed_index.get(committed) {
            self.retire_slot(slot)?;
            committed += 1;
        }
        self.finish_structural_prepare()
    }

    fn prepare_indexed_structural(
        &mut self,
        desired: &[DesiredPlacement<Key>],
    ) -> Result<(), PlacementSlotError> {
        reserve(&mut self.pending_index, desired.len())?;
        reserve(&mut self.pending_order, desired.len())?;
        reserve(&mut self.assignments, desired.len())?;
        reserve(&mut self.writes, desired.len())?;
        let placeholder = PlacementHandle {
            slot: PlacementSlot(u32::MAX),
            generation: PlacementGeneration::INITIAL,
        };
        for (index, placement) in desired.iter().enumerate() {
            self.pending_index.push((
                placement.logical_key,
                PlacementSlot(
                    u32::try_from(index).map_err(|_| PlacementSlotError::ArithmeticOverflow)?,
                ),
            ));
            self.pending_order.push(PlacementSlot(u32::MAX));
            self.assignments.push(placeholder);
        }
        self.pending_index.sort_unstable_by_key(|entry| entry.0);
        if self
            .pending_index
            .windows(2)
            .any(|pair| pair[0].0 == pair[1].0)
        {
            return Err(PlacementSlotError::DuplicateLogicalKey);
        }
        reserve(&mut self.retirements, self.slots.len())?;
        let mut committed = 0usize;
        for pending in 0..self.pending_index.len() {
            let (key, original) = self.pending_index[pending];
            while let Some(&(committed_key, slot)) = self.committed_index.get(committed) {
                if committed_key >= key {
                    break;
                }
                self.retire_slot(slot)?;
                committed += 1;
            }
            let existing = self
                .committed_index
                .get(committed)
                .copied()
                .filter(|(committed_key, _)| *committed_key == key)
                .map(|(_, slot)| slot);
            if existing.is_some() {
                committed += 1;
            }
            let original =
                usize::try_from(original.0).map_err(|_| PlacementSlotError::ArithmeticOverflow)?;
            let handle = self.assign_placement(&desired[original], existing)?;
            self.pending_index[pending].1 = handle.slot;
            self.pending_order[original] = handle.slot;
            self.assignments[original] = handle;
        }
        while let Some(&(_, slot)) = self.committed_index.get(committed) {
            self.retire_slot(slot)?;
            committed += 1;
        }
        self.finish_structural_prepare()
    }

    fn assign_placement(
        &mut self,
        placement: &DesiredPlacement<Key>,
        existing: Option<PlacementSlot>,
    ) -> Result<PlacementHandle, PlacementSlotError> {
        let Some(slot) = existing else {
            let handle = self.allocate_slot()?;
            self.writes.push(PendingWrite {
                handle,
                occupant: Occupant {
                    logical_key: placement.logical_key,
                },
            });
            return Ok(handle);
        };
        let state = self.slot_state(slot)?;
        let occupant = state
            .occupant
            .as_ref()
            .ok_or(PlacementSlotError::ArithmeticOverflow)?;
        if occupant.logical_key != placement.logical_key {
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
                    occupant: Some(write.occupant),
                });
            } else {
                let state = &mut self.slots[slot_index];
                debug_assert!(
                    state.occupant.is_none() || state.generation != write.handle.generation
                );
                state.generation = write.handle.generation;
                state.occupant = Some(write.occupant);
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
            self.pending_index.capacity(),
            self.pending_order.capacity(),
            self.slots.capacity(),
            self.quarantine.capacity(),
        ]
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

    fn placement(key: u64) -> DesiredPlacement<u64> {
        DesiredPlacement::new(key)
    }

    fn handles(arena: &PlacementSlotArena<u64>) -> Vec<PlacementHandle> {
        arena.assignments().unwrap().to_vec()
    }

    fn committed_key(arena: &PlacementSlotArena<u64>, handle: PlacementHandle) -> Option<u64> {
        let state = arena.slots.get(handle.slot.0 as usize)?;
        (state.generation == handle.generation).then_some(state.occupant.as_ref()?.logical_key)
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
}
