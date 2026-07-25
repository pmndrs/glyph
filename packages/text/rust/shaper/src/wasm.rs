use alloc::{boxed::Box, vec::Vec};
use core::{
    slice,
    sync::atomic::{AtomicUsize, Ordering},
};

use crate::ShaperRegistry;

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

static STATE: AtomicUsize = AtomicUsize::new(0);
static ABI: &str = env!("PMNDRS_TEXT_SHAPER_ABI");

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_abi_ptr() -> u32 {
    ABI.as_ptr() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_abi_len() -> u32 {
    ABI.len() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_alloc(length: u32) -> u32 {
    let mut bytes = Vec::<u8>::with_capacity(length as usize);
    let pointer = bytes.as_mut_ptr();
    core::mem::forget(bytes);
    pointer as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_dealloc(pointer: u32, length: u32) {
    if pointer == 0 || length == 0 {
        return;
    }
    // SAFETY: pointers returned by `pmndrs_text_shaper_alloc` have exactly this capacity and are
    // transferred back at most once by the JavaScript ABI wrapper.
    drop(unsafe { Vec::from_raw_parts(pointer as *mut u8, 0, length as usize) });
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_register_font(
    handle: u32,
    sfnt_pointer: u32,
    sfnt_length: u32,
    extents_pointer: u32,
    extents_length: u32,
    availability_pointer: u32,
    availability_length: u32,
) -> u32 {
    // SAFETY: every range was allocated in this module and remains live for this call.
    let Some(sfnt) = (unsafe { bytes(sfnt_pointer, sfnt_length) }) else {
        return 2;
    };
    // SAFETY: same allocation contract as `sfnt`.
    let Some(extents) = (unsafe { bytes(extents_pointer, extents_length) }) else {
        return 3;
    };
    // SAFETY: same allocation contract as `sfnt`.
    let Some(availability) = (unsafe { bytes(availability_pointer, availability_length) }) else {
        return 3;
    };
    with_state(|state| state.register_font(handle, sfnt, extents, availability))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_dispose_font(handle: u32) -> u32 {
    with_state(|state| state.dispose_font(handle))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_font_count() -> u32 {
    with_state(|state| state.font_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_retained_font_bytes() -> u32 {
    with_state(|state| state.retained_font_bytes())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_plan_count() -> u32 {
    with_state(|state| state.plan_count())
}

fn with_state<Result>(operation: impl FnOnce(&mut ShaperRegistry) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 {
        let candidate = Box::into_raw(Box::new(ShaperRegistry::default())) as usize;
        match STATE.compare_exchange(0, candidate, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => pointer = candidate,
            Err(existing) => {
                // SAFETY: this allocation was never published because another caller won the
                // one-time initialization race.
                drop(unsafe { Box::from_raw(candidate as *mut ShaperRegistry) });
                pointer = existing;
            }
        }
    }
    // SAFETY: Wasm V0 is single-threaded. The pointer is initialized once, never freed, and every
    // exported operation completes synchronously before another operation can enter.
    operation(unsafe { &mut *(pointer as *mut ShaperRegistry) })
}

unsafe fn bytes<'a>(pointer: u32, length: u32) -> Option<&'a [u8]> {
    if pointer == 0 && length != 0 {
        return None;
    }
    // SAFETY: the JavaScript wrapper allocates these ranges in this module's current memory and
    // does not grow or release them during the synchronous call.
    Some(unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) })
}
