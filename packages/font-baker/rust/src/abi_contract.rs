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

pub const BAKER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const FONT_FORMAT_VERSION: u32 = 0;
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const HARFBUZZ_REFERENCE_VERSION: &str = "13.0.0";
pub const HARFBUZZ_REFERENCE_COMMIT: &str = "a0fc099681a69ae40665fbea74982a2e9d7a5260";
pub const UNICODE_VERSION: &str = "17.0.0";
pub const GLTF_SPEC_VERSION: &str = "2.0";
pub const GLTF_SCHEMA_REVISION: &str = "77b44be7bef26e01fb0b140e3d5bb1716421c5e9";
pub const GLTF_VALIDATOR_VERSION: &str = "2.0.0-dev.3.10";
pub const BINARYEN_VERSION: &str = "129.0.0";
