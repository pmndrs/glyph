use alloc::string::{String, ToString};
use serde_json::json;

pub const ABI_VERSION: u32 = 0;
pub const SHAPER_VERSION: &str = "0.0.0";
pub const HARFRUST_VERSION: &str = "0.12.0";
pub const HARFRUST_COMMIT: &str = "60b28ea22b5261710018d69c168a762bcb28794c";
pub const UNICODE_VERSION: &str = "17.0.0";

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
            "planCount": "pmndrs_text_shaper_plan_count"
        },
        "status": {
            "ok": 0,
            "invalidHandle": 1,
            "invalidFont": 2,
            "invalidExtents": 3,
            "handleConflict": 4,
            "fontMissing": 5
        }
    })
    .to_string()
}
