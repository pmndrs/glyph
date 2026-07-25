use alloc::{boxed::Box, vec::Vec};
use core::{
    slice,
    sync::atomic::{AtomicUsize, Ordering},
};

use crate::{
    STATUS_INVALID_REQUEST, ShaperRegistry, bidi,
    wire::{
        pack_bidi_result, pack_result, parse_bidi_request, parse_reshape_request,
        parse_shape_request,
    },
};

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

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_shape_batch(pointer: u32, length: u32) -> u32 {
    // SAFETY: the request range is an allocation owned by this module and remains live for this
    // synchronous call. `bytes` also verifies it is within current linear memory.
    let Some(bytes) = (unsafe { bytes(pointer, length) }) else {
        return STATUS_INVALID_REQUEST;
    };
    with_state(|state| {
        state.set_result(Vec::new());
        let request = match parse_shape_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match state.shape_batch(&request) {
            Ok(output) => output,
            Err(status) => return status,
        };
        match pack_result(&output) {
            Ok(result) => {
                state.set_result(result);
                0
            }
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_reshape_ranges(pointer: u32, length: u32) -> u32 {
    // SAFETY: same request allocation contract as `pmndrs_text_shaper_shape_batch`.
    let Some(bytes) = (unsafe { bytes(pointer, length) }) else {
        return STATUS_INVALID_REQUEST;
    };
    with_state(|state| {
        state.set_result(Vec::new());
        let (request, ranges) = match parse_reshape_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match state.reshape_ranges(&request, &ranges) {
            Ok(output) => output,
            Err(status) => return status,
        };
        match pack_result(&output) {
            Ok(result) => {
                state.set_result(result);
                0
            }
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_analyze_bidi(pointer: u32, length: u32) -> u32 {
    // SAFETY: same request allocation contract as `pmndrs_text_shaper_shape_batch`.
    let Some(bytes) = (unsafe { bytes(pointer, length) }) else {
        return STATUS_INVALID_REQUEST;
    };
    with_state(|state| {
        state.set_result(Vec::new());
        let (text, direction) = match parse_bidi_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match bidi::analyze(&text, direction) {
            Ok(output) => output,
            Err(()) => return STATUS_INVALID_REQUEST,
        };
        match pack_bidi_result(&output) {
            Ok(result) => {
                state.set_result(result);
                0
            }
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_result_ptr() -> u32 {
    with_state(|state| state.result_pointer() as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_result_len() -> u32 {
    with_state(|state| state.result_length())
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
    let end = pointer.checked_add(length)?;
    let memory_bytes = (core::arch::wasm32::memory_size(0) as u64).checked_mul(65_536)?;
    if u64::from(end) > memory_bytes {
        return None;
    }
    // SAFETY: the JavaScript wrapper allocates these ranges in this module's current memory and
    // does not grow or release them during the synchronous call.
    Some(unsafe { slice::from_raw_parts(pointer as *const u8, length as usize) })
}
