// Generated from Rust compiler layout facts. Do not edit.
export const fontBakerAbi = {
  "endianness": "little",
  "functions": {
    "allocate": {
      "export": "pmndrs_font_baker_alloc",
      "parameters": [
        "byteLength"
      ],
      "result": "pointer"
    },
    "bake": {
      "export": "pmndrs_font_baker_bake",
      "parameters": [
        "sourcePointer",
        "sourceByteLength",
        "descriptorPointer",
        "descriptorByteLength"
      ],
      "result": "responsePointer"
    },
    "deallocate": {
      "export": "pmndrs_font_baker_dealloc",
      "parameters": [
        "pointer",
        "byteLength"
      ]
    },
    "inspect": {
      "export": "pmndrs_font_baker_inspect",
      "parameters": [
        "sourcePointer",
        "sourceByteLength",
        "descriptorPointer",
        "descriptorByteLength"
      ],
      "result": "responsePointer"
    },
    "prepare": {
      "export": "pmndrs_font_baker_prepare",
      "parameters": [
        "sourcePointer",
        "sourceByteLength",
        "selectionPointer",
        "selectionByteLength"
      ],
      "result": "responsePointer"
    },
    "responseByteLength": {
      "export": "pmndrs_font_baker_result_len",
      "parameters": [],
      "result": "byteLength"
    }
  },
  "memory": "memory",
  "name": "pmndrs-text-font-baker",
  "pointerWidth": 32,
  "response": {
    "artifactByteLengthOffset": 12,
    "headerAlignment": 4,
    "headerByteLength": 16,
    "magic": "PFB0",
    "magicOffset": 0,
    "metadataByteLengthOffset": 8,
    "payloadOffset": 16,
    "statusOffset": 4,
    "successStatus": 0
  },
  "version": 0,
  "versions": {
    "baker": "0.0.0",
    "binaryen": "129.0.0",
    "fontFormat": 0,
    "gltfSchemaRevision": "77b44be7bef26e01fb0b140e3d5bb1716421c5e9",
    "gltfSpec": "2.0",
    "gltfValidator": "2.0.0-dev.3.10",
    "harfbuzzReference": "13.0.0",
    "harfbuzzReferenceCommit": "a0fc099681a69ae40665fbea74982a2e9d7a5260",
    "harfrust": "0.12.0",
    "harfrustCommit": "60b28ea22b5261710018d69c168a762bcb28794c",
    "unicode": "17.0.0"
  }
} as const

export type FontBakerAbi = typeof fontBakerAbi
