use alloc::{boxed::Box, vec::Vec};
#[cfg(feature = "allocation-evidence")]
use core::alloc::{GlobalAlloc, Layout};
use core::sync::atomic::{AtomicUsize, Ordering};

use pmndrs_text_mtsdf_core::{AtlasRegion, Bounds, MtsdfGenerator, OutlineSink, OutlineSource};

#[cfg(not(feature = "allocation-evidence"))]
#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

#[cfg(feature = "allocation-evidence")]
static ALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
#[cfg(feature = "allocation-evidence")]
static REALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);
#[cfg(feature = "allocation-evidence")]
static DEALLOCATION_CALLS: AtomicUsize = AtomicUsize::new(0);

#[cfg(feature = "allocation-evidence")]
struct CountingAllocator;

#[cfg(feature = "allocation-evidence")]
#[global_allocator]
static ALLOCATOR: CountingAllocator = CountingAllocator;

#[cfg(feature = "allocation-evidence")]
unsafe impl GlobalAlloc for CountingAllocator {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        ALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: this wrapper forwards the allocator contract and exact layout unchanged.
        unsafe { GlobalAlloc::alloc(&dlmalloc::GlobalDlmalloc, layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        DEALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from this wrapper's dlmalloc allocation domain.
        unsafe { GlobalAlloc::dealloc(&dlmalloc::GlobalDlmalloc, pointer, layout) };
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        REALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from this wrapper and new_size is forwarded unchanged.
        unsafe { GlobalAlloc::realloc(&dlmalloc::GlobalDlmalloc, pointer, layout, new_size) }
    }
}

const MAX_REQUEST_BYTES: u32 = 64 * 1024 * 1024;
const REQUEST_HEADER_SIZE: usize = 48;
const COMMAND_SIZE: usize = 28;
const STATUS_OK: u32 = 0;
const STATUS_INVALID_REQUEST: u32 = 1;
const STATUS_INVALID_OUTLINE: u32 = 2;
const STATUS_GENERATION_FAILED: u32 = 3;

static STATE: AtomicUsize = AtomicUsize::new(0);
static ABI: &str = env!("PMNDRS_TEXT_MTSDF_ABI");

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_abi_ptr() -> u32 {
    u32::try_from(ABI.as_ptr() as usize).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_abi_len() -> u32 {
    u32::try_from(ABI.len()).unwrap_or(0)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_alloc(length: u32) -> u32 {
    with_state(|state| state.allocate(length))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_dealloc(pointer: u32, length: u32) {
    with_state(|state| state.deallocate(pointer, length));
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_generate(pointer: u32, length: u32) -> u32 {
    with_state(|state| {
        state.result_pointer = 0;
        state.result_length = 0;
        let WasmState {
            generator,
            allocations,
            result_pointer,
            result_length,
        } = state;
        let Some(bytes) = owned_bytes(allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let Some(request) = WireRequest::parse(bytes) else {
            return STATUS_INVALID_REQUEST;
        };
        let Ok(mut outline) = generator.read_outline(&request) else {
            return STATUS_INVALID_OUTLINE;
        };
        let Ok(output) = outline.generate_mtsdf(request.region) else {
            return STATUS_GENERATION_FAILED;
        };
        let Some(pointer) = u32::try_from(output.as_ptr() as usize).ok() else {
            return STATUS_GENERATION_FAILED;
        };
        let Some(length) = u32::try_from(output.len()).ok() else {
            return STATUS_GENERATION_FAILED;
        };
        *result_pointer = pointer;
        *result_length = length;
        STATUS_OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_result_ptr() -> u32 {
    with_state(|state| state.result_pointer)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_result_len() -> u32 {
    with_state(|state| state.result_length)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_reset_allocation_counts() {
    ALLOCATION_CALLS.store(0, Ordering::Relaxed);
    REALLOCATION_CALLS.store(0, Ordering::Relaxed);
    DEALLOCATION_CALLS.store(0, Ordering::Relaxed);
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_allocation_calls() -> u32 {
    u32::try_from(ALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_reallocation_calls() -> u32 {
    u32::try_from(REALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_mtsdf_deallocation_calls() -> u32 {
    u32::try_from(DEALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[derive(Default)]
struct WasmState {
    generator: MtsdfGenerator,
    allocations: Vec<Allocation>,
    result_pointer: u32,
    result_length: u32,
}

struct Allocation {
    pointer: u32,
    length: u32,
    bytes: Vec<u8>,
}

impl WasmState {
    fn allocate(&mut self, length: u32) -> u32 {
        if length == 0 || length > MAX_REQUEST_BYTES || self.allocations.try_reserve(1).is_err() {
            return 0;
        }
        let mut bytes = Vec::new();
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
                .any(|allocation| allocation.pointer == pointer)
        {
            return 0;
        }
        self.allocations.push(Allocation {
            pointer,
            length,
            bytes,
        });
        pointer
    }

    fn deallocate(&mut self, pointer: u32, length: u32) {
        if let Some(index) = self
            .allocations
            .iter()
            .position(|allocation| allocation.pointer == pointer && allocation.length == length)
        {
            self.allocations.swap_remove(index);
        }
    }
}

fn owned_bytes(allocations: &[Allocation], pointer: u32, length: u32) -> Option<&[u8]> {
    allocations
        .iter()
        .find(|allocation| allocation.pointer == pointer && allocation.length == length)
        .map(|allocation| allocation.bytes.as_slice())
}

struct WireRequest<'a> {
    bytes: &'a [u8],
    commands_offset: usize,
    command_count: usize,
    units_per_em: f32,
    bounds: Bounds,
    region: AtlasRegion,
}

impl<'a> WireRequest<'a> {
    fn parse(bytes: &'a [u8]) -> Option<Self> {
        if bytes.len() < REQUEST_HEADER_SIZE || read_u32(bytes, 0)? as usize != bytes.len() {
            return None;
        }
        let commands_offset = read_u32(bytes, 4)? as usize;
        let command_count = read_u32(bytes, 8)? as usize;
        let commands_length = command_count.checked_mul(COMMAND_SIZE)?;
        if commands_offset < REQUEST_HEADER_SIZE
            || commands_offset.checked_add(commands_length)? != bytes.len()
        {
            return None;
        }
        Some(Self {
            bytes,
            commands_offset,
            command_count,
            units_per_em: read_f32(bytes, 12)?,
            bounds: Bounds::new(
                read_f32(bytes, 16)?,
                read_f32(bytes, 20)?,
                read_f32(bytes, 24)?,
                read_f32(bytes, 28)?,
            ),
            region: AtlasRegion {
                inner_width: read_u32(bytes, 32)? as usize,
                inner_height: read_u32(bytes, 36)? as usize,
                padding_x: read_u32(bytes, 40)? as usize,
                padding_y: read_u32(bytes, 44)? as usize,
            },
        })
    }
}

impl OutlineSource for WireRequest<'_> {
    type Error = ();

    fn units_per_em(&self) -> f32 {
        self.units_per_em
    }

    fn bounds(&self) -> Bounds {
        self.bounds
    }

    fn emit(&self, sink: &mut OutlineSink<'_>) -> Result<(), Self::Error> {
        for index in 0..self.command_count {
            let offset = self.commands_offset + index * COMMAND_SIZE;
            let opcode = read_u32(self.bytes, offset).ok_or(())?;
            let value = |field| read_f32(self.bytes, offset + field).ok_or(());
            match opcode {
                0 => sink.move_to(value(4)?, value(8)?),
                1 => sink.line_to(value(4)?, value(8)?),
                2 => sink.quad_to(value(4)?, value(8)?, value(12)?, value(16)?),
                3 => sink.cubic_to(
                    value(4)?,
                    value(8)?,
                    value(12)?,
                    value(16)?,
                    value(20)?,
                    value(24)?,
                ),
                4 => sink.close(),
                _ => return Err(()),
            }
        }
        Ok(())
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        bytes.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

fn read_f32(bytes: &[u8], offset: usize) -> Option<f32> {
    Some(f32::from_bits(read_u32(bytes, offset)?))
}

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 {
        let candidate = Box::into_raw(Box::new(WasmState::default())) as usize;
        match STATE.compare_exchange(0, candidate, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => pointer = candidate,
            Err(existing) => {
                // SAFETY: this allocation was never published because another caller won initialization.
                drop(unsafe { Box::from_raw(candidate as *mut WasmState) });
                pointer = existing;
            }
        }
    }
    // SAFETY: the V0 Wasm host is single-threaded; this pointer is initialized once and never freed.
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
