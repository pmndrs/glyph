// Generated from Rust compiler layout facts. Do not edit.
export const slugBakerAbi = {
  "endianness": "little",
  "functions": {
    "allocate": {
      "export": "pmndrs_text_slug_alloc",
      "parameters": [
        "byteLength"
      ],
      "result": "pointer"
    },
    "bake": {
      "export": "pmndrs_text_slug_bake",
      "parameters": [
        "sourcePointer",
        "sourceByteLength",
        "requestPointer",
        "requestByteLength"
      ],
      "result": "responsePointer"
    },
    "deallocate": {
      "export": "pmndrs_text_slug_dealloc",
      "parameters": [
        "pointer",
        "byteLength"
      ]
    },
    "responseByteLength": {
      "export": "pmndrs_text_slug_bake_result_len",
      "parameters": [],
      "result": "byteLength"
    }
  },
  "imports": {
    "progress": {
      "module": "env",
      "name": "pmndrs_text_bake_progress",
      "parameters": [
        "completed",
        "total"
      ]
    }
  },
  "memory": "memory",
  "name": "pmndrs-text-slug-baker",
  "pointerWidth": 32,
  "response": {
    "artifactByteLengthOffset": 12,
    "headerAlignment": 4,
    "headerByteLength": 16,
    "magic": "PMSL",
    "magicOffset": 0,
    "metadataByteLengthOffset": 8,
    "payloadOffset": 16,
    "statusOffset": 4,
    "successStatus": 0
  },
  "segmented": {
    "chunkByteLength": 8388608,
    "functions": {
      "artifactByteLength": {
        "export": "pmndrs_text_slug_segmented_artifact_len",
        "parameters": [
          "artifactIndex"
        ],
        "result": "byteLength"
      },
      "artifactCount": {
        "export": "pmndrs_text_slug_segmented_artifact_count",
        "parameters": [],
        "result": "count"
      },
      "chunkByteLength": {
        "export": "pmndrs_text_slug_segmented_chunk_len",
        "parameters": [
          "artifactIndex",
          "byteOffset"
        ],
        "result": "byteLength"
      },
      "chunkPointer": {
        "export": "pmndrs_text_slug_segmented_chunk_ptr",
        "parameters": [
          "artifactIndex",
          "byteOffset"
        ],
        "result": "pointer"
      },
      "metadataByteLength": {
        "export": "pmndrs_text_slug_segmented_metadata_len",
        "parameters": [],
        "result": "byteLength"
      },
      "metadataPointer": {
        "export": "pmndrs_text_slug_segmented_metadata_ptr",
        "parameters": [],
        "result": "pointer"
      },
      "release": {
        "export": "pmndrs_text_slug_segmented_release",
        "parameters": []
      },
      "status": {
        "export": "pmndrs_text_slug_segmented_status",
        "parameters": [],
        "result": "status"
      }
    },
    "unavailableStatus": 4294967295
  },
  "version": 0,
  "versions": {
    "generator": "0.0.0",
    "ktx2": "0.5.0",
    "readFonts": "0.42.1",
    "skrifa": "0.45.1",
    "slugFormat": 0
  }
} as const

export type SlugBakerAbi = typeof slugBakerAbi
