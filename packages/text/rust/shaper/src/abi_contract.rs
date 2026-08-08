use alloc::string::{String, ToString};
use core::mem::{align_of, offset_of, size_of};
use serde_json::json;

use crate::engine::frame::RESULT_FLAG_CHECKPOINT;
use crate::engine::policy::{
    OP_ADD_F32, OP_CONSTANT_F32, OP_CONSTANT_U32, OP_CONVERT_U32_TO_F32, OP_LESS_THAN_F32,
    OP_LOAD_F32, OP_LOAD_U32, OP_MULTIPLY_F32, OP_SELECT_F32, OP_STORE_F32, OP_STORE_U16,
    OP_STORE_U32, OP_SUBTRACT_F32, ScalarType,
};

pub const ABI_VERSION: u32 = 0;
pub const SHAPER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const UNICODE_VERSION: &str = "17.0.0";

#[repr(C)]
struct ShapeRequestHeader {
    text_offset: u32,
    text_length: u32,
    runs_offset: u32,
    run_count: u32,
    features_offset: u32,
    feature_count: u32,
    languages_offset: u32,
    languages_length: u32,
}

#[repr(C)]
struct ReshapeRequestHeader {
    shape: ShapeRequestHeader,
    ranges_offset: u32,
    range_count: u32,
}

#[repr(C)]
struct BidiRequestHeader {
    text_offset: u32,
    text_length: u32,
    direction: u8,
    reserved: [u8; 3],
}

#[repr(C)]
struct PolicyRequestHeader {
    byte_length: u32,
    programs_offset: u32,
    program_count: u32,
    buffers_offset: u32,
    buffer_count: u32,
    operations_offset: u32,
    operation_count: u32,
}

#[repr(C)]
struct PolicyProgramRecord {
    technique_id: u32,
    program_id: u32,
    variant: u16,
    f32_input_count: u8,
    u32_input_count: u8,
    paint_capabilities: u32,
    compositing_capabilities: u32,
    buffer_start: u32,
    buffer_count: u16,
    reserved0: u16,
    operation_start: u32,
    operation_count: u16,
    reserved1: u16,
}

#[repr(C)]
struct PolicyBufferRecord {
    id: u16,
    scalar: u8,
    vector_width: u8,
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
    session_id: u32,
    expected_engine_revision: u32,
    consumed_plan_revision: u32,
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
}

#[repr(C, align(16))]
struct EngineResultHeader {
    abi_version: u32,
    byte_length: u32,
    status: u32,
    flags: u32,
    session_id: u32,
    engine_revision: u32,
    plan_revision: u32,
    required_base_revision: u32,
    publication_generation: u32,
    output_slot: u32,
    request_capacity: u32,
    required_request_capacity: u32,
    result_capacity: u32,
    required_result_capacity: u32,
    semantics_offset: u32,
    semantics_count: u32,
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
}

#[repr(C)]
struct FeatureRecord {
    tag: u32,
    value: u32,
    start: u32,
    end: u32,
}

#[repr(C)]
struct RunRecord {
    font_handle: u32,
    text_start: u32,
    text_end: u32,
    script: u32,
    language_offset: u32,
    feature_start: u32,
    feature_count: u16,
    direction: u8,
    cluster_level: u8,
    flags: u32,
}

#[repr(C)]
struct ReshapeRangeRecord {
    run: u32,
    item_start: u32,
    item_end: u32,
    context_start: u32,
    context_end: u32,
    flags: u32,
}

#[repr(C)]
struct ResultHeader {
    byte_length: u32,
    font_handles_offset: u32,
    font_handle_count: u32,
    run_font_slots_offset: u32,
    run_glyph_starts_offset: u32,
    run_glyph_counts_offset: u32,
    run_count: u32,
    glyph_ids_offset: u32,
    clusters_offset: u32,
    x_advances_offset: u32,
    y_advances_offset: u32,
    x_offsets_offset: u32,
    y_offsets_offset: u32,
    glyph_flags_offset: u32,
    glyph_count: u32,
}

#[repr(C)]
struct BidiResultHeader {
    byte_length: u32,
    levels_offset: u32,
    classes_offset: u32,
    text_length: u32,
    paragraph_starts_offset: u32,
    paragraph_ends_offset: u32,
    paragraph_levels_offset: u32,
    paragraph_count: u32,
}

macro_rules! layout {
    ($size:ident, $alignment:ident, $type:ty) => {
        pub const $size: u32 = size_of::<$type>() as u32;
        pub const $alignment: u32 = align_of::<$type>() as u32;
    };
}

layout!(
    SHAPE_REQUEST_HEADER_SIZE,
    SHAPE_REQUEST_HEADER_ALIGNMENT,
    ShapeRequestHeader
);
layout!(
    RESHAPE_REQUEST_HEADER_SIZE,
    RESHAPE_REQUEST_HEADER_ALIGNMENT,
    ReshapeRequestHeader
);
layout!(
    BIDI_REQUEST_HEADER_SIZE,
    BIDI_REQUEST_HEADER_ALIGNMENT,
    BidiRequestHeader
);
layout!(
    POLICY_REQUEST_HEADER_SIZE,
    POLICY_REQUEST_HEADER_ALIGNMENT,
    PolicyRequestHeader
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
    ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    ENGINE_UPDATE_REQUEST_HEADER_ALIGNMENT,
    EngineUpdateRequestHeader
);
layout!(
    ENGINE_RESULT_HEADER_SIZE,
    ENGINE_RESULT_HEADER_ALIGNMENT,
    EngineResultHeader
);
layout!(FEATURE_RECORD_SIZE, FEATURE_RECORD_ALIGNMENT, FeatureRecord);
layout!(RUN_RECORD_SIZE, RUN_RECORD_ALIGNMENT, RunRecord);
layout!(
    RESHAPE_RANGE_RECORD_SIZE,
    RESHAPE_RANGE_RECORD_ALIGNMENT,
    ReshapeRangeRecord
);
layout!(RESULT_HEADER_SIZE, RESULT_HEADER_ALIGNMENT, ResultHeader);
layout!(
    BIDI_RESULT_HEADER_SIZE,
    BIDI_RESULT_HEADER_ALIGNMENT,
    BidiResultHeader
);

macro_rules! field_offset {
    ($name:ident, $type:ty, $field:ident) => {
        pub const $name: usize = offset_of!($type, $field);
    };
}

field_offset!(SHAPE_TEXT_OFFSET, ShapeRequestHeader, text_offset);
field_offset!(SHAPE_TEXT_LENGTH, ShapeRequestHeader, text_length);
field_offset!(SHAPE_RUNS_OFFSET, ShapeRequestHeader, runs_offset);
field_offset!(SHAPE_RUN_COUNT, ShapeRequestHeader, run_count);
field_offset!(SHAPE_FEATURES_OFFSET, ShapeRequestHeader, features_offset);
field_offset!(SHAPE_FEATURE_COUNT, ShapeRequestHeader, feature_count);
field_offset!(SHAPE_LANGUAGES_OFFSET, ShapeRequestHeader, languages_offset);
field_offset!(SHAPE_LANGUAGES_LENGTH, ShapeRequestHeader, languages_length);
field_offset!(RESHAPE_RANGES_OFFSET, ReshapeRequestHeader, ranges_offset);
field_offset!(RESHAPE_RANGE_COUNT, ReshapeRequestHeader, range_count);
field_offset!(BIDI_TEXT_OFFSET, BidiRequestHeader, text_offset);
field_offset!(BIDI_TEXT_LENGTH, BidiRequestHeader, text_length);
field_offset!(BIDI_DIRECTION, BidiRequestHeader, direction);
field_offset!(POLICY_BYTE_LENGTH, PolicyRequestHeader, byte_length);
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
field_offset!(
    POLICY_PROGRAM_TECHNIQUE_ID,
    PolicyProgramRecord,
    technique_id
);
field_offset!(POLICY_PROGRAM_ID, PolicyProgramRecord, program_id);
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
field_offset!(POLICY_PROGRAM_RESERVED0, PolicyProgramRecord, reserved0);
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
field_offset!(POLICY_PROGRAM_RESERVED1, PolicyProgramRecord, reserved1);
field_offset!(POLICY_BUFFER_ID, PolicyBufferRecord, id);
field_offset!(POLICY_BUFFER_SCALAR, PolicyBufferRecord, scalar);
field_offset!(POLICY_BUFFER_VECTOR_WIDTH, PolicyBufferRecord, vector_width);
field_offset!(POLICY_OPERATION_OPCODE, PolicyOperationRecord, opcode);
field_offset!(POLICY_OPERATION_TARGET, PolicyOperationRecord, target);
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
    ENGINE_UPDATE_SESSION_ID,
    EngineUpdateRequestHeader,
    session_id
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
field_offset!(ENGINE_RESULT_ABI_VERSION, EngineResultHeader, abi_version);
field_offset!(ENGINE_RESULT_BYTE_LENGTH, EngineResultHeader, byte_length);
field_offset!(ENGINE_RESULT_STATUS, EngineResultHeader, status);
field_offset!(ENGINE_RESULT_FLAGS, EngineResultHeader, flags);
field_offset!(ENGINE_RESULT_SESSION_ID, EngineResultHeader, session_id);
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
    ENGINE_RESULT_SEMANTICS_OFFSET,
    EngineResultHeader,
    semantics_offset
);
field_offset!(
    ENGINE_RESULT_SEMANTICS_COUNT,
    EngineResultHeader,
    semantics_count
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
field_offset!(FEATURE_TAG, FeatureRecord, tag);
field_offset!(FEATURE_VALUE, FeatureRecord, value);
field_offset!(FEATURE_START, FeatureRecord, start);
field_offset!(FEATURE_END, FeatureRecord, end);
field_offset!(RUN_FONT_HANDLE, RunRecord, font_handle);
field_offset!(RUN_TEXT_START, RunRecord, text_start);
field_offset!(RUN_TEXT_END, RunRecord, text_end);
field_offset!(RUN_SCRIPT, RunRecord, script);
field_offset!(RUN_LANGUAGE_OFFSET, RunRecord, language_offset);
field_offset!(RUN_FEATURE_START, RunRecord, feature_start);
field_offset!(RUN_FEATURE_COUNT, RunRecord, feature_count);
field_offset!(RUN_DIRECTION, RunRecord, direction);
field_offset!(RUN_CLUSTER_LEVEL, RunRecord, cluster_level);
field_offset!(RUN_FLAGS, RunRecord, flags);
field_offset!(RANGE_RUN, ReshapeRangeRecord, run);
field_offset!(RANGE_ITEM_START, ReshapeRangeRecord, item_start);
field_offset!(RANGE_ITEM_END, ReshapeRangeRecord, item_end);
field_offset!(RANGE_CONTEXT_START, ReshapeRangeRecord, context_start);
field_offset!(RANGE_CONTEXT_END, ReshapeRangeRecord, context_end);
field_offset!(RANGE_FLAGS, ReshapeRangeRecord, flags);
field_offset!(RESULT_BYTE_LENGTH, ResultHeader, byte_length);
field_offset!(
    RESULT_FONT_HANDLES_OFFSET,
    ResultHeader,
    font_handles_offset
);
field_offset!(RESULT_FONT_HANDLE_COUNT, ResultHeader, font_handle_count);
field_offset!(
    RESULT_RUN_FONT_SLOTS_OFFSET,
    ResultHeader,
    run_font_slots_offset
);
field_offset!(
    RESULT_RUN_GLYPH_STARTS_OFFSET,
    ResultHeader,
    run_glyph_starts_offset
);
field_offset!(
    RESULT_RUN_GLYPH_COUNTS_OFFSET,
    ResultHeader,
    run_glyph_counts_offset
);
field_offset!(RESULT_RUN_COUNT, ResultHeader, run_count);
field_offset!(RESULT_GLYPH_IDS_OFFSET, ResultHeader, glyph_ids_offset);
field_offset!(RESULT_CLUSTERS_OFFSET, ResultHeader, clusters_offset);
field_offset!(RESULT_X_ADVANCES_OFFSET, ResultHeader, x_advances_offset);
field_offset!(RESULT_Y_ADVANCES_OFFSET, ResultHeader, y_advances_offset);
field_offset!(RESULT_X_OFFSETS_OFFSET, ResultHeader, x_offsets_offset);
field_offset!(RESULT_Y_OFFSETS_OFFSET, ResultHeader, y_offsets_offset);
field_offset!(RESULT_GLYPH_FLAGS_OFFSET, ResultHeader, glyph_flags_offset);
field_offset!(RESULT_GLYPH_COUNT, ResultHeader, glyph_count);
field_offset!(BIDI_RESULT_BYTE_LENGTH, BidiResultHeader, byte_length);
field_offset!(BIDI_RESULT_LEVELS_OFFSET, BidiResultHeader, levels_offset);
field_offset!(BIDI_RESULT_CLASSES_OFFSET, BidiResultHeader, classes_offset);
field_offset!(BIDI_RESULT_TEXT_LENGTH, BidiResultHeader, text_length);
field_offset!(
    BIDI_RESULT_PARAGRAPH_STARTS_OFFSET,
    BidiResultHeader,
    paragraph_starts_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_ENDS_OFFSET,
    BidiResultHeader,
    paragraph_ends_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_LEVELS_OFFSET,
    BidiResultHeader,
    paragraph_levels_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_COUNT,
    BidiResultHeader,
    paragraph_count
);

pub fn json() -> String {
    json!({
        "name": "pmndrs-text-shaper",
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
            "allocate": "pmndrs_text_shaper_alloc",
            "deallocate": "pmndrs_text_shaper_dealloc",
            "registerFont": "pmndrs_text_shaper_register_font",
            "disposeFont": "pmndrs_text_shaper_dispose_font",
            "fontCount": "pmndrs_text_shaper_font_count",
            "retainedFontBytes": "pmndrs_text_shaper_retained_font_bytes",
            "planCount": "pmndrs_text_shaper_plan_count",
            "registerPolicy": "pmndrs_text_engine_register_policy",
            "disposePolicy": "pmndrs_text_engine_dispose_policy",
            "policyCount": "pmndrs_text_engine_policy_count",
            "createSession": "pmndrs_text_engine_create_session",
            "reserveSession": "pmndrs_text_engine_reserve_session",
            "disposeSession": "pmndrs_text_engine_dispose_session",
            "sessionCount": "pmndrs_text_engine_session_count",
            "requestPointer": "pmndrs_text_engine_request_ptr",
            "requestCapacity": "pmndrs_text_engine_request_capacity",
            "textUpdate": "pmndrs_text_engine_update",
            "shapeBatch": "pmndrs_text_shaper_shape_batch",
            "reshapeRanges": "pmndrs_text_shaper_reshape_ranges",
            "analyzeBidi": "pmndrs_text_shaper_analyze_bidi",
            "resultPointer": "pmndrs_text_shaper_result_ptr",
            "resultLength": "pmndrs_text_shaper_result_len"
        },
        "layouts": {
            "shapeRequest": {
                "size": SHAPE_REQUEST_HEADER_SIZE,
                "alignment": SHAPE_REQUEST_HEADER_ALIGNMENT,
                "textOffset": SHAPE_TEXT_OFFSET,
                "textLength": SHAPE_TEXT_LENGTH,
                "runsOffset": SHAPE_RUNS_OFFSET,
                "runCount": SHAPE_RUN_COUNT,
                "featuresOffset": SHAPE_FEATURES_OFFSET,
                "featureCount": SHAPE_FEATURE_COUNT,
                "languagesOffset": SHAPE_LANGUAGES_OFFSET,
                "languagesLength": SHAPE_LANGUAGES_LENGTH
            },
            "reshapeRequest": {
                "size": RESHAPE_REQUEST_HEADER_SIZE,
                "alignment": RESHAPE_REQUEST_HEADER_ALIGNMENT,
                "rangesOffset": RESHAPE_RANGES_OFFSET,
                "rangeCount": RESHAPE_RANGE_COUNT
            },
            "bidiRequest": {
                "size": BIDI_REQUEST_HEADER_SIZE,
                "alignment": BIDI_REQUEST_HEADER_ALIGNMENT,
                "textOffset": BIDI_TEXT_OFFSET,
                "textLength": BIDI_TEXT_LENGTH,
                "direction": BIDI_DIRECTION
            },
            "policyRequest": {
                "size": POLICY_REQUEST_HEADER_SIZE,
                "alignment": POLICY_REQUEST_HEADER_ALIGNMENT,
                "byteLength": POLICY_BYTE_LENGTH,
                "programsOffset": POLICY_PROGRAMS_OFFSET,
                "programCount": POLICY_PROGRAM_COUNT,
                "buffersOffset": POLICY_BUFFERS_OFFSET,
                "bufferCount": POLICY_BUFFER_COUNT,
                "operationsOffset": POLICY_OPERATIONS_OFFSET,
                "operationCount": POLICY_OPERATION_COUNT
            },
            "policyProgram": {
                "size": POLICY_PROGRAM_RECORD_SIZE,
                "alignment": POLICY_PROGRAM_RECORD_ALIGNMENT,
                "techniqueId": POLICY_PROGRAM_TECHNIQUE_ID,
                "programId": POLICY_PROGRAM_ID,
                "variant": POLICY_PROGRAM_VARIANT,
                "f32InputCount": POLICY_PROGRAM_F32_INPUT_COUNT,
                "u32InputCount": POLICY_PROGRAM_U32_INPUT_COUNT,
                "paintCapabilities": POLICY_PROGRAM_PAINT_CAPABILITIES,
                "compositingCapabilities": POLICY_PROGRAM_COMPOSITING_CAPABILITIES,
                "bufferStart": POLICY_PROGRAM_BUFFER_START,
                "bufferCount": POLICY_PROGRAM_BUFFER_COUNT,
                "reserved0": POLICY_PROGRAM_RESERVED0,
                "operationStart": POLICY_PROGRAM_OPERATION_START,
                "operationCount": POLICY_PROGRAM_OPERATION_COUNT,
                "reserved1": POLICY_PROGRAM_RESERVED1
            },
            "policyBuffer": {
                "size": POLICY_BUFFER_RECORD_SIZE,
                "alignment": POLICY_BUFFER_RECORD_ALIGNMENT,
                "id": POLICY_BUFFER_ID,
                "scalar": POLICY_BUFFER_SCALAR,
                "vectorWidth": POLICY_BUFFER_VECTOR_WIDTH
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
            "engineUpdateRequest": {
                "size": ENGINE_UPDATE_REQUEST_HEADER_SIZE,
                "alignment": ENGINE_UPDATE_REQUEST_HEADER_ALIGNMENT,
                "abiVersion": ENGINE_UPDATE_ABI_VERSION,
                "byteLength": ENGINE_UPDATE_BYTE_LENGTH,
                "sessionId": ENGINE_UPDATE_SESSION_ID,
                "expectedEngineRevision": ENGINE_UPDATE_EXPECTED_ENGINE_REVISION,
                "consumedPlanRevision": ENGINE_UPDATE_CONSUMED_PLAN_REVISION,
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
                "policyParametersLength": ENGINE_UPDATE_POLICY_PARAMETERS_LENGTH
            },
            "engineResult": {
                "size": ENGINE_RESULT_HEADER_SIZE,
                "alignment": ENGINE_RESULT_HEADER_ALIGNMENT,
                "abiVersion": ENGINE_RESULT_ABI_VERSION,
                "byteLength": ENGINE_RESULT_BYTE_LENGTH,
                "status": ENGINE_RESULT_STATUS,
                "flags": ENGINE_RESULT_FLAGS,
                "sessionId": ENGINE_RESULT_SESSION_ID,
                "engineRevision": ENGINE_RESULT_ENGINE_REVISION,
                "planRevision": ENGINE_RESULT_PLAN_REVISION,
                "requiredBaseRevision": ENGINE_RESULT_REQUIRED_BASE_REVISION,
                "publicationGeneration": ENGINE_RESULT_PUBLICATION_GENERATION,
                "outputSlot": ENGINE_RESULT_OUTPUT_SLOT,
                "requestCapacity": ENGINE_RESULT_REQUEST_CAPACITY,
                "requiredRequestCapacity": ENGINE_RESULT_REQUIRED_REQUEST_CAPACITY,
                "resultCapacity": ENGINE_RESULT_RESULT_CAPACITY,
                "requiredResultCapacity": ENGINE_RESULT_REQUIRED_RESULT_CAPACITY,
                "semanticsOffset": ENGINE_RESULT_SEMANTICS_OFFSET,
                "semanticsCount": ENGINE_RESULT_SEMANTICS_COUNT,
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
                "diagnosticCount": ENGINE_RESULT_DIAGNOSTIC_COUNT
            },
            "feature": {
                "size": FEATURE_RECORD_SIZE,
                "alignment": FEATURE_RECORD_ALIGNMENT,
                "tag": FEATURE_TAG,
                "value": FEATURE_VALUE,
                "start": FEATURE_START,
                "end": FEATURE_END
            },
            "run": {
                "size": RUN_RECORD_SIZE,
                "alignment": RUN_RECORD_ALIGNMENT,
                "fontHandle": RUN_FONT_HANDLE,
                "textStart": RUN_TEXT_START,
                "textEnd": RUN_TEXT_END,
                "script": RUN_SCRIPT,
                "languageOffset": RUN_LANGUAGE_OFFSET,
                "featureStart": RUN_FEATURE_START,
                "featureCount": RUN_FEATURE_COUNT,
                "direction": RUN_DIRECTION,
                "clusterLevel": RUN_CLUSTER_LEVEL,
                "flags": RUN_FLAGS
            },
            "reshapeRange": {
                "size": RESHAPE_RANGE_RECORD_SIZE,
                "alignment": RESHAPE_RANGE_RECORD_ALIGNMENT,
                "run": RANGE_RUN,
                "itemStart": RANGE_ITEM_START,
                "itemEnd": RANGE_ITEM_END,
                "contextStart": RANGE_CONTEXT_START,
                "contextEnd": RANGE_CONTEXT_END,
                "flags": RANGE_FLAGS
            },
            "result": {
                "size": RESULT_HEADER_SIZE,
                "alignment": RESULT_HEADER_ALIGNMENT,
                "byteLength": RESULT_BYTE_LENGTH,
                "fontHandlesOffset": RESULT_FONT_HANDLES_OFFSET,
                "fontHandleCount": RESULT_FONT_HANDLE_COUNT,
                "runFontSlotsOffset": RESULT_RUN_FONT_SLOTS_OFFSET,
                "runGlyphStartsOffset": RESULT_RUN_GLYPH_STARTS_OFFSET,
                "runGlyphCountsOffset": RESULT_RUN_GLYPH_COUNTS_OFFSET,
                "runCount": RESULT_RUN_COUNT,
                "glyphIdsOffset": RESULT_GLYPH_IDS_OFFSET,
                "clustersOffset": RESULT_CLUSTERS_OFFSET,
                "xAdvancesOffset": RESULT_X_ADVANCES_OFFSET,
                "yAdvancesOffset": RESULT_Y_ADVANCES_OFFSET,
                "xOffsetsOffset": RESULT_X_OFFSETS_OFFSET,
                "yOffsetsOffset": RESULT_Y_OFFSETS_OFFSET,
                "glyphFlagsOffset": RESULT_GLYPH_FLAGS_OFFSET,
                "glyphCount": RESULT_GLYPH_COUNT
            },
            "bidiResult": {
                "size": BIDI_RESULT_HEADER_SIZE,
                "alignment": BIDI_RESULT_HEADER_ALIGNMENT,
                "byteLength": BIDI_RESULT_BYTE_LENGTH,
                "levelsOffset": BIDI_RESULT_LEVELS_OFFSET,
                "classesOffset": BIDI_RESULT_CLASSES_OFFSET,
                "textLength": BIDI_RESULT_TEXT_LENGTH,
                "paragraphStartsOffset": BIDI_RESULT_PARAGRAPH_STARTS_OFFSET,
                "paragraphEndsOffset": BIDI_RESULT_PARAGRAPH_ENDS_OFFSET,
                "paragraphLevelsOffset": BIDI_RESULT_PARAGRAPH_LEVELS_OFFSET,
                "paragraphCount": BIDI_RESULT_PARAGRAPH_COUNT
            }
        },
        "bidi": {
            "directions": { "auto": 0, "ltr": 1, "rtl": 2 },
            "classes": {
                "L": 0, "R": 1, "AL": 2, "EN": 3, "ES": 4, "ET": 5,
                "AN": 6, "CS": 7, "NSM": 8, "BN": 9, "B": 10, "S": 11,
                "WS": 12, "ON": 13, "LRE": 14, "LRO": 15, "RLE": 16,
                "RLO": 17, "PDF": 18, "LRI": 19, "RLI": 20, "FSI": 21,
                "PDI": 22
            }
        },
        "policy": {
            "scalarTypes": {
                "f32": ScalarType::F32 as u8,
                "u32": ScalarType::U32 as u8,
                "u16": ScalarType::U16 as u8
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
            "resultFlags": {
                "checkpoint": RESULT_FLAG_CHECKPOINT
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
            "sessionConflict": 10,
            "sessionMissing": 11,
            "revisionConflict": 12
        }
    })
    .to_string()
}
