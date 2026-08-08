use alloc::vec::Vec;

use super::{
    EngineError,
    frame::{
        EXCLUSION_WRAP_BOTH, EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START,
        EXCLUSION_WRAP_LARGEST, SHAPE_RECTANGLE,
    },
    semantic_wire::{FlowConstraint, FlowExclusion, FlowRegion, FlowVertex, GeometryBatch},
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct InlineSlot {
    pub start: f64,
    pub end: f64,
}

#[derive(Default)]
pub(crate) struct InlineSlotArena {
    slots: Vec<InlineSlot>,
    scratch: Vec<InlineSlot>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RetainedRegion {
    pub record: FlowRegion,
    pub vertex_start: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct RetainedExclusion {
    pub record: FlowExclusion,
    pub vertex_start: u32,
}

#[derive(Default)]
pub(crate) struct FlowGeometryArena {
    pub constraints: Vec<FlowConstraint>,
    pub regions: Vec<RetainedRegion>,
    pub exclusions: Vec<RetainedExclusion>,
    pub vertices: Vec<FlowVertex>,
}

impl FlowGeometryArena {
    pub(crate) fn build(&mut self, geometry: GeometryBatch<'_>) -> Result<(), EngineError> {
        self.clear();
        reserve(&mut self.constraints, geometry.constraint_count())?;
        for index in 0..geometry.constraint_count() {
            self.constraints.push(
                geometry
                    .constraint(index)
                    .ok_or(EngineError::InvalidRequest)?,
            );
        }
        let region_count = self
            .constraints
            .iter()
            .map(|constraint| {
                usize::try_from(constraint.region_start)
                    .ok()
                    .and_then(|start| start.checked_add(usize::from(constraint.region_count)))
            })
            .try_fold(0usize, |maximum, end| {
                end.map(|end| maximum.max(end))
                    .ok_or(EngineError::InvalidRequest)
            })?;
        reserve(&mut self.regions, region_count)?;
        for index in 0..region_count {
            let record = geometry.region(index).ok_or(EngineError::InvalidRequest)?;
            let vertex_start = append_vertices(
                &mut self.vertices,
                geometry,
                record.vertices_offset,
                record.vertex_count,
            )?;
            self.regions.push(RetainedRegion {
                record,
                vertex_start,
            });
        }
        let exclusion_count = self
            .regions
            .iter()
            .map(|region| {
                usize::from(region.record.exclusion_start)
                    .checked_add(usize::from(region.record.exclusion_count))
            })
            .try_fold(0usize, |maximum, end| {
                end.map(|end| maximum.max(end))
                    .ok_or(EngineError::InvalidRequest)
            })?;
        reserve(&mut self.exclusions, exclusion_count)?;
        for index in 0..exclusion_count {
            let record = geometry
                .exclusion(index)
                .ok_or(EngineError::InvalidRequest)?;
            let vertex_start = append_vertices(
                &mut self.vertices,
                geometry,
                record.vertices_offset,
                record.vertex_count,
            )?;
            self.exclusions.push(RetainedExclusion {
                record,
                vertex_start,
            });
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.constraints.clear();
        self.regions.clear();
        self.exclusions.clear();
        self.vertices.clear();
    }
}

impl InlineSlotArena {
    pub(crate) fn resolve_rectangle_band<'a>(
        &'a mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        block_start: f64,
        block_end: f64,
        max_slots: usize,
    ) -> Result<&'a [InlineSlot], EngineError> {
        if !block_start.is_finite() || !block_end.is_finite() || block_start >= block_end {
            return Err(EngineError::InvalidRequest);
        }
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?;
        if region.record.shape != SHAPE_RECTANGLE || max_slots == 0 {
            return Err(EngineError::InvalidRequest);
        }
        self.slots.clear();
        self.scratch.clear();
        reserve(&mut self.slots, max_slots)?;
        reserve(&mut self.scratch, max_slots)?;
        self.slots.push(InlineSlot {
            start: f64::from(region.record.inline_start),
            end: f64::from(region.record.inline_end),
        });
        let exclusion_start = usize::from(region.record.exclusion_start);
        let exclusion_end = exclusion_start
            .checked_add(usize::from(region.record.exclusion_count))
            .ok_or(EngineError::InvalidRequest)?;
        for exclusion in geometry
            .exclusions
            .get(exclusion_start..exclusion_end)
            .ok_or(EngineError::InvalidRequest)?
        {
            let record = exclusion.record;
            if record.shape != SHAPE_RECTANGLE {
                return Err(EngineError::InvalidRequest);
            }
            let margin_block = f64::from(record.margin_block);
            if f64::from(record.block_start) - margin_block >= block_end
                || f64::from(record.block_end) + margin_block <= block_start
            {
                continue;
            }
            let margin_inline = f64::from(record.margin_inline);
            let cut_start = f64::from(record.inline_start) - margin_inline;
            let cut_end = f64::from(record.inline_end) + margin_inline;
            self.scratch.clear();
            for slot in self.slots.iter().copied() {
                subtract_slot(
                    &mut self.scratch,
                    slot,
                    cut_start,
                    cut_end,
                    record.wrap_side,
                    max_slots,
                )?;
            }
            core::mem::swap(&mut self.slots, &mut self.scratch);
        }
        Ok(&self.slots)
    }
}

fn subtract_slot(
    destination: &mut Vec<InlineSlot>,
    slot: InlineSlot,
    cut_start: f64,
    cut_end: f64,
    wrap_side: u8,
    max_slots: usize,
) -> Result<(), EngineError> {
    if cut_end <= slot.start || cut_start >= slot.end {
        return push_slot(destination, slot, max_slots);
    }
    let before = InlineSlot {
        start: slot.start,
        end: cut_start.min(slot.end),
    };
    let after = InlineSlot {
        start: cut_end.max(slot.start),
        end: slot.end,
    };
    match wrap_side {
        EXCLUSION_WRAP_BOTH => {
            push_nonempty(destination, before, max_slots)?;
            push_nonempty(destination, after, max_slots)
        }
        EXCLUSION_WRAP_INLINE_START => push_nonempty(destination, before, max_slots),
        EXCLUSION_WRAP_INLINE_END => push_nonempty(destination, after, max_slots),
        EXCLUSION_WRAP_LARGEST => {
            let selected = if before.end - before.start >= after.end - after.start {
                before
            } else {
                after
            };
            push_nonempty(destination, selected, max_slots)
        }
        _ => Err(EngineError::InvalidRequest),
    }
}

fn push_nonempty(
    destination: &mut Vec<InlineSlot>,
    slot: InlineSlot,
    max_slots: usize,
) -> Result<(), EngineError> {
    if slot.start < slot.end {
        push_slot(destination, slot, max_slots)?;
    }
    Ok(())
}

fn push_slot(
    destination: &mut Vec<InlineSlot>,
    slot: InlineSlot,
    max_slots: usize,
) -> Result<(), EngineError> {
    if destination.len() >= max_slots {
        return Err(EngineError::ResultTooLarge);
    }
    destination.push(slot);
    Ok(())
}

fn append_vertices(
    destination: &mut Vec<FlowVertex>,
    geometry: GeometryBatch<'_>,
    offset: u32,
    count: u16,
) -> Result<u32, EngineError> {
    let start = u32::try_from(destination.len()).map_err(|_| EngineError::ResultTooLarge)?;
    reserve(destination, usize::from(count))?;
    for index in 0..usize::from(count) {
        destination.push(
            geometry
                .vertex(offset, index)
                .ok_or(EngineError::InvalidRequest)?,
        );
    }
    Ok(start)
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), EngineError> {
    if values.capacity().saturating_sub(values.len()) < additional {
        values
            .try_reserve_exact(additional)
            .map_err(|_| EngineError::ResultTooLarge)?;
    }
    Ok(())
}
