use alloc::string::{String, ToString};
use serde_json::json;

pub const ABI_VERSION: u32 = 1;
pub const REQUEST_HEADER_SIZE: u32 = 48;
pub const COMMAND_SIZE: u32 = 28;

pub fn json(include_artifact_baker: bool) -> String {
    let mut contract = json!({
        "name": "pmndrs-text-mtsdf-baker",
        "version": ABI_VERSION,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
        "functions": {
            "allocate": "pmndrs_text_mtsdf_alloc",
            "deallocate": "pmndrs_text_mtsdf_dealloc",
            "generate": "pmndrs_text_mtsdf_generate",
            "resultPointer": "pmndrs_text_mtsdf_result_ptr",
            "resultLength": "pmndrs_text_mtsdf_result_len",
            "abiPointer": "pmndrs_text_mtsdf_abi_ptr",
            "abiLength": "pmndrs_text_mtsdf_abi_len"
        },
        "layouts": {
            "request": {
                "size": REQUEST_HEADER_SIZE,
                "byteLength": 0,
                "commandsOffset": 4,
                "commandCount": 8,
                "unitsPerEm": 12,
                "minX": 16,
                "minY": 20,
                "maxX": 24,
                "maxY": 28,
                "innerWidth": 32,
                "innerHeight": 36,
                "paddingX": 40,
                "paddingY": 44
            },
            "command": {
                "size": COMMAND_SIZE,
                "opcode": 0,
                "x0": 4,
                "y0": 8,
                "x1": 12,
                "y1": 16,
                "x2": 20,
                "y2": 24
            }
        },
        "commands": { "move": 0, "line": 1, "quadratic": 2, "cubic": 3, "close": 4 },
        "output": { "format": "rgba8", "order": "row-major-top-down", "ownership": "borrowed-until-next-generate" },
        "status": { "ok": 0, "invalidRequest": 1, "invalidOutline": 2, "generationFailed": 3 }
    });
    if include_artifact_baker {
        contract["artifactBaker"] = json!({
            "versions": {
                "generator": env!("CARGO_PKG_VERSION"),
                "msdfFormat": 0,
                "skrifa": "0.45.1",
                "readFonts": "0.42.1",
                "ktx2": "0.5.0",
            },
            "functions": {
                "bake": {
                    "export": "pmndrs_text_mtsdf_bake",
                    "parameters": ["sourcePointer", "sourceByteLength", "requestPointer", "requestByteLength"],
                    "result": "responsePointer",
                },
                "responseByteLength": {
                    "export": "pmndrs_text_mtsdf_bake_result_len",
                    "parameters": [],
                    "result": "byteLength",
                },
                "segmentedStatus": {
                    "export": "pmndrs_text_mtsdf_segmented_status",
                    "parameters": [],
                    "result": "status",
                },
                "segmentedMetadataPointer": {
                    "export": "pmndrs_text_mtsdf_segmented_metadata_ptr",
                    "parameters": [],
                    "result": "pointer",
                },
                "segmentedMetadataByteLength": {
                    "export": "pmndrs_text_mtsdf_segmented_metadata_len",
                    "parameters": [],
                    "result": "byteLength",
                },
                "segmentedArtifactCount": {
                    "export": "pmndrs_text_mtsdf_segmented_artifact_count",
                    "parameters": [],
                    "result": "count",
                },
                "segmentedArtifactByteLength": {
                    "export": "pmndrs_text_mtsdf_segmented_artifact_len",
                    "parameters": ["artifactIndex"],
                    "result": "byteLength",
                },
                "segmentedChunkPointer": {
                    "export": "pmndrs_text_mtsdf_segmented_chunk_ptr",
                    "parameters": ["artifactIndex", "byteOffset"],
                    "result": "pointer",
                },
                "segmentedChunkByteLength": {
                    "export": "pmndrs_text_mtsdf_segmented_chunk_len",
                    "parameters": ["artifactIndex", "byteOffset"],
                    "result": "byteLength",
                },
                "releaseSegmentedResponse": {
                    "export": "pmndrs_text_mtsdf_segmented_release",
                    "parameters": [],
                },
            },
            "response": {
                "headerByteLength": 16,
                "magic": "PMMS",
                "statusOffset": 4,
                "metadataByteLengthOffset": 8,
                "artifactByteLengthOffset": 12,
                "payloadOffset": 16,
                "successStatus": 0,
                "segmented": {
                    "chunkByteLength": 8388608,
                    "unavailableStatus": 4294967295_u32,
                },
            },
        });
    }
    contract.to_string()
}
