use alloc::string::{String, ToString};
use serde_json::json;

pub const ABI_VERSION: u32 = 0;
pub const REQUEST_HEADER_SIZE: u32 = 48;
pub const COMMAND_SIZE: u32 = 28;

pub fn json() -> String {
    json!({
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
    })
    .to_string()
}
