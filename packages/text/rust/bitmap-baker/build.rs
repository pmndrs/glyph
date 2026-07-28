use std::{env, fs, path::PathBuf};

use serde_json::json;

mod abi_contract {
    include!("src/abi_contract.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/abi_contract.rs");
    let contract = json!({
        "name": "pmndrs-text-bitmap-baker",
        "version": 0,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
        "imports": {
            "progress": {
                "module": "env",
                "name": "pmndrs_text_bake_progress",
                "parameters": ["completed", "total"],
            },
        },
        "versions": {
            "generator": env!("CARGO_PKG_VERSION"),
            "bitmapFormat": 0,
            "skrifa": "0.45.1",
            "readFonts": "0.42.1",
            "zeno": "0.3.3",
            "ktx2": "0.5.0",
        },
        "functions": {
            "allocate": {
                "export": "pmndrs_bitmap_baker_alloc",
                "parameters": ["byteLength"],
                "result": "pointer",
            },
            "deallocate": {
                "export": "pmndrs_bitmap_baker_dealloc",
                "parameters": ["pointer", "byteLength"],
            },
            "bake": {
                "export": "pmndrs_bitmap_baker_bake",
                "parameters": ["sourcePointer", "sourceByteLength", "requestPointer", "requestByteLength"],
                "result": "responsePointer",
            },
            "responseByteLength": {
                "export": "pmndrs_bitmap_baker_result_len",
                "parameters": [],
                "result": "byteLength",
            },
        },
        "response": {
            "headerByteLength": abi_contract::RESPONSE_HEADER_BYTES,
            "headerAlignment": abi_contract::RESPONSE_HEADER_ALIGNMENT,
            "magic": abi_contract::RESPONSE_MAGIC,
            "magicOffset": abi_contract::RESPONSE_MAGIC_OFFSET,
            "statusOffset": abi_contract::RESPONSE_STATUS_OFFSET,
            "metadataByteLengthOffset": abi_contract::RESPONSE_METADATA_LEN_OFFSET,
            "artifactByteLengthOffset": abi_contract::RESPONSE_ARTIFACT_LEN_OFFSET,
            "payloadOffset": abi_contract::RESPONSE_PAYLOAD_OFFSET,
            "successStatus": abi_contract::RESPONSE_SUCCESS_STATUS,
        },
    });
    let output_directory = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    let output = output_directory.join("bitmap-baker-abi-v0.json");
    fs::write(
        output,
        serde_json::to_vec_pretty(&contract).expect("serialize bitmap ABI"),
    )
    .expect("write bitmap ABI");
}
