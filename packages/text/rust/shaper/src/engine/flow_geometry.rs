use alloc::vec::Vec;

use super::{
    EngineError,
    frame::{
        EXCLUSION_WRAP_BOTH, EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START,
        EXCLUSION_WRAP_LARGEST, SHAPE_POLYGON, SHAPE_RECTANGLE,
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
    section: Vec<InlineSlot>,
    crossings: Vec<f64>,
    critical_blocks: Vec<f64>,
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
        reserve(&mut self.exclusions, geometry.exclusion_count())?;
        for index in 0..geometry.constraint_count() {
            let mut constraint = geometry
                .constraint(index)
                .ok_or(EngineError::InvalidRequest)?;
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
        self.critical_blocks.sort_by(f64::total_cmp);
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
    crossings.sort_by(f64::total_cmp);
    for pair in crossings.chunks_exact(2) {
        push_raw_nonempty(
            output,
            InlineSlot {
                start: pair[0],
                end: pair[1],
            },
        );
    }
    normalize_slots(output);
    if output.len() > max_slots {
        return Err(EngineError::ResultTooLarge);
    }
    Ok(())
}

fn polygon_projection(
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

fn normalize_slots(slots: &mut Vec<InlineSlot>) {
    slots.sort_by(|first, second| first.start.total_cmp(&second.start));
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
