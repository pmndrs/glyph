use alloc::{boxed::Box, vec::Vec};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{
    STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE, ShaperRegistry, bidi,
    wire::{
        pack_bidi_result, pack_result, parse_bidi_request, parse_reshape_request,
        parse_shape_request,
    },
};

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

const MAX_REQUEST_ALLOCATION_BYTES: u32 = 64 * 1024 * 1024;

static STATE: AtomicUsize = AtomicUsize::new(0);

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_alloc(length: u32) -> u32 {
    with_state(|state| state.allocate(length))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_dealloc(pointer: u32, length: u32) {
    with_state(|state| state.deallocate(pointer, length));
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
    with_state(|state| {
        let WasmState {
            registry,
            allocations,
        } = state;
        let Some(sfnt) = owned_bytes(allocations, sfnt_pointer, sfnt_length) else {
            return 2;
        };
        let Some(extents) = owned_bytes(allocations, extents_pointer, extents_length) else {
            return 3;
        };
        let Some(availability) =
            owned_bytes(allocations, availability_pointer, availability_length)
        else {
            return 3;
        };
        registry.register_font(handle, sfnt, extents, availability)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_dispose_font(handle: u32) -> u32 {
    with_state(|state| state.registry.dispose_font(handle))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_font_count() -> u32 {
    with_state(|state| state.registry.font_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_retained_font_bytes() -> u32 {
    with_state(|state| state.registry.retained_font_bytes())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_plan_count() -> u32 {
    with_state(|state| state.registry.plan_count())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_shape_batch(pointer: u32, length: u32) -> u32 {
    with_state(|state| {
        state.registry.clear_result();
        let Some(bytes) = owned_bytes(&state.allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let request = match parse_shape_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match state.registry.shape_batch(&request) {
            Ok(output) => output,
            Err(status) => return status,
        };
        match pack_result(&output) {
            Ok(result) => store_result(&mut state.registry, result),
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_reshape_ranges(pointer: u32, length: u32) -> u32 {
    with_state(|state| {
        state.registry.clear_result();
        let Some(bytes) = owned_bytes(&state.allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let (request, ranges) = match parse_reshape_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match state.registry.reshape_ranges(&request, &ranges) {
            Ok(output) => output,
            Err(status) => return status,
        };
        match pack_result(&output) {
            Ok(result) => store_result(&mut state.registry, result),
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_shaper_analyze_bidi(pointer: u32, length: u32) -> u32 {
    with_state(|state| {
        state.registry.clear_result();
        let Some(bytes) = owned_bytes(&state.allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let (text, direction) = match parse_bidi_request(bytes) {
            Ok(request) => request,
            Err(status) => return status,
        };
        let output = match bidi::analyze(&text, direction) {
            Ok(output) => output,
            Err(bidi::BidiError::InvalidDirection) => return STATUS_INVALID_REQUEST,
            Err(bidi::BidiError::ResultTooLarge) => return STATUS_RESULT_TOO_LARGE,
        };
        match pack_bidi_result(&output) {
            Ok(result) => store_result(&mut state.registry, result),
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_result_ptr() -> u32 {
    with_state(|state| u32::try_from(state.registry.result_pointer() as usize).unwrap_or(0))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_shaper_result_len() -> u32 {
    with_state(|state| state.registry.result_length())
}

#[derive(Default)]
struct WasmState {
    registry: ShaperRegistry,
    allocations: Vec<Allocation>,
}

struct Allocation {
    pointer: u32,
    requested_length: u32,
    bytes: Vec<u8>,
}

impl WasmState {
    fn allocate(&mut self, length: u32) -> u32 {
        if length == 0 {
            return 0;
        }
        if length > MAX_REQUEST_ALLOCATION_BYTES {
            return 0;
        }
        if self.allocations.try_reserve(1).is_err() {
            return 0;
        }
        let mut bytes = Vec::<u8>::new();
        if bytes.try_reserve_exact(length as usize).is_err() {
            return 0;
        }
        bytes.resize(length as usize, 0);
        let Some(pointer) = u32::try_from(bytes.as_mut_ptr() as usize).ok() else {
            return 0;
        };
        if pointer == 0
            || self
                .allocations
                .iter()
                .any(|entry| entry.pointer == pointer)
        {
            return 0;
        }
        self.allocations.push(Allocation {
            pointer,
            requested_length: length,
            bytes,
        });
        pointer
    }

    fn deallocate(&mut self, pointer: u32, length: u32) {
        if let Some(index) = self
            .allocations
            .iter()
            .position(|entry| entry.pointer == pointer && entry.requested_length == length)
        {
            self.allocations.swap_remove(index);
        }
    }
}

fn owned_bytes(allocations: &[Allocation], pointer: u32, length: u32) -> Option<&[u8]> {
    if length == 0 {
        return (pointer == 0).then_some(&[]);
    }
    allocations
        .iter()
        .find(|entry| entry.pointer == pointer && entry.requested_length == length)
        .map(|entry| entry.bytes.as_slice())
}

fn store_result(registry: &mut ShaperRegistry, result: Vec<u8>) -> u32 {
    match registry.set_result(result) {
        Ok(()) => 0,
        Err(status) => status,
    }
}

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 {
        let candidate = Box::into_raw(Box::new(WasmState::default())) as usize;
        match STATE.compare_exchange(0, candidate, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => pointer = candidate,
            Err(existing) => {
                // SAFETY: this allocation was never published because another caller won the
                // one-time initialization race.
                drop(unsafe { Box::from_raw(candidate as *mut WasmState) });
                pointer = existing;
            }
        }
    }
    // SAFETY: Wasm V0 is single-threaded. The pointer is initialized once, never freed, and every
    // exported operation completes synchronously before another operation can enter.
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
