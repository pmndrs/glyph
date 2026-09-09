//! Planner-scoped stable storage for dynamic placement-segment occurrences.

use super::run_slot::{DesiredRun, RunHandle, RunSlotArena, RunSlotAssignment, RunSlotError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct PlacementSlot(u32);

impl PlacementSlot {
    pub(crate) const fn get(self) -> u32 {
        self.0
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PlacementHandle {
    slot: PlacementSlot,
    generation: u32,
}

impl PlacementHandle {
    pub(crate) const fn slot(self) -> PlacementSlot {
        self.slot
    }
}

pub(crate) type DesiredPlacement<Key, Canonical> = DesiredRun<Key, Canonical>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PlacementSlotAssignment(RunSlotAssignment);

impl PlacementSlotAssignment {
    pub(crate) const fn handle(self) -> PlacementHandle {
        placement_handle(self.0.handle())
    }
}

pub(crate) struct PlacementSlotArena<Key, Canonical> {
    inner: RunSlotArena<Key, Canonical>,
}

impl<Key, Canonical> Default for PlacementSlotArena<Key, Canonical> {
    fn default() -> Self {
        Self {
            inner: RunSlotArena::default(),
        }
    }
}

impl<Key, Canonical> PlacementSlotArena<Key, Canonical>
where
    Key: Copy + Ord,
    Canonical: Copy + Eq,
{
    pub(crate) fn acknowledge(&mut self, through_generation: u32) -> Result<(), RunSlotError> {
        self.inner.acknowledge(through_generation)
    }

    pub(crate) fn prepare(
        &mut self,
        desired: &[DesiredPlacement<Key, Canonical>],
        publication_generation: u32,
    ) -> Result<(), RunSlotError> {
        self.inner.prepare(desired, publication_generation)
    }

    pub(crate) fn assignment(&self, index: usize) -> Result<PlacementSlotAssignment, RunSlotError> {
        self.inner
            .assignments()?
            .get(index)
            .copied()
            .map(PlacementSlotAssignment)
            .ok_or(RunSlotError::ArithmeticOverflow)
    }

    pub(crate) fn assignment_count(&self) -> Result<usize, RunSlotError> {
        Ok(self.inner.assignments()?.len())
    }

    pub(crate) fn required_slots(&self) -> Result<u32, RunSlotError> {
        self.inner.required_slots()
    }

    pub(crate) fn commit(&mut self) {
        self.inner.commit();
    }

    pub(crate) fn abort(&mut self) {
        self.inner.abort();
    }
}

const fn placement_handle(handle: RunHandle) -> PlacementHandle {
    PlacementHandle {
        slot: PlacementSlot(handle.slot().get()),
        generation: handle.generation().get(),
    }
}
