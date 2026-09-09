//! Planner-scoped stable identity for retained layout runs.
//!
//! A run's logical key reconciles it with the preceding committed publication. The dense slot is
//! only physical storage, and its generation prevents a stale handle from naming changed or reused
//! storage. Removed slots remain quarantined until the renderer acknowledges the publication that
//! retired them.

use alloc::vec::Vec;
use core::num::NonZeroU32;

/// Dense planner-local storage index. It has no meaning outside its owning [`RunSlotArena`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RunSlot(u32);

impl RunSlot {
    pub(crate) const fn get(self) -> u32 {
        self.0
    }
}

/// Nonzero, nonwrapping incarnation of one physical run slot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RunGeneration(NonZeroU32);

impl RunGeneration {
    const INITIAL: Self = Self(NonZeroU32::MIN);

    pub(crate) const fn get(self) -> u32 {
        self.0.get()
    }

    fn next(self) -> Result<Self, RunSlotError> {
        let value = self
            .get()
            .checked_add(1)
            .ok_or(RunSlotError::GenerationExhausted)?;
        Ok(Self(
            NonZeroU32::new(value).ok_or(RunSlotError::GenerationExhausted)?,
        ))
    }
}

/// Opaque identity of one committed or prepared run in a planner-local namespace.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RunHandle {
    slot: RunSlot,
    generation: RunGeneration,
}

impl RunHandle {
    pub(crate) const fn slot(self) -> RunSlot {
        self.slot
    }

    pub(crate) const fn generation(self) -> RunGeneration {
        self.generation
    }
}

/// One desired live run. Keys and canonical values are compared exactly; neither is a hash token.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct DesiredRun<Key, Canonical> {
    logical_key: Key,
    canonical: Canonical,
}

impl<Key, Canonical> DesiredRun<Key, Canonical> {
    pub(crate) const fn new(logical_key: Key, canonical: Canonical) -> Self {
        Self {
            logical_key,
            canonical,
        }
    }
}

/// How one prepared assignment differs from its preceding committed identity.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunSlotChange {
    Retained,
    Updated,
    Allocated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct RunSlotAssignment {
    handle: RunHandle,
    change: RunSlotChange,
}

impl RunSlotAssignment {
    pub(crate) const fn handle(self) -> RunHandle {
        self.handle
    }

    pub(crate) const fn change(self) -> RunSlotChange {
        self.change
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RunSlotError {
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
struct Occupant<Key, Canonical> {
    logical_key: Key,
    canonical: Canonical,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct RunSlotState<Key, Canonical> {
    generation: RunGeneration,
    occupant: Option<Occupant<Key, Canonical>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QuarantinedRunSlot {
    handle: RunHandle,
    after_publication_generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PendingWrite<Key, Canonical> {
    handle: RunHandle,
    occupant: Occupant<Key, Canonical>,
}

/// Transactional dense run storage owned by exactly one retained planner/root.
///
/// `Key` must contain every logical-incarnation component needed to prevent cross-paragraph reuse.
/// `Canonical` must contain the complete topology/local-geometry value whose exact change invalidates
/// a handle generation.
pub(crate) struct RunSlotArena<Key, Canonical> {
    slots: Vec<RunSlotState<Key, Canonical>>,
    /// Sorted exact index of committed logical keys.
    committed_index: Vec<(Key, RunSlot)>,
    /// Physical slots in the preceding publication's desired-run order.
    committed_order: Vec<RunSlot>,
    free_slots: Vec<RunSlot>,
    quarantine: Vec<QuarantinedRunSlot>,
    assignments: Vec<RunSlotAssignment>,
    retirements: Vec<RunHandle>,
    writes: Vec<PendingWrite<Key, Canonical>>,
    /// Slots removed from `free_slots` by the pending transaction, restored on abort.
    allocated_free_slots: Vec<RunSlot>,
    /// Sorted exact index built for the pending live set and swapped on commit.
    pending_index: Vec<(Key, RunSlot)>,
    /// Physical slots in a structurally changed pending desired-run order.
    pending_order: Vec<RunSlot>,
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

impl<Key, Canonical> Default for RunSlotArena<Key, Canonical> {
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

impl<Key, Canonical> RunSlotArena<Key, Canonical>
where
    Key: Copy + Ord,
    Canonical: Copy + Eq,
{
    /// Releases physical slots whose renderer retirement fence has completed.
    ///
    /// Acknowledgement is external monotonic state: once accepted, a later prepare/abort does not
    /// roll it back.
    pub(crate) fn acknowledge(&mut self, through_generation: u32) -> Result<(), RunSlotError> {
        if self.prepared {
            return Err(RunSlotError::AlreadyPrepared);
        }
        if through_generation < self.acknowledged_publication_generation {
            return Err(RunSlotError::AcknowledgementRegressed);
        }
        if through_generation > self.committed_publication_generation {
            return Err(RunSlotError::InvalidPublicationGeneration);
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
        desired: &[DesiredRun<Key, Canonical>],
        publication_generation: u32,
    ) -> Result<(), RunSlotError> {
        if self.prepared {
            return Err(RunSlotError::AlreadyPrepared);
        }
        if publication_generation == 0
            || publication_generation <= self.committed_publication_generation
            || publication_generation <= self.acknowledged_publication_generation
        {
            return Err(RunSlotError::InvalidPublicationGeneration);
        }
        u32::try_from(desired.len()).map_err(|_| RunSlotError::ArithmeticOverflow)?;

        let retained = self.matches_committed_order(desired)?;
        self.begin_prepare(publication_generation)?;
        let result = if retained {
            #[cfg(test)]
            {
                self.retained_prepare_count += 1;
            }
            self.prepare_retained(desired)
        } else {
            #[cfg(test)]
            {
                self.structural_prepare_count += 1;
            }
            self.prepare_structural(desired)
        };

        if result.is_err() {
            self.abort();
        }
        result
    }

    fn matches_committed_order(
        &self,
        desired: &[DesiredRun<Key, Canonical>],
    ) -> Result<bool, RunSlotError> {
        if desired.len() != self.committed_order.len() {
            return Ok(false);
        }
        for (run, &slot) in desired.iter().zip(&self.committed_order) {
            let occupant = self
                .slot_state(slot)?
                .occupant
                .as_ref()
                .ok_or(RunSlotError::ArithmeticOverflow)?;
            if occupant.logical_key != run.logical_key {
                return Ok(false);
            }
        }
        Ok(true)
    }

    fn prepare_retained(
        &mut self,
        desired: &[DesiredRun<Key, Canonical>],
    ) -> Result<(), RunSlotError> {
        reserve(&mut self.assignments, desired.len())?;
        reserve(&mut self.writes, desired.len())?;
        for (index, run) in desired.iter().enumerate() {
            let slot = self.committed_order[index];
            let state = self.slot_state(slot)?;
            let occupant = state
                .occupant
                .as_ref()
                .ok_or(RunSlotError::ArithmeticOverflow)?;
            let (handle, change) = if occupant.canonical == run.canonical {
                (
                    RunHandle {
                        slot,
                        generation: state.generation,
                    },
                    RunSlotChange::Retained,
                )
            } else {
                let handle = RunHandle {
                    slot,
                    generation: state.generation.next()?,
                };
                self.writes.push(PendingWrite {
                    handle,
                    occupant: Occupant {
                        logical_key: run.logical_key,
                        canonical: run.canonical,
                    },
                });
                (handle, RunSlotChange::Updated)
            };
            self.assignments.push(RunSlotAssignment { handle, change });
        }
        self.prepared = true;
        Ok(())
    }

    fn prepare_structural(
        &mut self,
        desired: &[DesiredRun<Key, Canonical>],
    ) -> Result<(), RunSlotError> {
        reserve(&mut self.pending_index, desired.len())?;
        reserve(&mut self.pending_order, desired.len())?;
        reserve(&mut self.assignments, desired.len())?;
        reserve(&mut self.writes, desired.len())?;
        for run in desired {
            self.pending_index
                .push((run.logical_key, RunSlot(u32::MAX)));
        }
        self.pending_index.sort_unstable_by_key(|entry| entry.0);
        if self
            .pending_index
            .windows(2)
            .any(|pair| pair[0].0 == pair[1].0)
        {
            return Err(RunSlotError::DuplicateLogicalKey);
        }

        for run in desired {
            let (handle, change) = match self.find_committed(&run.logical_key) {
                Some(slot) => {
                    let state = self.slot_state(slot)?;
                    let occupant = state
                        .occupant
                        .as_ref()
                        .ok_or(RunSlotError::ArithmeticOverflow)?;
                    if occupant.canonical == run.canonical {
                        (
                            RunHandle {
                                slot,
                                generation: state.generation,
                            },
                            RunSlotChange::Retained,
                        )
                    } else {
                        let handle = RunHandle {
                            slot,
                            generation: state.generation.next()?,
                        };
                        self.writes.push(PendingWrite {
                            handle,
                            occupant: Occupant {
                                logical_key: run.logical_key,
                                canonical: run.canonical,
                            },
                        });
                        (handle, RunSlotChange::Updated)
                    }
                }
                None => {
                    let handle = self.allocate_slot()?;
                    self.writes.push(PendingWrite {
                        handle,
                        occupant: Occupant {
                            logical_key: run.logical_key,
                            canonical: run.canonical,
                        },
                    });
                    (handle, RunSlotChange::Allocated)
                }
            };

            let pending = self
                .pending_index
                .binary_search_by(|entry| entry.0.cmp(&run.logical_key))
                .map_err(|_| RunSlotError::ArithmeticOverflow)?;
            self.pending_index[pending].1 = handle.slot;
            self.pending_order.push(handle.slot);
            self.assignments.push(RunSlotAssignment { handle, change });
        }

        reserve(&mut self.retirements, self.slots.len())?;
        for (slot_index, state) in self.slots.iter().enumerate() {
            let Some(occupant) = &state.occupant else {
                continue;
            };
            if self
                .pending_index
                .binary_search_by(|entry| entry.0.cmp(&occupant.logical_key))
                .is_err()
            {
                let slot = RunSlot(
                    u32::try_from(slot_index).map_err(|_| RunSlotError::ArithmeticOverflow)?,
                );
                self.retirements.push(RunHandle {
                    slot,
                    generation: state.generation,
                });
            }
        }
        reserve(&mut self.quarantine, self.retirements.len())?;

        let required_slots = usize::try_from(self.pending_slot_count)
            .map_err(|_| RunSlotError::ArithmeticOverflow)?;
        let additional_slots = required_slots.saturating_sub(self.slots.len());
        reserve(&mut self.slots, additional_slots)?;
        self.pending_structural_change = true;
        self.prepared = true;
        Ok(())
    }

    pub(crate) fn assignments(&self) -> Result<&[RunSlotAssignment], RunSlotError> {
        if !self.prepared {
            return Err(RunSlotError::NotPrepared);
        }
        Ok(&self.assignments)
    }

    pub(crate) fn retirements(&self) -> Result<&[RunHandle], RunSlotError> {
        if !self.prepared {
            return Err(RunSlotError::NotPrepared);
        }
        Ok(&self.retirements)
    }

    pub(crate) fn required_slots(&self) -> Result<u32, RunSlotError> {
        if !self.prepared {
            return Err(RunSlotError::NotPrepared);
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
            self.quarantine.push(QuarantinedRunSlot {
                handle,
                after_publication_generation: self.pending_publication_generation,
            });
        }

        for write in self.writes.drain(..) {
            let slot_index = write.handle.slot.0 as usize;
            if slot_index == self.slots.len() {
                self.slots.push(RunSlotState {
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

    /// Resolves only a current committed handle. Changed, retired, and reused generations fail.
    pub(crate) fn get(&self, handle: RunHandle) -> Option<(&Key, &Canonical)> {
        let state = self.slots.get(handle.slot.0 as usize)?;
        if state.generation != handle.generation {
            return None;
        }
        let occupant = state.occupant.as_ref()?;
        Some((&occupant.logical_key, &occupant.canonical))
    }

    fn begin_prepare(&mut self, publication_generation: u32) -> Result<(), RunSlotError> {
        self.assignments.clear();
        self.retirements.clear();
        self.writes.clear();
        self.allocated_free_slots.clear();
        self.pending_index.clear();
        self.pending_order.clear();
        self.pending_structural_change = false;
        self.pending_slot_count =
            u32::try_from(self.slots.len()).map_err(|_| RunSlotError::ArithmeticOverflow)?;
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

    fn find_committed(&self, key: &Key) -> Option<RunSlot> {
        self.committed_index
            .binary_search_by(|entry| entry.0.cmp(key))
            .ok()
            .map(|index| self.committed_index[index].1)
    }

    fn slot_state(&self, slot: RunSlot) -> Result<&RunSlotState<Key, Canonical>, RunSlotError> {
        self.slots
            .get(slot.0 as usize)
            .ok_or(RunSlotError::ArithmeticOverflow)
    }

    fn allocate_slot(&mut self) -> Result<RunHandle, RunSlotError> {
        if let Some(&slot) = self.free_slots.last() {
            reserve(&mut self.allocated_free_slots, 1)?;
            let state = self.slot_state(slot)?;
            if state.occupant.is_some() {
                return Err(RunSlotError::ArithmeticOverflow);
            }
            let generation = state.generation.next()?;
            self.free_slots.pop();
            self.allocated_free_slots.push(slot);
            return Ok(RunHandle { slot, generation });
        }

        let slot = RunSlot(self.pending_slot_count);
        self.pending_slot_count = self
            .pending_slot_count
            .checked_add(1)
            .ok_or(RunSlotError::SlotExhausted)?;
        Ok(RunHandle {
            slot,
            generation: RunGeneration::INITIAL,
        })
    }
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), RunSlotError> {
    values
        .try_reserve(additional)
        .map_err(|_| RunSlotError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Canonical {
        topology_word: u64,
        advance_bits: u64,
    }

    fn run(key: u64, topology_word: u64, advance: f64) -> DesiredRun<u64, Canonical> {
        DesiredRun::new(
            key,
            Canonical {
                topology_word,
                advance_bits: advance.to_bits(),
            },
        )
    }

    fn handles(arena: &RunSlotArena<u64, Canonical>) -> Vec<RunHandle> {
        arena
            .assignments()
            .unwrap()
            .iter()
            .map(|assignment| assignment.handle())
            .collect()
    }

    #[test]
    fn exact_canonical_change_bumps_generation_in_place() {
        let mut arena = RunSlotArena::default();
        arena.prepare(&[run(10, 0x0102, 4.0)], 1).unwrap();
        let original = handles(&arena)[0];
        assert_eq!(arena.required_slots().unwrap(), 1);
        assert_eq!(original.slot().get(), 0);
        assert_eq!(original.generation().get(), 1);
        arena.commit();

        arena.prepare(&[run(10, 0x0102, 4.0)], 2).unwrap();
        assert_eq!(
            arena.assignments().unwrap()[0].change(),
            RunSlotChange::Retained
        );
        assert_eq!(handles(&arena)[0], original);
        arena.commit();

        arena.prepare(&[run(10, 0x0103, 4.0)], 3).unwrap();
        let changed = handles(&arena)[0];
        assert_eq!(
            arena.assignments().unwrap()[0].change(),
            RunSlotChange::Updated
        );
        assert_eq!(changed.slot(), original.slot());
        assert_eq!(changed.generation().get(), 2);
        arena.commit();
        assert!(arena.get(original).is_none());
        assert_eq!(arena.get(changed).unwrap().1.topology_word, 0x0103);
    }

    #[test]
    fn retained_order_uses_the_allocation_free_fast_path() {
        let mut arena = RunSlotArena::default();
        arena
            .prepare(&[run(10, 1, 1.0), run(20, 2, 2.0)], 1)
            .unwrap();
        assert_eq!(arena.prepare_counts(), (0, 1));
        arena.commit();
        let warmed_capacities = arena.scratch_capacities();

        arena
            .prepare(&[run(10, 1, 1.0), run(20, 3, 2.0)], 2)
            .unwrap();
        assert_eq!(arena.prepare_counts(), (1, 1));
        assert_eq!(arena.scratch_capacities(), warmed_capacities);
        assert!(arena.retirements().unwrap().is_empty());
        assert_eq!(
            arena.assignments().unwrap()[1].change(),
            RunSlotChange::Updated
        );
        arena.commit();

        arena
            .prepare(&[run(20, 3, 2.0), run(10, 1, 1.0)], 3)
            .unwrap();
        assert_eq!(arena.prepare_counts(), (1, 2));
        arena.commit();
        arena.commit();
    }

    #[test]
    fn retirement_quarantines_then_reuses_with_a_new_generation() {
        let mut arena = RunSlotArena::default();
        arena
            .prepare(&[run(10, 1, 1.0), run(20, 2, 2.0)], 1)
            .unwrap();
        let original = handles(&arena);
        arena.commit();

        arena.prepare(&[run(10, 1, 1.0)], 2).unwrap();
        assert_eq!(arena.retirements().unwrap(), &[original[1]]);
        arena.commit();

        arena
            .prepare(&[run(10, 1, 1.0), run(30, 3, 3.0)], 3)
            .unwrap();
        assert_eq!(handles(&arena)[1].slot().get(), 2);
        arena.commit();

        arena.acknowledge(2).unwrap();
        arena
            .prepare(&[run(10, 1, 1.0), run(30, 3, 3.0), run(40, 4, 4.0)], 4)
            .unwrap();
        let reused = handles(&arena)[2];
        assert_eq!(reused.slot(), original[1].slot());
        assert_eq!(reused.generation().get(), 2);
        arena.commit();
        assert!(arena.get(original[1]).is_none());
        assert_eq!(*arena.get(reused).unwrap().0, 40);
    }

    #[test]
    fn abort_restores_reclaimed_slots_and_committed_handles() {
        let mut arena = RunSlotArena::default();
        arena.prepare(&[run(10, 1, 1.0)], 1).unwrap();
        let original = handles(&arena)[0];
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena.prepare(&[run(20, 2, 2.0)], 3).unwrap();
        let aborted = handles(&arena)[0];
        assert_eq!(aborted.slot(), original.slot());
        arena.abort();
        assert!(arena.get(original).is_none());

        arena.prepare(&[run(30, 3, 3.0)], 3).unwrap();
        assert_eq!(handles(&arena)[0], aborted);
        arena.commit();
    }

    #[test]
    fn abort_restores_multiple_free_slots_in_exact_stack_order() {
        let mut arena = RunSlotArena::default();
        arena
            .prepare(&[run(10, 1, 1.0), run(20, 2, 2.0)], 1)
            .unwrap();
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena
            .prepare(&[run(30, 3, 3.0), run(40, 4, 4.0)], 3)
            .unwrap();
        let aborted = handles(&arena);
        arena.abort();

        arena
            .prepare(&[run(30, 3, 3.0), run(40, 4, 4.0)], 3)
            .unwrap();
        assert_eq!(handles(&arena), aborted);
    }

    #[test]
    fn duplicate_keys_and_regressing_acknowledgement_are_rejected() {
        let mut arena = RunSlotArena::default();
        assert_eq!(
            arena.prepare(&[run(10, 1, 1.0), run(10, 2, 2.0)], 1),
            Err(RunSlotError::DuplicateLogicalKey)
        );
        arena.prepare(&[run(10, 1, 1.0)], 1).unwrap();
        arena.commit();
        arena.acknowledge(1).unwrap();
        assert_eq!(
            arena.acknowledge(0),
            Err(RunSlotError::AcknowledgementRegressed)
        );
    }

    #[test]
    fn generation_exhaustion_never_wraps_or_changes_committed_state() {
        let generation = RunGeneration(NonZeroU32::new(u32::MAX).unwrap());
        let handle = RunHandle {
            slot: RunSlot(0),
            generation,
        };
        let canonical = Canonical {
            topology_word: 1,
            advance_bits: 1.0_f64.to_bits(),
        };
        let mut arena = RunSlotArena {
            slots: vec![RunSlotState {
                generation,
                occupant: Some(Occupant {
                    logical_key: 10,
                    canonical,
                }),
            }],
            committed_index: vec![(10, RunSlot(0))],
            committed_order: vec![RunSlot(0)],
            committed_publication_generation: 1,
            ..RunSlotArena::default()
        };

        assert_eq!(
            arena.prepare(&[run(10, 2, 2.0)], 2),
            Err(RunSlotError::GenerationExhausted)
        );
        assert_eq!(arena.get(handle), Some((&10, &canonical)));
        assert_eq!(arena.assignments(), Err(RunSlotError::NotPrepared));
    }

    #[test]
    fn acknowledgement_survives_a_later_aborted_prepare() {
        let mut arena = RunSlotArena::default();
        arena.prepare(&[run(10, 1, 1.0)], 1).unwrap();
        let original = handles(&arena)[0];
        arena.commit();
        arena.prepare(&[], 2).unwrap();
        arena.commit();
        arena.acknowledge(2).unwrap();

        arena.prepare(&[run(20, 2, 2.0)], 3).unwrap();
        assert_eq!(handles(&arena)[0].slot(), original.slot());
        arena.abort();

        arena.prepare(&[run(30, 3, 3.0)], 3).unwrap();
        assert_eq!(handles(&arena)[0].slot(), original.slot());
    }
}
