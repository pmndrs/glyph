// Generated from Rust compiler layout facts. Do not edit.
export const bitmapBakerAbi = {
  "endianness": "little",
  "functions": {
    "allocate": {
      "export": "pmndrs_bitmap_baker_alloc",
      "parameters": [
        "byteLength"
      ],
      "result": "pointer"
    },
    "bake": {
      "export": "pmndrs_bitmap_baker_bake",
      "parameters": [
        "sourcePointer",
        "sourceByteLength",
        "requestPointer",
        "requestByteLength"
      ],
      "result": "responsePointer"
    },
    "deallocate": {
      "export": "pmndrs_bitmap_baker_dealloc",
      "parameters": [
        "pointer",
        "byteLength"
      ]
    },
    "responseByteLength": {
      "export": "pmndrs_bitmap_baker_result_len",
      "parameters": [],
      "result": "byteLength"
    }
  },
  "imports": {
    "progress": {
      "module": "env",
      "name": "pmndrs_glyph_bake_progress",
      "parameters": [
        "completed",
        "total"
      ]
    }
  },
  "memory": "memory",
  "name": "pmndrs-glyph-bitmap-baker",
  "pointerWidth": 32,
  "response": {
    "artifactByteLengthOffset": 12,
    "headerAlignment": 4,
    "headerByteLength": 16,
    "magic": "PMBM",
    "magicOffset": 0,
    "metadataByteLengthOffset": 8,
    "payloadOffset": 16,
    "statusOffset": 4,
    "successStatus": 0
  },
  "version": 0,
  "versions": {
    "bitmapFormat": 0,
    "generator": "0.0.0",
    "ktx2": "0.5.0",
    "readFonts": "0.42.1",
    "skrifa": "0.45.1",
    "zeno": "0.3.3"
  }
} as const

export type BitmapBakerAbi = typeof bitmapBakerAbi
