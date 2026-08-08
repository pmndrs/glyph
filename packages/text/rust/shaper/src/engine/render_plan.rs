//! Renderer-neutral retained display-list records.
//!
//! These types describe rendering intent and revision-relative resource changes. They deliberately
//! contain no backend command, JavaScript callback, GPU object, or host pointer.

pub const SEMANTIC_LINE: u16 = 1;
pub const SEMANTIC_FRAGMENT: u16 = 2;
pub const SEMANTIC_RUN: u16 = 3;
pub const SEMANTIC_CLUSTER: u16 = 4;
pub const SEMANTIC_CARET: u16 = 5;
pub const SEMANTIC_SELECTION: u16 = 6;
pub const SEMANTIC_INSERTED_GLYPH: u16 = 7;

pub const RESOURCE_ACTION_CREATE: u16 = 1;
pub const RESOURCE_ACTION_UPDATE: u16 = 2;
pub const RESOURCE_ACTION_RETAIN: u16 = 3;

pub const BUFFER_ORDERED_DIRECT: u16 = 1;
pub const BUFFER_STABLE_INDIRECT: u16 = 2;

pub const PATCH_ALLOCATE_OR_RESIZE: u16 = 1;
pub const PATCH_WRITE: u16 = 2;
pub const PATCH_FILL: u16 = 3;
pub const PATCH_COPY: u16 = 4;
pub const PATCH_RETIRE: u16 = 5;

pub const PRIMITIVE_GLYPH: u16 = 1;
pub const PRIMITIVE_DECORATION: u16 = 2;
pub const PRIMITIVE_INLINE_OBJECT: u16 = 3;
pub const PRIMITIVE_CLIP: u16 = 4;
pub const PRIMITIVE_POLICY: u16 = 5;

pub const RETIRE_RESOURCE: u16 = 1;
pub const RETIRE_BUFFER: u16 = 2;
pub const RETIRE_SLOT_RANGE: u16 = 3;
pub const RETIRE_OUTPUT_BYTES: u16 = 4;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SemanticRecord {
    pub id: u32,
    pub kind: u16,
    pub flags: u16,
    pub parent_id: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub item_start: u32,
    pub item_count: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResourceRecord {
    pub id: u32,
    pub generation: u32,
    pub technique_id: u32,
    pub resource_kind: u16,
    pub action: u16,
    pub flags: u32,
    pub reference_id: u32,
    pub lower_bound: u32,
    pub upper_bound: u32,
    pub auxiliary0: u32,
    pub auxiliary1: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct BufferRecord {
    pub id: u32,
    pub generation: u32,
    pub program_id: u32,
    pub policy_buffer_id: u16,
    pub scalar_type: u8,
    pub vector_width: u8,
    pub strategy: u16,
    pub flags: u16,
    pub live_records: u32,
    pub capacity_records: u32,
    pub byte_length: u32,
    pub order_buffer_id: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PatchRecord {
    pub opcode: u16,
    pub flags: u16,
    pub buffer_id: u32,
    pub buffer_generation: u32,
    pub destination_offset: u32,
    pub byte_length: u32,
    /// Offset into `RenderPlanView::payload`; serialization rebases it to the publication start.
    pub payload_start: u32,
    pub source_buffer_id: u32,
    pub source_offset: u32,
    pub fill_value: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PrimitiveRecord {
    pub id: u32,
    pub kind: u16,
    pub flags: u16,
    pub technique_id: u32,
    pub resource_id: u32,
    pub resource_generation: u32,
    pub program_id: u32,
    pub variant: u16,
    pub reserved: u16,
    pub buffer_id: u32,
    pub record_index: u32,
    pub logical_order: u32,
    pub clip_id: u32,
    pub semantic_id: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DrawRecord {
    pub id: u32,
    pub program_id: u32,
    pub variant: u16,
    pub flags: u16,
    pub primitive_start: u32,
    pub primitive_count: u32,
    pub buffer_start: u32,
    pub buffer_count: u32,
    pub resource_start: u32,
    pub resource_count: u32,
    pub order_token: u32,
    pub indirect_buffer_id: u32,
    pub indirect_offset: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RetirementRecord {
    pub kind: u16,
    pub flags: u16,
    pub id: u32,
    pub generation: u32,
    pub after_publication_generation: u32,
    pub byte_offset: u32,
    pub byte_length: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct DiagnosticRecord {
    pub code: u16,
    pub severity: u8,
    pub phase: u8,
    pub subject_id: u32,
    pub value0: u32,
    pub value1: u32,
    pub duration_nanos_low: u32,
    pub duration_nanos_high: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct RenderPlanView<'a> {
    pub policy_handle: u32,
    pub capability_set: u32,
    pub policy_fingerprint: u64,
    pub semantics: &'a [SemanticRecord],
    pub resources: &'a [ResourceRecord],
    pub buffers: &'a [BufferRecord],
    pub patches: &'a [PatchRecord],
    pub primitives: &'a [PrimitiveRecord],
    pub draws: &'a [DrawRecord],
    pub retirements: &'a [RetirementRecord],
    pub diagnostics: &'a [DiagnosticRecord],
    pub payload: &'a [u8],
}

const _: () = assert!(core::mem::size_of::<SemanticRecord>() == 44);
const _: () = assert!(core::mem::size_of::<ResourceRecord>() == 40);
const _: () = assert!(core::mem::size_of::<BufferRecord>() == 36);
const _: () = assert!(core::mem::size_of::<PatchRecord>() == 36);
const _: () = assert!(core::mem::size_of::<PrimitiveRecord>() == 64);
const _: () = assert!(core::mem::size_of::<DrawRecord>() == 48);
const _: () = assert!(core::mem::size_of::<RetirementRecord>() == 24);
const _: () = assert!(core::mem::size_of::<DiagnosticRecord>() == 24);
