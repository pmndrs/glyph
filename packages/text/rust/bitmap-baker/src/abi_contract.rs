use core::mem::{align_of, offset_of, size_of};

#[repr(C)]
struct ResponseHeader {
    magic: [u8; 4],
    status: u32,
    metadata_byte_length: u32,
    artifact_byte_length: u32,
}

pub const RESPONSE_MAGIC: &str = "PMBM";
pub const RESPONSE_HEADER_BYTES: u32 = size_of::<ResponseHeader>() as u32;
pub const RESPONSE_HEADER_ALIGNMENT: u32 = align_of::<ResponseHeader>() as u32;
pub const RESPONSE_MAGIC_OFFSET: u32 = offset_of!(ResponseHeader, magic) as u32;
pub const RESPONSE_STATUS_OFFSET: u32 = offset_of!(ResponseHeader, status) as u32;
pub const RESPONSE_METADATA_LEN_OFFSET: u32 =
    offset_of!(ResponseHeader, metadata_byte_length) as u32;
pub const RESPONSE_ARTIFACT_LEN_OFFSET: u32 =
    offset_of!(ResponseHeader, artifact_byte_length) as u32;
pub const RESPONSE_PAYLOAD_OFFSET: u32 = RESPONSE_HEADER_BYTES;
pub const RESPONSE_SUCCESS_STATUS: u32 = 0;
