#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn pmndrs_glyph_bake_progress(completed: u32, total: u32);
}

pub(crate) fn report(completed: u32, total: u32) {
    if total == 0 {
        return;
    }
    let interval = (total / 100).max(1);
    // Positive guard rather than an early return: off wasm32 the reporting block below
    // compiles away, which would leave that `return` as the function's last statement.
    let milestone = completed == 0 || completed == total || completed.is_multiple_of(interval);
    if milestone {
        #[cfg(target_arch = "wasm32")]
        // SAFETY: the browser baker instantiates this module with a matching, synchronous import.
        unsafe {
            pmndrs_glyph_bake_progress(completed, total);
        }
    }
}
