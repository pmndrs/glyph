pub const NAME: &str = "pmndrs-text-font-baker";
pub const VERSION: u32 = 0;
pub const POINTER_WIDTH: u32 = 32;
pub const MEMORY_EXPORT: &str = "memory";

pub const ALLOC_EXPORT: &str = "pmndrs_font_baker_alloc";
pub const DEALLOC_EXPORT: &str = "pmndrs_font_baker_dealloc";
pub const BAKE_EXPORT: &str = "pmndrs_font_baker_bake";
pub const RESULT_LEN_EXPORT: &str = "pmndrs_font_baker_result_len";

pub const RESPONSE_HEADER_BYTES: u32 = 16;
pub const RESPONSE_MAGIC: &str = "PFB0";
pub const RESPONSE_STATUS_OFFSET: u32 = 4;
pub const RESPONSE_METADATA_LEN_OFFSET: u32 = 8;
pub const RESPONSE_ARTIFACT_LEN_OFFSET: u32 = 12;
pub const RESPONSE_PAYLOAD_OFFSET: u32 = 16;
pub const RESPONSE_SUCCESS_STATUS: u32 = 0;
