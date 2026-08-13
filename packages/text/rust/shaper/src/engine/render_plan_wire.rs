//! Little-endian serialization for immutable render-plan publications.

use crate::{
    STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE,
    abi_contract::*,
    engine::render_plan::{
        BufferRecord, DiagnosticRecord, DrawRecord, PATCH_ALLOCATE_OR_RESIZE, PATCH_COPY,
        PATCH_FILL, PATCH_RETIRE, PATCH_WRITE, PRIMITIVE_CLIP, PRIMITIVE_DECORATION,
        PRIMITIVE_GLYPH, PRIMITIVE_INLINE_OBJECT, PRIMITIVE_POLICY, PatchRecord, PrimitiveRecord,
        RESOURCE_ACTION_CREATE, RESOURCE_ACTION_RETAIN, RESOURCE_ACTION_UPDATE, RETIRE_BUFFER,
        RETIRE_OUTPUT_BYTES, RETIRE_RESOURCE, RETIRE_SLOT_RANGE, RenderPlanView, ResourceRecord,
        RetirementRecord,
    },
    engine::semantic_view::{
        SEMANTIC_CARET, SEMANTIC_CLUSTER, SEMANTIC_FRAGMENT, SEMANTIC_GLYPH,
        SEMANTIC_INSERTED_GLYPH, SEMANTIC_LINE, SEMANTIC_PARAGRAPH_MEASUREMENT, SEMANTIC_RUN,
        SEMANTIC_SELECTION, SemanticRecord,
    },
};

const PAYLOAD_ALIGNMENT: u32 = 16;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct TableSpan {
    pub offset: u32,
    pub count: u32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct EncodedPlanLayout {
    pub byte_length: u32,
    pub payload_offset: u32,
    pub semantic_views: TableSpan,
    pub resources: TableSpan,
    pub buffers: TableSpan,
    pub patches: TableSpan,
    pub primitives: TableSpan,
    pub draws: TableSpan,
    pub retirements: TableSpan,
    pub diagnostics: TableSpan,
}

#[cfg(test)]
pub(crate) fn encode_plan(
    plan: RenderPlanView<'_>,
    output: &mut [u8],
) -> Result<EncodedPlanLayout, u32> {
    encode_publication(plan, &[], output)
}

pub(crate) fn encode_publication(
    plan: RenderPlanView<'_>,
    semantic_views: &[SemanticRecord],
    output: &mut [u8],
) -> Result<EncodedPlanLayout, u32> {
    let layout = publication_layout(plan, semantic_views)?;
    let byte_length = usize::try_from(layout.byte_length).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    let bytes = output
        .get_mut(..byte_length)
        .ok_or(STATUS_RESULT_TOO_LARGE)?;
    bytes.fill(0);
    if !plan.payload.is_empty() {
        let start = usize::try_from(layout.payload_offset).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
        bytes[start..start + plan.payload.len()].copy_from_slice(plan.payload);
    }
    write_records(
        bytes,
        layout.semantic_views,
        SEMANTIC_RECORD_SIZE,
        semantic_views,
        write_semantic,
    );
    write_records(
        bytes,
        layout.resources,
        RESOURCE_RECORD_SIZE,
        plan.resources,
        write_resource,
    );
    write_records(
        bytes,
        layout.buffers,
        BUFFER_RECORD_SIZE,
        plan.buffers,
        write_buffer,
    );
    write_patch_records(bytes, layout.patches, layout.payload_offset, plan.patches);
    write_records(
        bytes,
        layout.primitives,
        PRIMITIVE_RECORD_SIZE,
        plan.primitives,
        write_primitive,
    );
    write_records(
        bytes,
        layout.draws,
        DRAW_RECORD_SIZE,
        plan.draws,
        write_draw,
    );
    write_records(
        bytes,
        layout.retirements,
        RETIREMENT_RECORD_SIZE,
        plan.retirements,
        write_retirement,
    );
    write_records(
        bytes,
        layout.diagnostics,
        DIAGNOSTIC_RECORD_SIZE,
        plan.diagnostics,
        write_diagnostic,
    );
    Ok(layout)
}

#[cfg(test)]
pub(crate) fn plan_layout(plan: RenderPlanView<'_>) -> Result<EncodedPlanLayout, u32> {
    publication_layout(plan, &[])
}

/// Encodes a query result carrying only the header space and the semantic table. A
/// query publishes no render plan, so every plan table stays empty and the plan
/// validator never runs.
pub(crate) fn encode_query(
    semantic_views: &[SemanticRecord],
    output: &mut [u8],
) -> Result<EncodedPlanLayout, u32> {
    let mut cursor = ENGINE_RESULT_HEADER_SIZE;
    let semantic_span = add_table(
        &mut cursor,
        semantic_views.len(),
        SEMANTIC_RECORD_SIZE,
        SEMANTIC_RECORD_ALIGNMENT,
    )?;
    let layout = EncodedPlanLayout {
        byte_length: cursor,
        semantic_views: semantic_span,
        ..EncodedPlanLayout::default()
    };
    let byte_length = usize::try_from(layout.byte_length).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    let bytes = output
        .get_mut(..byte_length)
        .ok_or(STATUS_RESULT_TOO_LARGE)?;
    bytes.fill(0);
    write_records(
        bytes,
        layout.semantic_views,
        SEMANTIC_RECORD_SIZE,
        semantic_views,
        write_semantic,
    );
    Ok(layout)
}

pub(crate) fn publication_layout(
    plan: RenderPlanView<'_>,
    semantic_views: &[SemanticRecord],
) -> Result<EncodedPlanLayout, u32> {
    validate_plan(plan, semantic_views)?;
    let mut cursor = ENGINE_RESULT_HEADER_SIZE;
    let payload_offset = if plan.payload.is_empty() {
        0
    } else {
        cursor = align(cursor, PAYLOAD_ALIGNMENT)?;
        let offset = cursor;
        cursor = add_bytes(cursor, plan.payload.len(), 1)?;
        offset
    };
    let semantic_views = add_table(
        &mut cursor,
        semantic_views.len(),
        SEMANTIC_RECORD_SIZE,
        SEMANTIC_RECORD_ALIGNMENT,
    )?;
    let resources = add_table(
        &mut cursor,
        plan.resources.len(),
        RESOURCE_RECORD_SIZE,
        RESOURCE_RECORD_ALIGNMENT,
    )?;
    let buffers = add_table(
        &mut cursor,
        plan.buffers.len(),
        BUFFER_RECORD_SIZE,
        BUFFER_RECORD_ALIGNMENT,
    )?;
    let patches = add_table(
        &mut cursor,
        plan.patches.len(),
        PATCH_RECORD_SIZE,
        PATCH_RECORD_ALIGNMENT,
    )?;
    let primitives = add_table(
        &mut cursor,
        plan.primitives.len(),
        PRIMITIVE_RECORD_SIZE,
        PRIMITIVE_RECORD_ALIGNMENT,
    )?;
    let draws = add_table(
        &mut cursor,
        plan.draws.len(),
        DRAW_RECORD_SIZE,
        DRAW_RECORD_ALIGNMENT,
    )?;
    let retirements = add_table(
        &mut cursor,
        plan.retirements.len(),
        RETIREMENT_RECORD_SIZE,
        RETIREMENT_RECORD_ALIGNMENT,
    )?;
    let diagnostics = add_table(
        &mut cursor,
        plan.diagnostics.len(),
        DIAGNOSTIC_RECORD_SIZE,
        DIAGNOSTIC_RECORD_ALIGNMENT,
    )?;
    Ok(EncodedPlanLayout {
        byte_length: cursor,
        payload_offset,
        semantic_views,
        resources,
        buffers,
        patches,
        primitives,
        draws,
        retirements,
        diagnostics,
    })
}

fn validate_plan(plan: RenderPlanView<'_>, semantic_views: &[SemanticRecord]) -> Result<(), u32> {
    if plan.policy_handle == 0 {
        return Err(STATUS_INVALID_REQUEST);
    }
    for record in semantic_views {
        if record.id == 0
            || !matches!(
                record.kind,
                SEMANTIC_LINE
                    | SEMANTIC_FRAGMENT
                    | SEMANTIC_RUN
                    | SEMANTIC_CLUSTER
                    | SEMANTIC_CARET
                    | SEMANTIC_SELECTION
                    | SEMANTIC_INSERTED_GLYPH
                    | SEMANTIC_PARAGRAPH_MEASUREMENT
                    | SEMANTIC_GLYPH
            )
            || (!matches!(record.kind, SEMANTIC_PARAGRAPH_MEASUREMENT | SEMANTIC_GLYPH)
                && record.text_start > record.text_end)
            || !finite4(
                record.inline_start,
                record.block_start,
                record.inline_extent,
                record.block_extent,
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.resources {
        if record.id == 0
            || record.generation == 0
            || record.technique_id == 0
            || record.resource_kind == 0
            || !matches!(
                record.action,
                RESOURCE_ACTION_CREATE | RESOURCE_ACTION_UPDATE | RESOURCE_ACTION_RETAIN
            )
            || record.lower_bound > record.upper_bound
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.buffers {
        if record.id == 0
            || record.generation == 0
            || record.program_id == 0
            || record.policy_buffer_id == 0
            || !matches!(record.scalar_type, 1..=3)
            || !matches!(record.vector_width, 1..=4)
            || !matches!(record.strategy, 1..=2)
            || record.live_records > record.capacity_records
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.patches {
        if record.buffer_id == 0
            || record.buffer_generation == 0
            || !matches!(
                record.opcode,
                PATCH_ALLOCATE_OR_RESIZE | PATCH_WRITE | PATCH_FILL | PATCH_COPY | PATCH_RETIRE
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let has_payload = record.opcode == PATCH_WRITE;
        if has_payload {
            let start =
                usize::try_from(record.payload_start).map_err(|_| STATUS_INVALID_REQUEST)?;
            let length = usize::try_from(record.byte_length).map_err(|_| STATUS_INVALID_REQUEST)?;
            if start
                .checked_add(length)
                .filter(|end| *end <= plan.payload.len())
                .is_none()
            {
                return Err(STATUS_INVALID_REQUEST);
            }
        } else if record.payload_start != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        if record.opcode == PATCH_COPY && record.source_buffer_id == 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.primitives {
        if record.id == 0
            || !matches!(
                record.kind,
                PRIMITIVE_GLYPH
                    | PRIMITIVE_DECORATION
                    | PRIMITIVE_INLINE_OBJECT
                    | PRIMITIVE_CLIP
                    | PRIMITIVE_POLICY
            )
            || record.record_count == 0
            || !finite4(
                record.inline_start,
                record.block_start,
                record.inline_extent,
                record.block_extent,
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.draws {
        if record.id == 0
            || record.program_id == 0
            || !range_in(
                record.primitive_start,
                record.primitive_count,
                plan.primitives.len(),
            )
            || !range_in(record.buffer_start, record.buffer_count, plan.buffers.len())
            || !range_in(
                record.resource_start,
                record.resource_count,
                plan.resources.len(),
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    for record in plan.retirements {
        if record.id == 0
            || record.generation == 0
            || !matches!(
                record.kind,
                RETIRE_RESOURCE | RETIRE_BUFFER | RETIRE_SLOT_RANGE | RETIRE_OUTPUT_BYTES
            )
        {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(())
}

fn add_table(
    cursor: &mut u32,
    count: usize,
    stride: u32,
    alignment: u32,
) -> Result<TableSpan, u32> {
    if count == 0 {
        return Ok(TableSpan::default());
    }
    *cursor = align(*cursor, alignment)?;
    let offset = *cursor;
    *cursor = add_bytes(*cursor, count, stride)?;
    Ok(TableSpan {
        offset,
        count: u32::try_from(count).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    })
}

fn add_bytes(cursor: u32, count: usize, stride: u32) -> Result<u32, u32> {
    let count = u32::try_from(count).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    count
        .checked_mul(stride)
        .and_then(|length| cursor.checked_add(length))
        .ok_or(STATUS_RESULT_TOO_LARGE)
}

fn align(value: u32, alignment: u32) -> Result<u32, u32> {
    debug_assert!(alignment.is_power_of_two());
    value
        .checked_add(alignment - 1)
        .map(|aligned| aligned & !(alignment - 1))
        .ok_or(STATUS_RESULT_TOO_LARGE)
}

fn range_in(start: u32, count: u32, length: usize) -> bool {
    if count == 0 {
        return start == 0;
    }
    start
        .checked_add(count)
        .and_then(|end| usize::try_from(end).ok())
        .is_some_and(|end| end <= length)
}

fn finite4(first: f32, second: f32, third: f32, fourth: f32) -> bool {
    first.is_finite() && second.is_finite() && third.is_finite() && fourth.is_finite()
}

fn write_records<Record: Copy>(
    bytes: &mut [u8],
    span: TableSpan,
    stride: u32,
    records: &[Record],
    write: fn(&mut [u8], usize, Record),
) {
    let start = span.offset as usize;
    let stride = stride as usize;
    for (index, record) in records.iter().copied().enumerate() {
        write(bytes, start + index * stride, record);
    }
}

fn write_patch_records(
    bytes: &mut [u8],
    span: TableSpan,
    payload_offset: u32,
    records: &[PatchRecord],
) {
    let start = span.offset as usize;
    for (index, record) in records.iter().copied().enumerate() {
        write_patch(
            bytes,
            start + index * PATCH_RECORD_SIZE as usize,
            record,
            payload_offset,
        );
    }
}

fn write_semantic(bytes: &mut [u8], at: usize, value: SemanticRecord) {
    u32_at(bytes, at, SEMANTIC_ID, value.id);
    u16_at(bytes, at, SEMANTIC_KIND, value.kind);
    u16_at(bytes, at, SEMANTIC_FLAGS, value.flags);
    u32_at(bytes, at, SEMANTIC_PARENT_ID, value.parent_id);
    u32_at(bytes, at, SEMANTIC_TEXT_START, value.text_start);
    u32_at(bytes, at, SEMANTIC_TEXT_END, value.text_end);
    u32_at(bytes, at, SEMANTIC_ITEM_START, value.item_start);
    u32_at(bytes, at, SEMANTIC_ITEM_COUNT, value.item_count);
    f32_at(bytes, at, SEMANTIC_INLINE_START, value.inline_start);
    f32_at(bytes, at, SEMANTIC_BLOCK_START, value.block_start);
    f32_at(bytes, at, SEMANTIC_INLINE_EXTENT, value.inline_extent);
    f32_at(bytes, at, SEMANTIC_BLOCK_EXTENT, value.block_extent);
}

fn write_resource(bytes: &mut [u8], at: usize, value: ResourceRecord) {
    u32_at(bytes, at, RESOURCE_ID, value.id);
    u32_at(bytes, at, RESOURCE_GENERATION, value.generation);
    u32_at(bytes, at, RESOURCE_TECHNIQUE_ID, value.technique_id);
    u16_at(bytes, at, RESOURCE_KIND, value.resource_kind);
    u16_at(bytes, at, RESOURCE_ACTION, value.action);
    u32_at(bytes, at, RESOURCE_FLAGS, value.flags);
    u32_at(bytes, at, RESOURCE_REFERENCE_ID, value.reference_id);
    u32_at(bytes, at, RESOURCE_LOWER_BOUND, value.lower_bound);
    u32_at(bytes, at, RESOURCE_UPPER_BOUND, value.upper_bound);
    u32_at(bytes, at, RESOURCE_AUXILIARY0, value.auxiliary0);
    u32_at(bytes, at, RESOURCE_AUXILIARY1, value.auxiliary1);
}

fn write_buffer(bytes: &mut [u8], at: usize, value: BufferRecord) {
    u32_at(bytes, at, BUFFER_ID, value.id);
    u32_at(bytes, at, BUFFER_GENERATION, value.generation);
    u32_at(bytes, at, BUFFER_PROGRAM_ID, value.program_id);
    u16_at(bytes, at, BUFFER_POLICY_BUFFER_ID, value.policy_buffer_id);
    u8_at(bytes, at, BUFFER_SCALAR_TYPE, value.scalar_type);
    u8_at(bytes, at, BUFFER_VECTOR_WIDTH, value.vector_width);
    u16_at(bytes, at, BUFFER_STRATEGY, value.strategy);
    u16_at(bytes, at, BUFFER_FLAGS, value.flags);
    u32_at(bytes, at, BUFFER_LIVE_RECORDS, value.live_records);
    u32_at(bytes, at, BUFFER_CAPACITY_RECORDS, value.capacity_records);
    u32_at(bytes, at, BUFFER_BYTE_LENGTH, value.byte_length);
    u32_at(bytes, at, BUFFER_ORDER_BUFFER_ID, value.order_buffer_id);
}

fn write_patch(bytes: &mut [u8], at: usize, value: PatchRecord, payload_offset: u32) {
    u16_at(bytes, at, PATCH_OPCODE, value.opcode);
    u16_at(bytes, at, PATCH_FLAGS, value.flags);
    u32_at(bytes, at, PATCH_BUFFER_ID, value.buffer_id);
    u32_at(bytes, at, PATCH_BUFFER_GENERATION, value.buffer_generation);
    u32_at(
        bytes,
        at,
        PATCH_DESTINATION_OFFSET,
        value.destination_offset,
    );
    u32_at(bytes, at, PATCH_BYTE_LENGTH, value.byte_length);
    let rebased = if value.opcode == PATCH_WRITE {
        payload_offset + value.payload_start
    } else {
        0
    };
    u32_at(bytes, at, PATCH_PAYLOAD_OFFSET, rebased);
    u32_at(bytes, at, PATCH_SOURCE_BUFFER_ID, value.source_buffer_id);
    u32_at(bytes, at, PATCH_SOURCE_OFFSET, value.source_offset);
    u32_at(bytes, at, PATCH_FILL_VALUE, value.fill_value);
}

fn write_primitive(bytes: &mut [u8], at: usize, value: PrimitiveRecord) {
    u32_at(bytes, at, PRIMITIVE_ID, value.id);
    u16_at(bytes, at, PRIMITIVE_KIND, value.kind);
    u16_at(bytes, at, PRIMITIVE_FLAGS, value.flags);
    u32_at(bytes, at, PRIMITIVE_TECHNIQUE_ID, value.technique_id);
    u32_at(bytes, at, PRIMITIVE_RESOURCE_ID, value.resource_id);
    u32_at(
        bytes,
        at,
        PRIMITIVE_RESOURCE_GENERATION,
        value.resource_generation,
    );
    u32_at(bytes, at, PRIMITIVE_PROGRAM_ID, value.program_id);
    u16_at(bytes, at, PRIMITIVE_PROGRAM_VARIANT, value.program_variant);
    u16_at(bytes, at, PRIMITIVE_RECORD_COUNT, value.record_count);
    u32_at(bytes, at, PRIMITIVE_BUFFER_ID, value.buffer_id);
    u32_at(bytes, at, PRIMITIVE_RECORD_INDEX, value.record_index);
    u32_at(bytes, at, PRIMITIVE_LOGICAL_ORDER, value.logical_order);
    u32_at(bytes, at, PRIMITIVE_CLIP_ID, value.clip_id);
    u32_at(bytes, at, PRIMITIVE_SEMANTIC_ID, value.semantic_id);
    f32_at(bytes, at, PRIMITIVE_INLINE_START, value.inline_start);
    f32_at(bytes, at, PRIMITIVE_BLOCK_START, value.block_start);
    f32_at(bytes, at, PRIMITIVE_INLINE_EXTENT, value.inline_extent);
    f32_at(bytes, at, PRIMITIVE_BLOCK_EXTENT, value.block_extent);
}

fn write_draw(bytes: &mut [u8], at: usize, value: DrawRecord) {
    u32_at(bytes, at, DRAW_ID, value.id);
    u32_at(bytes, at, DRAW_PROGRAM_ID, value.program_id);
    u16_at(bytes, at, DRAW_PROGRAM_VARIANT, value.program_variant);
    u16_at(bytes, at, DRAW_FLAGS, value.flags);
    u32_at(bytes, at, DRAW_MATERIAL_ID, value.material_id);
    u32_at(bytes, at, DRAW_CLIP_ID, value.clip_id);
    u32_at(bytes, at, DRAW_DEPTH_KEY, value.depth_key);
    u32_at(bytes, at, DRAW_TRANSFORM_ID, value.transform_id);
    u32_at(bytes, at, DRAW_PRIMITIVE_START, value.primitive_start);
    u32_at(bytes, at, DRAW_PRIMITIVE_COUNT, value.primitive_count);
    u32_at(bytes, at, DRAW_BUFFER_START, value.buffer_start);
    u32_at(bytes, at, DRAW_BUFFER_COUNT, value.buffer_count);
    u32_at(bytes, at, DRAW_RESOURCE_START, value.resource_start);
    u32_at(bytes, at, DRAW_RESOURCE_COUNT, value.resource_count);
    u32_at(bytes, at, DRAW_ORDER_TOKEN, value.order_token);
    u32_at(bytes, at, DRAW_INDIRECT_BUFFER_ID, value.indirect_buffer_id);
    u32_at(bytes, at, DRAW_INDIRECT_OFFSET, value.indirect_offset);
}

fn write_retirement(bytes: &mut [u8], at: usize, value: RetirementRecord) {
    u16_at(bytes, at, RETIREMENT_KIND, value.kind);
    u16_at(bytes, at, RETIREMENT_FLAGS, value.flags);
    u32_at(bytes, at, RETIREMENT_ID, value.id);
    u32_at(bytes, at, RETIREMENT_GENERATION, value.generation);
    u32_at(
        bytes,
        at,
        RETIREMENT_AFTER_PUBLICATION_GENERATION,
        value.after_publication_generation,
    );
    u32_at(bytes, at, RETIREMENT_BYTE_OFFSET, value.byte_offset);
    u32_at(bytes, at, RETIREMENT_BYTE_LENGTH, value.byte_length);
}

fn write_diagnostic(bytes: &mut [u8], at: usize, value: DiagnosticRecord) {
    u16_at(bytes, at, DIAGNOSTIC_CODE, value.code);
    u8_at(bytes, at, DIAGNOSTIC_SEVERITY, value.severity);
    u8_at(bytes, at, DIAGNOSTIC_PHASE, value.phase);
    u32_at(bytes, at, DIAGNOSTIC_SUBJECT_ID, value.subject_id);
    u32_at(bytes, at, DIAGNOSTIC_VALUE0, value.value0);
    u32_at(bytes, at, DIAGNOSTIC_VALUE1, value.value1);
    u32_at(
        bytes,
        at,
        DIAGNOSTIC_DURATION_NANOS_LOW,
        value.duration_nanos_low,
    );
    u32_at(
        bytes,
        at,
        DIAGNOSTIC_DURATION_NANOS_HIGH,
        value.duration_nanos_high,
    );
}

fn u8_at(bytes: &mut [u8], record: usize, field: usize, value: u8) {
    bytes[record + field] = value;
}

fn u16_at(bytes: &mut [u8], record: usize, field: usize, value: u16) {
    bytes[record + field..record + field + 2].copy_from_slice(&value.to_le_bytes());
}

fn u32_at(bytes: &mut [u8], record: usize, field: usize, value: u32) {
    bytes[record + field..record + field + 4].copy_from_slice(&value.to_le_bytes());
}

fn f32_at(bytes: &mut [u8], record: usize, field: usize, value: f32) {
    u32_at(bytes, record, field, value.to_bits());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{engine::render_plan::*, wire::read_u32};
    use alloc::vec;

    #[test]
    fn serializes_every_table_with_compiler_offsets_and_rebased_payloads() {
        let semantic = [SemanticRecord {
            id: 1,
            kind: SEMANTIC_LINE,
            text_end: 4,
            item_count: 2,
            inline_start: 1.5,
            block_start: 2.5,
            inline_extent: 80.0,
            block_extent: 12.0,
            ..SemanticRecord::default()
        }];
        let resource = [ResourceRecord {
            id: 2,
            generation: 3,
            technique_id: 4,
            resource_kind: 1,
            action: RESOURCE_ACTION_CREATE,
            reference_id: 5,
            upper_bound: 9,
            ..ResourceRecord::default()
        }];
        let buffer = [BufferRecord {
            id: 6,
            generation: 7,
            program_id: 8,
            policy_buffer_id: 9,
            scalar_type: 1,
            vector_width: 4,
            strategy: BUFFER_ORDERED_DIRECT,
            live_records: 2,
            capacity_records: 4,
            byte_length: 64,
            ..BufferRecord::default()
        }];
        let patch = [PatchRecord {
            opcode: PATCH_WRITE,
            buffer_id: 6,
            buffer_generation: 7,
            destination_offset: 16,
            byte_length: 4,
            payload_start: 1,
            ..PatchRecord::default()
        }];
        let primitive = [PrimitiveRecord {
            id: 10,
            kind: PRIMITIVE_GLYPH,
            technique_id: 4,
            resource_id: 2,
            resource_generation: 3,
            program_id: 8,
            record_count: 1,
            buffer_id: 6,
            semantic_id: 1,
            inline_extent: 8.0,
            block_extent: 12.0,
            ..PrimitiveRecord::default()
        }];
        let draw = [DrawRecord {
            id: 11,
            program_id: 8,
            primitive_count: 1,
            buffer_count: 1,
            resource_count: 1,
            ..DrawRecord::default()
        }];
        let retirement = [RetirementRecord {
            kind: RETIRE_BUFFER,
            id: 12,
            generation: 2,
            after_publication_generation: 4,
            ..RetirementRecord::default()
        }];
        let diagnostic = [DiagnosticRecord {
            code: 13,
            severity: 2,
            phase: 3,
            value0: 14,
            ..DiagnosticRecord::default()
        }];
        let plan = RenderPlanView {
            policy_handle: 15,
            capability_set: 16,
            policy_fingerprint: 17,
            resources: &resource,
            buffers: &buffer,
            patches: &patch,
            primitives: &primitive,
            draws: &draw,
            retirements: &retirement,
            diagnostics: &diagnostic,
            payload: &[0xaa, 0xbb, 0xcc, 0xdd, 0xee],
        };
        let expected = publication_layout(plan, &semantic).unwrap();
        let mut bytes = vec![0x7f; expected.byte_length as usize + 16];
        let layout = encode_publication(plan, &semantic, &mut bytes).unwrap();
        assert_eq!(layout, expected);
        assert_eq!(layout.payload_offset % PAYLOAD_ALIGNMENT, 0);
        assert_eq!(
            read_u32(
                &bytes,
                layout.patches.offset as usize + PATCH_PAYLOAD_OFFSET
            )
            .unwrap(),
            layout.payload_offset + 1
        );
        assert_eq!(
            &bytes[layout.payload_offset as usize..layout.payload_offset as usize + 5],
            plan.payload
        );
        assert_eq!(
            read_u32(&bytes, layout.primitives.offset as usize + PRIMITIVE_ID).unwrap(),
            10
        );
        assert_eq!(bytes[layout.byte_length as usize..], [0x7f; 16]);
    }

    #[test]
    fn validation_fails_before_touching_destination_bytes() {
        let patch = [PatchRecord {
            opcode: PATCH_WRITE,
            buffer_id: 1,
            buffer_generation: 1,
            byte_length: 4,
            payload_start: 2,
            ..PatchRecord::default()
        }];
        let plan = RenderPlanView {
            policy_handle: 1,
            patches: &patch,
            payload: &[1, 2, 3],
            ..RenderPlanView::default()
        };
        let mut bytes = [0xa5; 512];
        assert_eq!(encode_plan(plan, &mut bytes), Err(STATUS_INVALID_REQUEST));
        assert_eq!(bytes, [0xa5; 512]);
    }
}
