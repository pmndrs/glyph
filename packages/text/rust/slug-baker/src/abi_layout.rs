use core::mem::{align_of, offset_of, size_of};

#[repr(C)]
struct ResponseHeader {
    magic: [u8; 4],
    status: u32,
    metadata_byte_length: u32,
    artifact_byte_length: u32,
}

#[cfg_attr(not(feature = "std"), allow(dead_code))]
pub const RESPONSE_MAGIC: &str = "PMSL";
pub const RESPONSE_HEADER_SIZE: usize = size_of::<ResponseHeader>();
#[cfg_attr(not(feature = "std"), allow(dead_code))]
pub const RESPONSE_HEADER_ALIGNMENT: usize = align_of::<ResponseHeader>();
pub const RESPONSE_MAGIC_OFFSET: usize = offset_of!(ResponseHeader, magic);
pub const RESPONSE_STATUS_OFFSET: usize = offset_of!(ResponseHeader, status);
pub const RESPONSE_METADATA_LENGTH_OFFSET: usize = offset_of!(ResponseHeader, metadata_byte_length);
pub const RESPONSE_ARTIFACT_LENGTH_OFFSET: usize = offset_of!(ResponseHeader, artifact_byte_length);
