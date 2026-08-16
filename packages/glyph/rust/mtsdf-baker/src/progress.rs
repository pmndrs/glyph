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
    if completed != 0 && completed != total && completed % interval != 0 {
        return;
    }
    #[cfg(target_arch = "wasm32")]
    // SAFETY: the browser baker instantiates this module with a matching, synchronous import.
    unsafe {
        pmndrs_glyph_bake_progress(completed, total);
    }
}
