use std::{env, fs, path::PathBuf};

mod abi_contract {
    include!("src/abi_contract.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/abi_contract.rs");

    let json = serde_json::json!({
        "name": abi_contract::NAME,
        "version": abi_contract::VERSION,
        "endianness": "little",
        "pointerWidth": abi_contract::POINTER_WIDTH,
        "memory": abi_contract::MEMORY_EXPORT,
        "versions": {
            "baker": abi_contract::BAKER_VERSION,
            "fontFormat": abi_contract::FONT_FORMAT_VERSION,
            "harfrust": abi_contract::HARFRUST_VERSION,
            "harfrustCommit": abi_contract::HARFRUST_COMMIT,
            "harfbuzzReference": abi_contract::HARFBUZZ_REFERENCE_VERSION,
            "harfbuzzReferenceCommit": abi_contract::HARFBUZZ_REFERENCE_COMMIT,
            "unicode": abi_contract::UNICODE_VERSION,
            "gltfSpec": abi_contract::GLTF_SPEC_VERSION,
            "gltfSchemaRevision": abi_contract::GLTF_SCHEMA_REVISION,
            "gltfValidator": abi_contract::GLTF_VALIDATOR_VERSION,
            "binaryen": abi_contract::BINARYEN_VERSION,
        },
        "functions": {
            "allocate": {
                "export": abi_contract::ALLOC_EXPORT,
                "parameters": ["byteLength"],
                "result": "pointer",
            },
            "deallocate": {
                "export": abi_contract::DEALLOC_EXPORT,
                "parameters": ["pointer", "byteLength"],
            },
            "bake": {
                "export": abi_contract::BAKE_EXPORT,
                "parameters": [
                    "sourcePointer",
                    "sourceByteLength",
                    "descriptorPointer",
                    "descriptorByteLength",
                ],
                "result": "responsePointer",
            },
            "responseByteLength": {
                "export": abi_contract::RESULT_LEN_EXPORT,
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

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo supplies OUT_DIR"))
        .join("font-baker-abi-v0.json");
    let mut bytes = serde_json::to_vec_pretty(&json).expect("serialize font baker ABI");
    bytes.push(b'\n');
    fs::write(output, bytes).expect("write generated font baker ABI");
}
