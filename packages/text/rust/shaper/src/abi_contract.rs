use alloc::string::{String, ToString};
use core::mem::{align_of, offset_of, size_of};
use serde_json::json;

pub const ABI_VERSION: u32 = 0;
pub const SHAPER_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const UNICODE_VERSION: &str = "17.0.0";

#[repr(C)]
struct ShapeRequestHeader {
    text_offset: u32,
    text_length: u32,
    runs_offset: u32,
    run_count: u32,
    features_offset: u32,
    feature_count: u32,
    languages_offset: u32,
    languages_length: u32,
}

#[repr(C)]
struct ReshapeRequestHeader {
    shape: ShapeRequestHeader,
    ranges_offset: u32,
    range_count: u32,
}

#[repr(C)]
struct BidiRequestHeader {
    text_offset: u32,
    text_length: u32,
    direction: u8,
    reserved: [u8; 3],
}

#[repr(C)]
struct FeatureRecord {
    tag: u32,
    value: u32,
    start: u32,
    end: u32,
}

#[repr(C)]
struct RunRecord {
    font_handle: u32,
    text_start: u32,
    text_end: u32,
    script: u32,
    language_offset: u32,
    feature_start: u32,
    feature_count: u16,
    direction: u8,
    cluster_level: u8,
    flags: u32,
}

#[repr(C)]
struct ReshapeRangeRecord {
    run: u32,
    item_start: u32,
    item_end: u32,
    context_start: u32,
    context_end: u32,
    flags: u32,
}

#[repr(C)]
struct ResultHeader {
    byte_length: u32,
    font_handles_offset: u32,
    font_handle_count: u32,
    run_font_slots_offset: u32,
    run_glyph_starts_offset: u32,
    run_glyph_counts_offset: u32,
    run_count: u32,
    glyph_ids_offset: u32,
    clusters_offset: u32,
    x_advances_offset: u32,
    y_advances_offset: u32,
    x_offsets_offset: u32,
    y_offsets_offset: u32,
    glyph_flags_offset: u32,
    glyph_count: u32,
}

#[repr(C)]
struct BidiResultHeader {
    byte_length: u32,
    levels_offset: u32,
    classes_offset: u32,
    text_length: u32,
    paragraph_starts_offset: u32,
    paragraph_ends_offset: u32,
    paragraph_levels_offset: u32,
    paragraph_count: u32,
}

macro_rules! layout {
    ($size:ident, $alignment:ident, $type:ty) => {
        pub const $size: u32 = size_of::<$type>() as u32;
        pub const $alignment: u32 = align_of::<$type>() as u32;
    };
}

layout!(
    SHAPE_REQUEST_HEADER_SIZE,
    SHAPE_REQUEST_HEADER_ALIGNMENT,
    ShapeRequestHeader
);
layout!(
    RESHAPE_REQUEST_HEADER_SIZE,
    RESHAPE_REQUEST_HEADER_ALIGNMENT,
    ReshapeRequestHeader
);
layout!(
    BIDI_REQUEST_HEADER_SIZE,
    BIDI_REQUEST_HEADER_ALIGNMENT,
    BidiRequestHeader
);
layout!(FEATURE_RECORD_SIZE, FEATURE_RECORD_ALIGNMENT, FeatureRecord);
layout!(RUN_RECORD_SIZE, RUN_RECORD_ALIGNMENT, RunRecord);
layout!(
    RESHAPE_RANGE_RECORD_SIZE,
    RESHAPE_RANGE_RECORD_ALIGNMENT,
    ReshapeRangeRecord
);
layout!(RESULT_HEADER_SIZE, RESULT_HEADER_ALIGNMENT, ResultHeader);
layout!(
    BIDI_RESULT_HEADER_SIZE,
    BIDI_RESULT_HEADER_ALIGNMENT,
    BidiResultHeader
);

macro_rules! field_offset {
    ($name:ident, $type:ty, $field:ident) => {
        pub const $name: usize = offset_of!($type, $field);
    };
}

field_offset!(SHAPE_TEXT_OFFSET, ShapeRequestHeader, text_offset);
field_offset!(SHAPE_TEXT_LENGTH, ShapeRequestHeader, text_length);
field_offset!(SHAPE_RUNS_OFFSET, ShapeRequestHeader, runs_offset);
field_offset!(SHAPE_RUN_COUNT, ShapeRequestHeader, run_count);
field_offset!(SHAPE_FEATURES_OFFSET, ShapeRequestHeader, features_offset);
field_offset!(SHAPE_FEATURE_COUNT, ShapeRequestHeader, feature_count);
field_offset!(SHAPE_LANGUAGES_OFFSET, ShapeRequestHeader, languages_offset);
field_offset!(SHAPE_LANGUAGES_LENGTH, ShapeRequestHeader, languages_length);
field_offset!(RESHAPE_RANGES_OFFSET, ReshapeRequestHeader, ranges_offset);
field_offset!(RESHAPE_RANGE_COUNT, ReshapeRequestHeader, range_count);
field_offset!(BIDI_TEXT_OFFSET, BidiRequestHeader, text_offset);
field_offset!(BIDI_TEXT_LENGTH, BidiRequestHeader, text_length);
field_offset!(BIDI_DIRECTION, BidiRequestHeader, direction);
field_offset!(FEATURE_TAG, FeatureRecord, tag);
field_offset!(FEATURE_VALUE, FeatureRecord, value);
field_offset!(FEATURE_START, FeatureRecord, start);
field_offset!(FEATURE_END, FeatureRecord, end);
field_offset!(RUN_FONT_HANDLE, RunRecord, font_handle);
field_offset!(RUN_TEXT_START, RunRecord, text_start);
field_offset!(RUN_TEXT_END, RunRecord, text_end);
field_offset!(RUN_SCRIPT, RunRecord, script);
field_offset!(RUN_LANGUAGE_OFFSET, RunRecord, language_offset);
field_offset!(RUN_FEATURE_START, RunRecord, feature_start);
field_offset!(RUN_FEATURE_COUNT, RunRecord, feature_count);
field_offset!(RUN_DIRECTION, RunRecord, direction);
field_offset!(RUN_CLUSTER_LEVEL, RunRecord, cluster_level);
field_offset!(RUN_FLAGS, RunRecord, flags);
field_offset!(RANGE_RUN, ReshapeRangeRecord, run);
field_offset!(RANGE_ITEM_START, ReshapeRangeRecord, item_start);
field_offset!(RANGE_ITEM_END, ReshapeRangeRecord, item_end);
field_offset!(RANGE_CONTEXT_START, ReshapeRangeRecord, context_start);
field_offset!(RANGE_CONTEXT_END, ReshapeRangeRecord, context_end);
field_offset!(RANGE_FLAGS, ReshapeRangeRecord, flags);
field_offset!(RESULT_BYTE_LENGTH, ResultHeader, byte_length);
field_offset!(
    RESULT_FONT_HANDLES_OFFSET,
    ResultHeader,
    font_handles_offset
);
field_offset!(RESULT_FONT_HANDLE_COUNT, ResultHeader, font_handle_count);
field_offset!(
    RESULT_RUN_FONT_SLOTS_OFFSET,
    ResultHeader,
    run_font_slots_offset
);
field_offset!(
    RESULT_RUN_GLYPH_STARTS_OFFSET,
    ResultHeader,
    run_glyph_starts_offset
);
field_offset!(
    RESULT_RUN_GLYPH_COUNTS_OFFSET,
    ResultHeader,
    run_glyph_counts_offset
);
field_offset!(RESULT_RUN_COUNT, ResultHeader, run_count);
field_offset!(RESULT_GLYPH_IDS_OFFSET, ResultHeader, glyph_ids_offset);
field_offset!(RESULT_CLUSTERS_OFFSET, ResultHeader, clusters_offset);
field_offset!(RESULT_X_ADVANCES_OFFSET, ResultHeader, x_advances_offset);
field_offset!(RESULT_Y_ADVANCES_OFFSET, ResultHeader, y_advances_offset);
field_offset!(RESULT_X_OFFSETS_OFFSET, ResultHeader, x_offsets_offset);
field_offset!(RESULT_Y_OFFSETS_OFFSET, ResultHeader, y_offsets_offset);
field_offset!(RESULT_GLYPH_FLAGS_OFFSET, ResultHeader, glyph_flags_offset);
field_offset!(RESULT_GLYPH_COUNT, ResultHeader, glyph_count);
field_offset!(BIDI_RESULT_BYTE_LENGTH, BidiResultHeader, byte_length);
field_offset!(BIDI_RESULT_LEVELS_OFFSET, BidiResultHeader, levels_offset);
field_offset!(BIDI_RESULT_CLASSES_OFFSET, BidiResultHeader, classes_offset);
field_offset!(BIDI_RESULT_TEXT_LENGTH, BidiResultHeader, text_length);
field_offset!(
    BIDI_RESULT_PARAGRAPH_STARTS_OFFSET,
    BidiResultHeader,
    paragraph_starts_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_ENDS_OFFSET,
    BidiResultHeader,
    paragraph_ends_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_LEVELS_OFFSET,
    BidiResultHeader,
    paragraph_levels_offset
);
field_offset!(
    BIDI_RESULT_PARAGRAPH_COUNT,
    BidiResultHeader,
    paragraph_count
);

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
                "alignment": SHAPE_REQUEST_HEADER_ALIGNMENT,
                "textOffset": SHAPE_TEXT_OFFSET,
                "textLength": SHAPE_TEXT_LENGTH,
                "runsOffset": SHAPE_RUNS_OFFSET,
                "runCount": SHAPE_RUN_COUNT,
                "featuresOffset": SHAPE_FEATURES_OFFSET,
                "featureCount": SHAPE_FEATURE_COUNT,
                "languagesOffset": SHAPE_LANGUAGES_OFFSET,
                "languagesLength": SHAPE_LANGUAGES_LENGTH
            },
            "reshapeRequest": {
                "size": RESHAPE_REQUEST_HEADER_SIZE,
                "alignment": RESHAPE_REQUEST_HEADER_ALIGNMENT,
                "rangesOffset": RESHAPE_RANGES_OFFSET,
                "rangeCount": RESHAPE_RANGE_COUNT
            },
            "bidiRequest": {
                "size": BIDI_REQUEST_HEADER_SIZE,
                "alignment": BIDI_REQUEST_HEADER_ALIGNMENT,
                "textOffset": BIDI_TEXT_OFFSET,
                "textLength": BIDI_TEXT_LENGTH,
                "direction": BIDI_DIRECTION
            },
            "feature": {
                "size": FEATURE_RECORD_SIZE,
                "alignment": FEATURE_RECORD_ALIGNMENT,
                "tag": FEATURE_TAG,
                "value": FEATURE_VALUE,
                "start": FEATURE_START,
                "end": FEATURE_END
            },
            "run": {
                "size": RUN_RECORD_SIZE,
                "alignment": RUN_RECORD_ALIGNMENT,
                "fontHandle": RUN_FONT_HANDLE,
                "textStart": RUN_TEXT_START,
                "textEnd": RUN_TEXT_END,
                "script": RUN_SCRIPT,
                "languageOffset": RUN_LANGUAGE_OFFSET,
                "featureStart": RUN_FEATURE_START,
                "featureCount": RUN_FEATURE_COUNT,
                "direction": RUN_DIRECTION,
                "clusterLevel": RUN_CLUSTER_LEVEL,
                "flags": RUN_FLAGS
            },
            "reshapeRange": {
                "size": RESHAPE_RANGE_RECORD_SIZE,
                "alignment": RESHAPE_RANGE_RECORD_ALIGNMENT,
                "run": RANGE_RUN,
                "itemStart": RANGE_ITEM_START,
                "itemEnd": RANGE_ITEM_END,
                "contextStart": RANGE_CONTEXT_START,
                "contextEnd": RANGE_CONTEXT_END,
                "flags": RANGE_FLAGS
            },
            "result": {
                "size": RESULT_HEADER_SIZE,
                "alignment": RESULT_HEADER_ALIGNMENT,
                "byteLength": RESULT_BYTE_LENGTH,
                "fontHandlesOffset": RESULT_FONT_HANDLES_OFFSET,
                "fontHandleCount": RESULT_FONT_HANDLE_COUNT,
                "runFontSlotsOffset": RESULT_RUN_FONT_SLOTS_OFFSET,
                "runGlyphStartsOffset": RESULT_RUN_GLYPH_STARTS_OFFSET,
                "runGlyphCountsOffset": RESULT_RUN_GLYPH_COUNTS_OFFSET,
                "runCount": RESULT_RUN_COUNT,
                "glyphIdsOffset": RESULT_GLYPH_IDS_OFFSET,
                "clustersOffset": RESULT_CLUSTERS_OFFSET,
                "xAdvancesOffset": RESULT_X_ADVANCES_OFFSET,
                "yAdvancesOffset": RESULT_Y_ADVANCES_OFFSET,
                "xOffsetsOffset": RESULT_X_OFFSETS_OFFSET,
                "yOffsetsOffset": RESULT_Y_OFFSETS_OFFSET,
                "glyphFlagsOffset": RESULT_GLYPH_FLAGS_OFFSET,
                "glyphCount": RESULT_GLYPH_COUNT
            },
            "bidiResult": {
                "size": BIDI_RESULT_HEADER_SIZE,
                "alignment": BIDI_RESULT_HEADER_ALIGNMENT,
                "byteLength": BIDI_RESULT_BYTE_LENGTH,
                "levelsOffset": BIDI_RESULT_LEVELS_OFFSET,
                "classesOffset": BIDI_RESULT_CLASSES_OFFSET,
                "textLength": BIDI_RESULT_TEXT_LENGTH,
                "paragraphStartsOffset": BIDI_RESULT_PARAGRAPH_STARTS_OFFSET,
                "paragraphEndsOffset": BIDI_RESULT_PARAGRAPH_ENDS_OFFSET,
                "paragraphLevelsOffset": BIDI_RESULT_PARAGRAPH_LEVELS_OFFSET,
                "paragraphCount": BIDI_RESULT_PARAGRAPH_COUNT
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
