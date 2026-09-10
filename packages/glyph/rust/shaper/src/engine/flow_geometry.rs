use alloc::vec::Vec;

use super::{
    EngineError,
    frame::{
        EXCLUSION_WRAP_BOTH, EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START,
        EXCLUSION_WRAP_LARGEST, SHAPE_POLYGON, SHAPE_RECTANGLE,
    },
    semantic_wire::{FlowConstraint, FlowExclusion, FlowRegion, FlowVertex, GeometryBatch},
    sort,
};

const INITIAL_EXCLUSION_CAPACITY: usize = 16;

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct InlineSlot {
    pub start: f64,
    pub end: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct InlineCut {
    pub start: f64,
    pub end: f64,
    pub wrap_side: u8,
}

#[derive(Default)]
pub(crate) struct InlineSlotArena {
    slots: Vec<InlineSlot>,
    scratch: Vec<InlineSlot>,
    section: Vec<InlineSlot>,
    crossings: Vec<f64>,
    critical_blocks: Vec<f64>,
    sort_pairs: Vec<(u64, u32)>,
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

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct ExclusionDirtyBand {
    pub region_id: u32,
    pub block_start: f64,
    pub block_end: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum LocalizedGeometryChange {
    Unchanged,
    ExclusionBand(ExclusionDirtyBand),
    Unsupported,
}

#[derive(Clone, Default, PartialEq)]
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
        reserve(&mut self.regions, geometry.region_count())?;
        let exclusion_capacity = if geometry.exclusion_count() == 0 {
            0
        } else {
            geometry.exclusion_count().max(INITIAL_EXCLUSION_CAPACITY)
        };
        reserve(&mut self.exclusions, exclusion_capacity)?;
        for index in 0..geometry.constraint_count() {
            let mut constraint = geometry
                .constraint(index)
                .ok_or(EngineError::InvalidRequest)?;
            constraint.drop_cap_vertices_offset = if constraint.drop_cap_vertex_count == 0 {
                0
            } else {
                append_vertices(
                    &mut self.vertices,
                    geometry,
                    constraint.drop_cap_vertices_offset,
                    constraint.drop_cap_vertex_count,
                )?
            };
            let source_region_start = usize::try_from(constraint.region_start)
                .map_err(|_| EngineError::InvalidRequest)?;
            constraint.region_start =
                u32::try_from(self.regions.len()).map_err(|_| EngineError::InvalidRequest)?;
            for region_index in source_region_start
                ..source_region_start
                    .checked_add(usize::from(constraint.region_count))
                    .ok_or(EngineError::InvalidRequest)?
            {
                let mut region = geometry
                    .region(region_index)
                    .ok_or(EngineError::InvalidRequest)?;
                let source_exclusion_start = usize::from(region.exclusion_start);
                region.exclusion_start = u16::try_from(self.exclusions.len())
                    .map_err(|_| EngineError::InvalidRequest)?;
                let vertex_start = append_vertices(
                    &mut self.vertices,
                    geometry,
                    region.vertices_offset,
                    region.vertex_count,
                )?;
                for exclusion_index in source_exclusion_start
                    ..source_exclusion_start
                        .checked_add(usize::from(region.exclusion_count))
                        .ok_or(EngineError::InvalidRequest)?
                {
                    let exclusion = geometry
                        .exclusion(exclusion_index)
                        .ok_or(EngineError::InvalidRequest)?;
                    let vertex_start = append_vertices(
                        &mut self.vertices,
                        geometry,
                        exclusion.vertices_offset,
                        exclusion.vertex_count,
                    )?;
                    self.exclusions.push(RetainedExclusion {
                        record: exclusion,
                        vertex_start,
                    });
                }
                self.regions.push(RetainedRegion {
                    record: region,
                    vertex_start,
                });
            }
            self.constraints.push(constraint);
        }
        Ok(())
    }

    pub(crate) fn clear(&mut self) {
        self.constraints.clear();
        self.regions.clear();
        self.exclusions.clear();
        self.vertices.clear();
    }

    pub(crate) fn retained_vertices(
        &self,
        start: u32,
        count: u16,
    ) -> Result<&[FlowVertex], EngineError> {
        polygon_vertices(self, start, count)
    }

    pub(crate) fn localized_change_from(
        &self,
        previous: &Self,
    ) -> Result<LocalizedGeometryChange, EngineError> {
        if self.constraints != previous.constraints
            || self.regions.len() != previous.regions.len()
            || self.exclusions.len() != previous.exclusions.len()
        {
            return Ok(LocalizedGeometryChange::Unsupported);
        }
        for (next, old) in self.constraints.iter().zip(&previous.constraints) {
            if self.retained_vertices(next.drop_cap_vertices_offset, next.drop_cap_vertex_count)?
                != previous
                    .retained_vertices(old.drop_cap_vertices_offset, old.drop_cap_vertex_count)?
            {
                return Ok(LocalizedGeometryChange::Unsupported);
            }
        }
        for (next, old) in self.regions.iter().zip(&previous.regions) {
            if !same_region_geometry(self, next, previous, old)? {
                return Ok(LocalizedGeometryChange::Unsupported);
            }
        }
        let mut dirty: Option<ExclusionDirtyBand> = None;
        for (next, old) in self.exclusions.iter().zip(&previous.exclusions) {
            if next.record.id != old.record.id || next.record.region_id != old.record.region_id {
                return Ok(LocalizedGeometryChange::Unsupported);
            }
            if same_exclusion_geometry(self, next, previous, old)? {
                continue;
            }
            let old_start = f64::from(old.record.block_start) - f64::from(old.record.margin_block);
            let old_end = f64::from(old.record.block_end) + f64::from(old.record.margin_block);
            let next_start =
                f64::from(next.record.block_start) - f64::from(next.record.margin_block);
            let next_end = f64::from(next.record.block_end) + f64::from(next.record.margin_block);
            let block_start = old_start.min(next_start);
            let block_end = old_end.max(next_end);
            if !block_start.is_finite() || !block_end.is_finite() || block_start >= block_end {
                return Err(EngineError::InvalidRequest);
            }
            match &mut dirty {
                Some(band) if band.region_id == next.record.region_id => {
                    band.block_start = band.block_start.min(block_start);
                    band.block_end = band.block_end.max(block_end);
                }
                Some(_) => return Ok(LocalizedGeometryChange::Unsupported),
                None => {
                    dirty = Some(ExclusionDirtyBand {
                        region_id: next.record.region_id,
                        block_start,
                        block_end,
                    });
                }
            }
        }
        Ok(dirty.map_or(
            LocalizedGeometryChange::Unchanged,
            LocalizedGeometryChange::ExclusionBand,
        ))
    }
}

fn same_region_geometry(
    left_geometry: &FlowGeometryArena,
    left: &RetainedRegion,
    right_geometry: &FlowGeometryArena,
    right: &RetainedRegion,
) -> Result<bool, EngineError> {
    let left_record = left.record;
    let right_record = right.record;
    Ok(left_record.id == right_record.id
        && left_record.transform_index == right_record.transform_index
        && left_record.vertex_count == right_record.vertex_count
        && left_record.exclusion_start == right_record.exclusion_start
        && left_record.exclusion_count == right_record.exclusion_count
        && left_record.shape == right_record.shape
        && left_record.writing_mode == right_record.writing_mode
        && left_record.text_orientation == right_record.text_orientation
        && left_record.inline_start.to_bits() == right_record.inline_start.to_bits()
        && left_record.block_start.to_bits() == right_record.block_start.to_bits()
        && left_record.inline_end.to_bits() == right_record.inline_end.to_bits()
        && left_record.block_end.to_bits() == right_record.block_end.to_bits()
        && left_record.clip_inline_start.to_bits() == right_record.clip_inline_start.to_bits()
        && left_record.clip_block_start.to_bits() == right_record.clip_block_start.to_bits()
        && left_record.clip_inline_end.to_bits() == right_record.clip_inline_end.to_bits()
        && left_record.clip_block_end.to_bits() == right_record.clip_block_end.to_bits()
        && polygon_vertices(left_geometry, left.vertex_start, left_record.vertex_count)?
            == polygon_vertices(
                right_geometry,
                right.vertex_start,
                right_record.vertex_count,
            )?)
}

fn same_exclusion_geometry(
    left_geometry: &FlowGeometryArena,
    left: &RetainedExclusion,
    right_geometry: &FlowGeometryArena,
    right: &RetainedExclusion,
) -> Result<bool, EngineError> {
    let left_record = left.record;
    let right_record = right.record;
    Ok(left_record.id == right_record.id
        && left_record.region_id == right_record.region_id
        && left_record.vertex_count == right_record.vertex_count
        && left_record.shape == right_record.shape
        && left_record.wrap_side == right_record.wrap_side
        && left_record.inline_start.to_bits() == right_record.inline_start.to_bits()
        && left_record.block_start.to_bits() == right_record.block_start.to_bits()
        && left_record.inline_end.to_bits() == right_record.inline_end.to_bits()
        && left_record.block_end.to_bits() == right_record.block_end.to_bits()
        && left_record.margin_inline.to_bits() == right_record.margin_inline.to_bits()
        && left_record.margin_block.to_bits() == right_record.margin_block.to_bits()
        && polygon_vertices(left_geometry, left.vertex_start, left_record.vertex_count)?
            == polygon_vertices(
                right_geometry,
                right.vertex_start,
                right_record.vertex_count,
            )?)
}

impl InlineSlotArena {
    pub(crate) fn resolve_band<'a>(
        &'a mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        block_start: f64,
        block_end: f64,
        max_slots: usize,
    ) -> Result<&'a [InlineSlot], EngineError> {
        self.resolve_band_with_cut(
            geometry,
            region_index,
            block_start,
            block_end,
            max_slots,
            None,
        )
    }

    pub(crate) fn resolve_band_with_cut<'a>(
        &'a mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        block_start: f64,
        block_end: f64,
        max_slots: usize,
        extra_cut: Option<InlineCut>,
    ) -> Result<&'a [InlineSlot], EngineError> {
        if !block_start.is_finite() || !block_end.is_finite() || block_start >= block_end {
            return Err(EngineError::InvalidRequest);
        }
        let region = geometry
            .regions
            .get(region_index)
            .ok_or(EngineError::InvalidRequest)?;
        if max_slots == 0 {
            return Err(EngineError::InvalidRequest);
        }
        self.slots.clear();
        self.scratch.clear();
        reserve(&mut self.slots, max_slots)?;
        reserve(&mut self.scratch, max_slots)?;
        match region.record.shape {
            SHAPE_RECTANGLE => self.slots.push(InlineSlot {
                start: f64::from(region.record.inline_start),
                end: f64::from(region.record.inline_end),
            }),
            SHAPE_POLYGON => {
                self.slots.push(InlineSlot {
                    start: f64::from(region.record.inline_start),
                    end: f64::from(region.record.inline_end),
                });
                self.resolve_polygon_region(geometry, region, block_start, block_end, max_slots)?
            }
            _ => return Err(EngineError::InvalidRequest),
        }
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
            let margin_block = f64::from(record.margin_block);
            let margin_inline = f64::from(record.margin_inline);
            let cut = match record.shape {
                SHAPE_RECTANGLE => {
                    if f64::from(record.block_start) - margin_block >= block_end
                        || f64::from(record.block_end) + margin_block <= block_start
                    {
                        continue;
                    }
                    Some(InlineSlot {
                        start: f64::from(record.inline_start) - margin_inline,
                        end: f64::from(record.inline_end) + margin_inline,
                    })
                }
                SHAPE_POLYGON => polygon_projection(
                    polygon_vertices(geometry, exclusion.vertex_start, record.vertex_count)?,
                    block_start - margin_block,
                    block_end + margin_block,
                )?
                .map(|slot| InlineSlot {
                    start: slot.start - margin_inline,
                    end: slot.end + margin_inline,
                }),
                _ => return Err(EngineError::InvalidRequest),
            };
            let Some(cut) = cut else { continue };
            self.scratch.clear();
            for slot in self.slots.iter().copied() {
                subtract_slot(
                    &mut self.scratch,
                    slot,
                    cut.start,
                    cut.end,
                    record.wrap_side,
                    max_slots,
                )?;
            }
            core::mem::swap(&mut self.slots, &mut self.scratch);
        }
        if let Some(cut) = extra_cut {
            self.scratch.clear();
            for slot in self.slots.iter().copied() {
                subtract_slot(
                    &mut self.scratch,
                    slot,
                    cut.start,
                    cut.end,
                    cut.wrap_side,
                    max_slots,
                )?;
            }
            core::mem::swap(&mut self.slots, &mut self.scratch);
        }
        Ok(&self.slots)
    }

    pub(crate) fn resolve_rectangle_band<'a>(
        &'a mut self,
        geometry: &FlowGeometryArena,
        region_index: usize,
        block_start: f64,
        block_end: f64,
        max_slots: usize,
    ) -> Result<&'a [InlineSlot], EngineError> {
        self.resolve_band(geometry, region_index, block_start, block_end, max_slots)
    }

    fn resolve_polygon_region(
        &mut self,
        geometry: &FlowGeometryArena,
        region: &RetainedRegion,
        block_start: f64,
        block_end: f64,
        max_slots: usize,
    ) -> Result<(), EngineError> {
        let vertices = polygon_vertices(geometry, region.vertex_start, region.record.vertex_count)?;
        reserve(&mut self.critical_blocks, vertices.len().saturating_add(2))?;
        reserve(&mut self.crossings, vertices.len())?;
        reserve(&mut self.section, vertices.len())?;
        self.critical_blocks.clear();
        self.critical_blocks.push(block_start);
        for vertex in vertices {
            let block = f64::from(vertex.block);
            if block_start < block && block < block_end {
                self.critical_blocks.push(block);
            }
        }
        self.critical_blocks.push(block_end);
        sort::sort_f64_total(&mut self.critical_blocks);
        self.critical_blocks.dedup();
        let mut sample_index = 0usize;
        while sample_index < self.critical_blocks.len() {
            let block = self.critical_blocks[sample_index];
            self.intersect_polygon_section(vertices, block, max_slots)?;
            if let Some(next) = self.critical_blocks.get(sample_index + 1).copied()
                && block < next
            {
                self.intersect_polygon_section(vertices, block + (next - block) * 0.5, max_slots)?;
            }
            if self.slots.is_empty() {
                break;
            }
            sample_index += 1;
        }
        Ok(())
    }

    fn intersect_polygon_section(
        &mut self,
        vertices: &[FlowVertex],
        block: f64,
        max_slots: usize,
    ) -> Result<(), EngineError> {
        polygon_section(
            vertices,
            block,
            &mut self.crossings,
            &mut self.section,
            &mut self.sort_pairs,
            max_slots,
        )?;
        self.scratch.clear();
        intersect_sorted(&self.slots, &self.section, &mut self.scratch, max_slots)?;
        core::mem::swap(&mut self.slots, &mut self.scratch);
        Ok(())
    }
}

fn polygon_vertices(
    geometry: &FlowGeometryArena,
    start: u32,
    count: u16,
) -> Result<&[FlowVertex], EngineError> {
    let start = usize::try_from(start).map_err(|_| EngineError::InvalidRequest)?;
    let end = start
        .checked_add(usize::from(count))
        .ok_or(EngineError::InvalidRequest)?;
    geometry
        .vertices
        .get(start..end)
        .ok_or(EngineError::InvalidRequest)
}

fn polygon_section(
    vertices: &[FlowVertex],
    block: f64,
    crossings: &mut Vec<f64>,
    output: &mut Vec<InlineSlot>,
    sort_pairs: &mut Vec<(u64, u32)>,
    max_slots: usize,
) -> Result<(), EngineError> {
    crossings.clear();
    output.clear();
    if vertices.len() < 3 {
        return Err(EngineError::InvalidRequest);
    }
    reserve(crossings, vertices.len())?;
    reserve(output, vertices.len().saturating_mul(2))?;
    for index in 0..vertices.len() {
        let first = vertices[index];
        let second = vertices[(index + 1) % vertices.len()];
        let first_block = f64::from(first.block);
        let second_block = f64::from(second.block);
        if first_block == second_block {
            if block == first_block {
                push_raw_nonempty(
                    output,
                    InlineSlot {
                        start: f64::from(first.inline.min(second.inline)),
                        end: f64::from(first.inline.max(second.inline)),
                    },
                );
            }
            continue;
        }
        if (first_block <= block && block < second_block)
            || (second_block <= block && block < first_block)
        {
            let ratio = (block - first_block) / (second_block - first_block);
            crossings.push(
                f64::from(first.inline)
                    + (f64::from(second.inline) - f64::from(first.inline)) * ratio,
            );
        }
    }
    sort::sort_f64_total(crossings);
    for pair in crossings.chunks_exact(2) {
        push_raw_nonempty(
            output,
            InlineSlot {
                start: pair[0],
                end: pair[1],
            },
        );
    }
    normalize_slots(output, sort_pairs)?;
    if output.len() > max_slots {
        return Err(EngineError::ResultTooLarge);
    }
    Ok(())
}

pub(crate) fn polygon_projection(
    vertices: &[FlowVertex],
    block_start: f64,
    block_end: f64,
) -> Result<Option<InlineSlot>, EngineError> {
    if vertices.len() < 3 || block_start >= block_end {
        return Err(EngineError::InvalidRequest);
    }
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    for index in 0..vertices.len() {
        let first = vertices[index];
        let second = vertices[(index + 1) % vertices.len()];
        let first_block = f64::from(first.block);
        let second_block = f64::from(second.block);
        if block_start <= first_block && first_block <= block_end {
            minimum = minimum.min(f64::from(first.inline));
            maximum = maximum.max(f64::from(first.inline));
        }
        for boundary in [block_start, block_end] {
            if first_block != second_block
                && ((first_block <= boundary && boundary <= second_block)
                    || (second_block <= boundary && boundary <= first_block))
            {
                let ratio = (boundary - first_block) / (second_block - first_block);
                let inline = f64::from(first.inline)
                    + (f64::from(second.inline) - f64::from(first.inline)) * ratio;
                minimum = minimum.min(inline);
                maximum = maximum.max(inline);
            }
        }
    }
    Ok((minimum < maximum).then_some(InlineSlot {
        start: minimum,
        end: maximum,
    }))
}

fn intersect_sorted(
    first: &[InlineSlot],
    second: &[InlineSlot],
    output: &mut Vec<InlineSlot>,
    max_slots: usize,
) -> Result<(), EngineError> {
    let mut first_index = 0usize;
    let mut second_index = 0usize;
    while first_index < first.len() && second_index < second.len() {
        let left = first[first_index];
        let right = second[second_index];
        push_nonempty(
            output,
            InlineSlot {
                start: left.start.max(right.start),
                end: left.end.min(right.end),
            },
            max_slots,
        )?;
        if left.end <= right.end {
            first_index += 1;
        } else {
            second_index += 1;
        }
    }
    Ok(())
}

fn normalize_slots(
    slots: &mut Vec<InlineSlot>,
    sort_pairs: &mut Vec<(u64, u32)>,
) -> Result<(), EngineError> {
    sort::prepare_pairs(sort_pairs, slots.len())?;
    for (index, slot) in slots.iter().enumerate() {
        sort_pairs.push((sort::f64_key(slot.start), index as u32));
    }
    sort::sort_pairs(sort_pairs);
    sort::apply_pair_order(slots, sort_pairs);
    let mut write = 0usize;
    for read in 0..slots.len() {
        let slot = slots[read];
        if write > 0 && slot.start <= slots[write - 1].end {
            slots[write - 1].end = slots[write - 1].end.max(slot.end);
        } else {
            slots[write] = slot;
            write += 1;
        }
    }
    slots.truncate(write);
    Ok(())
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

fn push_raw_nonempty(destination: &mut Vec<InlineSlot>, slot: InlineSlot) {
    if slot.start < slot.end {
        destination.push(slot);
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::frame::{ORIENTATION_MIXED, WRITING_HORIZONTAL_TB};
    use alloc::vec;

    #[test]
    fn concave_region_and_polygon_exclusion_resolve_conservatively() {
        let mut concave = FlowGeometryArena {
            vertices: vec![
                vertex(0.0, 0.0),
                vertex(100.0, 0.0),
                vertex(100.0, 100.0),
                vertex(60.0, 100.0),
                vertex(60.0, 40.0),
                vertex(40.0, 40.0),
                vertex(40.0, 100.0),
                vertex(0.0, 100.0),
            ],
            ..FlowGeometryArena::default()
        };
        concave.regions.push(RetainedRegion {
            record: region(SHAPE_POLYGON, 8, 0),
            vertex_start: 0,
        });
        let mut slots = InlineSlotArena::default();
        assert_eq!(
            slots.resolve_band(&concave, 0, 20.0, 60.0, 4).unwrap(),
            [
                InlineSlot {
                    start: 0.0,
                    end: 40.0,
                },
                InlineSlot {
                    start: 60.0,
                    end: 100.0,
                },
            ]
        );
        assert_eq!(
            slots.resolve_band(&concave, 0, 20.0, 60.0, 1),
            Err(EngineError::ResultTooLarge)
        );

        let mut excluded = FlowGeometryArena {
            vertices: vec![
                vertex(40.0, 20.0),
                vertex(60.0, 40.0),
                vertex(40.0, 60.0),
                vertex(20.0, 40.0),
            ],
            ..FlowGeometryArena::default()
        };
        excluded.regions.push(RetainedRegion {
            record: region(SHAPE_RECTANGLE, 0, 1),
            vertex_start: 0,
        });
        excluded.exclusions.push(RetainedExclusion {
            record: exclusion(SHAPE_POLYGON, 4),
            vertex_start: 0,
        });
        assert_eq!(
            slots.resolve_band(&excluded, 0, 30.0, 50.0, 4).unwrap(),
            [
                InlineSlot {
                    start: 0.0,
                    end: 20.0,
                },
                InlineSlot {
                    start: 60.0,
                    end: 100.0,
                },
            ]
        );
    }

    #[test]
    fn localized_change_unions_multiple_exclusions_and_ignores_revision_only_updates() {
        let mut region_record = region(SHAPE_RECTANGLE, 0, 2);
        region_record.exclusion_count = 2;
        let mut first = exclusion(SHAPE_RECTANGLE, 0);
        first.inline_start = 20.0;
        first.inline_end = 30.0;
        first.block_start = 10.0;
        first.block_end = 20.0;
        let mut second = first;
        second.id = 3;
        second.inline_start = 70.0;
        second.inline_end = 80.0;
        second.block_start = 40.0;
        second.block_end = 50.0;
        let previous = FlowGeometryArena {
            regions: vec![RetainedRegion {
                record: region_record,
                vertex_start: 0,
            }],
            exclusions: vec![
                RetainedExclusion {
                    record: first,
                    vertex_start: 0,
                },
                RetainedExclusion {
                    record: second,
                    vertex_start: 0,
                },
            ],
            ..FlowGeometryArena::default()
        };

        let mut revisions_only = previous.clone();
        revisions_only.regions[0].record.geometry_revision = 2;
        revisions_only.exclusions[0].record.geometry_revision = 2;
        revisions_only.exclusions[1].record.geometry_revision = 3;
        assert_eq!(
            revisions_only.localized_change_from(&previous).unwrap(),
            LocalizedGeometryChange::Unchanged
        );

        let mut moved = revisions_only;
        moved.exclusions[0].record.block_start = 20.0;
        moved.exclusions[0].record.block_end = 30.0;
        moved.exclusions[1].record.block_start = 35.0;
        moved.exclusions[1].record.block_end = 45.0;
        assert_eq!(
            moved.localized_change_from(&previous).unwrap(),
            LocalizedGeometryChange::ExclusionBand(ExclusionDirtyBand {
                region_id: 1,
                block_start: 10.0,
                block_end: 50.0,
            })
        );

        moved.regions[0].record.inline_end = 90.0;
        assert_eq!(
            moved.localized_change_from(&previous).unwrap(),
            LocalizedGeometryChange::Unsupported
        );
    }

    fn vertex(inline: f32, block: f32) -> FlowVertex {
        FlowVertex { inline, block }
    }

    fn region(shape: u8, vertex_count: u16, exclusion_count: u16) -> FlowRegion {
        FlowRegion {
            id: 1,
            geometry_revision: 1,
            transform_index: 1,
            vertices_offset: 0,
            vertex_count,
            exclusion_start: 0,
            exclusion_count,
            shape,
            writing_mode: WRITING_HORIZONTAL_TB,
            text_orientation: ORIENTATION_MIXED,
            inline_start: 0.0,
            block_start: 0.0,
            inline_end: 100.0,
            block_end: 100.0,
            clip_inline_start: 0.0,
            clip_block_start: 0.0,
            clip_inline_end: 100.0,
            clip_block_end: 100.0,
        }
    }

    fn exclusion(shape: u8, vertex_count: u16) -> FlowExclusion {
        FlowExclusion {
            id: 2,
            region_id: 1,
            geometry_revision: 1,
            vertices_offset: 0,
            vertex_count,
            shape,
            wrap_side: EXCLUSION_WRAP_BOTH,
            inline_start: 20.0,
            block_start: 20.0,
            inline_end: 60.0,
            block_end: 60.0,
            margin_inline: 0.0,
            margin_block: 0.0,
        }
    }
}
