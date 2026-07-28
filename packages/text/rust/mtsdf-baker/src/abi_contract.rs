use alloc::string::{String, ToString};
use serde_json::json;

pub use crate::abi_layout::*;

pub const ABI_VERSION: u32 = 1;

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
            "resultLength": "pmndrs_text_mtsdf_result_len"
        },
        "layouts": {
            "request": {
                "size": REQUEST_HEADER_SIZE,
                "alignment": REQUEST_HEADER_ALIGNMENT,
                "byteLength": REQUEST_BYTE_LENGTH,
                "commandsOffset": REQUEST_COMMANDS_OFFSET,
                "commandCount": REQUEST_COMMAND_COUNT,
                "unitsPerEm": REQUEST_UNITS_PER_EM,
                "minX": REQUEST_MIN_X,
                "minY": REQUEST_MIN_Y,
                "maxX": REQUEST_MAX_X,
                "maxY": REQUEST_MAX_Y,
                "innerWidth": REQUEST_INNER_WIDTH,
                "innerHeight": REQUEST_INNER_HEIGHT,
                "paddingX": REQUEST_PADDING_X,
                "paddingY": REQUEST_PADDING_Y
            },
            "command": {
                "size": COMMAND_SIZE,
                "alignment": COMMAND_ALIGNMENT,
                "opcode": COMMAND_OPCODE,
                "x0": COMMAND_X0,
                "y0": COMMAND_Y0,
                "x1": COMMAND_X1,
                "y1": COMMAND_Y1,
                "x2": COMMAND_X2,
                "y2": COMMAND_Y2
            }
        },
        "commands": { "move": 0, "line": 1, "quadratic": 2, "cubic": 3, "close": 4 },
        "output": { "format": "rgba8", "order": "row-major-top-down", "ownership": "borrowed-until-next-generate" },
        "status": { "ok": 0, "invalidRequest": 1, "invalidOutline": 2, "generationFailed": 3 }
    });
    if include_artifact_baker {
        contract["imports"] = json!({
            "progress": {
                "module": "env",
                "name": "pmndrs_text_bake_progress",
                "parameters": ["completed", "total"],
            },
        });
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
                "headerByteLength": RESPONSE_HEADER_SIZE,
                "headerAlignment": RESPONSE_HEADER_ALIGNMENT,
                "magic": "PMMS",
                "magicOffset": RESPONSE_MAGIC_OFFSET,
                "statusOffset": RESPONSE_STATUS_OFFSET,
                "metadataByteLengthOffset": RESPONSE_METADATA_LENGTH_OFFSET,
                "artifactByteLengthOffset": RESPONSE_ARTIFACT_LENGTH_OFFSET,
                "payloadOffset": RESPONSE_HEADER_SIZE,
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
