// Generated from Rust compiler layout facts. Do not edit.
export const textShaperAbi = {
  "bidi": {
    "classes": {
      "AL": 2,
      "AN": 6,
      "B": 10,
      "BN": 9,
      "CS": 7,
      "EN": 3,
      "ES": 4,
      "ET": 5,
      "FSI": 21,
      "L": 0,
      "LRE": 14,
      "LRI": 19,
      "LRO": 15,
      "NSM": 8,
      "ON": 13,
      "PDF": 18,
      "PDI": 22,
      "R": 1,
      "RLE": 16,
      "RLI": 20,
      "RLO": 17,
      "S": 11,
      "WS": 12
    },
    "directions": {
      "auto": 0,
      "ltr": 1,
      "rtl": 2
    }
  },
  "endianness": "little",
  "functions": {
    "allocate": "pmndrs_text_shaper_alloc",
    "analyzeBidi": "pmndrs_text_shaper_analyze_bidi",
    "deallocate": "pmndrs_text_shaper_dealloc",
    "disposeFont": "pmndrs_text_shaper_dispose_font",
    "disposePolicy": "pmndrs_text_engine_dispose_policy",
    "fontCount": "pmndrs_text_shaper_font_count",
    "planCount": "pmndrs_text_shaper_plan_count",
    "policyCount": "pmndrs_text_engine_policy_count",
    "registerFont": "pmndrs_text_shaper_register_font",
    "registerPolicy": "pmndrs_text_engine_register_policy",
    "reshapeRanges": "pmndrs_text_shaper_reshape_ranges",
    "resultLength": "pmndrs_text_shaper_result_len",
    "resultPointer": "pmndrs_text_shaper_result_ptr",
    "retainedFontBytes": "pmndrs_text_shaper_retained_font_bytes",
    "shapeBatch": "pmndrs_text_shaper_shape_batch"
  },
  "layouts": {
    "bidiRequest": {
      "alignment": 4,
      "direction": 8,
      "size": 12,
      "textLength": 4,
      "textOffset": 0
    },
    "bidiResult": {
      "alignment": 4,
      "byteLength": 0,
      "classesOffset": 8,
      "levelsOffset": 4,
      "paragraphCount": 28,
      "paragraphEndsOffset": 20,
      "paragraphLevelsOffset": 24,
      "paragraphStartsOffset": 16,
      "size": 32,
      "textLength": 12
    },
    "feature": {
      "alignment": 4,
      "end": 12,
      "size": 16,
      "start": 8,
      "tag": 0,
      "value": 4
    },
    "policyBuffer": {
      "alignment": 2,
      "id": 0,
      "scalar": 2,
      "size": 4,
      "vectorWidth": 3
    },
    "policyOperation": {
      "alignment": 4,
      "immediate0": 4,
      "immediate1": 8,
      "immediate2": 12,
      "opcode": 0,
      "operand0": 2,
      "operand1": 3,
      "size": 16,
      "target": 1
    },
    "policyProgram": {
      "alignment": 4,
      "bufferCount": 24,
      "bufferStart": 20,
      "compositingCapabilities": 16,
      "f32InputCount": 10,
      "operationCount": 32,
      "operationStart": 28,
      "paintCapabilities": 12,
      "programId": 4,
      "reserved0": 26,
      "reserved1": 34,
      "size": 36,
      "techniqueId": 0,
      "u32InputCount": 11,
      "variant": 8
    },
    "policyRequest": {
      "alignment": 4,
      "bufferCount": 16,
      "buffersOffset": 12,
      "byteLength": 0,
      "operationCount": 24,
      "operationsOffset": 20,
      "programCount": 8,
      "programsOffset": 4,
      "size": 28
    },
    "reshapeRange": {
      "alignment": 4,
      "contextEnd": 16,
      "contextStart": 12,
      "flags": 20,
      "itemEnd": 8,
      "itemStart": 4,
      "run": 0,
      "size": 24
    },
    "reshapeRequest": {
      "alignment": 4,
      "rangeCount": 36,
      "rangesOffset": 32,
      "size": 40
    },
    "result": {
      "alignment": 4,
      "byteLength": 0,
      "clustersOffset": 32,
      "fontHandleCount": 8,
      "fontHandlesOffset": 4,
      "glyphCount": 56,
      "glyphFlagsOffset": 52,
      "glyphIdsOffset": 28,
      "runCount": 24,
      "runFontSlotsOffset": 12,
      "runGlyphCountsOffset": 20,
      "runGlyphStartsOffset": 16,
      "size": 60,
      "xAdvancesOffset": 36,
      "xOffsetsOffset": 44,
      "yAdvancesOffset": 40,
      "yOffsetsOffset": 48
    },
    "run": {
      "alignment": 4,
      "clusterLevel": 27,
      "direction": 26,
      "featureCount": 24,
      "featureStart": 20,
      "flags": 28,
      "fontHandle": 0,
      "languageOffset": 16,
      "script": 12,
      "size": 32,
      "textEnd": 8,
      "textStart": 4
    },
    "shapeRequest": {
      "alignment": 4,
      "featureCount": 20,
      "featuresOffset": 16,
      "languagesLength": 28,
      "languagesOffset": 24,
      "runCount": 12,
      "runsOffset": 8,
      "size": 32,
      "textLength": 4,
      "textOffset": 0
    }
  },
  "memory": "memory",
  "name": "pmndrs-text-shaper",
  "pointerWidth": 32,
  "policy": {
    "opcodes": {
      "addF32": 5,
      "constantF32": 3,
      "constantU32": 4,
      "convertU32ToF32": 10,
      "lessThanF32": 8,
      "loadF32": 1,
      "loadU32": 2,
      "multiplyF32": 7,
      "selectF32": 9,
      "storeF32": 11,
      "storeU16": 13,
      "storeU32": 12,
      "subtractF32": 6
    },
    "scalarTypes": {
      "f32": 1,
      "u16": 3,
      "u32": 2
    }
  },
  "status": {
    "fontMissing": 5,
    "handleConflict": 4,
    "invalidExtents": 3,
    "invalidFont": 2,
    "invalidHandle": 1,
    "invalidRequest": 6,
    "ok": 0,
    "policyConflict": 8,
    "policyMissing": 9,
    "resultTooLarge": 7
  },
  "version": 0,
  "versions": {
    "fontFormat": 0,
    "harfrust": "0.12.0",
    "harfrustCommit": "60b28ea22b5261710018d69c168a762bcb28794c",
    "shaper": "0.0.0",
    "unicode": "17.0.0"
  }
} as const

export type TextShaperAbi = typeof textShaperAbi
