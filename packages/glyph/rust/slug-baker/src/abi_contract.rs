use alloc::string::String;

use serde_json::json;

use crate::abi_layout::*;

pub const ABI_VERSION: u32 = 0;

pub fn json() -> String {
    json!({
        "name": "pmndrs-glyph-slug-baker",
        "version": ABI_VERSION,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
        "imports": {
            "progress": {
                "module": "env",
                "name": "pmndrs_glyph_bake_progress",
                "parameters": ["completed", "total"],
            },
        },
        "functions": {
            "allocate": {
                "export": "pmndrs_glyph_slug_alloc",
                "parameters": ["byteLength"],
                "result": "pointer",
            },
            "deallocate": {
                "export": "pmndrs_glyph_slug_dealloc",
                "parameters": ["pointer", "byteLength"],
            },
            "bake": {
                "export": "pmndrs_glyph_slug_bake",
                "parameters": ["sourcePointer", "sourceByteLength", "requestPointer", "requestByteLength"],
                "result": "responsePointer",
            },
            "responseByteLength": {
                "export": "pmndrs_glyph_slug_bake_result_len",
                "parameters": [],
                "result": "byteLength",
            },
        },
        "response": {
            "headerByteLength": RESPONSE_HEADER_SIZE,
            "headerAlignment": RESPONSE_HEADER_ALIGNMENT,
            "magic": RESPONSE_MAGIC,
            "magicOffset": RESPONSE_MAGIC_OFFSET,
            "statusOffset": RESPONSE_STATUS_OFFSET,
            "metadataByteLengthOffset": RESPONSE_METADATA_LENGTH_OFFSET,
            "artifactByteLengthOffset": RESPONSE_ARTIFACT_LENGTH_OFFSET,
            "payloadOffset": RESPONSE_HEADER_SIZE,
            "successStatus": 0,
        },
        "segmented": {
            "chunkByteLength": 8_388_608,
            "unavailableStatus": 4_294_967_295_u32,
            "functions": {
                "status": { "export": "pmndrs_glyph_slug_segmented_status", "parameters": [], "result": "status" },
                "metadataPointer": { "export": "pmndrs_glyph_slug_segmented_metadata_ptr", "parameters": [], "result": "pointer" },
                "metadataByteLength": { "export": "pmndrs_glyph_slug_segmented_metadata_len", "parameters": [], "result": "byteLength" },
                "artifactCount": { "export": "pmndrs_glyph_slug_segmented_artifact_count", "parameters": [], "result": "count" },
                "artifactByteLength": { "export": "pmndrs_glyph_slug_segmented_artifact_len", "parameters": ["artifactIndex"], "result": "byteLength" },
                "chunkPointer": { "export": "pmndrs_glyph_slug_segmented_chunk_ptr", "parameters": ["artifactIndex", "byteOffset"], "result": "pointer" },
                "chunkByteLength": { "export": "pmndrs_glyph_slug_segmented_chunk_len", "parameters": ["artifactIndex", "byteOffset"], "result": "byteLength" },
                "release": { "export": "pmndrs_glyph_slug_segmented_release", "parameters": [] },
            },
        },
        "versions": {
            "generator": env!("CARGO_PKG_VERSION"),
            "slugFormat": 0,
            "skrifa": "0.45.1",
            "readFonts": "0.42.1",
            "ktx2": "0.5.0",
        },
    })
    .to_string()
}
