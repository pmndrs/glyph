use alloc::string::{String, ToString};
use core::mem::{align_of, offset_of, size_of};
use serde_json::json;

use crate::engine::frame::{
    ALIGN_CENTER, ALIGN_END, ALIGN_JUSTIFY, ALIGN_START, AXIS_AT_MOST, AXIS_EXACT,
    AXIS_UNCONSTRAINED, BASELINE_ALPHABETIC, BASELINE_MIDDLE, BASELINE_TEXT_BOTTOM,
    BASELINE_TEXT_TOP, BLOCK_ALIGN_CENTER, BLOCK_ALIGN_END, BLOCK_ALIGN_START, DECORATION_DASHED,
    DECORATION_DOTTED, DECORATION_DOUBLE, DECORATION_FLAGS_MASK, DECORATION_LINE_THROUGH,
    DECORATION_NONE, DECORATION_OVERLINE, DECORATION_SKIP_INK, DECORATION_SOLID,
    DECORATION_UNDERLINE, DECORATION_WAVY, DEFAULT_PLANNER_TEXT_CAPACITY, EXCLUSION_WRAP_BOTH,
    EXCLUSION_WRAP_INLINE_END, EXCLUSION_WRAP_INLINE_START, EXCLUSION_WRAP_LARGEST, LAST_LINE_AUTO,
    LAST_LINE_JUSTIFY, ORIENTATION_MIXED, ORIENTATION_SIDEWAYS, ORIENTATION_UPRIGHT, OVERFLOW_CLIP,
    OVERFLOW_ELLIPSIS, OVERFLOW_VISIBLE, PARAGRAPH_MUTATION_REMOVE, PARAGRAPH_MUTATION_UPSERT,
    RESULT_FLAG_CHECKPOINT, SEMANTIC_F32_BLOCK_EXTENT, SEMANTIC_F32_BLOCK_ORIGIN,
    SEMANTIC_F32_BLOCK_START, SEMANTIC_F32_FONT_SIZE, SEMANTIC_F32_FOREGROUND_ALPHA,
    SEMANTIC_F32_FOREGROUND_BLUE, SEMANTIC_F32_FOREGROUND_GREEN, SEMANTIC_F32_FOREGROUND_RED,
    SEMANTIC_F32_INLINE_EXTENT, SEMANTIC_F32_INLINE_ORIGIN, SEMANTIC_F32_INLINE_START,
    SEMANTIC_F32_INVERSE_FONT_SIZE, SEMANTIC_F32_OUTLINE_ALPHA, SEMANTIC_F32_OUTLINE_BLUE,
    SEMANTIC_F32_OUTLINE_GREEN, SEMANTIC_F32_OUTLINE_RED, SEMANTIC_F32_OUTLINE_WIDTH,
    SEMANTIC_F32_RASTER_PIXEL_RATIO, SEMANTIC_F32_SHADOW_ALPHA, SEMANTIC_F32_SHADOW_BLUE,
    SEMANTIC_F32_SHADOW_GREEN, SEMANTIC_F32_SHADOW_OFFSET_X, SEMANTIC_F32_SHADOW_OFFSET_Y,
    SEMANTIC_F32_SHADOW_RED, SEMANTIC_U32_CLUSTER_ID, SEMANTIC_U32_FLOW_THREAD_ID,
    SEMANTIC_U32_FOREGROUND_RGBA, SEMANTIC_U32_REGION_ID, SEMANTIC_U32_STABLE_GLYPH_ID,
    SEMANTIC_U32_TRANSFORM_INDEX, SEMANTIC_VIEW_LAYOUT_INSPECTION, SEMANTIC_VIEW_MASK,
    SEMANTIC_VIEW_MEASUREMENT, SHAPE_POLYGON, SHAPE_RECTANGLE, STYLE_FIELD_BASELINE_SHIFT,
    STYLE_FIELD_DECORATION, STYLE_FIELD_DIRECTION, STYLE_FIELD_FEATURES, STYLE_FIELD_FONT_SIZE,
    STYLE_FIELD_FONT_STACK, STYLE_FIELD_FOREGROUND, STYLE_FIELD_LANGUAGE,
    STYLE_FIELD_LETTER_SPACING, STYLE_FIELD_LINE_HEIGHT, STYLE_FIELD_MASK, STYLE_FIELD_MATERIAL,
    STYLE_FIELD_OPACITY, STYLE_FIELD_OUTLINE, STYLE_FIELD_RASTER_PIXEL_RATIO, STYLE_FIELD_SHADOW,
    STYLE_FIELD_WORD_SPACING, STYLE_FLAG_ROOT, STYLE_MUTATION_REMOVE, STYLE_MUTATION_UPSERT,
    TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16, WRAP_CHARACTER, WRAP_NONE, WRAP_WORD,
    WRITING_HORIZONTAL_TB, WRITING_VERTICAL_LR, WRITING_VERTICAL_RL,
};
use crate::engine::policy::{
    ALLOCATION_ORDERED_DIRECT, ALLOCATION_STABLE_INDIRECT, BATCH_CLIP, BATCH_DEPTH, BATCH_MATERIAL,
    BATCH_ORDER, BATCH_PROGRAM, BATCH_RESOURCE, BATCH_TECHNIQUE, BATCH_TRANSFORM,
    BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BUFFER_USAGE_VERTEX, CAP_ALIAS_VEC2,
    CAP_ALIAS_VEC4, CAP_INDIRECT_DRAWS, CAP_ORDERED_DIRECT, CAP_STABLE_INDIRECT,
    CAP_STORAGE_BUFFERS, INPUT_GLYPH, INPUT_RESOURCE, INPUT_SEMANTIC, INPUT_STRIKE, OP_ADD_F32,
    OP_CONSTANT_F32, OP_CONSTANT_U32, OP_CONVERT_U32_TO_F32, OP_LESS_THAN_F32, OP_LOAD_F32,
    OP_LOAD_U32, OP_MULTIPLY_F32, OP_SELECT_F32, OP_STORE_F32, OP_STORE_U16, OP_STORE_U32,
    OP_SUBTRACT_F32, ScalarType,
};
use crate::engine::render_plan::{
    BUFFER_ORDERED_DIRECT, BUFFER_STABLE_INDIRECT, BufferRecord, DiagnosticRecord, DrawRecord,
    PATCH_ALLOCATE_OR_RESIZE, PATCH_COPY, PATCH_FILL, PATCH_RETIRE, PATCH_WRITE,
    POLICY_BUFFER_ORDER, PRIMITIVE_CLIP, PRIMITIVE_DECORATION, PRIMITIVE_GLYPH,
    PRIMITIVE_INLINE_OBJECT, PRIMITIVE_POLICY, PatchRecord, PrimitiveRecord,
    RESOURCE_ACTION_CREATE, RESOURCE_ACTION_RETAIN, RESOURCE_ACTION_UPDATE, RETIRE_BUFFER,
    RETIRE_OUTPUT_BYTES, RETIRE_RESOURCE, RETIRE_SLOT_RANGE, ResourceRecord, RetirementRecord,
};
use crate::engine::semantic_view::{
    SEMANTIC_CARET, SEMANTIC_CLUSTER, SEMANTIC_FRAGMENT, SEMANTIC_GLYPH, SEMANTIC_INSERTED_GLYPH,
    SEMANTIC_LINE, SEMANTIC_PARAGRAPH_MEASUREMENT, SEMANTIC_RUN, SEMANTIC_SELECTION,
    SemanticRecord,
};

pub const ABI_VERSION: u32 = 0;
pub const SHAPER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const UNICODE_VERSION: &str = "17.0.0";

#[repr(C)]
struct PolicyRequestHeader {
    byte_length: u32,
    capability_sets_offset: u32,
    capability_set_count: u32,
    programs_offset: u32,
    program_count: u32,
    buffers_offset: u32,
    buffer_count: u32,
    operations_offset: u32,
    operation_count: u32,
    inputs_offset: u32,
    input_count: u32,
}

#[repr(C)]
struct PolicyCapabilitySetRecord {
    id: u32,
    flags: u32,
    max_buffer_bytes: u32,
    update_alignment: u32,
    coalesce_gap_bytes: u32,
    range_call_penalty_bytes: u32,
    max_buffers_per_draw: u16,
    max_resources_per_draw: u16,
    max_indirect_draws: u16,
    fragmentation_budget: u16,
    whole_buffer_threshold_basis_points: u16,
    reserved: [u16; 3],
}

#[repr(C)]
struct PolicyProgramRecord {
    technique_id: u32,
    program_id: u32,
    capability_set_id: u32,
    resource_kind_mask: u32,
    semantic_view_mask: u32,
    storage_key_mask: u32,
    paint_capabilities: u32,
    compositing_capabilities: u32,
    buffer_start: u32,
    operation_start: u32,
    variant: u16,
    buffer_count: u16,
    operation_count: u16,
    allocation_strategy: u16,
    f32_input_count: u8,
    u32_input_count: u8,
    primitive_kind: u16,
    draw_key_mask: u32,
    input_start: u32,
    input_count: u16,
    reserved1: u16,
}

#[repr(C)]
struct PolicyInputRecord {
    scope: u8,
    field: u8,
    reserved: u16,
}

#[repr(C)]
struct FontBindingRequestHeader {
    abi_version: u32,
    byte_length: u32,
    technique_id: u32,
    program_variant: u16,
    reserved0: u16,
    glyph_count: u32,
    strike_count: u32,
    resource_count: u32,
    glyph_f32_field_count: u8,
    glyph_u32_field_count: u8,
    strike_f32_field_count: u8,
    strike_u32_field_count: u8,
    resource_f32_field_count: u8,
    resource_u32_field_count: u8,
    reserved1: u16,
    strikes_offset: u32,
    resources_offset: u32,
    resource_indices_offset: u32,
    glyph_f32_offset: u32,
    glyph_u32_offset: u32,
    strike_f32_offset: u32,
    strike_u32_offset: u32,
    resource_f32_offset: u32,
    resource_u32_offset: u32,
    reserved2: u32,
}

#[repr(C)]
struct FontBindingStrikeRecord {
    ppem: u32,
    reserved: u32,
}

#[repr(C)]
struct FontBindingResourceRecord {
    id: u32,
    generation: u32,
    kind: u16,
    reserved: u16,
    reference: u32,
}

#[repr(C)]
struct PolicyBufferRecord {
    id: u16,
    scalar: u8,
    vector_width: u8,
    alignment: u16,
    stride: u16,
    usage: u32,
    capacity_class: u16,
    reserved0: u16,
}

#[repr(C)]
struct PolicyOperationRecord {
    opcode: u8,
    target: u8,
    operand0: u8,
    operand1: u8,
    immediate0: u32,
    immediate1: u32,
    immediate2: u32,
}

#[repr(C)]
struct EngineUpdateRequestHeader {
    abi_version: u32,
    byte_length: u32,
    planner_id: u32,
    expected_engine_revision: u32,
    consumed_plan_revision: u32,
    acknowledged_publication_generation: u32,
    policy_handle: u32,
    capability_set: u32,
    flags: u32,
    semantic_view_mask: u32,
    max_clusters: u32,
    max_lines: u32,
    max_regions: u32,
    max_exclusions: u32,
    max_inline_objects: u32,
    max_slots_per_band: u32,
    max_output_bytes: u32,
    text_mutations_offset: u32,
    text_mutation_count: u32,
    style_mutations_offset: u32,
    style_mutation_count: u32,
    constraints_offset: u32,
    constraint_count: u32,
    regions_offset: u32,
    region_count: u32,
    exclusions_offset: u32,
    exclusion_count: u32,
    inline_objects_offset: u32,
    inline_object_count: u32,
    policy_parameters_offset: u32,
    policy_parameters_length: u32,
    max_paragraphs: u32,
    paragraph_mutations_offset: u32,
    paragraph_mutation_count: u32,
}

#[repr(C)]
struct EngineParagraphMutationRecord {
    opcode: u8,
    flags: u8,
    reserved0: u16,
    paragraph_id: u32,
    order: u32,
}

#[repr(C)]
struct EngineTextMutationRecord {
    opcode: u8,
    encoding: u8,
    reserved0: u16,
    text_start: u32,
    delete_count: u32,
    insert_offset: u32,
    insert_count: u32,
    paragraph_id: u32,
}

#[repr(C)]
struct EngineStyleMutationRecord {
    opcode: u8,
    direction: u8,
    decoration_style: u8,
    flags: u8,
    style_id: u32,
    cascade_order: u32,
    field_mask: u32,
    text_start: u32,
    text_end: u32,
    font_stack_handle: u32,
    material_id: u32,
    language_offset: u32,
    language_length: u16,
    feature_count: u16,
    features_offset: u32,
    font_size: f32,
    line_height: f32,
    letter_spacing: f32,
    word_spacing: f32,
    baseline_shift: f32,
    raster_pixel_ratio: f32,
    foreground_rgba: u32,
    decoration_rgba: u32,
    decoration_flags: u32,
    decoration_thickness: f32,
    decoration_offset: f32,
    opacity: f32,
    outline_rgba: u32,
    outline_width: f32,
    shadow_rgba: u32,
    shadow_offset_x: f32,
    shadow_offset_y: f32,
    paragraph_id: u32,
}

#[repr(C)]
struct EngineConstraintRecord {
    flow_thread_id: u32,
    geometry_revision: u32,
    width: f32,
    height: f32,
    viewport_block_start: f32,
    viewport_block_end: f32,
    resume_block_offset: f32,
    max_lines: u32,
    region_start: u32,
    resume_cluster: u32,
    region_count: u16,
    resume_region: u16,
    width_mode: u8,
    height_mode: u8,
    wrap: u8,
    align: u8,
    overflow: u8,
    block_align: u8,
    flags: u16,
    paragraph_id: u32,
    first_line_indent: f32,
    space_before: f32,
    space_after: f32,
    justify_min_word_space_ratio: f32,
    justify_max_word_space_ratio: f32,
    justify_letter_space_expansion: f32,
    last_line: u8,
    reserved0: u8,
    reserved1: u16,
}

#[repr(C)]
struct EngineFlowVertexRecord {
    inline: f32,
    block: f32,
}

#[repr(C)]
struct EngineRegionRecord {
    id: u32,
    geometry_revision: u32,
    transform_index: u32,
    vertices_offset: u32,
    vertex_count: u16,
    exclusion_start: u16,
    exclusion_count: u16,
    flags: u16,
    shape: u8,
    writing_mode: u8,
    text_orientation: u8,
    reserved0: u8,
    inline_start: f32,
    block_start: f32,
    inline_end: f32,
    block_end: f32,
    clip_inline_start: f32,
    clip_block_start: f32,
    clip_inline_end: f32,
    clip_block_end: f32,
}

#[repr(C)]
struct EngineExclusionRecord {
    id: u32,
    region_id: u32,
    geometry_revision: u32,
    vertices_offset: u32,
    vertex_count: u16,
    flags: u16,
    shape: u8,
    wrap_side: u8,
    reserved0: u16,
    inline_start: f32,
    block_start: f32,
    inline_end: f32,
    block_end: f32,
    margin_inline: f32,
    margin_block: f32,
}

#[repr(C)]
struct EngineInlineObjectRecord {
    id: u32,
    content_revision: u32,
    text_offset: u32,
    material_id: u32,
    resource_id: u32,
    resource_generation: u32,
    inline_extent: f32,
    block_extent: f32,
    baseline_offset: f32,
    margin_inline_start: f32,
    margin_inline_end: f32,
    margin_block_start: f32,
    margin_block_end: f32,
    baseline_alignment: u8,
    flags: u8,
    reserved0: u16,
    paragraph_id: u32,
}

#[repr(C, align(16))]
struct EngineResultHeader {
    abi_version: u32,
    byte_length: u32,
    status: u32,
    flags: u32,
    planner_id: u32,
    engine_revision: u32,
    plan_revision: u32,
    required_base_revision: u32,
    publication_generation: u32,
    output_slot: u32,
    request_capacity: u32,
    required_request_capacity: u32,
    result_capacity: u32,
    required_result_capacity: u32,
    policy_handle: u32,
    capability_set: u32,
    policy_fingerprint_low: u32,
    policy_fingerprint_high: u32,
    semantic_views_offset: u32,
    semantic_view_count: u32,
    resources_offset: u32,
    resource_count: u32,
    buffers_offset: u32,
    buffer_count: u32,
    patches_offset: u32,
    patch_count: u32,
    primitives_offset: u32,
    primitive_count: u32,
    draws_offset: u32,
    draw_count: u32,
    retirements_offset: u32,
    retirement_count: u32,
    diagnostics_offset: u32,
    diagnostic_count: u32,
    /// Paragraph a rejection is attributed to, or zero when the status names none. Occupies the
    /// tail padding this 16-byte-aligned header already carried, so the header size is unchanged.
    fault_paragraph_id: u32,
    /// Style the rejection is attributed to, under the request's own `styleId`, or zero.
    fault_style_id: u32,
}

#[repr(C)]
struct FeatureRecord {
    tag: u32,
    value: u32,
    start: u32,
    end: u32,
}

macro_rules! layout {
    ($size:ident, $alignment:ident, $type:ty) => {
        pub const $size: u32 = size_of::<$type>() as u32;
        pub const $alignment: u32 = align_of::<$type>() as u32;
    };
}

layout!(
    POLICY_REQUEST_HEADER_SIZE,
    POLICY_REQUEST_HEADER_ALIGNMENT,
    PolicyRequestHeader
);
layout!(
    POLICY_CAPABILITY_SET_RECORD_SIZE,
    POLICY_CAPABILITY_SET_RECORD_ALIGNMENT,
    PolicyCapabilitySetRecord
);
layout!(
    POLICY_PROGRAM_RECORD_SIZE,
    POLICY_PROGRAM_RECORD_ALIGNMENT,
    PolicyProgramRecord
);
layout!(
    POLICY_BUFFER_RECORD_SIZE,
    POLICY_BUFFER_RECORD_ALIGNMENT,
    PolicyBufferRecord
);
layout!(
    POLICY_OPERATION_RECORD_SIZE,
    POLICY_OPERATION_RECORD_ALIGNMENT,
    PolicyOperationRecord
);
layout!(
    POLICY_INPUT_RECORD_SIZE,
    POLICY_INPUT_RECORD_ALIGNMENT,
    PolicyInputRecord
);
layout!(
    FONT_BINDING_REQUEST_HEADER_SIZE,
    FONT_BINDING_REQUEST_HEADER_ALIGNMENT,
    FontBindingRequestHeader
);
layout!(
    FONT_BINDING_STRIKE_RECORD_SIZE,
    FONT_BINDING_STRIKE_RECORD_ALIGNMENT,
    FontBindingStrikeRecord
);
layout!(
    FONT_BINDING_RESOURCE_RECORD_SIZE,
    FONT_BINDING_RESOURCE_RECORD_ALIGNMENT,
    FontBindingResourceRecord
);
layout!(
    ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    ENGINE_UPDATE_REQUEST_HEADER_ALIGNMENT,
    EngineUpdateRequestHeader
);
layout!(
    ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE,
    ENGINE_PARAGRAPH_MUTATION_RECORD_ALIGNMENT,
    EngineParagraphMutationRecord
);
layout!(
    ENGINE_TEXT_MUTATION_RECORD_SIZE,
    ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
    EngineTextMutationRecord
);
layout!(
    ENGINE_STYLE_MUTATION_RECORD_SIZE,
    ENGINE_STYLE_MUTATION_RECORD_ALIGNMENT,
    EngineStyleMutationRecord
);
layout!(
    ENGINE_CONSTRAINT_RECORD_SIZE,
    ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
    EngineConstraintRecord
);
layout!(
    ENGINE_FLOW_VERTEX_RECORD_SIZE,
    ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
    EngineFlowVertexRecord
);
layout!(
    ENGINE_REGION_RECORD_SIZE,
    ENGINE_REGION_RECORD_ALIGNMENT,
    EngineRegionRecord
);
layout!(
    ENGINE_EXCLUSION_RECORD_SIZE,
    ENGINE_EXCLUSION_RECORD_ALIGNMENT,
    EngineExclusionRecord
);
layout!(
    ENGINE_INLINE_OBJECT_RECORD_SIZE,
    ENGINE_INLINE_OBJECT_RECORD_ALIGNMENT,
    EngineInlineObjectRecord
);
layout!(
    ENGINE_RESULT_HEADER_SIZE,
    ENGINE_RESULT_HEADER_ALIGNMENT,
    EngineResultHeader
);
layout!(
    SEMANTIC_RECORD_SIZE,
    SEMANTIC_RECORD_ALIGNMENT,
    SemanticRecord
);
layout!(
    RESOURCE_RECORD_SIZE,
    RESOURCE_RECORD_ALIGNMENT,
    ResourceRecord
);
layout!(BUFFER_RECORD_SIZE, BUFFER_RECORD_ALIGNMENT, BufferRecord);
layout!(PATCH_RECORD_SIZE, PATCH_RECORD_ALIGNMENT, PatchRecord);
layout!(
    PRIMITIVE_RECORD_SIZE,
    PRIMITIVE_RECORD_ALIGNMENT,
    PrimitiveRecord
);
layout!(DRAW_RECORD_SIZE, DRAW_RECORD_ALIGNMENT, DrawRecord);
layout!(
    RETIREMENT_RECORD_SIZE,
    RETIREMENT_RECORD_ALIGNMENT,
    RetirementRecord
);
layout!(
    DIAGNOSTIC_RECORD_SIZE,
    DIAGNOSTIC_RECORD_ALIGNMENT,
    DiagnosticRecord
);
layout!(FEATURE_RECORD_SIZE, FEATURE_RECORD_ALIGNMENT, FeatureRecord);

macro_rules! field_offset {
    ($name:ident, $type:ty, $field:ident) => {
        pub const $name: usize = offset_of!($type, $field);
    };
}

field_offset!(POLICY_BYTE_LENGTH, PolicyRequestHeader, byte_length);
field_offset!(
    POLICY_CAPABILITY_SETS_OFFSET,
    PolicyRequestHeader,
    capability_sets_offset
);
field_offset!(
    POLICY_CAPABILITY_SET_COUNT,
    PolicyRequestHeader,
    capability_set_count
);
field_offset!(POLICY_PROGRAMS_OFFSET, PolicyRequestHeader, programs_offset);
field_offset!(POLICY_PROGRAM_COUNT, PolicyRequestHeader, program_count);
field_offset!(POLICY_BUFFERS_OFFSET, PolicyRequestHeader, buffers_offset);
field_offset!(POLICY_BUFFER_COUNT, PolicyRequestHeader, buffer_count);
field_offset!(
    POLICY_OPERATIONS_OFFSET,
    PolicyRequestHeader,
    operations_offset
);
field_offset!(POLICY_OPERATION_COUNT, PolicyRequestHeader, operation_count);
field_offset!(POLICY_INPUTS_OFFSET, PolicyRequestHeader, inputs_offset);
field_offset!(POLICY_INPUT_COUNT, PolicyRequestHeader, input_count);
field_offset!(POLICY_CAPABILITY_SET_ID, PolicyCapabilitySetRecord, id);
field_offset!(
    POLICY_CAPABILITY_SET_FLAGS,
    PolicyCapabilitySetRecord,
    flags
);
field_offset!(
    POLICY_CAPABILITY_SET_MAX_BUFFER_BYTES,
    PolicyCapabilitySetRecord,
    max_buffer_bytes
);
field_offset!(
    POLICY_CAPABILITY_SET_UPDATE_ALIGNMENT,
    PolicyCapabilitySetRecord,
    update_alignment
);
field_offset!(
    POLICY_CAPABILITY_SET_COALESCE_GAP_BYTES,
    PolicyCapabilitySetRecord,
    coalesce_gap_bytes
);
field_offset!(
    POLICY_CAPABILITY_SET_RANGE_CALL_PENALTY_BYTES,
    PolicyCapabilitySetRecord,
    range_call_penalty_bytes
);
field_offset!(
    POLICY_CAPABILITY_SET_MAX_BUFFERS_PER_DRAW,
    PolicyCapabilitySetRecord,
    max_buffers_per_draw
);
field_offset!(
    POLICY_CAPABILITY_SET_MAX_RESOURCES_PER_DRAW,
    PolicyCapabilitySetRecord,
    max_resources_per_draw
);
field_offset!(
    POLICY_CAPABILITY_SET_MAX_INDIRECT_DRAWS,
    PolicyCapabilitySetRecord,
    max_indirect_draws
);
field_offset!(
    POLICY_CAPABILITY_SET_FRAGMENTATION_BUDGET,
    PolicyCapabilitySetRecord,
    fragmentation_budget
);
field_offset!(
    POLICY_CAPABILITY_SET_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS,
    PolicyCapabilitySetRecord,
    whole_buffer_threshold_basis_points
);
field_offset!(
    POLICY_CAPABILITY_SET_RESERVED,
    PolicyCapabilitySetRecord,
    reserved
);
field_offset!(
    POLICY_PROGRAM_TECHNIQUE_ID,
    PolicyProgramRecord,
    technique_id
);
field_offset!(POLICY_PROGRAM_ID, PolicyProgramRecord, program_id);
field_offset!(
    POLICY_PROGRAM_CAPABILITY_SET_ID,
    PolicyProgramRecord,
    capability_set_id
);
field_offset!(
    POLICY_PROGRAM_RESOURCE_KIND_MASK,
    PolicyProgramRecord,
    resource_kind_mask
);
field_offset!(
    POLICY_PROGRAM_SEMANTIC_VIEW_MASK,
    PolicyProgramRecord,
    semantic_view_mask
);
field_offset!(
    POLICY_PROGRAM_STORAGE_KEY_MASK,
    PolicyProgramRecord,
    storage_key_mask
);
field_offset!(POLICY_PROGRAM_VARIANT, PolicyProgramRecord, variant);
field_offset!(
    POLICY_PROGRAM_F32_INPUT_COUNT,
    PolicyProgramRecord,
    f32_input_count
);
field_offset!(
    POLICY_PROGRAM_U32_INPUT_COUNT,
    PolicyProgramRecord,
    u32_input_count
);
field_offset!(
    POLICY_PROGRAM_PAINT_CAPABILITIES,
    PolicyProgramRecord,
    paint_capabilities
);
field_offset!(
    POLICY_PROGRAM_COMPOSITING_CAPABILITIES,
    PolicyProgramRecord,
    compositing_capabilities
);
field_offset!(
    POLICY_PROGRAM_BUFFER_START,
    PolicyProgramRecord,
    buffer_start
);
field_offset!(
    POLICY_PROGRAM_BUFFER_COUNT,
    PolicyProgramRecord,
    buffer_count
);
field_offset!(
    POLICY_PROGRAM_PRIMITIVE_KIND,
    PolicyProgramRecord,
    primitive_kind
);
field_offset!(
    POLICY_PROGRAM_OPERATION_START,
    PolicyProgramRecord,
    operation_start
);
field_offset!(
    POLICY_PROGRAM_OPERATION_COUNT,
    PolicyProgramRecord,
    operation_count
);
field_offset!(
    POLICY_PROGRAM_ALLOCATION_STRATEGY,
    PolicyProgramRecord,
    allocation_strategy
);
field_offset!(
    POLICY_PROGRAM_DRAW_KEY_MASK,
    PolicyProgramRecord,
    draw_key_mask
);
field_offset!(POLICY_PROGRAM_INPUT_START, PolicyProgramRecord, input_start);
field_offset!(POLICY_PROGRAM_INPUT_COUNT, PolicyProgramRecord, input_count);
field_offset!(POLICY_PROGRAM_RESERVED1, PolicyProgramRecord, reserved1);
field_offset!(POLICY_BUFFER_ID, PolicyBufferRecord, id);
field_offset!(POLICY_BUFFER_SCALAR, PolicyBufferRecord, scalar);
field_offset!(POLICY_BUFFER_VECTOR_WIDTH, PolicyBufferRecord, vector_width);
field_offset!(POLICY_BUFFER_ALIGNMENT, PolicyBufferRecord, alignment);
field_offset!(POLICY_BUFFER_STRIDE, PolicyBufferRecord, stride);
field_offset!(POLICY_BUFFER_USAGE, PolicyBufferRecord, usage);
field_offset!(
    POLICY_BUFFER_CAPACITY_CLASS,
    PolicyBufferRecord,
    capacity_class
);
field_offset!(POLICY_BUFFER_RESERVED0, PolicyBufferRecord, reserved0);
field_offset!(POLICY_OPERATION_OPCODE, PolicyOperationRecord, opcode);
field_offset!(POLICY_OPERATION_TARGET, PolicyOperationRecord, target);
field_offset!(POLICY_INPUT_SCOPE, PolicyInputRecord, scope);
field_offset!(POLICY_INPUT_FIELD, PolicyInputRecord, field);
field_offset!(POLICY_INPUT_RESERVED, PolicyInputRecord, reserved);
field_offset!(
    FONT_BINDING_ABI_VERSION,
    FontBindingRequestHeader,
    abi_version
);
field_offset!(
    FONT_BINDING_BYTE_LENGTH,
    FontBindingRequestHeader,
    byte_length
);
field_offset!(
    FONT_BINDING_TECHNIQUE_ID,
    FontBindingRequestHeader,
    technique_id
);
field_offset!(
    FONT_BINDING_PROGRAM_VARIANT,
    FontBindingRequestHeader,
    program_variant
);
field_offset!(FONT_BINDING_RESERVED0, FontBindingRequestHeader, reserved0);
field_offset!(
    FONT_BINDING_GLYPH_COUNT,
    FontBindingRequestHeader,
    glyph_count
);
field_offset!(
    FONT_BINDING_STRIKE_COUNT,
    FontBindingRequestHeader,
    strike_count
);
field_offset!(
    FONT_BINDING_RESOURCE_COUNT,
    FontBindingRequestHeader,
    resource_count
);
field_offset!(
    FONT_BINDING_GLYPH_F32_FIELD_COUNT,
    FontBindingRequestHeader,
    glyph_f32_field_count
);
field_offset!(
    FONT_BINDING_GLYPH_U32_FIELD_COUNT,
    FontBindingRequestHeader,
    glyph_u32_field_count
);
field_offset!(
    FONT_BINDING_STRIKE_F32_FIELD_COUNT,
    FontBindingRequestHeader,
    strike_f32_field_count
);
field_offset!(
    FONT_BINDING_STRIKE_U32_FIELD_COUNT,
    FontBindingRequestHeader,
    strike_u32_field_count
);
field_offset!(
    FONT_BINDING_RESOURCE_F32_FIELD_COUNT,
    FontBindingRequestHeader,
    resource_f32_field_count
);
field_offset!(
    FONT_BINDING_RESOURCE_U32_FIELD_COUNT,
    FontBindingRequestHeader,
    resource_u32_field_count
);
field_offset!(FONT_BINDING_RESERVED1, FontBindingRequestHeader, reserved1);
field_offset!(
    FONT_BINDING_STRIKES_OFFSET,
    FontBindingRequestHeader,
    strikes_offset
);
field_offset!(
    FONT_BINDING_RESOURCES_OFFSET,
    FontBindingRequestHeader,
    resources_offset
);
field_offset!(
    FONT_BINDING_RESOURCE_INDICES_OFFSET,
    FontBindingRequestHeader,
    resource_indices_offset
);
field_offset!(
    FONT_BINDING_GLYPH_F32_OFFSET,
    FontBindingRequestHeader,
    glyph_f32_offset
);
field_offset!(
    FONT_BINDING_GLYPH_U32_OFFSET,
    FontBindingRequestHeader,
    glyph_u32_offset
);
field_offset!(
    FONT_BINDING_STRIKE_F32_OFFSET,
    FontBindingRequestHeader,
    strike_f32_offset
);
field_offset!(
    FONT_BINDING_STRIKE_U32_OFFSET,
    FontBindingRequestHeader,
    strike_u32_offset
);
field_offset!(
    FONT_BINDING_RESOURCE_F32_OFFSET,
    FontBindingRequestHeader,
    resource_f32_offset
);
field_offset!(
    FONT_BINDING_RESOURCE_U32_OFFSET,
    FontBindingRequestHeader,
    resource_u32_offset
);
field_offset!(FONT_BINDING_RESERVED2, FontBindingRequestHeader, reserved2);
field_offset!(FONT_BINDING_STRIKE_PPEM, FontBindingStrikeRecord, ppem);
field_offset!(
    FONT_BINDING_STRIKE_RESERVED,
    FontBindingStrikeRecord,
    reserved
);
field_offset!(FONT_BINDING_RESOURCE_ID, FontBindingResourceRecord, id);
field_offset!(
    FONT_BINDING_RESOURCE_GENERATION,
    FontBindingResourceRecord,
    generation
);
field_offset!(FONT_BINDING_RESOURCE_KIND, FontBindingResourceRecord, kind);
field_offset!(
    FONT_BINDING_RESOURCE_RESERVED,
    FontBindingResourceRecord,
    reserved
);
field_offset!(
    FONT_BINDING_RESOURCE_REFERENCE,
    FontBindingResourceRecord,
    reference
);
field_offset!(POLICY_OPERATION_OPERAND0, PolicyOperationRecord, operand0);
field_offset!(POLICY_OPERATION_OPERAND1, PolicyOperationRecord, operand1);
field_offset!(
    POLICY_OPERATION_IMMEDIATE0,
    PolicyOperationRecord,
    immediate0
);
field_offset!(
    POLICY_OPERATION_IMMEDIATE1,
    PolicyOperationRecord,
    immediate1
);
field_offset!(
    POLICY_OPERATION_IMMEDIATE2,
    PolicyOperationRecord,
    immediate2
);
field_offset!(
    ENGINE_UPDATE_ABI_VERSION,
    EngineUpdateRequestHeader,
    abi_version
);
field_offset!(
    ENGINE_UPDATE_BYTE_LENGTH,
    EngineUpdateRequestHeader,
    byte_length
);
field_offset!(
    ENGINE_UPDATE_PLANNER_ID,
    EngineUpdateRequestHeader,
    planner_id
);
field_offset!(
    ENGINE_UPDATE_EXPECTED_ENGINE_REVISION,
    EngineUpdateRequestHeader,
    expected_engine_revision
);
field_offset!(
    ENGINE_UPDATE_CONSUMED_PLAN_REVISION,
    EngineUpdateRequestHeader,
    consumed_plan_revision
);
field_offset!(
    ENGINE_UPDATE_ACKNOWLEDGED_PUBLICATION_GENERATION,
    EngineUpdateRequestHeader,
    acknowledged_publication_generation
);
field_offset!(
    ENGINE_UPDATE_POLICY_HANDLE,
    EngineUpdateRequestHeader,
    policy_handle
);
field_offset!(
    ENGINE_UPDATE_CAPABILITY_SET,
    EngineUpdateRequestHeader,
    capability_set
);
field_offset!(ENGINE_UPDATE_FLAGS, EngineUpdateRequestHeader, flags);
field_offset!(
    ENGINE_UPDATE_SEMANTIC_VIEW_MASK,
    EngineUpdateRequestHeader,
    semantic_view_mask
);
field_offset!(
    ENGINE_UPDATE_MAX_CLUSTERS,
    EngineUpdateRequestHeader,
    max_clusters
);
field_offset!(
    ENGINE_UPDATE_MAX_LINES,
    EngineUpdateRequestHeader,
    max_lines
);
field_offset!(
    ENGINE_UPDATE_MAX_REGIONS,
    EngineUpdateRequestHeader,
    max_regions
);
field_offset!(
    ENGINE_UPDATE_MAX_EXCLUSIONS,
    EngineUpdateRequestHeader,
    max_exclusions
);
field_offset!(
    ENGINE_UPDATE_MAX_INLINE_OBJECTS,
    EngineUpdateRequestHeader,
    max_inline_objects
);
field_offset!(
    ENGINE_UPDATE_MAX_SLOTS_PER_BAND,
    EngineUpdateRequestHeader,
    max_slots_per_band
);
field_offset!(
    ENGINE_UPDATE_MAX_OUTPUT_BYTES,
    EngineUpdateRequestHeader,
    max_output_bytes
);
field_offset!(
    ENGINE_UPDATE_TEXT_MUTATIONS_OFFSET,
    EngineUpdateRequestHeader,
    text_mutations_offset
);
field_offset!(
    ENGINE_UPDATE_TEXT_MUTATION_COUNT,
    EngineUpdateRequestHeader,
    text_mutation_count
);
field_offset!(
    ENGINE_UPDATE_STYLE_MUTATIONS_OFFSET,
    EngineUpdateRequestHeader,
    style_mutations_offset
);
field_offset!(
    ENGINE_UPDATE_STYLE_MUTATION_COUNT,
    EngineUpdateRequestHeader,
    style_mutation_count
);
field_offset!(
    ENGINE_UPDATE_CONSTRAINTS_OFFSET,
    EngineUpdateRequestHeader,
    constraints_offset
);
field_offset!(
    ENGINE_UPDATE_CONSTRAINT_COUNT,
    EngineUpdateRequestHeader,
    constraint_count
);
field_offset!(
    ENGINE_UPDATE_REGIONS_OFFSET,
    EngineUpdateRequestHeader,
    regions_offset
);
field_offset!(
    ENGINE_UPDATE_REGION_COUNT,
    EngineUpdateRequestHeader,
    region_count
);
field_offset!(
    ENGINE_UPDATE_EXCLUSIONS_OFFSET,
    EngineUpdateRequestHeader,
    exclusions_offset
);
field_offset!(
    ENGINE_UPDATE_EXCLUSION_COUNT,
    EngineUpdateRequestHeader,
    exclusion_count
);
field_offset!(
    ENGINE_UPDATE_INLINE_OBJECTS_OFFSET,
    EngineUpdateRequestHeader,
    inline_objects_offset
);
field_offset!(
    ENGINE_UPDATE_INLINE_OBJECT_COUNT,
    EngineUpdateRequestHeader,
    inline_object_count
);
field_offset!(
    ENGINE_UPDATE_POLICY_PARAMETERS_OFFSET,
    EngineUpdateRequestHeader,
    policy_parameters_offset
);
field_offset!(
    ENGINE_UPDATE_POLICY_PARAMETERS_LENGTH,
    EngineUpdateRequestHeader,
    policy_parameters_length
);
field_offset!(
    ENGINE_UPDATE_MAX_PARAGRAPHS,
    EngineUpdateRequestHeader,
    max_paragraphs
);
field_offset!(
    ENGINE_UPDATE_PARAGRAPH_MUTATIONS_OFFSET,
    EngineUpdateRequestHeader,
    paragraph_mutations_offset
);
field_offset!(
    ENGINE_UPDATE_PARAGRAPH_MUTATION_COUNT,
    EngineUpdateRequestHeader,
    paragraph_mutation_count
);
field_offset!(
    ENGINE_PARAGRAPH_MUTATION_OPCODE,
    EngineParagraphMutationRecord,
    opcode
);
field_offset!(
    ENGINE_PARAGRAPH_MUTATION_FLAGS,
    EngineParagraphMutationRecord,
    flags
);
field_offset!(
    ENGINE_PARAGRAPH_MUTATION_RESERVED0,
    EngineParagraphMutationRecord,
    reserved0
);
field_offset!(
    ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
    EngineParagraphMutationRecord,
    paragraph_id
);
field_offset!(
    ENGINE_PARAGRAPH_MUTATION_ORDER,
    EngineParagraphMutationRecord,
    order
);
field_offset!(
    ENGINE_TEXT_MUTATION_OPCODE,
    EngineTextMutationRecord,
    opcode
);
field_offset!(
    ENGINE_TEXT_MUTATION_ENCODING,
    EngineTextMutationRecord,
    encoding
);
field_offset!(
    ENGINE_TEXT_MUTATION_RESERVED0,
    EngineTextMutationRecord,
    reserved0
);
field_offset!(
    ENGINE_TEXT_MUTATION_TEXT_START,
    EngineTextMutationRecord,
    text_start
);
field_offset!(
    ENGINE_TEXT_MUTATION_DELETE_COUNT,
    EngineTextMutationRecord,
    delete_count
);
field_offset!(
    ENGINE_TEXT_MUTATION_INSERT_OFFSET,
    EngineTextMutationRecord,
    insert_offset
);
field_offset!(
    ENGINE_TEXT_MUTATION_INSERT_COUNT,
    EngineTextMutationRecord,
    insert_count
);
field_offset!(
    ENGINE_TEXT_MUTATION_PARAGRAPH_ID,
    EngineTextMutationRecord,
    paragraph_id
);
field_offset!(
    ENGINE_STYLE_MUTATION_OPCODE,
    EngineStyleMutationRecord,
    opcode
);
field_offset!(
    ENGINE_STYLE_MUTATION_DIRECTION,
    EngineStyleMutationRecord,
    direction
);
field_offset!(
    ENGINE_STYLE_MUTATION_DECORATION_STYLE,
    EngineStyleMutationRecord,
    decoration_style
);
field_offset!(
    ENGINE_STYLE_MUTATION_FLAGS,
    EngineStyleMutationRecord,
    flags
);
field_offset!(
    ENGINE_STYLE_MUTATION_STYLE_ID,
    EngineStyleMutationRecord,
    style_id
);
field_offset!(
    ENGINE_STYLE_MUTATION_CASCADE_ORDER,
    EngineStyleMutationRecord,
    cascade_order
);
field_offset!(
    ENGINE_STYLE_MUTATION_FIELD_MASK,
    EngineStyleMutationRecord,
    field_mask
);
field_offset!(
    ENGINE_STYLE_MUTATION_TEXT_START,
    EngineStyleMutationRecord,
    text_start
);
field_offset!(
    ENGINE_STYLE_MUTATION_TEXT_END,
    EngineStyleMutationRecord,
    text_end
);
field_offset!(
    ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
    EngineStyleMutationRecord,
    font_stack_handle
);
field_offset!(
    ENGINE_STYLE_MUTATION_MATERIAL_ID,
    EngineStyleMutationRecord,
    material_id
);
field_offset!(
    ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
    EngineStyleMutationRecord,
    language_offset
);
field_offset!(
    ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH,
    EngineStyleMutationRecord,
    language_length
);
field_offset!(
    ENGINE_STYLE_MUTATION_FEATURE_COUNT,
    EngineStyleMutationRecord,
    feature_count
);
field_offset!(
    ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
    EngineStyleMutationRecord,
    features_offset
);
field_offset!(
    ENGINE_STYLE_MUTATION_FONT_SIZE,
    EngineStyleMutationRecord,
    font_size
);
field_offset!(
    ENGINE_STYLE_MUTATION_LINE_HEIGHT,
    EngineStyleMutationRecord,
    line_height
);
field_offset!(
    ENGINE_STYLE_MUTATION_LETTER_SPACING,
    EngineStyleMutationRecord,
    letter_spacing
);
field_offset!(
    ENGINE_STYLE_MUTATION_WORD_SPACING,
    EngineStyleMutationRecord,
    word_spacing
);
field_offset!(
    ENGINE_STYLE_MUTATION_BASELINE_SHIFT,
    EngineStyleMutationRecord,
    baseline_shift
);
field_offset!(
    ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
    EngineStyleMutationRecord,
    raster_pixel_ratio
);
field_offset!(
    ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
    EngineStyleMutationRecord,
    foreground_rgba
);
field_offset!(
    ENGINE_STYLE_MUTATION_DECORATION_RGBA,
    EngineStyleMutationRecord,
    decoration_rgba
);
field_offset!(
    ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
    EngineStyleMutationRecord,
    decoration_flags
);
field_offset!(
    ENGINE_STYLE_MUTATION_DECORATION_THICKNESS,
    EngineStyleMutationRecord,
    decoration_thickness
);
field_offset!(
    ENGINE_STYLE_MUTATION_DECORATION_OFFSET,
    EngineStyleMutationRecord,
    decoration_offset
);
field_offset!(
    ENGINE_STYLE_MUTATION_OPACITY,
    EngineStyleMutationRecord,
    opacity
);
field_offset!(
    ENGINE_STYLE_MUTATION_OUTLINE_RGBA,
    EngineStyleMutationRecord,
    outline_rgba
);
field_offset!(
    ENGINE_STYLE_MUTATION_OUTLINE_WIDTH,
    EngineStyleMutationRecord,
    outline_width
);
field_offset!(
    ENGINE_STYLE_MUTATION_SHADOW_RGBA,
    EngineStyleMutationRecord,
    shadow_rgba
);
field_offset!(
    ENGINE_STYLE_MUTATION_SHADOW_OFFSET_X,
    EngineStyleMutationRecord,
    shadow_offset_x
);
field_offset!(
    ENGINE_STYLE_MUTATION_SHADOW_OFFSET_Y,
    EngineStyleMutationRecord,
    shadow_offset_y
);
field_offset!(
    ENGINE_STYLE_MUTATION_PARAGRAPH_ID,
    EngineStyleMutationRecord,
    paragraph_id
);
field_offset!(
    ENGINE_CONSTRAINT_FLOW_THREAD_ID,
    EngineConstraintRecord,
    flow_thread_id
);
field_offset!(
    ENGINE_CONSTRAINT_GEOMETRY_REVISION,
    EngineConstraintRecord,
    geometry_revision
);
field_offset!(ENGINE_CONSTRAINT_WIDTH, EngineConstraintRecord, width);
field_offset!(ENGINE_CONSTRAINT_HEIGHT, EngineConstraintRecord, height);
field_offset!(
    ENGINE_CONSTRAINT_VIEWPORT_BLOCK_START,
    EngineConstraintRecord,
    viewport_block_start
);
field_offset!(
    ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
    EngineConstraintRecord,
    viewport_block_end
);
field_offset!(
    ENGINE_CONSTRAINT_RESUME_BLOCK_OFFSET,
    EngineConstraintRecord,
    resume_block_offset
);
field_offset!(
    ENGINE_CONSTRAINT_MAX_LINES,
    EngineConstraintRecord,
    max_lines
);
field_offset!(
    ENGINE_CONSTRAINT_REGION_START,
    EngineConstraintRecord,
    region_start
);
field_offset!(
    ENGINE_CONSTRAINT_RESUME_CLUSTER,
    EngineConstraintRecord,
    resume_cluster
);
field_offset!(
    ENGINE_CONSTRAINT_REGION_COUNT,
    EngineConstraintRecord,
    region_count
);
field_offset!(
    ENGINE_CONSTRAINT_RESUME_REGION,
    EngineConstraintRecord,
    resume_region
);
field_offset!(
    ENGINE_CONSTRAINT_WIDTH_MODE,
    EngineConstraintRecord,
    width_mode
);
field_offset!(
    ENGINE_CONSTRAINT_HEIGHT_MODE,
    EngineConstraintRecord,
    height_mode
);
field_offset!(ENGINE_CONSTRAINT_WRAP, EngineConstraintRecord, wrap);
field_offset!(ENGINE_CONSTRAINT_ALIGN, EngineConstraintRecord, align);
field_offset!(ENGINE_CONSTRAINT_OVERFLOW, EngineConstraintRecord, overflow);
field_offset!(
    ENGINE_CONSTRAINT_BLOCK_ALIGN,
    EngineConstraintRecord,
    block_align
);
field_offset!(ENGINE_CONSTRAINT_FLAGS, EngineConstraintRecord, flags);
field_offset!(
    ENGINE_CONSTRAINT_PARAGRAPH_ID,
    EngineConstraintRecord,
    paragraph_id
);
field_offset!(
    ENGINE_CONSTRAINT_FIRST_LINE_INDENT,
    EngineConstraintRecord,
    first_line_indent
);
field_offset!(
    ENGINE_CONSTRAINT_SPACE_BEFORE,
    EngineConstraintRecord,
    space_before
);
field_offset!(
    ENGINE_CONSTRAINT_SPACE_AFTER,
    EngineConstraintRecord,
    space_after
);
field_offset!(
    ENGINE_CONSTRAINT_JUSTIFY_MIN_WORD_SPACE_RATIO,
    EngineConstraintRecord,
    justify_min_word_space_ratio
);
field_offset!(
    ENGINE_CONSTRAINT_JUSTIFY_MAX_WORD_SPACE_RATIO,
    EngineConstraintRecord,
    justify_max_word_space_ratio
);
field_offset!(
    ENGINE_CONSTRAINT_JUSTIFY_LETTER_SPACE_EXPANSION,
    EngineConstraintRecord,
    justify_letter_space_expansion
);
field_offset!(
    ENGINE_CONSTRAINT_LAST_LINE,
    EngineConstraintRecord,
    last_line
);
field_offset!(ENGINE_FLOW_VERTEX_INLINE, EngineFlowVertexRecord, inline);
field_offset!(ENGINE_FLOW_VERTEX_BLOCK, EngineFlowVertexRecord, block);
field_offset!(ENGINE_REGION_ID, EngineRegionRecord, id);
field_offset!(
    ENGINE_REGION_GEOMETRY_REVISION,
    EngineRegionRecord,
    geometry_revision
);
field_offset!(
    ENGINE_REGION_TRANSFORM_INDEX,
    EngineRegionRecord,
    transform_index
);
field_offset!(
    ENGINE_REGION_VERTICES_OFFSET,
    EngineRegionRecord,
    vertices_offset
);
field_offset!(ENGINE_REGION_VERTEX_COUNT, EngineRegionRecord, vertex_count);
field_offset!(
    ENGINE_REGION_EXCLUSION_START,
    EngineRegionRecord,
    exclusion_start
);
field_offset!(
    ENGINE_REGION_EXCLUSION_COUNT,
    EngineRegionRecord,
    exclusion_count
);
field_offset!(ENGINE_REGION_FLAGS, EngineRegionRecord, flags);
field_offset!(ENGINE_REGION_SHAPE, EngineRegionRecord, shape);
field_offset!(ENGINE_REGION_WRITING_MODE, EngineRegionRecord, writing_mode);
field_offset!(
    ENGINE_REGION_TEXT_ORIENTATION,
    EngineRegionRecord,
    text_orientation
);
field_offset!(ENGINE_REGION_RESERVED0, EngineRegionRecord, reserved0);
field_offset!(ENGINE_REGION_INLINE_START, EngineRegionRecord, inline_start);
field_offset!(ENGINE_REGION_BLOCK_START, EngineRegionRecord, block_start);
field_offset!(ENGINE_REGION_INLINE_END, EngineRegionRecord, inline_end);
field_offset!(ENGINE_REGION_BLOCK_END, EngineRegionRecord, block_end);
field_offset!(
    ENGINE_REGION_CLIP_INLINE_START,
    EngineRegionRecord,
    clip_inline_start
);
field_offset!(
    ENGINE_REGION_CLIP_BLOCK_START,
    EngineRegionRecord,
    clip_block_start
);
field_offset!(
    ENGINE_REGION_CLIP_INLINE_END,
    EngineRegionRecord,
    clip_inline_end
);
field_offset!(
    ENGINE_REGION_CLIP_BLOCK_END,
    EngineRegionRecord,
    clip_block_end
);
field_offset!(ENGINE_EXCLUSION_ID, EngineExclusionRecord, id);
field_offset!(ENGINE_EXCLUSION_REGION_ID, EngineExclusionRecord, region_id);
field_offset!(
    ENGINE_EXCLUSION_GEOMETRY_REVISION,
    EngineExclusionRecord,
    geometry_revision
);
field_offset!(
    ENGINE_EXCLUSION_VERTICES_OFFSET,
    EngineExclusionRecord,
    vertices_offset
);
field_offset!(
    ENGINE_EXCLUSION_VERTEX_COUNT,
    EngineExclusionRecord,
    vertex_count
);
field_offset!(ENGINE_EXCLUSION_FLAGS, EngineExclusionRecord, flags);
field_offset!(ENGINE_EXCLUSION_SHAPE, EngineExclusionRecord, shape);
field_offset!(ENGINE_EXCLUSION_WRAP_SIDE, EngineExclusionRecord, wrap_side);
field_offset!(ENGINE_EXCLUSION_RESERVED0, EngineExclusionRecord, reserved0);
field_offset!(
    ENGINE_EXCLUSION_INLINE_START,
    EngineExclusionRecord,
    inline_start
);
field_offset!(
    ENGINE_EXCLUSION_BLOCK_START,
    EngineExclusionRecord,
    block_start
);
field_offset!(
    ENGINE_EXCLUSION_INLINE_END,
    EngineExclusionRecord,
    inline_end
);
field_offset!(ENGINE_EXCLUSION_BLOCK_END, EngineExclusionRecord, block_end);
field_offset!(
    ENGINE_EXCLUSION_MARGIN_INLINE,
    EngineExclusionRecord,
    margin_inline
);
field_offset!(
    ENGINE_EXCLUSION_MARGIN_BLOCK,
    EngineExclusionRecord,
    margin_block
);
field_offset!(ENGINE_INLINE_OBJECT_ID, EngineInlineObjectRecord, id);
field_offset!(
    ENGINE_INLINE_OBJECT_CONTENT_REVISION,
    EngineInlineObjectRecord,
    content_revision
);
field_offset!(
    ENGINE_INLINE_OBJECT_TEXT_OFFSET,
    EngineInlineObjectRecord,
    text_offset
);
field_offset!(
    ENGINE_INLINE_OBJECT_MATERIAL_ID,
    EngineInlineObjectRecord,
    material_id
);
field_offset!(
    ENGINE_INLINE_OBJECT_RESOURCE_ID,
    EngineInlineObjectRecord,
    resource_id
);
field_offset!(
    ENGINE_INLINE_OBJECT_RESOURCE_GENERATION,
    EngineInlineObjectRecord,
    resource_generation
);
field_offset!(
    ENGINE_INLINE_OBJECT_INLINE_EXTENT,
    EngineInlineObjectRecord,
    inline_extent
);
field_offset!(
    ENGINE_INLINE_OBJECT_BLOCK_EXTENT,
    EngineInlineObjectRecord,
    block_extent
);
field_offset!(
    ENGINE_INLINE_OBJECT_BASELINE_OFFSET,
    EngineInlineObjectRecord,
    baseline_offset
);
field_offset!(
    ENGINE_INLINE_OBJECT_MARGIN_INLINE_START,
    EngineInlineObjectRecord,
    margin_inline_start
);
field_offset!(
    ENGINE_INLINE_OBJECT_MARGIN_INLINE_END,
    EngineInlineObjectRecord,
    margin_inline_end
);
field_offset!(
    ENGINE_INLINE_OBJECT_MARGIN_BLOCK_START,
    EngineInlineObjectRecord,
    margin_block_start
);
field_offset!(
    ENGINE_INLINE_OBJECT_MARGIN_BLOCK_END,
    EngineInlineObjectRecord,
    margin_block_end
);
field_offset!(
    ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT,
    EngineInlineObjectRecord,
    baseline_alignment
);
field_offset!(ENGINE_INLINE_OBJECT_FLAGS, EngineInlineObjectRecord, flags);
field_offset!(
    ENGINE_INLINE_OBJECT_RESERVED0,
    EngineInlineObjectRecord,
    reserved0
);
field_offset!(
    ENGINE_INLINE_OBJECT_PARAGRAPH_ID,
    EngineInlineObjectRecord,
    paragraph_id
);
field_offset!(ENGINE_RESULT_ABI_VERSION, EngineResultHeader, abi_version);
field_offset!(ENGINE_RESULT_BYTE_LENGTH, EngineResultHeader, byte_length);
field_offset!(ENGINE_RESULT_STATUS, EngineResultHeader, status);
field_offset!(ENGINE_RESULT_FLAGS, EngineResultHeader, flags);
field_offset!(ENGINE_RESULT_PLANNER_ID, EngineResultHeader, planner_id);
field_offset!(
    ENGINE_RESULT_ENGINE_REVISION,
    EngineResultHeader,
    engine_revision
);
field_offset!(
    ENGINE_RESULT_PLAN_REVISION,
    EngineResultHeader,
    plan_revision
);
field_offset!(
    ENGINE_RESULT_REQUIRED_BASE_REVISION,
    EngineResultHeader,
    required_base_revision
);
field_offset!(
    ENGINE_RESULT_PUBLICATION_GENERATION,
    EngineResultHeader,
    publication_generation
);
field_offset!(ENGINE_RESULT_OUTPUT_SLOT, EngineResultHeader, output_slot);
field_offset!(
    ENGINE_RESULT_REQUEST_CAPACITY,
    EngineResultHeader,
    request_capacity
);
field_offset!(
    ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY,
    EngineResultHeader,
    required_request_capacity
);
field_offset!(
    ENGINE_RESULT_RESULT_CAPACITY,
    EngineResultHeader,
    result_capacity
);
field_offset!(
    ENGINE_RESULT_REQUIRED_RESULT_CAPACITY,
    EngineResultHeader,
    required_result_capacity
);
field_offset!(
    ENGINE_RESULT_POLICY_HANDLE,
    EngineResultHeader,
    policy_handle
);
field_offset!(
    ENGINE_RESULT_CAPABILITY_SET,
    EngineResultHeader,
    capability_set
);
field_offset!(
    ENGINE_RESULT_POLICY_FINGERPRINT_LOW,
    EngineResultHeader,
    policy_fingerprint_low
);
field_offset!(
    ENGINE_RESULT_POLICY_FINGERPRINT_HIGH,
    EngineResultHeader,
    policy_fingerprint_high
);
field_offset!(
    ENGINE_RESULT_SEMANTICS_OFFSET,
    EngineResultHeader,
    semantic_views_offset
);
field_offset!(
    ENGINE_RESULT_SEMANTICS_COUNT,
    EngineResultHeader,
    semantic_view_count
);
field_offset!(
    ENGINE_RESULT_RESOURCES_OFFSET,
    EngineResultHeader,
    resources_offset
);
field_offset!(
    ENGINE_RESULT_RESOURCE_COUNT,
    EngineResultHeader,
    resource_count
);
field_offset!(
    ENGINE_RESULT_BUFFERS_OFFSET,
    EngineResultHeader,
    buffers_offset
);
field_offset!(ENGINE_RESULT_BUFFER_COUNT, EngineResultHeader, buffer_count);
field_offset!(
    ENGINE_RESULT_PATCHES_OFFSET,
    EngineResultHeader,
    patches_offset
);
field_offset!(ENGINE_RESULT_PATCH_COUNT, EngineResultHeader, patch_count);
field_offset!(
    ENGINE_RESULT_PRIMITIVES_OFFSET,
    EngineResultHeader,
    primitives_offset
);
field_offset!(
    ENGINE_RESULT_PRIMITIVE_COUNT,
    EngineResultHeader,
    primitive_count
);
field_offset!(ENGINE_RESULT_DRAWS_OFFSET, EngineResultHeader, draws_offset);
field_offset!(ENGINE_RESULT_DRAW_COUNT, EngineResultHeader, draw_count);
field_offset!(
    ENGINE_RESULT_RETIREMENTS_OFFSET,
    EngineResultHeader,
    retirements_offset
);
field_offset!(
    ENGINE_RESULT_RETIREMENT_COUNT,
    EngineResultHeader,
    retirement_count
);
field_offset!(
    ENGINE_RESULT_DIAGNOSTICS_OFFSET,
    EngineResultHeader,
    diagnostics_offset
);
field_offset!(
    ENGINE_RESULT_DIAGNOSTIC_COUNT,
    EngineResultHeader,
    diagnostic_count
);
field_offset!(
    ENGINE_RESULT_FAULT_PARAGRAPH_ID,
    EngineResultHeader,
    fault_paragraph_id
);
field_offset!(
    ENGINE_RESULT_FAULT_STYLE_ID,
    EngineResultHeader,
    fault_style_id
);
field_offset!(SEMANTIC_ID, SemanticRecord, id);
field_offset!(SEMANTIC_KIND, SemanticRecord, kind);
field_offset!(SEMANTIC_FLAGS, SemanticRecord, flags);
field_offset!(SEMANTIC_PARENT_ID, SemanticRecord, parent_id);
field_offset!(SEMANTIC_TEXT_START, SemanticRecord, text_start);
field_offset!(SEMANTIC_TEXT_END, SemanticRecord, text_end);
field_offset!(SEMANTIC_ITEM_START, SemanticRecord, item_start);
field_offset!(SEMANTIC_ITEM_COUNT, SemanticRecord, item_count);
field_offset!(SEMANTIC_INLINE_START, SemanticRecord, inline_start);
field_offset!(SEMANTIC_BLOCK_START, SemanticRecord, block_start);
field_offset!(SEMANTIC_INLINE_EXTENT, SemanticRecord, inline_extent);
field_offset!(SEMANTIC_BLOCK_EXTENT, SemanticRecord, block_extent);
field_offset!(SEMANTIC_INLINE_ADVANCE, SemanticRecord, inline_advance);
field_offset!(SEMANTIC_INK_INLINE_START, SemanticRecord, ink_inline_start);
field_offset!(SEMANTIC_INK_BLOCK_START, SemanticRecord, ink_block_start);
field_offset!(
    SEMANTIC_INK_INLINE_EXTENT,
    SemanticRecord,
    ink_inline_extent
);
field_offset!(SEMANTIC_INK_BLOCK_EXTENT, SemanticRecord, ink_block_extent);
field_offset!(SEMANTIC_ASCENT, SemanticRecord, ascent);
field_offset!(
    SEMANTIC_MIN_CONTENT_WIDTH,
    SemanticRecord,
    min_content_width
);
field_offset!(
    SEMANTIC_MAX_CONTENT_WIDTH,
    SemanticRecord,
    max_content_width
);
field_offset!(RESOURCE_ID, ResourceRecord, id);
field_offset!(RESOURCE_GENERATION, ResourceRecord, generation);
field_offset!(RESOURCE_TECHNIQUE_ID, ResourceRecord, technique_id);
field_offset!(RESOURCE_KIND, ResourceRecord, resource_kind);
field_offset!(RESOURCE_ACTION, ResourceRecord, action);
field_offset!(RESOURCE_FLAGS, ResourceRecord, flags);
field_offset!(RESOURCE_REFERENCE_ID, ResourceRecord, reference_id);
field_offset!(RESOURCE_LOWER_BOUND, ResourceRecord, lower_bound);
field_offset!(RESOURCE_UPPER_BOUND, ResourceRecord, upper_bound);
field_offset!(RESOURCE_AUXILIARY0, ResourceRecord, auxiliary0);
field_offset!(RESOURCE_AUXILIARY1, ResourceRecord, auxiliary1);
field_offset!(BUFFER_ID, BufferRecord, id);
field_offset!(BUFFER_GENERATION, BufferRecord, generation);
field_offset!(BUFFER_PROGRAM_ID, BufferRecord, program_id);
field_offset!(BUFFER_POLICY_BUFFER_ID, BufferRecord, policy_buffer_id);
field_offset!(BUFFER_SCALAR_TYPE, BufferRecord, scalar_type);
field_offset!(BUFFER_VECTOR_WIDTH, BufferRecord, vector_width);
field_offset!(BUFFER_STRATEGY, BufferRecord, strategy);
field_offset!(BUFFER_FLAGS, BufferRecord, flags);
field_offset!(BUFFER_LIVE_RECORDS, BufferRecord, live_records);
field_offset!(BUFFER_CAPACITY_RECORDS, BufferRecord, capacity_records);
field_offset!(BUFFER_BYTE_LENGTH, BufferRecord, byte_length);
field_offset!(BUFFER_ORDER_BUFFER_ID, BufferRecord, order_buffer_id);
field_offset!(PATCH_OPCODE, PatchRecord, opcode);
field_offset!(PATCH_FLAGS, PatchRecord, flags);
field_offset!(PATCH_BUFFER_ID, PatchRecord, buffer_id);
field_offset!(PATCH_BUFFER_GENERATION, PatchRecord, buffer_generation);
field_offset!(PATCH_DESTINATION_OFFSET, PatchRecord, destination_offset);
field_offset!(PATCH_BYTE_LENGTH, PatchRecord, byte_length);
field_offset!(PATCH_PAYLOAD_OFFSET, PatchRecord, payload_start);
field_offset!(PATCH_SOURCE_BUFFER_ID, PatchRecord, source_buffer_id);
field_offset!(PATCH_SOURCE_OFFSET, PatchRecord, source_offset);
field_offset!(PATCH_FILL_VALUE, PatchRecord, fill_value);
field_offset!(PRIMITIVE_ID, PrimitiveRecord, id);
field_offset!(PRIMITIVE_KIND, PrimitiveRecord, kind);
field_offset!(PRIMITIVE_FLAGS, PrimitiveRecord, flags);
field_offset!(PRIMITIVE_TECHNIQUE_ID, PrimitiveRecord, technique_id);
field_offset!(PRIMITIVE_RESOURCE_ID, PrimitiveRecord, resource_id);
field_offset!(
    PRIMITIVE_RESOURCE_GENERATION,
    PrimitiveRecord,
    resource_generation
);
field_offset!(PRIMITIVE_PROGRAM_ID, PrimitiveRecord, program_id);
field_offset!(PRIMITIVE_PROGRAM_VARIANT, PrimitiveRecord, program_variant);
field_offset!(PRIMITIVE_RECORD_COUNT, PrimitiveRecord, record_count);
field_offset!(PRIMITIVE_BUFFER_ID, PrimitiveRecord, buffer_id);
field_offset!(PRIMITIVE_RECORD_INDEX, PrimitiveRecord, record_index);
field_offset!(PRIMITIVE_LOGICAL_ORDER, PrimitiveRecord, logical_order);
field_offset!(PRIMITIVE_CLIP_ID, PrimitiveRecord, clip_id);
field_offset!(PRIMITIVE_SEMANTIC_ID, PrimitiveRecord, semantic_id);
field_offset!(PRIMITIVE_INLINE_START, PrimitiveRecord, inline_start);
field_offset!(PRIMITIVE_BLOCK_START, PrimitiveRecord, block_start);
field_offset!(PRIMITIVE_INLINE_EXTENT, PrimitiveRecord, inline_extent);
field_offset!(PRIMITIVE_BLOCK_EXTENT, PrimitiveRecord, block_extent);
field_offset!(DRAW_ID, DrawRecord, id);
field_offset!(DRAW_PROGRAM_ID, DrawRecord, program_id);
field_offset!(DRAW_PROGRAM_VARIANT, DrawRecord, program_variant);
field_offset!(DRAW_FLAGS, DrawRecord, flags);
field_offset!(DRAW_MATERIAL_ID, DrawRecord, material_id);
field_offset!(DRAW_CLIP_ID, DrawRecord, clip_id);
field_offset!(DRAW_DEPTH_KEY, DrawRecord, depth_key);
field_offset!(DRAW_TRANSFORM_ID, DrawRecord, transform_id);
field_offset!(DRAW_PRIMITIVE_START, DrawRecord, primitive_start);
field_offset!(DRAW_PRIMITIVE_COUNT, DrawRecord, primitive_count);
field_offset!(DRAW_BUFFER_START, DrawRecord, buffer_start);
field_offset!(DRAW_BUFFER_COUNT, DrawRecord, buffer_count);
field_offset!(DRAW_RESOURCE_START, DrawRecord, resource_start);
field_offset!(DRAW_RESOURCE_COUNT, DrawRecord, resource_count);
field_offset!(DRAW_ORDER_TOKEN, DrawRecord, order_token);
field_offset!(DRAW_INDIRECT_BUFFER_ID, DrawRecord, indirect_buffer_id);
field_offset!(DRAW_INDIRECT_OFFSET, DrawRecord, indirect_offset);
field_offset!(RETIREMENT_KIND, RetirementRecord, kind);
field_offset!(RETIREMENT_FLAGS, RetirementRecord, flags);
field_offset!(RETIREMENT_ID, RetirementRecord, id);
field_offset!(RETIREMENT_GENERATION, RetirementRecord, generation);
field_offset!(
    RETIREMENT_AFTER_PUBLICATION_GENERATION,
    RetirementRecord,
    after_publication_generation
);
field_offset!(RETIREMENT_BYTE_OFFSET, RetirementRecord, byte_offset);
field_offset!(RETIREMENT_BYTE_LENGTH, RetirementRecord, byte_length);
field_offset!(DIAGNOSTIC_CODE, DiagnosticRecord, code);
field_offset!(DIAGNOSTIC_SEVERITY, DiagnosticRecord, severity);
field_offset!(DIAGNOSTIC_PHASE, DiagnosticRecord, phase);
field_offset!(DIAGNOSTIC_SUBJECT_ID, DiagnosticRecord, subject_id);
field_offset!(DIAGNOSTIC_VALUE0, DiagnosticRecord, value0);
field_offset!(DIAGNOSTIC_VALUE1, DiagnosticRecord, value1);
field_offset!(
    DIAGNOSTIC_DURATION_NANOS_LOW,
    DiagnosticRecord,
    duration_nanos_low
);
field_offset!(
    DIAGNOSTIC_DURATION_NANOS_HIGH,
    DiagnosticRecord,
    duration_nanos_high
);
field_offset!(FEATURE_TAG, FeatureRecord, tag);
field_offset!(FEATURE_VALUE, FeatureRecord, value);
field_offset!(FEATURE_START, FeatureRecord, start);
field_offset!(FEATURE_END, FeatureRecord, end);

pub fn json() -> String {
    json!({
        "name": "pmndrs-glyph-shaper",
        "version": ABI_VERSION,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
        "versions": {
            "shaper": SHAPER_VERSION,
            "harfrust": HARFRUST_VERSION,
            "harfrustCommit": HARFRUST_COMMIT,
            "unicode": UNICODE_VERSION,
            "fontFormat": 0
        },
        "functions": {
            "initialize": "pmndrs_glyph_shaper_initialize",
            "allocate": "pmndrs_glyph_shaper_alloc",
            "deallocate": "pmndrs_glyph_shaper_dealloc",
            "registerFont": "pmndrs_glyph_shaper_register_font",
            "disposeFont": "pmndrs_glyph_shaper_dispose_font",
            "fontCount": "pmndrs_glyph_shaper_font_count",
            "retainedFontBytes": "pmndrs_glyph_shaper_retained_font_bytes",
            "planCount": "pmndrs_glyph_shaper_plan_count",
            "registerFontStack": "pmndrs_glyph_engine_register_font_stack",
            "disposeFontStack": "pmndrs_glyph_engine_dispose_font_stack",
            "fontStackCount": "pmndrs_glyph_engine_font_stack_count",
            "registerFontBinding": "pmndrs_glyph_engine_register_font_binding",
            "disposeFontBinding": "pmndrs_glyph_engine_dispose_font_binding",
            "fontBindingCount": "pmndrs_glyph_engine_font_binding_count",
            "registerPolicy": "pmndrs_glyph_engine_register_policy",
            "disposePolicy": "pmndrs_glyph_engine_dispose_policy",
            "policyCount": "pmndrs_glyph_engine_policy_count",
            "createPlanner": "pmndrs_glyph_engine_create_planner",
            "reservePlanner": "pmndrs_glyph_engine_reserve_planner",
            "disposePlanner": "pmndrs_glyph_engine_dispose_planner",
            "plannerCount": "pmndrs_glyph_engine_planner_count",
            "requestPointer": "pmndrs_glyph_engine_request_ptr",
            "requestCapacity": "pmndrs_glyph_engine_request_capacity",
            "textUpdate": "pmndrs_glyph_engine_update",
            "measureParagraph": "pmndrs_glyph_engine_measure_paragraph"
        },
        "layouts": {
            "policyRequest": {
                "size": POLICY_REQUEST_HEADER_SIZE,
                "alignment": POLICY_REQUEST_HEADER_ALIGNMENT,
                "byteLength": POLICY_BYTE_LENGTH,
                "capabilitySetsOffset": POLICY_CAPABILITY_SETS_OFFSET,
                "capabilitySetCount": POLICY_CAPABILITY_SET_COUNT,
                "programsOffset": POLICY_PROGRAMS_OFFSET,
                "programCount": POLICY_PROGRAM_COUNT,
                "buffersOffset": POLICY_BUFFERS_OFFSET,
                "bufferCount": POLICY_BUFFER_COUNT,
                "operationsOffset": POLICY_OPERATIONS_OFFSET,
                "operationCount": POLICY_OPERATION_COUNT,
                "inputsOffset": POLICY_INPUTS_OFFSET,
                "inputCount": POLICY_INPUT_COUNT
            },
            "policyCapabilitySet": {
                "size": POLICY_CAPABILITY_SET_RECORD_SIZE,
                "alignment": POLICY_CAPABILITY_SET_RECORD_ALIGNMENT,
                "id": POLICY_CAPABILITY_SET_ID,
                "flags": POLICY_CAPABILITY_SET_FLAGS,
                "maxBufferBytes": POLICY_CAPABILITY_SET_MAX_BUFFER_BYTES,
                "updateAlignment": POLICY_CAPABILITY_SET_UPDATE_ALIGNMENT,
                "coalesceGapBytes": POLICY_CAPABILITY_SET_COALESCE_GAP_BYTES,
                "rangeCallPenaltyBytes": POLICY_CAPABILITY_SET_RANGE_CALL_PENALTY_BYTES,
                "maxBuffersPerDraw": POLICY_CAPABILITY_SET_MAX_BUFFERS_PER_DRAW,
                "maxResourcesPerDraw": POLICY_CAPABILITY_SET_MAX_RESOURCES_PER_DRAW,
                "maxIndirectDraws": POLICY_CAPABILITY_SET_MAX_INDIRECT_DRAWS,
                "fragmentationBudget": POLICY_CAPABILITY_SET_FRAGMENTATION_BUDGET,
                "wholeBufferThresholdBasisPoints": POLICY_CAPABILITY_SET_WHOLE_BUFFER_THRESHOLD_BASIS_POINTS,
                "reserved": POLICY_CAPABILITY_SET_RESERVED
            },
            "policyProgram": {
                "size": POLICY_PROGRAM_RECORD_SIZE,
                "alignment": POLICY_PROGRAM_RECORD_ALIGNMENT,
                "techniqueId": POLICY_PROGRAM_TECHNIQUE_ID,
                "programId": POLICY_PROGRAM_ID,
                "capabilitySetId": POLICY_PROGRAM_CAPABILITY_SET_ID,
                "resourceKindMask": POLICY_PROGRAM_RESOURCE_KIND_MASK,
                "semanticViewMask": POLICY_PROGRAM_SEMANTIC_VIEW_MASK,
                "storageKeyMask": POLICY_PROGRAM_STORAGE_KEY_MASK,
                "drawKeyMask": POLICY_PROGRAM_DRAW_KEY_MASK,
                "variant": POLICY_PROGRAM_VARIANT,
                "f32InputCount": POLICY_PROGRAM_F32_INPUT_COUNT,
                "u32InputCount": POLICY_PROGRAM_U32_INPUT_COUNT,
                "paintCapabilities": POLICY_PROGRAM_PAINT_CAPABILITIES,
                "compositingCapabilities": POLICY_PROGRAM_COMPOSITING_CAPABILITIES,
                "bufferStart": POLICY_PROGRAM_BUFFER_START,
                "bufferCount": POLICY_PROGRAM_BUFFER_COUNT,
                "primitiveKind": POLICY_PROGRAM_PRIMITIVE_KIND,
                "operationStart": POLICY_PROGRAM_OPERATION_START,
                "operationCount": POLICY_PROGRAM_OPERATION_COUNT,
                "allocationStrategy": POLICY_PROGRAM_ALLOCATION_STRATEGY,
                "inputStart": POLICY_PROGRAM_INPUT_START,
                "inputCount": POLICY_PROGRAM_INPUT_COUNT,
                "reserved1": POLICY_PROGRAM_RESERVED1
            },
            "policyBuffer": {
                "size": POLICY_BUFFER_RECORD_SIZE,
                "alignment": POLICY_BUFFER_RECORD_ALIGNMENT,
                "id": POLICY_BUFFER_ID,
                "scalar": POLICY_BUFFER_SCALAR,
                "vectorWidth": POLICY_BUFFER_VECTOR_WIDTH,
                "alignment": POLICY_BUFFER_ALIGNMENT,
                "stride": POLICY_BUFFER_STRIDE,
                "usage": POLICY_BUFFER_USAGE,
                "capacityClass": POLICY_BUFFER_CAPACITY_CLASS,
                "reserved0": POLICY_BUFFER_RESERVED0
            },
            "policyOperation": {
                "size": POLICY_OPERATION_RECORD_SIZE,
                "alignment": POLICY_OPERATION_RECORD_ALIGNMENT,
                "opcode": POLICY_OPERATION_OPCODE,
                "target": POLICY_OPERATION_TARGET,
                "operand0": POLICY_OPERATION_OPERAND0,
                "operand1": POLICY_OPERATION_OPERAND1,
                "immediate0": POLICY_OPERATION_IMMEDIATE0,
                "immediate1": POLICY_OPERATION_IMMEDIATE1,
                "immediate2": POLICY_OPERATION_IMMEDIATE2
            },
            "policyInput": {
                "size": POLICY_INPUT_RECORD_SIZE,
                "alignment": POLICY_INPUT_RECORD_ALIGNMENT,
                "scope": POLICY_INPUT_SCOPE,
                "field": POLICY_INPUT_FIELD,
                "reserved": POLICY_INPUT_RESERVED
            },
            "fontBindingRequest": {
                "size": FONT_BINDING_REQUEST_HEADER_SIZE,
                "alignment": FONT_BINDING_REQUEST_HEADER_ALIGNMENT,
                "abiVersion": FONT_BINDING_ABI_VERSION,
                "byteLength": FONT_BINDING_BYTE_LENGTH,
                "techniqueId": FONT_BINDING_TECHNIQUE_ID,
                "programVariant": FONT_BINDING_PROGRAM_VARIANT,
                "reserved0": FONT_BINDING_RESERVED0,
                "glyphCount": FONT_BINDING_GLYPH_COUNT,
                "strikeCount": FONT_BINDING_STRIKE_COUNT,
                "resourceCount": FONT_BINDING_RESOURCE_COUNT,
                "glyphF32FieldCount": FONT_BINDING_GLYPH_F32_FIELD_COUNT,
                "glyphU32FieldCount": FONT_BINDING_GLYPH_U32_FIELD_COUNT,
                "strikeF32FieldCount": FONT_BINDING_STRIKE_F32_FIELD_COUNT,
                "strikeU32FieldCount": FONT_BINDING_STRIKE_U32_FIELD_COUNT,
                "resourceF32FieldCount": FONT_BINDING_RESOURCE_F32_FIELD_COUNT,
                "resourceU32FieldCount": FONT_BINDING_RESOURCE_U32_FIELD_COUNT,
                "reserved1": FONT_BINDING_RESERVED1,
                "strikesOffset": FONT_BINDING_STRIKES_OFFSET,
                "resourcesOffset": FONT_BINDING_RESOURCES_OFFSET,
                "resourceIndicesOffset": FONT_BINDING_RESOURCE_INDICES_OFFSET,
                "glyphF32Offset": FONT_BINDING_GLYPH_F32_OFFSET,
                "glyphU32Offset": FONT_BINDING_GLYPH_U32_OFFSET,
                "strikeF32Offset": FONT_BINDING_STRIKE_F32_OFFSET,
                "strikeU32Offset": FONT_BINDING_STRIKE_U32_OFFSET,
                "resourceF32Offset": FONT_BINDING_RESOURCE_F32_OFFSET,
                "resourceU32Offset": FONT_BINDING_RESOURCE_U32_OFFSET,
                "reserved2": FONT_BINDING_RESERVED2
            },
            "fontBindingStrike": {
                "size": FONT_BINDING_STRIKE_RECORD_SIZE,
                "alignment": FONT_BINDING_STRIKE_RECORD_ALIGNMENT,
                "ppem": FONT_BINDING_STRIKE_PPEM,
                "reserved": FONT_BINDING_STRIKE_RESERVED
            },
            "fontBindingResource": {
                "size": FONT_BINDING_RESOURCE_RECORD_SIZE,
                "alignment": FONT_BINDING_RESOURCE_RECORD_ALIGNMENT,
                "id": FONT_BINDING_RESOURCE_ID,
                "generation": FONT_BINDING_RESOURCE_GENERATION,
                "kind": FONT_BINDING_RESOURCE_KIND,
                "reserved": FONT_BINDING_RESOURCE_RESERVED,
                "reference": FONT_BINDING_RESOURCE_REFERENCE
            },
            "engineUpdateRequest": {
                "size": ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                "alignment": ENGINE_UPDATE_REQUEST_HEADER_ALIGNMENT,
                "abiVersion": ENGINE_UPDATE_ABI_VERSION,
                "byteLength": ENGINE_UPDATE_BYTE_LENGTH,
                "plannerId": ENGINE_UPDATE_PLANNER_ID,
                "expectedEngineRevision": ENGINE_UPDATE_EXPECTED_ENGINE_REVISION,
                "consumedPlanRevision": ENGINE_UPDATE_CONSUMED_PLAN_REVISION,
                "acknowledgedPublicationGeneration": ENGINE_UPDATE_ACKNOWLEDGED_PUBLICATION_GENERATION,
                "policyHandle": ENGINE_UPDATE_POLICY_HANDLE,
                "capabilitySet": ENGINE_UPDATE_CAPABILITY_SET,
                "flags": ENGINE_UPDATE_FLAGS,
                "semanticViewMask": ENGINE_UPDATE_SEMANTIC_VIEW_MASK,
                "maxClusters": ENGINE_UPDATE_MAX_CLUSTERS,
                "maxLines": ENGINE_UPDATE_MAX_LINES,
                "maxRegions": ENGINE_UPDATE_MAX_REGIONS,
                "maxExclusions": ENGINE_UPDATE_MAX_EXCLUSIONS,
                "maxInlineObjects": ENGINE_UPDATE_MAX_INLINE_OBJECTS,
                "maxSlotsPerBand": ENGINE_UPDATE_MAX_SLOTS_PER_BAND,
                "maxOutputBytes": ENGINE_UPDATE_MAX_OUTPUT_BYTES,
                "textMutationsOffset": ENGINE_UPDATE_TEXT_MUTATIONS_OFFSET,
                "textMutationCount": ENGINE_UPDATE_TEXT_MUTATION_COUNT,
                "styleMutationsOffset": ENGINE_UPDATE_STYLE_MUTATIONS_OFFSET,
                "styleMutationCount": ENGINE_UPDATE_STYLE_MUTATION_COUNT,
                "constraintsOffset": ENGINE_UPDATE_CONSTRAINTS_OFFSET,
                "constraintCount": ENGINE_UPDATE_CONSTRAINT_COUNT,
                "regionsOffset": ENGINE_UPDATE_REGIONS_OFFSET,
                "regionCount": ENGINE_UPDATE_REGION_COUNT,
                "exclusionsOffset": ENGINE_UPDATE_EXCLUSIONS_OFFSET,
                "exclusionCount": ENGINE_UPDATE_EXCLUSION_COUNT,
                "inlineObjectsOffset": ENGINE_UPDATE_INLINE_OBJECTS_OFFSET,
                "inlineObjectCount": ENGINE_UPDATE_INLINE_OBJECT_COUNT,
                "policyParametersOffset": ENGINE_UPDATE_POLICY_PARAMETERS_OFFSET,
                "policyParametersLength": ENGINE_UPDATE_POLICY_PARAMETERS_LENGTH,
                "maxParagraphs": ENGINE_UPDATE_MAX_PARAGRAPHS,
                "paragraphMutationsOffset": ENGINE_UPDATE_PARAGRAPH_MUTATIONS_OFFSET,
                "paragraphMutationCount": ENGINE_UPDATE_PARAGRAPH_MUTATION_COUNT
            },
            "engineParagraphMutation": {
                "size": ENGINE_PARAGRAPH_MUTATION_RECORD_SIZE,
                "alignment": ENGINE_PARAGRAPH_MUTATION_RECORD_ALIGNMENT,
                "opcode": ENGINE_PARAGRAPH_MUTATION_OPCODE,
                "flags": ENGINE_PARAGRAPH_MUTATION_FLAGS,
                "reserved0": ENGINE_PARAGRAPH_MUTATION_RESERVED0,
                "paragraphId": ENGINE_PARAGRAPH_MUTATION_PARAGRAPH_ID,
                "order": ENGINE_PARAGRAPH_MUTATION_ORDER
            },
            "engineTextMutation": {
                "size": ENGINE_TEXT_MUTATION_RECORD_SIZE,
                "alignment": ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
                "opcode": ENGINE_TEXT_MUTATION_OPCODE,
                "encoding": ENGINE_TEXT_MUTATION_ENCODING,
                "reserved0": ENGINE_TEXT_MUTATION_RESERVED0,
                "textStart": ENGINE_TEXT_MUTATION_TEXT_START,
                "deleteCount": ENGINE_TEXT_MUTATION_DELETE_COUNT,
                "insertOffset": ENGINE_TEXT_MUTATION_INSERT_OFFSET,
                "insertCount": ENGINE_TEXT_MUTATION_INSERT_COUNT,
                "paragraphId": ENGINE_TEXT_MUTATION_PARAGRAPH_ID
            },
            "engineStyleMutation": {
                "size": ENGINE_STYLE_MUTATION_RECORD_SIZE,
                "alignment": ENGINE_STYLE_MUTATION_RECORD_ALIGNMENT,
                "opcode": ENGINE_STYLE_MUTATION_OPCODE,
                "direction": ENGINE_STYLE_MUTATION_DIRECTION,
                "decorationStyle": ENGINE_STYLE_MUTATION_DECORATION_STYLE,
                "flags": ENGINE_STYLE_MUTATION_FLAGS,
                "styleId": ENGINE_STYLE_MUTATION_STYLE_ID,
                "cascadeOrder": ENGINE_STYLE_MUTATION_CASCADE_ORDER,
                "fieldMask": ENGINE_STYLE_MUTATION_FIELD_MASK,
                "textStart": ENGINE_STYLE_MUTATION_TEXT_START,
                "textEnd": ENGINE_STYLE_MUTATION_TEXT_END,
                "fontStackHandle": ENGINE_STYLE_MUTATION_FONT_STACK_HANDLE,
                "materialId": ENGINE_STYLE_MUTATION_MATERIAL_ID,
                "languageOffset": ENGINE_STYLE_MUTATION_LANGUAGE_OFFSET,
                "languageLength": ENGINE_STYLE_MUTATION_LANGUAGE_LENGTH,
                "featureCount": ENGINE_STYLE_MUTATION_FEATURE_COUNT,
                "featuresOffset": ENGINE_STYLE_MUTATION_FEATURES_OFFSET,
                "fontSize": ENGINE_STYLE_MUTATION_FONT_SIZE,
                "lineHeight": ENGINE_STYLE_MUTATION_LINE_HEIGHT,
                "letterSpacing": ENGINE_STYLE_MUTATION_LETTER_SPACING,
                "wordSpacing": ENGINE_STYLE_MUTATION_WORD_SPACING,
                "baselineShift": ENGINE_STYLE_MUTATION_BASELINE_SHIFT,
                "rasterPixelRatio": ENGINE_STYLE_MUTATION_RASTER_PIXEL_RATIO,
                "foregroundRgba": ENGINE_STYLE_MUTATION_FOREGROUND_RGBA,
                "decorationRgba": ENGINE_STYLE_MUTATION_DECORATION_RGBA,
                "decorationFlags": ENGINE_STYLE_MUTATION_DECORATION_FLAGS,
                "decorationThickness": ENGINE_STYLE_MUTATION_DECORATION_THICKNESS,
                "decorationOffset": ENGINE_STYLE_MUTATION_DECORATION_OFFSET,
                "opacity": ENGINE_STYLE_MUTATION_OPACITY,
                "outlineRgba": ENGINE_STYLE_MUTATION_OUTLINE_RGBA,
                "outlineWidth": ENGINE_STYLE_MUTATION_OUTLINE_WIDTH,
                "shadowRgba": ENGINE_STYLE_MUTATION_SHADOW_RGBA,
                "shadowOffsetX": ENGINE_STYLE_MUTATION_SHADOW_OFFSET_X,
                "shadowOffsetY": ENGINE_STYLE_MUTATION_SHADOW_OFFSET_Y,
                "paragraphId": ENGINE_STYLE_MUTATION_PARAGRAPH_ID
            },
            "engineConstraint": {
                "size": ENGINE_CONSTRAINT_RECORD_SIZE,
                "alignment": ENGINE_CONSTRAINT_RECORD_ALIGNMENT,
                "flowThreadId": ENGINE_CONSTRAINT_FLOW_THREAD_ID,
                "geometryRevision": ENGINE_CONSTRAINT_GEOMETRY_REVISION,
                "width": ENGINE_CONSTRAINT_WIDTH,
                "height": ENGINE_CONSTRAINT_HEIGHT,
                "viewportBlockStart": ENGINE_CONSTRAINT_VIEWPORT_BLOCK_START,
                "viewportBlockEnd": ENGINE_CONSTRAINT_VIEWPORT_BLOCK_END,
                "resumeBlockOffset": ENGINE_CONSTRAINT_RESUME_BLOCK_OFFSET,
                "maxLines": ENGINE_CONSTRAINT_MAX_LINES,
                "regionStart": ENGINE_CONSTRAINT_REGION_START,
                "resumeCluster": ENGINE_CONSTRAINT_RESUME_CLUSTER,
                "regionCount": ENGINE_CONSTRAINT_REGION_COUNT,
                "resumeRegion": ENGINE_CONSTRAINT_RESUME_REGION,
                "widthMode": ENGINE_CONSTRAINT_WIDTH_MODE,
                "heightMode": ENGINE_CONSTRAINT_HEIGHT_MODE,
                "wrap": ENGINE_CONSTRAINT_WRAP,
                "align": ENGINE_CONSTRAINT_ALIGN,
                "overflow": ENGINE_CONSTRAINT_OVERFLOW,
                "blockAlign": ENGINE_CONSTRAINT_BLOCK_ALIGN,
                "flags": ENGINE_CONSTRAINT_FLAGS,
                "paragraphId": ENGINE_CONSTRAINT_PARAGRAPH_ID,
                "firstLineIndent": ENGINE_CONSTRAINT_FIRST_LINE_INDENT,
                "spaceBefore": ENGINE_CONSTRAINT_SPACE_BEFORE,
                "spaceAfter": ENGINE_CONSTRAINT_SPACE_AFTER,
                "justifyMinWordSpaceRatio": ENGINE_CONSTRAINT_JUSTIFY_MIN_WORD_SPACE_RATIO,
                "justifyMaxWordSpaceRatio": ENGINE_CONSTRAINT_JUSTIFY_MAX_WORD_SPACE_RATIO,
                "justifyLetterSpaceExpansion": ENGINE_CONSTRAINT_JUSTIFY_LETTER_SPACE_EXPANSION,
                "lastLine": ENGINE_CONSTRAINT_LAST_LINE
            },
            "engineFlowVertex": {
                "size": ENGINE_FLOW_VERTEX_RECORD_SIZE,
                "alignment": ENGINE_FLOW_VERTEX_RECORD_ALIGNMENT,
                "inline": ENGINE_FLOW_VERTEX_INLINE,
                "block": ENGINE_FLOW_VERTEX_BLOCK
            },
            "engineRegion": {
                "size": ENGINE_REGION_RECORD_SIZE,
                "alignment": ENGINE_REGION_RECORD_ALIGNMENT,
                "id": ENGINE_REGION_ID,
                "geometryRevision": ENGINE_REGION_GEOMETRY_REVISION,
                "transformIndex": ENGINE_REGION_TRANSFORM_INDEX,
                "verticesOffset": ENGINE_REGION_VERTICES_OFFSET,
                "vertexCount": ENGINE_REGION_VERTEX_COUNT,
                "exclusionStart": ENGINE_REGION_EXCLUSION_START,
                "exclusionCount": ENGINE_REGION_EXCLUSION_COUNT,
                "flags": ENGINE_REGION_FLAGS,
                "shape": ENGINE_REGION_SHAPE,
                "writingMode": ENGINE_REGION_WRITING_MODE,
                "textOrientation": ENGINE_REGION_TEXT_ORIENTATION,
                "reserved0": ENGINE_REGION_RESERVED0,
                "inlineStart": ENGINE_REGION_INLINE_START,
                "blockStart": ENGINE_REGION_BLOCK_START,
                "inlineEnd": ENGINE_REGION_INLINE_END,
                "blockEnd": ENGINE_REGION_BLOCK_END,
                "clipInlineStart": ENGINE_REGION_CLIP_INLINE_START,
                "clipBlockStart": ENGINE_REGION_CLIP_BLOCK_START,
                "clipInlineEnd": ENGINE_REGION_CLIP_INLINE_END,
                "clipBlockEnd": ENGINE_REGION_CLIP_BLOCK_END
            },
            "engineExclusion": {
                "size": ENGINE_EXCLUSION_RECORD_SIZE,
                "alignment": ENGINE_EXCLUSION_RECORD_ALIGNMENT,
                "id": ENGINE_EXCLUSION_ID,
                "regionId": ENGINE_EXCLUSION_REGION_ID,
                "geometryRevision": ENGINE_EXCLUSION_GEOMETRY_REVISION,
                "verticesOffset": ENGINE_EXCLUSION_VERTICES_OFFSET,
                "vertexCount": ENGINE_EXCLUSION_VERTEX_COUNT,
                "flags": ENGINE_EXCLUSION_FLAGS,
                "shape": ENGINE_EXCLUSION_SHAPE,
                "wrapSide": ENGINE_EXCLUSION_WRAP_SIDE,
                "reserved0": ENGINE_EXCLUSION_RESERVED0,
                "inlineStart": ENGINE_EXCLUSION_INLINE_START,
                "blockStart": ENGINE_EXCLUSION_BLOCK_START,
                "inlineEnd": ENGINE_EXCLUSION_INLINE_END,
                "blockEnd": ENGINE_EXCLUSION_BLOCK_END,
                "marginInline": ENGINE_EXCLUSION_MARGIN_INLINE,
                "marginBlock": ENGINE_EXCLUSION_MARGIN_BLOCK
            },
            "engineInlineObject": {
                "size": ENGINE_INLINE_OBJECT_RECORD_SIZE,
                "alignment": ENGINE_INLINE_OBJECT_RECORD_ALIGNMENT,
                "id": ENGINE_INLINE_OBJECT_ID,
                "contentRevision": ENGINE_INLINE_OBJECT_CONTENT_REVISION,
                "textOffset": ENGINE_INLINE_OBJECT_TEXT_OFFSET,
                "materialId": ENGINE_INLINE_OBJECT_MATERIAL_ID,
                "resourceId": ENGINE_INLINE_OBJECT_RESOURCE_ID,
                "resourceGeneration": ENGINE_INLINE_OBJECT_RESOURCE_GENERATION,
                "inlineExtent": ENGINE_INLINE_OBJECT_INLINE_EXTENT,
                "blockExtent": ENGINE_INLINE_OBJECT_BLOCK_EXTENT,
                "baselineOffset": ENGINE_INLINE_OBJECT_BASELINE_OFFSET,
                "marginInlineStart": ENGINE_INLINE_OBJECT_MARGIN_INLINE_START,
                "marginInlineEnd": ENGINE_INLINE_OBJECT_MARGIN_INLINE_END,
                "marginBlockStart": ENGINE_INLINE_OBJECT_MARGIN_BLOCK_START,
                "marginBlockEnd": ENGINE_INLINE_OBJECT_MARGIN_BLOCK_END,
                "baselineAlignment": ENGINE_INLINE_OBJECT_BASELINE_ALIGNMENT,
                "flags": ENGINE_INLINE_OBJECT_FLAGS,
                "reserved0": ENGINE_INLINE_OBJECT_RESERVED0,
                "paragraphId": ENGINE_INLINE_OBJECT_PARAGRAPH_ID
            },
            "engineResult": {
                "size": ENGINE_RESULT_HEADER_SIZE,
                "alignment": ENGINE_RESULT_HEADER_ALIGNMENT,
                "abiVersion": ENGINE_RESULT_ABI_VERSION,
                "byteLength": ENGINE_RESULT_BYTE_LENGTH,
                "status": ENGINE_RESULT_STATUS,
                "flags": ENGINE_RESULT_FLAGS,
                "plannerId": ENGINE_RESULT_PLANNER_ID,
                "engineRevision": ENGINE_RESULT_ENGINE_REVISION,
                "planRevision": ENGINE_RESULT_PLAN_REVISION,
                "requiredBaseRevision": ENGINE_RESULT_REQUIRED_BASE_REVISION,
                "publicationGeneration": ENGINE_RESULT_PUBLICATION_GENERATION,
                "outputSlot": ENGINE_RESULT_OUTPUT_SLOT,
                "requestCapacity": ENGINE_RESULT_REQUEST_CAPACITY,
                "requiredRequestCapacity": ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY,
                "resultCapacity": ENGINE_RESULT_RESULT_CAPACITY,
                "requiredResultCapacity": ENGINE_RESULT_REQUIRED_RESULT_CAPACITY,
                "policyHandle": ENGINE_RESULT_POLICY_HANDLE,
                "capabilitySet": ENGINE_RESULT_CAPABILITY_SET,
                "policyFingerprintLow": ENGINE_RESULT_POLICY_FINGERPRINT_LOW,
                "policyFingerprintHigh": ENGINE_RESULT_POLICY_FINGERPRINT_HIGH,
                "semanticViewsOffset": ENGINE_RESULT_SEMANTICS_OFFSET,
                "semanticViewCount": ENGINE_RESULT_SEMANTICS_COUNT,
                "resourcesOffset": ENGINE_RESULT_RESOURCES_OFFSET,
                "resourceCount": ENGINE_RESULT_RESOURCE_COUNT,
                "buffersOffset": ENGINE_RESULT_BUFFERS_OFFSET,
                "bufferCount": ENGINE_RESULT_BUFFER_COUNT,
                "patchesOffset": ENGINE_RESULT_PATCHES_OFFSET,
                "patchCount": ENGINE_RESULT_PATCH_COUNT,
                "primitivesOffset": ENGINE_RESULT_PRIMITIVES_OFFSET,
                "primitiveCount": ENGINE_RESULT_PRIMITIVE_COUNT,
                "drawsOffset": ENGINE_RESULT_DRAWS_OFFSET,
                "drawCount": ENGINE_RESULT_DRAW_COUNT,
                "retirementsOffset": ENGINE_RESULT_RETIREMENTS_OFFSET,
                "retirementCount": ENGINE_RESULT_RETIREMENT_COUNT,
                "diagnosticsOffset": ENGINE_RESULT_DIAGNOSTICS_OFFSET,
                "diagnosticCount": ENGINE_RESULT_DIAGNOSTIC_COUNT,
                "faultParagraphId": ENGINE_RESULT_FAULT_PARAGRAPH_ID,
                "faultStyleId": ENGINE_RESULT_FAULT_STYLE_ID
            },
            "engineSemanticView": {
                "size": SEMANTIC_RECORD_SIZE,
                "alignment": SEMANTIC_RECORD_ALIGNMENT,
                "id": SEMANTIC_ID,
                "kind": SEMANTIC_KIND,
                "flags": SEMANTIC_FLAGS,
                "parentId": SEMANTIC_PARENT_ID,
                "textStart": SEMANTIC_TEXT_START,
                "textEnd": SEMANTIC_TEXT_END,
                "itemStart": SEMANTIC_ITEM_START,
                "itemCount": SEMANTIC_ITEM_COUNT,
                "inlineStart": SEMANTIC_INLINE_START,
                "blockStart": SEMANTIC_BLOCK_START,
                "inlineExtent": SEMANTIC_INLINE_EXTENT,
                "blockExtent": SEMANTIC_BLOCK_EXTENT,
                "inlineAdvance": SEMANTIC_INLINE_ADVANCE,
                "inkInlineStart": SEMANTIC_INK_INLINE_START,
                "inkBlockStart": SEMANTIC_INK_BLOCK_START,
                "inkInlineExtent": SEMANTIC_INK_INLINE_EXTENT,
                "inkBlockExtent": SEMANTIC_INK_BLOCK_EXTENT,
                "ascent": SEMANTIC_ASCENT,
                "minContentWidth": SEMANTIC_MIN_CONTENT_WIDTH,
                "maxContentWidth": SEMANTIC_MAX_CONTENT_WIDTH
            },
            "engineResource": {
                "size": RESOURCE_RECORD_SIZE,
                "alignment": RESOURCE_RECORD_ALIGNMENT,
                "id": RESOURCE_ID,
                "generation": RESOURCE_GENERATION,
                "techniqueId": RESOURCE_TECHNIQUE_ID,
                "resourceKind": RESOURCE_KIND,
                "action": RESOURCE_ACTION,
                "flags": RESOURCE_FLAGS,
                "referenceId": RESOURCE_REFERENCE_ID,
                "lowerBound": RESOURCE_LOWER_BOUND,
                "upperBound": RESOURCE_UPPER_BOUND,
                "auxiliary0": RESOURCE_AUXILIARY0,
                "auxiliary1": RESOURCE_AUXILIARY1
            },
            "engineBuffer": {
                "size": BUFFER_RECORD_SIZE,
                "alignment": BUFFER_RECORD_ALIGNMENT,
                "id": BUFFER_ID,
                "generation": BUFFER_GENERATION,
                "programId": BUFFER_PROGRAM_ID,
                "policyBufferId": BUFFER_POLICY_BUFFER_ID,
                "scalarType": BUFFER_SCALAR_TYPE,
                "vectorWidth": BUFFER_VECTOR_WIDTH,
                "strategy": BUFFER_STRATEGY,
                "flags": BUFFER_FLAGS,
                "liveRecords": BUFFER_LIVE_RECORDS,
                "capacityRecords": BUFFER_CAPACITY_RECORDS,
                "byteLength": BUFFER_BYTE_LENGTH,
                "orderBufferId": BUFFER_ORDER_BUFFER_ID
            },
            "enginePatch": {
                "size": PATCH_RECORD_SIZE,
                "alignment": PATCH_RECORD_ALIGNMENT,
                "opcode": PATCH_OPCODE,
                "flags": PATCH_FLAGS,
                "bufferId": PATCH_BUFFER_ID,
                "bufferGeneration": PATCH_BUFFER_GENERATION,
                "destinationOffset": PATCH_DESTINATION_OFFSET,
                "byteLength": PATCH_BYTE_LENGTH,
                "payloadOffset": PATCH_PAYLOAD_OFFSET,
                "sourceBufferId": PATCH_SOURCE_BUFFER_ID,
                "sourceOffset": PATCH_SOURCE_OFFSET,
                "fillValue": PATCH_FILL_VALUE
            },
            "enginePrimitive": {
                "size": PRIMITIVE_RECORD_SIZE,
                "alignment": PRIMITIVE_RECORD_ALIGNMENT,
                "id": PRIMITIVE_ID,
                "kind": PRIMITIVE_KIND,
                "flags": PRIMITIVE_FLAGS,
                "techniqueId": PRIMITIVE_TECHNIQUE_ID,
                "resourceId": PRIMITIVE_RESOURCE_ID,
                "resourceGeneration": PRIMITIVE_RESOURCE_GENERATION,
                "programId": PRIMITIVE_PROGRAM_ID,
                "programVariant": PRIMITIVE_PROGRAM_VARIANT,
                "recordCount": PRIMITIVE_RECORD_COUNT,
                "bufferId": PRIMITIVE_BUFFER_ID,
                "recordIndex": PRIMITIVE_RECORD_INDEX,
                "logicalOrder": PRIMITIVE_LOGICAL_ORDER,
                "clipId": PRIMITIVE_CLIP_ID,
                "semanticId": PRIMITIVE_SEMANTIC_ID,
                "inlineStart": PRIMITIVE_INLINE_START,
                "blockStart": PRIMITIVE_BLOCK_START,
                "inlineExtent": PRIMITIVE_INLINE_EXTENT,
                "blockExtent": PRIMITIVE_BLOCK_EXTENT
            },
            "engineDraw": {
                "size": DRAW_RECORD_SIZE,
                "alignment": DRAW_RECORD_ALIGNMENT,
                "id": DRAW_ID,
                "programId": DRAW_PROGRAM_ID,
                "programVariant": DRAW_PROGRAM_VARIANT,
                "flags": DRAW_FLAGS,
                "materialId": DRAW_MATERIAL_ID,
                "clipId": DRAW_CLIP_ID,
                "depthKey": DRAW_DEPTH_KEY,
                "transformId": DRAW_TRANSFORM_ID,
                "primitiveStart": DRAW_PRIMITIVE_START,
                "primitiveCount": DRAW_PRIMITIVE_COUNT,
                "bufferStart": DRAW_BUFFER_START,
                "bufferCount": DRAW_BUFFER_COUNT,
                "resourceStart": DRAW_RESOURCE_START,
                "resourceCount": DRAW_RESOURCE_COUNT,
                "orderToken": DRAW_ORDER_TOKEN,
                "indirectBufferId": DRAW_INDIRECT_BUFFER_ID,
                "indirectOffset": DRAW_INDIRECT_OFFSET
            },
            "engineRetirement": {
                "size": RETIREMENT_RECORD_SIZE,
                "alignment": RETIREMENT_RECORD_ALIGNMENT,
                "kind": RETIREMENT_KIND,
                "flags": RETIREMENT_FLAGS,
                "id": RETIREMENT_ID,
                "generation": RETIREMENT_GENERATION,
                "afterPublicationGeneration": RETIREMENT_AFTER_PUBLICATION_GENERATION,
                "byteOffset": RETIREMENT_BYTE_OFFSET,
                "byteLength": RETIREMENT_BYTE_LENGTH
            },
            "engineDiagnostic": {
                "size": DIAGNOSTIC_RECORD_SIZE,
                "alignment": DIAGNOSTIC_RECORD_ALIGNMENT,
                "code": DIAGNOSTIC_CODE,
                "severity": DIAGNOSTIC_SEVERITY,
                "phase": DIAGNOSTIC_PHASE,
                "subjectId": DIAGNOSTIC_SUBJECT_ID,
                "value0": DIAGNOSTIC_VALUE0,
                "value1": DIAGNOSTIC_VALUE1,
                "durationNanosLow": DIAGNOSTIC_DURATION_NANOS_LOW,
                "durationNanosHigh": DIAGNOSTIC_DURATION_NANOS_HIGH
            },
            "feature": {
                "size": FEATURE_RECORD_SIZE,
                "alignment": FEATURE_RECORD_ALIGNMENT,
                "tag": FEATURE_TAG,
                "value": FEATURE_VALUE,
                "start": FEATURE_START,
                "end": FEATURE_END
            },
        },
        "policy": {
            "capabilityFlags": {
                "storageBuffers": CAP_STORAGE_BUFFERS,
                "indirectDraws": CAP_INDIRECT_DRAWS,
                "aliasVec2": CAP_ALIAS_VEC2,
                "aliasVec4": CAP_ALIAS_VEC4,
                "orderedDirect": CAP_ORDERED_DIRECT,
                "stableIndirect": CAP_STABLE_INDIRECT
            },
            "batchFields": {
                "technique": BATCH_TECHNIQUE,
                "resource": BATCH_RESOURCE,
                "program": BATCH_PROGRAM,
                "material": BATCH_MATERIAL,
                "clip": BATCH_CLIP,
                "depth": BATCH_DEPTH,
                "order": BATCH_ORDER,
                "transform": BATCH_TRANSFORM
            },
            "bufferUsage": {
                "vertex": BUFFER_USAGE_VERTEX,
                "storage": BUFFER_USAGE_STORAGE,
                "copyDst": BUFFER_USAGE_COPY_DST
            },
            "allocationStrategies": {
                "orderedDirect": ALLOCATION_ORDERED_DIRECT,
                "stableIndirect": ALLOCATION_STABLE_INDIRECT
            },
            "scalarTypes": {
                "f32": ScalarType::F32 as u8,
                "u32": ScalarType::U32 as u8,
                "u16": ScalarType::U16 as u8
            },
            "inputScopes": {
                "semantic": INPUT_SEMANTIC,
                "glyph": INPUT_GLYPH,
                "resource": INPUT_RESOURCE,
                "strike": INPUT_STRIKE
            },
            "opcodes": {
                "loadF32": OP_LOAD_F32,
                "loadU32": OP_LOAD_U32,
                "constantF32": OP_CONSTANT_F32,
                "constantU32": OP_CONSTANT_U32,
                "addF32": OP_ADD_F32,
                "subtractF32": OP_SUBTRACT_F32,
                "multiplyF32": OP_MULTIPLY_F32,
                "lessThanF32": OP_LESS_THAN_F32,
                "selectF32": OP_SELECT_F32,
                "convertU32ToF32": OP_CONVERT_U32_TO_F32,
                "storeF32": OP_STORE_F32,
                "storeU32": OP_STORE_U32,
                "storeU16": OP_STORE_U16
            }
        },
        "engine": {
            "defaultPlannerTextCapacity": DEFAULT_PLANNER_TEXT_CAPACITY,
            "frameFlags": {
                "compositingIndependent": crate::engine::frame::FRAME_FLAG_COMPOSITING_INDEPENDENT
            },
            "semanticF32Fields": {
                "inlineStart": SEMANTIC_F32_INLINE_START,
                "blockStart": SEMANTIC_F32_BLOCK_START,
                "inlineExtent": SEMANTIC_F32_INLINE_EXTENT,
                "blockExtent": SEMANTIC_F32_BLOCK_EXTENT,
                "fontSize": SEMANTIC_F32_FONT_SIZE,
                "rasterPixelRatio": SEMANTIC_F32_RASTER_PIXEL_RATIO,
                "inlineOrigin": SEMANTIC_F32_INLINE_ORIGIN,
                "blockOrigin": SEMANTIC_F32_BLOCK_ORIGIN,
                "foregroundRed": SEMANTIC_F32_FOREGROUND_RED,
                "foregroundGreen": SEMANTIC_F32_FOREGROUND_GREEN,
                "foregroundBlue": SEMANTIC_F32_FOREGROUND_BLUE,
                "foregroundAlpha": SEMANTIC_F32_FOREGROUND_ALPHA,
                "inverseFontSize": SEMANTIC_F32_INVERSE_FONT_SIZE,
                "outlineRed": SEMANTIC_F32_OUTLINE_RED,
                "outlineGreen": SEMANTIC_F32_OUTLINE_GREEN,
                "outlineBlue": SEMANTIC_F32_OUTLINE_BLUE,
                "outlineAlpha": SEMANTIC_F32_OUTLINE_ALPHA,
                "outlineWidth": SEMANTIC_F32_OUTLINE_WIDTH,
                "shadowRed": SEMANTIC_F32_SHADOW_RED,
                "shadowGreen": SEMANTIC_F32_SHADOW_GREEN,
                "shadowBlue": SEMANTIC_F32_SHADOW_BLUE,
                "shadowAlpha": SEMANTIC_F32_SHADOW_ALPHA,
                "shadowOffsetX": SEMANTIC_F32_SHADOW_OFFSET_X,
                "shadowOffsetY": SEMANTIC_F32_SHADOW_OFFSET_Y
            },
            "semanticU32Fields": {
                "foregroundRgba": SEMANTIC_U32_FOREGROUND_RGBA,
                "clusterId": SEMANTIC_U32_CLUSTER_ID,
                "regionId": SEMANTIC_U32_REGION_ID,
                "flowThreadId": SEMANTIC_U32_FLOW_THREAD_ID,
                "transformIndex": SEMANTIC_U32_TRANSFORM_INDEX,
                "stableGlyphId": SEMANTIC_U32_STABLE_GLYPH_ID
            },
            "paragraphMutationOpcodes": {
                "upsert": PARAGRAPH_MUTATION_UPSERT,
                "remove": PARAGRAPH_MUTATION_REMOVE
            },
            "textMutationOpcodes": {
                "replaceUtf16": TEXT_MUTATION_REPLACE_UTF16
            },
            "textEncodings": {
                "utf16Le": TEXT_ENCODING_UTF16_LE
            },
            "styleMutationOpcodes": {
                "upsert": STYLE_MUTATION_UPSERT,
                "remove": STYLE_MUTATION_REMOVE
            },
            "styleFlags": {
                "root": STYLE_FLAG_ROOT
            },
            "styleFields": {
                "fontStack": STYLE_FIELD_FONT_STACK,
                "material": STYLE_FIELD_MATERIAL,
                "language": STYLE_FIELD_LANGUAGE,
                "features": STYLE_FIELD_FEATURES,
                "fontSize": STYLE_FIELD_FONT_SIZE,
                "lineHeight": STYLE_FIELD_LINE_HEIGHT,
                "letterSpacing": STYLE_FIELD_LETTER_SPACING,
                "wordSpacing": STYLE_FIELD_WORD_SPACING,
                "baselineShift": STYLE_FIELD_BASELINE_SHIFT,
                "rasterPixelRatio": STYLE_FIELD_RASTER_PIXEL_RATIO,
                "direction": STYLE_FIELD_DIRECTION,
                "foreground": STYLE_FIELD_FOREGROUND,
                "decoration": STYLE_FIELD_DECORATION,
                "opacity": STYLE_FIELD_OPACITY,
                "outline": STYLE_FIELD_OUTLINE,
                "shadow": STYLE_FIELD_SHADOW,
                "all": STYLE_FIELD_MASK
            },
            "decorationStyles": {
                "none": DECORATION_NONE,
                "solid": DECORATION_SOLID,
                "double": DECORATION_DOUBLE,
                "dotted": DECORATION_DOTTED,
                "dashed": DECORATION_DASHED,
                "wavy": DECORATION_WAVY
            },
            "decorationFlags": {
                "underline": DECORATION_UNDERLINE,
                "overline": DECORATION_OVERLINE,
                "lineThrough": DECORATION_LINE_THROUGH,
                "skipInk": DECORATION_SKIP_INK,
                "all": DECORATION_FLAGS_MASK
            },
            "flowShapeKinds": {
                "rectangle": SHAPE_RECTANGLE,
                "polygon": SHAPE_POLYGON
            },
            "writingModes": {
                "horizontalTb": WRITING_HORIZONTAL_TB,
                "verticalRl": WRITING_VERTICAL_RL,
                "verticalLr": WRITING_VERTICAL_LR
            },
            "textOrientations": {
                "mixed": ORIENTATION_MIXED,
                "upright": ORIENTATION_UPRIGHT,
                "sideways": ORIENTATION_SIDEWAYS
            },
            "axisModes": {
                "unconstrained": AXIS_UNCONSTRAINED,
                "atMost": AXIS_AT_MOST,
                "exact": AXIS_EXACT
            },
            "wrapModes": {
                "none": WRAP_NONE,
                "word": WRAP_WORD,
                "character": WRAP_CHARACTER
            },
            "inlineAlignments": {
                "start": ALIGN_START,
                "center": ALIGN_CENTER,
                "end": ALIGN_END,
                "justify": ALIGN_JUSTIFY
            },
            "lastLinePolicies": {
                "auto": LAST_LINE_AUTO,
                "justify": LAST_LINE_JUSTIFY
            },
            "overflowModes": {
                "visible": OVERFLOW_VISIBLE,
                "clip": OVERFLOW_CLIP,
                "ellipsis": OVERFLOW_ELLIPSIS
            },
            "blockAlignments": {
                "start": BLOCK_ALIGN_START,
                "center": BLOCK_ALIGN_CENTER,
                "end": BLOCK_ALIGN_END
            },
            "exclusionWrapSides": {
                "both": EXCLUSION_WRAP_BOTH,
                "inlineStart": EXCLUSION_WRAP_INLINE_START,
                "inlineEnd": EXCLUSION_WRAP_INLINE_END,
                "largest": EXCLUSION_WRAP_LARGEST
            },
            "inlineObjectBaselines": {
                "alphabetic": BASELINE_ALPHABETIC,
                "textTop": BASELINE_TEXT_TOP,
                "middle": BASELINE_MIDDLE,
                "textBottom": BASELINE_TEXT_BOTTOM
            },
            "resultFlags": {
                "checkpoint": RESULT_FLAG_CHECKPOINT
            },
            "semanticViewMasks": {
                "all": SEMANTIC_VIEW_MASK,
                "measurement": SEMANTIC_VIEW_MEASUREMENT,
                "layoutInspection": SEMANTIC_VIEW_LAYOUT_INSPECTION
            },
            "measurementFlags": {
                "overflowed": crate::engine::layout_query::MEASUREMENT_FLAG_OVERFLOWED,
                "inkBounds": crate::engine::layout_query::MEASUREMENT_FLAG_INK_BOUNDS
            },
            "glyphFlags": {
                "unsafeToBreak": crate::engine::shaping_state::GLYPH_FLAG_UNSAFE_TO_BREAK,
                "unsafeToConcat": crate::engine::shaping_state::GLYPH_FLAG_UNSAFE_TO_CONCAT,
                "produced": crate::engine::shaping_state::GLYPH_FLAGS_PRODUCED
            },
            "semanticKinds": {
                "line": SEMANTIC_LINE,
                "fragment": SEMANTIC_FRAGMENT,
                "run": SEMANTIC_RUN,
                "cluster": SEMANTIC_CLUSTER,
                "caret": SEMANTIC_CARET,
                "selection": SEMANTIC_SELECTION,
                "insertedGlyph": SEMANTIC_INSERTED_GLYPH,
                "paragraphMeasurement": SEMANTIC_PARAGRAPH_MEASUREMENT,
                "glyph": SEMANTIC_GLYPH
            },
            "resourceActions": {
                "create": RESOURCE_ACTION_CREATE,
                "update": RESOURCE_ACTION_UPDATE,
                "retain": RESOURCE_ACTION_RETAIN
            },
            "bufferStrategies": {
                "orderedDirect": BUFFER_ORDERED_DIRECT,
                "stableIndirect": BUFFER_STABLE_INDIRECT
            },
            "internalBufferBindings": {
                "order": POLICY_BUFFER_ORDER
            },
            "patchOpcodes": {
                "allocateOrResize": PATCH_ALLOCATE_OR_RESIZE,
                "write": PATCH_WRITE,
                "fill": PATCH_FILL,
                "copy": PATCH_COPY,
                "retire": PATCH_RETIRE
            },
            "primitiveKinds": {
                "glyph": PRIMITIVE_GLYPH,
                "decoration": PRIMITIVE_DECORATION,
                "inlineObject": PRIMITIVE_INLINE_OBJECT,
                "clip": PRIMITIVE_CLIP,
                "policy": PRIMITIVE_POLICY
            },
            "retirementKinds": {
                "resource": RETIRE_RESOURCE,
                "buffer": RETIRE_BUFFER,
                "slotRange": RETIRE_SLOT_RANGE,
                "outputBytes": RETIRE_OUTPUT_BYTES
            }
        },
        "status": {
            "ok": 0,
            "invalidHandle": 1,
            "invalidFont": 2,
            "invalidExtents": 3,
            "handleConflict": 4,
            "fontMissing": 5,
            "invalidRequest": 6,
            "resultTooLarge": 7,
            "policyConflict": 8,
            "policyMissing": 9,
            "plannerConflict": 10,
            "plannerMissing": 11,
            "revisionConflict": 12,
            "fontStackMissing": 13,
            "fontInUse": 14,
            "styleRangeInvalid": 15,
            "styleSplitsCluster": 16,
            "styleNestingInvalid": 17,
            "styleRootInvalid": 18,
            "fontMetricsMissing": 19,
            "registrationInUse": 20
        }
    })
    .to_string()
}
