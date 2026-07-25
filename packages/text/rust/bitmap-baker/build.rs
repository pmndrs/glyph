use std::{env, fs, path::PathBuf};

use ktx2::{Format, dfd::Block};
use serde_json::json;

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let contract = json!({
        "name": "pmndrs-text-bitmap-baker",
        "version": 0,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
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
            "headerByteLength": 16,
            "magic": "PMBM",
            "statusOffset": 4,
            "metadataByteLengthOffset": 8,
            "artifactByteLengthOffset": 12,
            "payloadOffset": 16,
            "successStatus": 0,
        },
    });
    let output_directory = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set"));
    let output = output_directory.join("bitmap-baker-abi-v0.json");
    fs::write(
        output,
        serde_json::to_vec_pretty(&contract).expect("serialize bitmap ABI"),
    )
    .expect("write bitmap ABI");

    let (basic, type_size) = ktx2::dfd::Basic::from_format(Format::R8_UNORM)
        .expect("KTX2 crate supports the canonical R8 format");
    assert_eq!(type_size, 1);
    fs::write(
        output_directory.join("r8-dfd.bin"),
        Block::Basic(basic).to_vec(),
    )
    .expect("write canonical R8 DFD");
}
