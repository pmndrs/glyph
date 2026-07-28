// Generated from Rust compiler layout facts. Do not edit.
export const mtsdfBakerAbi = {
  "artifactBaker": {
    "functions": {
      "bake": {
        "export": "pmndrs_text_mtsdf_bake",
        "parameters": [
          "sourcePointer",
          "sourceByteLength",
          "requestPointer",
          "requestByteLength"
        ],
        "result": "responsePointer"
      },
      "releaseSegmentedResponse": {
        "export": "pmndrs_text_mtsdf_segmented_release",
        "parameters": []
      },
      "responseByteLength": {
        "export": "pmndrs_text_mtsdf_bake_result_len",
        "parameters": [],
        "result": "byteLength"
      },
      "segmentedArtifactByteLength": {
        "export": "pmndrs_text_mtsdf_segmented_artifact_len",
        "parameters": [
          "artifactIndex"
        ],
        "result": "byteLength"
      },
      "segmentedArtifactCount": {
        "export": "pmndrs_text_mtsdf_segmented_artifact_count",
        "parameters": [],
        "result": "count"
      },
      "segmentedChunkByteLength": {
        "export": "pmndrs_text_mtsdf_segmented_chunk_len",
        "parameters": [
          "artifactIndex",
          "byteOffset"
        ],
        "result": "byteLength"
      },
      "segmentedChunkPointer": {
        "export": "pmndrs_text_mtsdf_segmented_chunk_ptr",
        "parameters": [
          "artifactIndex",
          "byteOffset"
        ],
        "result": "pointer"
      },
      "segmentedMetadataByteLength": {
        "export": "pmndrs_text_mtsdf_segmented_metadata_len",
        "parameters": [],
        "result": "byteLength"
      },
      "segmentedMetadataPointer": {
        "export": "pmndrs_text_mtsdf_segmented_metadata_ptr",
        "parameters": [],
        "result": "pointer"
      },
      "segmentedStatus": {
        "export": "pmndrs_text_mtsdf_segmented_status",
        "parameters": [],
        "result": "status"
      }
    },
    "response": {
      "artifactByteLengthOffset": 12,
      "headerAlignment": 4,
      "headerByteLength": 16,
      "magic": "PMMS",
      "magicOffset": 0,
      "metadataByteLengthOffset": 8,
      "payloadOffset": 16,
      "segmented": {
        "chunkByteLength": 8388608,
        "unavailableStatus": 4294967295
      },
      "statusOffset": 4,
      "successStatus": 0
    },
    "versions": {
      "generator": "0.0.0",
      "ktx2": "0.5.0",
      "msdfFormat": 0,
      "readFonts": "0.42.1",
      "skrifa": "0.45.1"
    }
  },
  "commands": {
    "close": 4,
    "cubic": 3,
    "line": 1,
    "move": 0,
    "quadratic": 2
  },
  "endianness": "little",
  "functions": {
    "allocate": "pmndrs_text_mtsdf_alloc",
    "deallocate": "pmndrs_text_mtsdf_dealloc",
    "generate": "pmndrs_text_mtsdf_generate",
    "resultLength": "pmndrs_text_mtsdf_result_len",
    "resultPointer": "pmndrs_text_mtsdf_result_ptr"
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
  "layouts": {
    "command": {
      "alignment": 4,
      "opcode": 0,
      "size": 28,
      "x0": 4,
      "x1": 12,
      "x2": 20,
      "y0": 8,
      "y1": 16,
      "y2": 24
    },
    "request": {
      "alignment": 4,
      "byteLength": 0,
      "commandCount": 8,
      "commandsOffset": 4,
      "innerHeight": 36,
      "innerWidth": 32,
      "maxX": 24,
      "maxY": 28,
      "minX": 16,
      "minY": 20,
      "paddingX": 40,
      "paddingY": 44,
      "size": 48,
      "unitsPerEm": 12
    }
  },
  "memory": "memory",
  "name": "pmndrs-text-mtsdf-baker",
  "output": {
    "format": "rgba8",
    "order": "row-major-top-down",
    "ownership": "borrowed-until-next-generate"
  },
  "pointerWidth": 32,
  "status": {
    "generationFailed": 3,
    "invalidOutline": 2,
    "invalidRequest": 1,
    "ok": 0
  },
  "version": 1
} as const

export type MtsdfBakerAbi = typeof mtsdfBakerAbi
