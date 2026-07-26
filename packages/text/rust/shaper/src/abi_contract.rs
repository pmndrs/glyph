use alloc::string::{String, ToString};
use serde_json::json;

pub const ABI_VERSION: u32 = 0;
pub const SHAPER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const UNICODE_VERSION: &str = "17.0.0";

pub const SHAPE_REQUEST_HEADER_SIZE: u32 = 32;
pub const RESHAPE_REQUEST_HEADER_SIZE: u32 = 40;
pub const FEATURE_RECORD_SIZE: u32 = 16;
pub const RUN_RECORD_SIZE: u32 = 32;
pub const RESHAPE_RANGE_RECORD_SIZE: u32 = 24;
pub const RESULT_HEADER_SIZE: u32 = 60;
pub const BIDI_REQUEST_HEADER_SIZE: u32 = 12;
pub const BIDI_RESULT_HEADER_SIZE: u32 = 32;

pub fn json() -> String {
    json!({
        "name": "pmndrs-text-shaper",
        "version": ABI_VERSION,
        "endianness": "little",
        "pointerWidth": 32,
        "memory": "memory",
        "versions": {
            "shaper": SHAPER_VERSION,
            "harfrust": HARFRUST_VERSION,
            "harfrustCommit": HARFRUST_COMMIT,
            "unicode": UNICODE_VERSION,
            "fontFormat": 0
        },
        "functions": {
            "allocate": "pmndrs_text_shaper_alloc",
            "deallocate": "pmndrs_text_shaper_dealloc",
            "registerFont": "pmndrs_text_shaper_register_font",
            "disposeFont": "pmndrs_text_shaper_dispose_font",
            "fontCount": "pmndrs_text_shaper_font_count",
            "retainedFontBytes": "pmndrs_text_shaper_retained_font_bytes",
            "planCount": "pmndrs_text_shaper_plan_count",
            "shapeBatch": "pmndrs_text_shaper_shape_batch",
            "reshapeRanges": "pmndrs_text_shaper_reshape_ranges",
            "analyzeBidi": "pmndrs_text_shaper_analyze_bidi",
            "resultPointer": "pmndrs_text_shaper_result_ptr",
            "resultLength": "pmndrs_text_shaper_result_len"
        },
        "layouts": {
            "shapeRequest": {
                "size": SHAPE_REQUEST_HEADER_SIZE,
                "textOffset": 0,
                "textLength": 4,
                "runsOffset": 8,
                "runCount": 12,
                "featuresOffset": 16,
                "featureCount": 20,
                "languagesOffset": 24,
                "languagesLength": 28
            },
            "reshapeRequest": {
                "size": RESHAPE_REQUEST_HEADER_SIZE,
                "rangesOffset": 32,
                "rangeCount": 36
            },
            "bidiRequest": {
                "size": BIDI_REQUEST_HEADER_SIZE,
                "textOffset": 0,
                "textLength": 4,
                "direction": 8
            },
            "feature": {
                "size": FEATURE_RECORD_SIZE,
                "tag": 0,
                "value": 4,
                "start": 8,
                "end": 12
            },
            "run": {
                "size": RUN_RECORD_SIZE,
                "fontHandle": 0,
                "textStart": 4,
                "textEnd": 8,
                "script": 12,
                "languageOffset": 16,
                "featureStart": 20,
                "featureCount": 24,
                "direction": 26,
                "clusterLevel": 27,
                "flags": 28
            },
            "reshapeRange": {
                "size": RESHAPE_RANGE_RECORD_SIZE,
                "run": 0,
                "itemStart": 4,
                "itemEnd": 8,
                "contextStart": 12,
                "contextEnd": 16,
                "flags": 20
            },
            "result": {
                "size": RESULT_HEADER_SIZE,
                "byteLength": 0,
                "fontHandlesOffset": 4,
                "fontHandleCount": 8,
                "runFontSlotsOffset": 12,
                "runGlyphStartsOffset": 16,
                "runGlyphCountsOffset": 20,
                "runCount": 24,
                "glyphIdsOffset": 28,
                "clustersOffset": 32,
                "xAdvancesOffset": 36,
                "yAdvancesOffset": 40,
                "xOffsetsOffset": 44,
                "yOffsetsOffset": 48,
                "glyphFlagsOffset": 52,
                "glyphCount": 56
            },
            "bidiResult": {
                "size": BIDI_RESULT_HEADER_SIZE,
                "byteLength": 0,
                "levelsOffset": 4,
                "classesOffset": 8,
                "textLength": 12,
                "paragraphStartsOffset": 16,
                "paragraphEndsOffset": 20,
                "paragraphLevelsOffset": 24,
                "paragraphCount": 28
            }
        },
        "bidi": {
            "directions": { "auto": 0, "ltr": 1, "rtl": 2 },
            "classes": {
                "L": 0, "R": 1, "AL": 2, "EN": 3, "ES": 4, "ET": 5,
                "AN": 6, "CS": 7, "NSM": 8, "BN": 9, "B": 10, "S": 11,
                "WS": 12, "ON": 13, "LRE": 14, "LRO": 15, "RLE": 16,
                "RLO": 17, "PDF": 18, "LRI": 19, "RLI": 20, "FSI": 21,
                "PDI": 22
            }
        },
        "status": {
            "ok": 0,
            "invalidHandle": 1,
            "invalidFont": 2,
            "invalidExtents": 3,
            "handleConflict": 4,
            "fontMissing": 5,
            "invalidRequest": 6,
            "resultTooLarge": 7
        }
    })
    .to_string()
}
