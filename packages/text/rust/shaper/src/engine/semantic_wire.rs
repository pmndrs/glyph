//! Borrowed semantic update records decoded from the compiler-mapped frame ABI.

use crate::{
    STATUS_INVALID_REQUEST,
    abi_contract::{
        self as abi, ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
        ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
        ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
        ENGINE_TEXT_MUTATION_RECORD_SIZE, ENGINE_TEXT_MUTATION_RESERVED0,
        ENGINE_TEXT_MUTATION_RESERVED1, ENGINE_TEXT_MUTATION_TEXT_START,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    },
    engine::frame::{
        ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START, AXIS_AT_MOST, AXIS_EXACT,
        AXIS_UNCONSTRAINED, BASELINE_ALPHABETIC, BASELINE_MIDDLE, BASELINE_TEXT_BOTTOM,
        BASELINE_TEXT_TOP, BLOCK_ALIGN_CENTER, BLOCK_ALIGN_END, BLOCK_ALIGN_START,
        EXCLUSION_WRAP_BOTH, EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START,
        EXCLUSION_WRAP_LARGEST, ORIENTATION_MIXED, ORIENTATION_SIDEWAYS, ORIENTATION_UPRIGHT,
        OVERFLOW_CLIP, OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE, SHAPE_POLYGON, SHAPE_RECTANGLE,
        TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16, UpdateLimits, WRAP_CHARACTER,
        WRAP_NONE, WRAP_WORD, WRITING_HORIZONTAL_TB, WRITING_VERTICAL_LR, WRITING_VERTICAL_RL,
    },
    wire::{array, read_f32, read_u16, read_u32},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutationBatch<'a> {
    request: &'a [u8],
    records: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutation<'a> {
    pub text_start: u32,
    pub delete_count: u32,
    pub insert_utf16_le: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GeometryBatch<'a> {
    request: &'a [u8],
    constraints: &'a [u8],
    regions: &'a [u8],
    exclusions: &'a [u8],
    inline_objects: &'a [u8],
}

impl GeometryBatch<'_> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            constraints: &[],
            regions: &[],
            exclusions: &[],
            inline_objects: &[],
        }
    }

    pub(crate) fn validate_text_length(self, text_length: usize) -> Result<(), u32> {
        let text_length = u32::try_from(text_length).map_err(|_| STATUS_INVALID_REQUEST)?;
        for record in self
            .constraints
            .chunks_exact(abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize)
        {
            if read_u32(record, abi::ENGINE_CONSTRAINT_RESUME_CLUSTER)? > text_length {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        let mut previous_offset = None;
        for record in self
            .inline_objects
            .chunks_exact(abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize)
        {
            let offset = read_u32(record, abi::ENGINE_INLINE_OBJECT_TEXT_OFFSET)?;
            if offset > text_length || previous_offset.is_some_and(|previous| offset <= previous) {
                return Err(STATUS_INVALID_REQUEST);
            }
            previous_offset = Some(offset);
        }
        Ok(())
    }

    pub(crate) fn fingerprint(self) -> u64 {
        let mut hash = 0xcbf2_9ce4_8422_2325_u64;
        for section in [self.constraints, self.inline_objects] {
            mix_bytes(&mut hash, section);
        }
        for record in self
            .regions
            .chunks_exact(abi::ENGINE_REGION_RECORD_SIZE as usize)
        {
            mix_record_without_u32(&mut hash, record, abi::ENGINE_REGION_VERTICES_OFFSET);
            mix_vertex_payload(
                &mut hash,
                self.request,
                record,
                abi::ENGINE_REGION_SHAPE,
                abi::ENGINE_REGION_VERTICES_OFFSET,
                abi::ENGINE_REGION_VERTEX_COUNT,
            );
        }
        for record in self
            .exclusions
            .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        {
            mix_record_without_u32(&mut hash, record, abi::ENGINE_EXCLUSION_VERTICES_OFFSET);
            mix_vertex_payload(
                &mut hash,
                self.request,
                record,
                abi::ENGINE_EXCLUSION_SHAPE,
                abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
                abi::ENGINE_EXCLUSION_VERTEX_COUNT,
            );
        }
        hash
    }

    fn overlaps_range(self, range: (usize, usize)) -> Result<bool, u32> {
        for section in [
            self.constraints,
            self.regions,
            self.exclusions,
            self.inline_objects,
        ] {
            if !section.is_empty() && overlaps(range, byte_range(self.request, section)?) {
                return Ok(true);
            }
        }
        let total = self.regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize
            + self.exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
        for index in 0..total {
            if indexed_vertex_range(self.request, self.regions, self.exclusions, index)?
                .is_some_and(|vertices| overlaps(range, vertices))
            {
                return Ok(true);
            }
        }
        Ok(false)
    }
}

impl<'a> TextMutationBatch<'a> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            records: &[],
        }
    }

    pub(crate) fn len(self) -> usize {
        self.records.len() / ENGINE_TEXT_MUTATION_RECORD_SIZE as usize
    }

    pub(crate) fn get(self, index: usize) -> Option<TextMutation<'a>> {
        let stride = ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let start = index.checked_mul(stride)?;
        let record = self.records.get(start..start.checked_add(stride)?)?;
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT).ok()?;
        let insert_utf16_le = if insert_count == 0 {
            &[]
        } else {
            array(
                self.request,
                read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET).ok()?,
                insert_count,
                2,
                2,
            )
            .ok()?
        };
        Some(TextMutation {
            text_start: read_u32(record, ENGINE_TEXT_MUTATION_TEXT_START).ok()?,
            delete_count: read_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT).ok()?,
            insert_utf16_le,
        })
    }

    pub(crate) fn validate_disjoint_geometry(self, geometry: GeometryBatch<'_>) -> Result<(), u32> {
        if !self.records.is_empty()
            && geometry.overlaps_range(byte_range(self.request, self.records)?)?
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        for record in self
            .records
            .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        {
            if let Some(range) = text_payload_range(self.request, record)?
                && geometry.overlaps_range(range)?
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
        Ok(())
    }
}

pub(crate) fn parse_text_mutations(
    request: &[u8],
    offset: u32,
    count: u32,
) -> Result<TextMutationBatch<'_>, u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(TextMutationBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    let records = array(
        request,
        offset,
        count,
        ENGINE_TEXT_MUTATION_RECORD_SIZE,
        ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
    )?;
    let record_start = offset as usize;
    let record_end = record_start
        .checked_add(records.len())
        .ok_or(STATUS_INVALID_REQUEST)?;
    for (index, record) in records
        .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        .enumerate()
    {
        if record[ENGINE_TEXT_MUTATION_OPCODE] != TEXT_MUTATION_REPLACE_UTF16
            || record[ENGINE_TEXT_MUTATION_ENCODING] != TEXT_ENCODING_UTF16_LE
            || read_u16(record, ENGINE_TEXT_MUTATION_RESERVED0)? != 0
            || read_u32(record, ENGINE_TEXT_MUTATION_RESERVED1)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT)?;
        let insert_offset = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET)?;
        if insert_count == 0 {
            if insert_offset != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            continue;
        }
        let payload = array(request, insert_offset, insert_count, 2, 2)?;
        let payload_range = byte_range(request, payload)?;
        if overlaps(payload_range, (record_start, record_end)) {
            return Err(STATUS_INVALID_REQUEST);
        }
        for previous in records[..index * ENGINE_TEXT_MUTATION_RECORD_SIZE as usize]
            .chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize)
        {
            if text_payload_range(request, previous)?
                .is_some_and(|range| overlaps(payload_range, range))
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(TextMutationBatch { request, records })
}

fn text_payload_range(request: &[u8], record: &[u8]) -> Result<Option<(usize, usize)>, u32> {
    let count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT)?;
    if count == 0 {
        return Ok(None);
    }
    let payload = array(
        request,
        read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET)?,
        count,
        2,
        2,
    )?;
    Ok(Some(byte_range(request, payload)?))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn parse_geometry(
    request: &[u8],
    constraints_offset: u32,
    constraint_count: u32,
    regions_offset: u32,
    region_count: u32,
    exclusions_offset: u32,
    exclusion_count: u32,
    inline_objects_offset: u32,
    inline_object_count: u32,
    limits: UpdateLimits,
) -> Result<GeometryBatch<'_>, u32> {
    if region_count > limits.max_regions
        || exclusion_count > limits.max_exclusions
        || inline_object_count > limits.max_inline_objects
        || constraint_count > limits.max_regions
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let all_empty = constraint_count == 0
        && region_count == 0
        && exclusion_count == 0
        && inline_object_count == 0;
    if all_empty {
        return if constraints_offset == 0
            && regions_offset == 0
            && exclusions_offset == 0
            && inline_objects_offset == 0
        {
            Ok(GeometryBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if constraint_count == 0 || region_count == 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    let constraints = record_table(
        request,
        constraints_offset,
        constraint_count,
        abi::ENGINE_CONSTRAINT_RECORD_SIZE,
        abi::ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
    )?;
    let regions = record_table(
        request,
        regions_offset,
        region_count,
        abi::ENGINE_REGION_RECORD_SIZE,
        abi::ENGINE_REGION_RECORD_ALIGNMENT,
    )?;
    let exclusions = record_table(
        request,
        exclusions_offset,
        exclusion_count,
        abi::ENGINE_EXCLUSION_RECORD_SIZE,
        abi::ENGINE_EXCLUSION_RECORD_ALIGNMENT,
    )?;
    let inline_objects = record_table(
        request,
        inline_objects_offset,
        inline_object_count,
        abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
        abi::ENGINE_INLINE_OBJECT_RECORD_ALIGNMENT,
    )?;
    let fixed = [constraints, regions, exclusions, inline_objects];
    reject_overlapping_slices(request, &fixed)?;
    validate_constraints(constraints, region_count, limits)?;
    validate_regions(request, regions, exclusions, &fixed)?;
    validate_exclusions(request, exclusions, regions, &fixed)?;
    validate_inline_objects(inline_objects)?;
    reject_overlapping_vertex_payloads(request, regions, exclusions)?;
    Ok(GeometryBatch {
        request,
        constraints,
        regions,
        exclusions,
        inline_objects,
    })
}

fn record_table(
    request: &[u8],
    offset: u32,
    count: u32,
    stride: u32,
    alignment: u32,
) -> Result<&[u8], u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(&[])
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    array(request, offset, count, stride, alignment)
}

fn validate_constraints(
    constraints: &[u8],
    region_count: u32,
    limits: UpdateLimits,
) -> Result<(), u32> {
    for (index, record) in constraints
        .chunks_exact(abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize)
        .enumerate()
    {
        let flow_thread_id = read_u32(record, abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID)?;
        if flow_thread_id == 0
            || prior_u32_duplicate(
                constraints,
                abi::ENGINE_CONSTRAINT_RECORD_SIZE,
                abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID,
                index,
                flow_thread_id,
            )?
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let width_mode = byte(record, abi::ENGINE_CONSTRAINT_WIDTH_MODE)?;
        let height_mode = byte(record, abi::ENGINE_CONSTRAINT_HEIGHT_MODE)?;
        let width = finite(record, abi::ENGINE_CONSTRAINT_WIDTH)?;
        let height = finite(record, abi::ENGINE_CONSTRAINT_HEIGHT)?;
        if !valid_axis(width_mode, width) || !valid_axis(height_mode, height) {
            return Err(STATUS_INVALID_REQUEST);
        }
        let viewport_start = finite(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_START)?;
        let viewport_end = finite(record, abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END)?;
        if viewport_start > viewport_end
            || !finite(record, abi::ENGINE_CONSTRAINT_RESUME_BLOCK_OFFSET)?.is_finite()
            || read_u32(record, abi::ENGINE_CONSTRAINT_MAX_LINES)? > limits.max_lines
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_WRAP)?,
                WRAP_NONE | WRAP_WORD | WRAP_CHARACTER
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_ALIGN)?,
                ALIGN_START | ALIGN_CENTER | ALIGN_END | ALIGN_JUSTIFY
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_OVERFLOW)?,
                OVERFLOW_VISIBLE | OVERFLOW_CLIP | OVERFLOW_ELLIPSIS
            )
            || !matches!(
                byte(record, abi::ENGINE_CONSTRAINT_BLOCK_ALIGN)?,
                BLOCK_ALIGN_START | BLOCK_ALIGN_CENTER | BLOCK_ALIGN_END
            )
            || read_u16(record, abi::ENGINE_CONSTRAINT_FLAGS)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let region_start = read_u32(record, abi::ENGINE_CONSTRAINT_REGION_START)?;
        let selected_count = u32::from(read_u16(record, abi::ENGINE_CONSTRAINT_REGION_COUNT)?);
        let resume_region = u32::from(read_u16(record, abi::ENGINE_CONSTRAINT_RESUME_REGION)?);
        if selected_count == 0
            || region_start
                .checked_add(selected_count)
                .is_none_or(|end| end > region_count)
            || resume_region > selected_count
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn validate_regions(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
    fixed: &[&[u8]],
) -> Result<(), u32> {
    let exclusion_total = exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    for (index, record) in regions
        .chunks_exact(abi::ENGINE_REGION_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_REGION_ID)?;
        if id == 0
            || prior_u32_duplicate(
                regions,
                abi::ENGINE_REGION_RECORD_SIZE,
                abi::ENGINE_REGION_ID,
                index,
                id,
            )?
            || read_u16(record, abi::ENGINE_REGION_FLAGS)? != 0
            || byte(record, abi::ENGINE_REGION_RESERVED0)? != 0
            || !matches!(
                byte(record, abi::ENGINE_REGION_WRITING_MODE)?,
                WRITING_HORIZONTAL_TB | WRITING_VERTICAL_RL | WRITING_VERTICAL_LR
            )
            || !matches!(
                byte(record, abi::ENGINE_REGION_TEXT_ORIENTATION)?,
                ORIENTATION_MIXED | ORIENTATION_UPRIGHT | ORIENTATION_SIDEWAYS
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let region_bounds = bounds(
            record,
            abi::ENGINE_REGION_INLINE_START,
            abi::ENGINE_REGION_BLOCK_START,
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_BLOCK_END,
        )?;
        let clip = bounds(
            record,
            abi::ENGINE_REGION_CLIP_INLINE_START,
            abi::ENGINE_REGION_CLIP_BLOCK_START,
            abi::ENGINE_REGION_CLIP_INLINE_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        )?;
        if clip.0 < region_bounds.0
            || clip.1 < region_bounds.1
            || clip.2 > region_bounds.2
            || clip.3 > region_bounds.3
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        validate_shape(
            request,
            record,
            abi::ENGINE_REGION_SHAPE,
            abi::ENGINE_REGION_VERTICES_OFFSET,
            abi::ENGINE_REGION_VERTEX_COUNT,
            region_bounds,
            fixed,
        )?;
        let exclusion_start = usize::from(read_u16(record, abi::ENGINE_REGION_EXCLUSION_START)?);
        let exclusion_count = usize::from(read_u16(record, abi::ENGINE_REGION_EXCLUSION_COUNT)?);
        let end = exclusion_start
            .checked_add(exclusion_count)
            .ok_or(STATUS_INVALID_REQUEST)?;
        if end > exclusion_total {
            return Err(STATUS_INVALID_REQUEST);
        }
        for exclusion in exclusions[exclusion_start * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize
            ..end * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize]
            .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        {
            if read_u32(exclusion, abi::ENGINE_EXCLUSION_REGION_ID)? != id {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn validate_exclusions(
    request: &[u8],
    exclusions: &[u8],
    regions: &[u8],
    fixed: &[&[u8]],
) -> Result<(), u32> {
    for (index, record) in exclusions
        .chunks_exact(abi::ENGINE_EXCLUSION_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_EXCLUSION_ID)?;
        let region_id = read_u32(record, abi::ENGINE_EXCLUSION_REGION_ID)?;
        if id == 0
            || prior_u32_duplicate(
                exclusions,
                abi::ENGINE_EXCLUSION_RECORD_SIZE,
                abi::ENGINE_EXCLUSION_ID,
                index,
                id,
            )?
            || !contains_u32(
                regions,
                abi::ENGINE_REGION_RECORD_SIZE,
                abi::ENGINE_REGION_ID,
                region_id,
            )?
            || read_u16(record, abi::ENGINE_EXCLUSION_FLAGS)? != 0
            || read_u16(record, abi::ENGINE_EXCLUSION_RESERVED0)? != 0
            || !matches!(
                byte(record, abi::ENGINE_EXCLUSION_WRAP_SIDE)?,
                EXCLUSION_WRAP_BOTH
                    | EXCLUSION_WRAP_INLINE_START
                    | EXCLUSION_WRAP_INLINE_END
                    | EXCLUSION_WRAP_LARGEST
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let shape_bounds = bounds(
            record,
            abi::ENGINE_EXCLUSION_INLINE_START,
            abi::ENGINE_EXCLUSION_BLOCK_START,
            abi::ENGINE_EXCLUSION_INLINE_END,
            abi::ENGINE_EXCLUSION_BLOCK_END,
        )?;
        if finite(record, abi::ENGINE_EXCLUSION_MARGIN_INLINE)? < 0.0
            || finite(record, abi::ENGINE_EXCLUSION_MARGIN_BLOCK)? < 0.0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        validate_shape(
            request,
            record,
            abi::ENGINE_EXCLUSION_SHAPE,
            abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
            abi::ENGINE_EXCLUSION_VERTEX_COUNT,
            shape_bounds,
            fixed,
        )?;
    }
    Ok(())
}

fn validate_inline_objects(records: &[u8]) -> Result<(), u32> {
    for (index, record) in records
        .chunks_exact(abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize)
        .enumerate()
    {
        let id = read_u32(record, abi::ENGINE_INLINE_OBJECT_ID)?;
        if id == 0
            || prior_u32_duplicate(
                records,
                abi::ENGINE_INLINE_OBJECT_RECORD_SIZE,
                abi::ENGINE_INLINE_OBJECT_ID,
                index,
                id,
            )?
            || read_u32(record, abi::ENGINE_INLINE_OBJECT_RESOURCE_ID)? == 0
            || read_u32(record, abi::ENGINE_INLINE_OBJECT_RESOURCE_GENERATION)? == 0
            || finite(record, abi::ENGINE_INLINE_OBJECT_INLINE_EXTENT)? < 0.0
            || finite(record, abi::ENGINE_INLINE_OBJECT_BLOCK_EXTENT)? < 0.0
            || !finite(record, abi::ENGINE_INLINE_OBJECT_BASELINE_OFFSET)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_START)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_INLINE_END)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_BLOCK_START)?.is_finite()
            || !finite(record, abi::ENGINE_INLINE_OBJECT_MARGIN_BLOCK_END)?.is_finite()
            || !matches!(
                byte(record, abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT)?,
                BASELINE_ALPHABETIC | BASELINE_TEXT_TOP | BASELINE_MIDDLE | BASELINE_TEXT_BOTTOM
            )
            || byte(record, abi::ENGINE_INLINE_OBJECT_FLAGS)? != 0
            || read_u16(record, abi::ENGINE_INLINE_OBJECT_RESERVED0)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn validate_shape(
    request: &[u8],
    record: &[u8],
    shape_offset: usize,
    vertices_offset: usize,
    vertex_count_offset: usize,
    shape_bounds: (f32, f32, f32, f32),
    fixed: &[&[u8]],
) -> Result<(), u32> {
    let shape = byte(record, shape_offset)?;
    let offset = read_u32(record, vertices_offset)?;
    let count = u32::from(read_u16(record, vertex_count_offset)?);
    match shape {
        SHAPE_RECTANGLE if offset == 0 && count == 0 => Ok(()),
        SHAPE_POLYGON if count >= 3 => {
            let vertices = record_table(
                request,
                offset,
                count,
                abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
                abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
            )?;
            reject_payload_overlap(request, vertices, fixed)?;
            for vertex in vertices.chunks_exact(abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize) {
                let inline = finite(vertex, abi::ENGINE_FLOW_VERTEX_INLINE)?;
                let block = finite(vertex, abi::ENGINE_FLOW_VERTEX_BLOCK)?;
                if inline < shape_bounds.0
                    || block < shape_bounds.1
                    || inline > shape_bounds.2
                    || block > shape_bounds.3
                {
                    return Err(STATUS_INVALID_REQUEST);
                }
            }
            Ok(())
        }
        _ => Err(STATUS_INVALID_REQUEST),
    }
}

fn bounds(
    record: &[u8],
    inline_start: usize,
    block_start: usize,
    inline_end: usize,
    block_end: usize,
) -> Result<(f32, f32, f32, f32), u32> {
    let values = (
        finite(record, inline_start)?,
        finite(record, block_start)?,
        finite(record, inline_end)?,
        finite(record, block_end)?,
    );
    if values.0 >= values.2 || values.1 >= values.3 {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok(values)
    }
}

fn valid_axis(mode: u8, value: f32) -> bool {
    match mode {
        AXIS_UNCONSTRAINED => value == 0.0,
        AXIS_AT_MOST | AXIS_EXACT => value >= 0.0,
        _ => false,
    }
}

fn finite(record: &[u8], offset: usize) -> Result<f32, u32> {
    let value = read_f32(record, offset)?;
    if value.is_finite() {
        Ok(value)
    } else {
        Err(STATUS_INVALID_REQUEST)
    }
}

fn byte(record: &[u8], offset: usize) -> Result<u8, u32> {
    record.get(offset).copied().ok_or(STATUS_INVALID_REQUEST)
}

fn prior_u32_duplicate(
    records: &[u8],
    stride: u32,
    field: usize,
    index: usize,
    value: u32,
) -> Result<bool, u32> {
    for record in records[..index * stride as usize].chunks_exact(stride as usize) {
        if read_u32(record, field)? == value {
            return Ok(true);
        }
    }
    Ok(false)
}

fn contains_u32(records: &[u8], stride: u32, field: usize, value: u32) -> Result<bool, u32> {
    for record in records.chunks_exact(stride as usize) {
        if read_u32(record, field)? == value {
            return Ok(true);
        }
    }
    Ok(false)
}

fn reject_overlapping_slices(request: &[u8], slices: &[&[u8]]) -> Result<(), u32> {
    for (index, slice) in slices.iter().enumerate() {
        if slice.is_empty() {
            continue;
        }
        let current = byte_range(request, slice)?;
        for other in &slices[..index] {
            if !other.is_empty() && overlaps(current, byte_range(request, other)?) {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn reject_payload_overlap(request: &[u8], payload: &[u8], fixed: &[&[u8]]) -> Result<(), u32> {
    let payload = byte_range(request, payload)?;
    for table in fixed {
        if !table.is_empty() && overlaps(payload, byte_range(request, table)?) {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn reject_overlapping_vertex_payloads(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
) -> Result<(), u32> {
    let total = regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize
        + exclusions.len() / abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    for index in 0..total {
        let Some(current) = indexed_vertex_range(request, regions, exclusions, index)? else {
            continue;
        };
        for previous in 0..index {
            if indexed_vertex_range(request, regions, exclusions, previous)?
                .is_some_and(|range| overlaps(current, range))
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn indexed_vertex_range(
    request: &[u8],
    regions: &[u8],
    exclusions: &[u8],
    index: usize,
) -> Result<Option<(usize, usize)>, u32> {
    let region_count = regions.len() / abi::ENGINE_REGION_RECORD_SIZE as usize;
    let (record, shape, offset, count) = if index < region_count {
        let start = index * abi::ENGINE_REGION_RECORD_SIZE as usize;
        (
            &regions[start..start + abi::ENGINE_REGION_RECORD_SIZE as usize],
            abi::ENGINE_REGION_SHAPE,
            abi::ENGINE_REGION_VERTICES_OFFSET,
            abi::ENGINE_REGION_VERTEX_COUNT,
        )
    } else {
        let start = (index - region_count) * abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
        (
            &exclusions[start..start + abi::ENGINE_EXCLUSION_RECORD_SIZE as usize],
            abi::ENGINE_EXCLUSION_SHAPE,
            abi::ENGINE_EXCLUSION_VERTICES_OFFSET,
            abi::ENGINE_EXCLUSION_VERTEX_COUNT,
        )
    };
    if byte(record, shape)? != SHAPE_POLYGON {
        return Ok(None);
    }
    let vertices = array(
        request,
        read_u32(record, offset)?,
        u32::from(read_u16(record, count)?),
        abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
        abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
    )?;
    Ok(Some(byte_range(request, vertices)?))
}

fn byte_range(request: &[u8], slice: &[u8]) -> Result<(usize, usize), u32> {
    let request_start = request.as_ptr() as usize;
    let start = (slice.as_ptr() as usize)
        .checked_sub(request_start)
        .ok_or(STATUS_INVALID_REQUEST)?;
    let end = start
        .checked_add(slice.len())
        .ok_or(STATUS_INVALID_REQUEST)?;
    if end > request.len() {
        Err(STATUS_INVALID_REQUEST)
    } else {
        Ok((start, end))
    }
}

fn overlaps(left: (usize, usize), right: (usize, usize)) -> bool {
    left.0 < right.1 && right.0 < left.1
}

fn mix_bytes(hash: &mut u64, bytes: &[u8]) {
    for byte in bytes {
        *hash ^= u64::from(*byte);
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
}

fn mix_record_without_u32(hash: &mut u64, record: &[u8], offset: usize) {
    mix_bytes(hash, &record[..offset]);
    mix_bytes(hash, &record[offset + 4..]);
}

fn mix_vertex_payload(
    hash: &mut u64,
    request: &[u8],
    record: &[u8],
    shape: usize,
    offset: usize,
    count: usize,
) {
    if byte(record, shape).ok() != Some(SHAPE_POLYGON) {
        return;
    }
    if let (Ok(offset), Ok(count)) = (read_u32(record, offset), read_u16(record, count))
        && let Ok(vertices) = array(
            request,
            offset,
            u32::from(count),
            abi::ENGINE_FLOW_VERTEX_RECORD_SIZE,
            abi::ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
        )
    {
        mix_bytes(hash, vertices);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        abi_contract::{
            ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
            ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_TEXT_START,
        },
        wire::write_u32,
    };
    use alloc::vec;

    #[test]
    fn validates_and_borrows_utf16_replacements_without_decoding_objects() {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let payload_offset = record_offset + ENGINE_TEXT_MUTATION_RECORD_SIZE;
        let mut bytes = vec![0; payload_offset as usize + 4];
        let record = &mut bytes[record_offset as usize..payload_offset as usize];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_TEXT_START, 2);
        write_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT, 1);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, payload_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 2);
        bytes[payload_offset as usize..payload_offset as usize + 2]
            .copy_from_slice(&0x0061_u16.to_le_bytes());
        bytes[payload_offset as usize + 2..payload_offset as usize + 4]
            .copy_from_slice(&0xd83d_u16.to_le_bytes());

        let batch = parse_text_mutations(&bytes, record_offset, 1).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(
            batch.get(0),
            Some(TextMutation {
                text_start: 2,
                delete_count: 1,
                insert_utf16_le: &[0x61, 0x00, 0x3d, 0xd8],
            })
        );
    }

    #[test]
    fn rejects_noncanonical_empty_and_overlapping_payloads() {
        assert!(parse_text_mutations(&[], 4, 0).is_err());
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let mut bytes = vec![0; record_offset as usize + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize];
        let record = &mut bytes[record_offset as usize..];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, record_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 1);
        assert!(parse_text_mutations(&bytes, record_offset, 1).is_err());
    }

    #[test]
    fn validates_one_call_rectangle_flow_and_text_anchored_objects() {
        let bytes = valid_geometry_bytes();
        let geometry = parse_valid_geometry(&bytes).unwrap();
        geometry.validate_text_length(0).unwrap();
        assert_ne!(geometry.fingerprint(), 0);

        let mut polygon = bytes.clone();
        polygon.resize(
            polygon.len() + 3 * abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize,
            0,
        );
        polygon[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_POLYGON;
        write_u32(
            &mut polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            GEOMETRY_LENGTH as u32,
        );
        write_u16(
            &mut polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTEX_COUNT,
            3,
        );
        for (index, (inline, block)) in [(0.0, 0.0), (100.0, 0.0), (0.0, 100.0)]
            .into_iter()
            .enumerate()
        {
            let offset = GEOMETRY_LENGTH + index * abi::ENGINE_FLOW_VERTEX_RECORD_SIZE as usize;
            write_f32(
                &mut polygon,
                offset + abi::ENGINE_FLOW_VERTEX_INLINE,
                inline,
            );
            write_f32(&mut polygon, offset + abi::ENGINE_FLOW_VERTEX_BLOCK, block);
        }
        let polygon_geometry = parse_valid_geometry(&polygon).unwrap();
        assert_ne!(polygon_geometry.fingerprint(), geometry.fingerprint());
        let mut relocated_polygon = polygon[..GEOMETRY_LENGTH].to_vec();
        relocated_polygon.resize(GEOMETRY_LENGTH + 8, 0);
        relocated_polygon.extend_from_slice(&polygon[GEOMETRY_LENGTH..]);
        write_u32(
            &mut relocated_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            (GEOMETRY_LENGTH + 8) as u32,
        );
        assert_eq!(
            parse_valid_geometry(&relocated_polygon)
                .unwrap()
                .fingerprint(),
            polygon_geometry.fingerprint(),
            "request placement is not semantic geometry",
        );

        let mut outside_text = bytes.clone();
        let inline = INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_TEXT_OFFSET;
        write_u32(&mut outside_text, inline, 1);
        assert!(
            parse_valid_geometry(&outside_text)
                .unwrap()
                .validate_text_length(0)
                .is_err()
        );
    }

    #[test]
    fn rejects_invalid_geometry_relationships_and_payload_aliasing() {
        let mut wrong_region = valid_geometry_bytes();
        write_u32(
            &mut wrong_region,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_REGION_ID,
            9,
        );
        assert!(parse_valid_geometry(&wrong_region).is_err());

        let mut nonfinite = valid_geometry_bytes();
        write_f32(
            &mut nonfinite,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_MARGIN_INLINE,
            f32::NAN,
        );
        assert!(parse_valid_geometry(&nonfinite).is_err());

        let mut overlapping_polygon = valid_geometry_bytes();
        overlapping_polygon[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_POLYGON;
        write_u32(
            &mut overlapping_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTICES_OFFSET,
            CONSTRAINT_OFFSET as u32,
        );
        write_u16(
            &mut overlapping_polygon,
            REGION_OFFSET + abi::ENGINE_REGION_VERTEX_COUNT,
            3,
        );
        assert!(parse_valid_geometry(&overlapping_polygon).is_err());

        let mut cross_section_alias = valid_geometry_bytes();
        let mutation_offset = cross_section_alias.len();
        cross_section_alias.resize(
            mutation_offset + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize,
            0,
        );
        cross_section_alias[mutation_offset + ENGINE_TEXT_MUTATION_OPCODE] =
            TEXT_MUTATION_REPLACE_UTF16;
        cross_section_alias[mutation_offset + ENGINE_TEXT_MUTATION_ENCODING] =
            TEXT_ENCODING_UTF16_LE;
        write_u32(
            &mut cross_section_alias,
            mutation_offset + ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            CONSTRAINT_OFFSET as u32,
        );
        write_u32(
            &mut cross_section_alias,
            mutation_offset + ENGINE_TEXT_MUTATION_INSERT_COUNT,
            2,
        );
        let text = parse_text_mutations(&cross_section_alias, mutation_offset as u32, 1).unwrap();
        let geometry = parse_valid_geometry(&cross_section_alias).unwrap();
        assert!(text.validate_disjoint_geometry(geometry).is_err());

        assert!(
            parse_geometry(
                &valid_geometry_bytes(),
                CONSTRAINT_OFFSET as u32,
                1,
                REGION_OFFSET as u32,
                1,
                EXCLUSION_OFFSET as u32,
                1,
                INLINE_OFFSET as u32,
                1,
                UpdateLimits {
                    max_regions: 1,
                    max_exclusions: 0,
                    ..limits()
                },
            )
            .is_err()
        );
    }

    const CONSTRAINT_OFFSET: usize = abi::ENGINE_UPDATE_REQUEST_HEADER_SIZE as usize;
    const REGION_OFFSET: usize = CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_RECORD_SIZE as usize;
    const EXCLUSION_OFFSET: usize = REGION_OFFSET + abi::ENGINE_REGION_RECORD_SIZE as usize;
    const INLINE_OFFSET: usize = EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_RECORD_SIZE as usize;
    const GEOMETRY_LENGTH: usize = INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RECORD_SIZE as usize;

    fn parse_valid_geometry(bytes: &[u8]) -> Result<GeometryBatch<'_>, u32> {
        parse_geometry(
            bytes,
            CONSTRAINT_OFFSET as u32,
            1,
            REGION_OFFSET as u32,
            1,
            EXCLUSION_OFFSET as u32,
            1,
            INLINE_OFFSET as u32,
            1,
            limits(),
        )
    }

    fn limits() -> UpdateLimits {
        UpdateLimits {
            max_clusters: 16,
            max_lines: 16,
            max_regions: 4,
            max_exclusions: 4,
            max_inline_objects: 4,
            max_slots_per_band: 4,
            max_output_bytes: 4096,
        }
    }

    fn valid_geometry_bytes() -> Vec<u8> {
        let mut bytes = vec![0; GEOMETRY_LENGTH];
        write_u32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_FLOW_THREAD_ID,
            1,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WIDTH,
            100.0,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_HEIGHT,
            100.0,
        );
        write_f32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
            100.0,
        );
        write_u32(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_MAX_LINES,
            16,
        );
        write_u16(
            &mut bytes,
            CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_REGION_COUNT,
            1,
        );
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WIDTH_MODE] = AXIS_EXACT;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_HEIGHT_MODE] = AXIS_EXACT;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_WRAP] = WRAP_WORD;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_ALIGN] = ALIGN_START;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_OVERFLOW] = OVERFLOW_CLIP;
        bytes[CONSTRAINT_OFFSET + abi::ENGINE_CONSTRAINT_BLOCK_ALIGN] = BLOCK_ALIGN_START;

        write_u32(&mut bytes, REGION_OFFSET + abi::ENGINE_REGION_ID, 1);
        write_u32(
            &mut bytes,
            REGION_OFFSET + abi::ENGINE_REGION_GEOMETRY_REVISION,
            1,
        );
        write_u16(
            &mut bytes,
            REGION_OFFSET + abi::ENGINE_REGION_EXCLUSION_COUNT,
            1,
        );
        bytes[REGION_OFFSET + abi::ENGINE_REGION_SHAPE] = SHAPE_RECTANGLE;
        bytes[REGION_OFFSET + abi::ENGINE_REGION_WRITING_MODE] = WRITING_HORIZONTAL_TB;
        bytes[REGION_OFFSET + abi::ENGINE_REGION_TEXT_ORIENTATION] = ORIENTATION_MIXED;
        for field in [
            abi::ENGINE_REGION_INLINE_END,
            abi::ENGINE_REGION_BLOCK_END,
            abi::ENGINE_REGION_CLIP_INLINE_END,
            abi::ENGINE_REGION_CLIP_BLOCK_END,
        ] {
            write_f32(&mut bytes, REGION_OFFSET + field, 100.0);
        }

        write_u32(&mut bytes, EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_ID, 2);
        write_u32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_REGION_ID,
            1,
        );
        write_u32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_GEOMETRY_REVISION,
            1,
        );
        bytes[EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_SHAPE] = SHAPE_RECTANGLE;
        bytes[EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_WRAP_SIDE] = EXCLUSION_WRAP_BOTH;
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_INLINE_START,
            20.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_BLOCK_START,
            20.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_INLINE_END,
            40.0,
        );
        write_f32(
            &mut bytes,
            EXCLUSION_OFFSET + abi::ENGINE_EXCLUSION_BLOCK_END,
            40.0,
        );

        write_u32(&mut bytes, INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_ID, 3);
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_CONTENT_REVISION,
            1,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_MATERIAL_ID,
            1,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RESOURCE_ID,
            4,
        );
        write_u32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_RESOURCE_GENERATION,
            1,
        );
        write_f32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_INLINE_EXTENT,
            10.0,
        );
        write_f32(
            &mut bytes,
            INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_BLOCK_EXTENT,
            10.0,
        );
        bytes[INLINE_OFFSET + abi::ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT] = BASELINE_ALPHABETIC;
        bytes
    }

    fn write_u16(bytes: &mut [u8], offset: usize, value: u16) {
        bytes[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn write_f32(bytes: &mut [u8], offset: usize, value: f32) {
        write_u32(bytes, offset, value.to_bits());
    }
}
