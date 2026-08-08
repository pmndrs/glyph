//! Transactional stable physical-slot assignment with acknowledgment-gated reuse.

use alloc::vec::Vec;

use super::identity_index::{IdentityIndex, IdentityIndexError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotIdentity {
    pub stable_id: u32,
    pub content_revision: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SlotAssignment {
    pub stable_id: u32,
    pub content_revision: u32,
    pub slot: u32,
    pub changed: bool,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct SlotState {
    stable_id: u32,
    content_revision: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct QuarantinedSlot {
    slot: u32,
    after_publication_generation: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum StablePoolError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    InvalidIdentity,
    DuplicateIdentity,
    IdentifierExhausted,
    ArithmeticOverflow,
}

#[derive(Default)]
pub struct StableSlotPool {
    slots: Vec<SlotState>,
    free_slots: Vec<u32>,
    quarantine: Vec<QuarantinedSlot>,
    assignments: Vec<SlotAssignment>,
    retired_slots: Vec<u32>,
    allocated_free_slots: Vec<u32>,
    identity_index: IdentityIndex,
    seen_slots: Vec<u32>,
    seen_epoch: u32,
    pending_slot_count: u32,
    pending_publication_generation: u32,
    prepared: bool,
}

impl StableSlotPool {
    /// Releases slots whose renderer fence has completed.
    ///
    /// Acknowledgment is monotonic state independent of a later prepare/abort transaction.
    pub fn acknowledge(&mut self, through_generation: u32) -> Result<(), StablePoolError> {
        if self.prepared {
            return Err(StablePoolError::AlreadyPrepared);
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
                self.free_slots.push(entry.slot);
            } else {
                self.quarantine[write] = entry;
                write += 1;
            }
        }
        self.quarantine.truncate(write);
        Ok(())
    }

    pub fn has_quarantined_slots(&self) -> bool {
        !self.quarantine.is_empty()
    }

    pub fn prepare(
        &mut self,
        desired: &[SlotIdentity],
        publication_generation: u32,
    ) -> Result<(), StablePoolError> {
        if self.prepared {
            return Err(StablePoolError::AlreadyPrepared);
        }
        if publication_generation == 0 || u32::try_from(desired.len()).is_err() {
            return Err(StablePoolError::InvalidIdentity);
        }
        self.assignments.clear();
        self.retired_slots.clear();
        self.allocated_free_slots.clear();
        self.pending_slot_count =
            u32::try_from(self.slots.len()).map_err(|_| StablePoolError::ArithmeticOverflow)?;
        self.pending_publication_generation = publication_generation;
        let result = (|| {
            self.prepare_identity_map(desired.len())?;
            self.prepare_seen_slots()?;
            reserve(&mut self.assignments, desired.len())?;

            for slot in 0..self.slots.len() {
                let stable_id = self.slots[slot].stable_id;
                if stable_id != 0 {
                    self.insert_committed_identity(stable_id, slot as u32)?;
                }
            }

            for identity in desired.iter().copied() {
                if identity.stable_id == 0 || identity.content_revision == 0 {
                    return Err(StablePoolError::InvalidIdentity);
                }
                let existing = self.find_identity(identity.stable_id);
                let slot = match existing {
                    Some(slot) => {
                        if self.slot_seen(slot)? {
                            return Err(StablePoolError::DuplicateIdentity);
                        }
                        slot
                    }
                    None => {
                        let slot = self.allocate_slot()?;
                        self.insert_new_identity(identity.stable_id, slot)?;
                        slot
                    }
                };
                self.mark_slot_seen(slot)?;
                let changed = self.slots.get(slot as usize).is_none_or(|state| {
                    state.stable_id != identity.stable_id
                        || state.content_revision != identity.content_revision
                });
                self.assignments.push(SlotAssignment {
                    stable_id: identity.stable_id,
                    content_revision: identity.content_revision,
                    slot,
                    changed,
                });
            }

            reserve(&mut self.retired_slots, self.slots.len())?;
            for (slot, state) in self.slots.iter().enumerate() {
                if state.stable_id != 0 && !self.slot_seen(slot as u32)? {
                    self.retired_slots.push(slot as u32);
                }
            }
            reserve(&mut self.quarantine, self.retired_slots.len())?;
            let required_slots = usize::try_from(self.pending_slot_count)
                .map_err(|_| StablePoolError::ArithmeticOverflow)?;
            let additional_slots = required_slots.saturating_sub(self.slots.len());
            reserve(&mut self.slots, additional_slots)?;
            self.prepared = true;
            Ok(())
        })();
        if result.is_err() {
            self.abort();
        }
        result
    }

    pub fn assignments(&self) -> Result<&[SlotAssignment], StablePoolError> {
        if !self.prepared {
            return Err(StablePoolError::NotPrepared);
        }
        Ok(&self.assignments)
    }

    pub fn retired_slots(&self) -> Result<&[u32], StablePoolError> {
        if !self.prepared {
            return Err(StablePoolError::NotPrepared);
        }
        Ok(&self.retired_slots)
    }

    pub fn required_slots(&self) -> Result<u32, StablePoolError> {
        if !self.prepared {
            return Err(StablePoolError::NotPrepared);
        }
        Ok(self.pending_slot_count)
    }

    pub fn live_count(&self) -> Result<u32, StablePoolError> {
        if !self.prepared {
            return Err(StablePoolError::NotPrepared);
        }
        u32::try_from(self.assignments.len()).map_err(|_| StablePoolError::ArithmeticOverflow)
    }

    pub fn commit(&mut self) -> Result<(), StablePoolError> {
        if !self.prepared {
            return Err(StablePoolError::NotPrepared);
        }
        self.slots
            .resize(self.pending_slot_count as usize, SlotState::default());
        for &slot in &self.retired_slots {
            self.slots[slot as usize] = SlotState::default();
            self.quarantine.push(QuarantinedSlot {
                slot,
                after_publication_generation: self.pending_publication_generation,
            });
        }
        for assignment in &self.assignments {
            self.slots[assignment.slot as usize] = SlotState {
                stable_id: assignment.stable_id,
                content_revision: assignment.content_revision,
            };
        }
        self.finish_transaction();
        Ok(())
    }

    pub fn abort(&mut self) {
        for slot in self.allocated_free_slots.drain(..) {
            self.free_slots.push(slot);
        }
        self.finish_transaction();
    }

    #[cfg(test)]
    pub fn scratch_capacities(&self) -> [usize; 10] {
        let identity = self.identity_index.capacities();
        [
            self.slots.capacity(),
            self.free_slots.capacity(),
            self.quarantine.capacity(),
            self.assignments.capacity(),
            self.retired_slots.capacity(),
            self.allocated_free_slots.capacity(),
            identity[0],
            identity[1],
            identity[2],
            self.seen_slots.capacity(),
        ]
    }

    fn finish_transaction(&mut self) {
        self.assignments.clear();
        self.retired_slots.clear();
        self.allocated_free_slots.clear();
        self.prepared = false;
    }

    fn prepare_identity_map(&mut self, desired_count: usize) -> Result<(), StablePoolError> {
        let live_count = self
            .slots
            .iter()
            .filter(|state| state.stable_id != 0)
            .count();
        let required = live_count
            .checked_add(desired_count)
            .ok_or(StablePoolError::ArithmeticOverflow)?;
        self.identity_index
            .prepare(required)
            .map_err(identity_index_error)
    }

    fn prepare_seen_slots(&mut self) -> Result<(), StablePoolError> {
        if self.seen_slots.len() < self.slots.len() {
            let additional = self.slots.len() - self.seen_slots.len();
            reserve(&mut self.seen_slots, additional)?;
            self.seen_slots.resize(self.slots.len(), 0);
        }
        self.seen_epoch = next_epoch(&mut self.seen_slots, self.seen_epoch);
        Ok(())
    }

    fn insert_committed_identity(
        &mut self,
        identity: u32,
        slot: u32,
    ) -> Result<(), StablePoolError> {
        self.identity_index
            .insert(identity, slot)
            .map_err(identity_index_error)
    }

    fn insert_new_identity(&mut self, identity: u32, slot: u32) -> Result<(), StablePoolError> {
        self.identity_index
            .insert(identity, slot)
            .map_err(identity_index_error)
    }

    fn find_identity(&self, identity: u32) -> Option<u32> {
        self.identity_index.get(identity)
    }

    fn allocate_slot(&mut self) -> Result<u32, StablePoolError> {
        if let Some(slot) = self.free_slots.pop() {
            reserve(&mut self.allocated_free_slots, 1)?;
            self.allocated_free_slots.push(slot);
            return Ok(slot);
        }
        let slot = self.pending_slot_count;
        self.pending_slot_count = self
            .pending_slot_count
            .checked_add(1)
            .ok_or(StablePoolError::IdentifierExhausted)?;
        Ok(slot)
    }

    fn slot_seen(&self, slot: u32) -> Result<bool, StablePoolError> {
        let index = usize::try_from(slot).map_err(|_| StablePoolError::ArithmeticOverflow)?;
        Ok(self.seen_slots.get(index).copied() == Some(self.seen_epoch))
    }

    fn mark_slot_seen(&mut self, slot: u32) -> Result<(), StablePoolError> {
        let required = usize::try_from(slot)
            .ok()
            .and_then(|slot| slot.checked_add(1))
            .ok_or(StablePoolError::ArithmeticOverflow)?;
        if self.seen_slots.len() < required {
            let additional = required - self.seen_slots.len();
            reserve(&mut self.seen_slots, additional)?;
            self.seen_slots.resize(required, 0);
        }
        self.seen_slots[required - 1] = self.seen_epoch;
        Ok(())
    }
}

fn next_epoch(values: &mut [u32], current: u32) -> u32 {
    match current.checked_add(1) {
        Some(epoch) => epoch,
        None => {
            values.fill(0);
            1
        }
    }
}

fn identity_index_error(error: IdentityIndexError) -> StablePoolError {
    match error {
        IdentityIndexError::AllocationFailed => StablePoolError::AllocationFailed,
        IdentityIndexError::ArithmeticOverflow => StablePoolError::ArithmeticOverflow,
        IdentityIndexError::DuplicateIdentity => StablePoolError::DuplicateIdentity,
    }
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), StablePoolError> {
    values
        .try_reserve(additional)
        .map_err(|_| StablePoolError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn insertion_preserves_existing_slots_and_marks_only_new_content_dirty() {
        let mut pool = StableSlotPool::default();
        pool.prepare(&identities(&[(1, 1), (2, 1), (3, 1)]), 1)
            .unwrap();
        assert_eq!(slots(&pool), vec![0, 1, 2]);
        pool.commit().unwrap();

        pool.prepare(&identities(&[(1, 1), (4, 1), (2, 1), (3, 1)]), 2)
            .unwrap();
        assert_eq!(slots(&pool), vec![0, 3, 1, 2]);
        assert_eq!(changed_slots(&pool), vec![3]);
    }

    #[test]
    fn deletion_quarantines_slots_until_the_renderer_acknowledges_the_fence() {
        let mut pool = StableSlotPool::default();
        pool.prepare(&identities(&[(1, 1), (2, 1)]), 1).unwrap();
        pool.commit().unwrap();

        pool.prepare(&identities(&[(1, 1)]), 2).unwrap();
        assert_eq!(pool.retired_slots().unwrap(), &[1]);
        pool.commit().unwrap();

        pool.prepare(&identities(&[(1, 1), (3, 1)]), 3).unwrap();
        assert_eq!(slots(&pool), vec![0, 2]);
        pool.abort();

        pool.acknowledge(1).unwrap();
        pool.prepare(&identities(&[(1, 1), (3, 1)]), 3).unwrap();
        assert_eq!(slots(&pool), vec![0, 2]);
        pool.abort();

        pool.acknowledge(2).unwrap();
        pool.prepare(&identities(&[(1, 1), (3, 1)]), 3).unwrap();
        assert_eq!(slots(&pool), vec![0, 1]);
    }

    #[test]
    fn content_revision_changes_rewrite_the_same_slot() {
        let mut pool = StableSlotPool::default();
        pool.prepare(&identities(&[(1, 1), (2, 1)]), 1).unwrap();
        pool.commit().unwrap();
        pool.prepare(&identities(&[(2, 2), (1, 1)]), 2).unwrap();
        assert_eq!(slots(&pool), vec![1, 0]);
        assert_eq!(changed_slots(&pool), vec![1]);
    }

    #[test]
    fn abort_returns_reclaimed_allocations_without_committing_identity() {
        let mut pool = StableSlotPool::default();
        pool.prepare(&identities(&[(1, 1), (2, 1)]), 1).unwrap();
        pool.commit().unwrap();
        pool.prepare(&identities(&[(1, 1)]), 2).unwrap();
        pool.commit().unwrap();
        pool.acknowledge(2).unwrap();

        pool.prepare(&identities(&[(1, 1), (3, 1)]), 3).unwrap();
        assert_eq!(slots(&pool), vec![0, 1]);
        pool.abort();
        pool.prepare(&identities(&[(1, 1), (4, 1)]), 4).unwrap();
        assert_eq!(slots(&pool), vec![0, 1]);
    }

    #[test]
    fn duplicate_desired_identity_fails_without_leaking_a_slot() {
        let mut pool = StableSlotPool::default();
        assert_eq!(
            pool.prepare(&identities(&[(1, 1), (1, 1)]), 1),
            Err(StablePoolError::DuplicateIdentity)
        );
        pool.prepare(&identities(&[(2, 1)]), 1).unwrap();
        assert_eq!(slots(&pool), vec![0]);
        assert_eq!(pool.required_slots().unwrap(), 1);
        assert_eq!(pool.live_count().unwrap(), 1);
    }

    fn identities(values: &[(u32, u32)]) -> Vec<SlotIdentity> {
        values
            .iter()
            .map(|&(stable_id, content_revision)| SlotIdentity {
                stable_id,
                content_revision,
            })
            .collect()
    }

    fn slots(pool: &StableSlotPool) -> Vec<u32> {
        pool.assignments()
            .unwrap()
            .iter()
            .map(|assignment| assignment.slot)
            .collect()
    }

    fn changed_slots(pool: &StableSlotPool) -> Vec<u32> {
        pool.assignments()
            .unwrap()
            .iter()
            .filter(|assignment| assignment.changed)
            .map(|assignment| assignment.slot)
            .collect()
    }
}
