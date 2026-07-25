use std::{env, fs, path::PathBuf};

mod abi_contract {
    include!("src/abi_contract.rs");
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=src/abi_contract.rs");

    let json = format!(
        concat!(
            "{{\n",
            "  \"name\": \"{}\",\n",
            "  \"version\": {},\n",
            "  \"endianness\": \"little\",\n",
            "  \"pointerWidth\": {},\n",
            "  \"memory\": \"{}\",\n",
            "  \"functions\": {{\n",
            "    \"allocate\": {{ \"export\": \"{}\", \"parameters\": [\"byteLength\"], \"result\": \"pointer\" }},\n",
            "    \"deallocate\": {{ \"export\": \"{}\", \"parameters\": [\"pointer\", \"byteLength\"] }},\n",
            "    \"bake\": {{ \"export\": \"{}\", \"parameters\": [\"sourcePointer\", \"sourceByteLength\", \"descriptorPointer\", \"descriptorByteLength\"], \"result\": \"responsePointer\" }},\n",
            "    \"responseByteLength\": {{ \"export\": \"{}\", \"parameters\": [], \"result\": \"byteLength\" }}\n",
            "  }},\n",
            "  \"response\": {{\n",
            "    \"headerByteLength\": {},\n",
            "    \"magic\": \"{}\",\n",
            "    \"statusOffset\": {},\n",
            "    \"metadataByteLengthOffset\": {},\n",
            "    \"artifactByteLengthOffset\": {},\n",
            "    \"payloadOffset\": {},\n",
            "    \"successStatus\": {}\n",
            "  }}\n",
            "}}\n"
        ),
        abi_contract::NAME,
        abi_contract::VERSION,
        abi_contract::POINTER_WIDTH,
        abi_contract::MEMORY_EXPORT,
        abi_contract::ALLOC_EXPORT,
        abi_contract::DEALLOC_EXPORT,
        abi_contract::BAKE_EXPORT,
        abi_contract::RESULT_LEN_EXPORT,
        abi_contract::RESPONSE_HEADER_BYTES,
        abi_contract::RESPONSE_MAGIC,
        abi_contract::RESPONSE_STATUS_OFFSET,
        abi_contract::RESPONSE_METADATA_LEN_OFFSET,
        abi_contract::RESPONSE_ARTIFACT_LEN_OFFSET,
        abi_contract::RESPONSE_PAYLOAD_OFFSET,
        abi_contract::RESPONSE_SUCCESS_STATUS,
    );

    let output = PathBuf::from(env::var_os("OUT_DIR").expect("Cargo supplies OUT_DIR"))
        .join("font-baker-abi-v0.json");
    fs::write(output, json).expect("write generated font baker ABI");
}
