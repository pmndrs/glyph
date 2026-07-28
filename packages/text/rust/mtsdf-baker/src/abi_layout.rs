use core::mem::{align_of, offset_of, size_of};

#[repr(C)]
struct RequestHeader {
    byte_length: u32,
    commands_offset: u32,
    command_count: u32,
    units_per_em: f32,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    inner_width: u32,
    inner_height: u32,
    padding_x: u32,
    padding_y: u32,
}

#[repr(C)]
struct CommandRecord {
    opcode: u32,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
}

#[cfg(any(feature = "std", feature = "artifact-baker"))]
#[repr(C)]
struct ArtifactResponseHeader {
    magic: [u8; 4],
    status: u32,
    metadata_byte_length: u32,
    artifact_byte_length: u32,
}

pub const REQUEST_HEADER_SIZE: usize = size_of::<RequestHeader>();
#[cfg_attr(not(feature = "std"), allow(dead_code))]
pub const REQUEST_HEADER_ALIGNMENT: usize = align_of::<RequestHeader>();
pub const COMMAND_SIZE: usize = size_of::<CommandRecord>();
#[cfg_attr(not(feature = "std"), allow(dead_code))]
pub const COMMAND_ALIGNMENT: usize = align_of::<CommandRecord>();
#[cfg(any(feature = "std", feature = "artifact-baker"))]
pub const RESPONSE_HEADER_SIZE: usize = size_of::<ArtifactResponseHeader>();
#[cfg(any(feature = "std", feature = "artifact-baker"))]
#[cfg_attr(not(feature = "std"), allow(dead_code))]
pub const RESPONSE_HEADER_ALIGNMENT: usize = align_of::<ArtifactResponseHeader>();

macro_rules! field_offset {
    ($name:ident, $type:ty, $field:ident) => {
        pub const $name: usize = offset_of!($type, $field);
    };
}

field_offset!(REQUEST_BYTE_LENGTH, RequestHeader, byte_length);
field_offset!(REQUEST_COMMANDS_OFFSET, RequestHeader, commands_offset);
field_offset!(REQUEST_COMMAND_COUNT, RequestHeader, command_count);
field_offset!(REQUEST_UNITS_PER_EM, RequestHeader, units_per_em);
field_offset!(REQUEST_MIN_X, RequestHeader, min_x);
field_offset!(REQUEST_MIN_Y, RequestHeader, min_y);
field_offset!(REQUEST_MAX_X, RequestHeader, max_x);
field_offset!(REQUEST_MAX_Y, RequestHeader, max_y);
field_offset!(REQUEST_INNER_WIDTH, RequestHeader, inner_width);
field_offset!(REQUEST_INNER_HEIGHT, RequestHeader, inner_height);
field_offset!(REQUEST_PADDING_X, RequestHeader, padding_x);
field_offset!(REQUEST_PADDING_Y, RequestHeader, padding_y);
field_offset!(COMMAND_OPCODE, CommandRecord, opcode);
field_offset!(COMMAND_X0, CommandRecord, x0);
field_offset!(COMMAND_Y0, CommandRecord, y0);
field_offset!(COMMAND_X1, CommandRecord, x1);
field_offset!(COMMAND_Y1, CommandRecord, y1);
field_offset!(COMMAND_X2, CommandRecord, x2);
field_offset!(COMMAND_Y2, CommandRecord, y2);
#[cfg(any(feature = "std", feature = "artifact-baker"))]
field_offset!(RESPONSE_MAGIC_OFFSET, ArtifactResponseHeader, magic);
#[cfg(any(feature = "std", feature = "artifact-baker"))]
field_offset!(RESPONSE_STATUS_OFFSET, ArtifactResponseHeader, status);
#[cfg(any(feature = "std", feature = "artifact-baker"))]
field_offset!(
    RESPONSE_METADATA_LENGTH_OFFSET,
    ArtifactResponseHeader,
    metadata_byte_length
);
#[cfg(any(feature = "std", feature = "artifact-baker"))]
field_offset!(
    RESPONSE_ARTIFACT_LENGTH_OFFSET,
    ArtifactResponseHeader,
    artifact_byte_length
);
