#[cfg(feature = "artifact-baker")]
use alloc::string::ToString;
use alloc::{boxed::Box, vec::Vec};
#[cfg(feature = "allocation-evidence")]
use core::alloc::{GlobalAlloc, Layout};
use core::sync::atomic::{AtomicUsize, Ordering};

#[cfg(feature = "artifact-baker")]
use serde::Serialize;

#[cfg(feature = "artifact-baker")]
use crate::abi_layout::{
    RESPONSE_ARTIFACT_LENGTH_OFFSET, RESPONSE_HEADER_SIZE, RESPONSE_MAGIC_OFFSET,
    RESPONSE_METADATA_LENGTH_OFFSET, RESPONSE_STATUS_OFFSET,
};
#[cfg(feature = "artifact-baker")]
use crate::{SlugBakeArtifactV0, SlugBakeRequestV0, SlugBakeResultV0, bake_slug};

#[cfg(not(feature = "allocation-evidence"))]
#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

#[cfg(feature = "allocation-evidence")]
static BACKING_ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

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
        unsafe { GlobalAlloc::alloc(&BACKING_ALLOCATOR, layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        DEALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from this wrapper's Talc allocation domain.
        unsafe { GlobalAlloc::dealloc(&BACKING_ALLOCATOR, pointer, layout) };
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        REALLOCATION_CALLS.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from this wrapper and new_size is forwarded unchanged.
        unsafe { GlobalAlloc::realloc(&BACKING_ALLOCATOR, pointer, layout, new_size) }
    }
}

const MAX_REQUEST_BYTES: u32 = 64 * 1024 * 1024;
#[cfg(feature = "artifact-baker")]
const MAX_SINGLE_RESPONSE_BYTES: usize = MAX_REQUEST_BYTES as usize;
#[cfg(feature = "artifact-baker")]
const RESPONSE_CHUNK_BYTES: usize = 8 * 1024 * 1024;
static STATE: AtomicUsize = AtomicUsize::new(0);

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_alloc(length: u32) -> u32 {
    with_state(|state| state.allocate(length))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_dealloc(pointer: u32, length: u32) {
    with_state(|state| state.deallocate(pointer, length));
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_bake(
    source_pointer: u32,
    source_length: u32,
    request_pointer: u32,
    request_length: u32,
) -> u32 {
    with_state(|state| {
        state.segmented_response = None;
    });
    let result = with_state(|state| {
        let Some(source) = owned_bytes(&state.allocations, source_pointer, source_length) else {
            return Err(crate::SlugBakeError::new(
                crate::SlugBakeErrorCode::InvalidDescriptor,
                "Slug baker source range is not an active module allocation",
            ));
        };
        let Some(request_bytes) = owned_bytes(&state.allocations, request_pointer, request_length)
        else {
            return Err(crate::SlugBakeError::new(
                crate::SlugBakeErrorCode::InvalidDescriptor,
                "Slug baker request range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<SlugBakeRequestV0>(request_bytes)
            .map_err(|error| {
                crate::SlugBakeError::new(
                    crate::SlugBakeErrorCode::InvalidDescriptor,
                    error.to_string(),
                )
            })
            .and_then(|request| bake_slug(source, request))
    });
    let prepared = prepare_artifact_response(result);
    if prepared.encoded_byte_length() <= MAX_SINGLE_RESPONSE_BYTES {
        match encode_artifact_response(prepared) {
            Ok(response) => leak_artifact_response(response),
            Err(prepared) => retain_segmented_response(prepared),
        }
    } else {
        retain_segmented_response(prepared)
    }
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_bake_result_len() -> u32 {
    with_state(|state| state.artifact_result_length)
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_status() -> u32 {
    with_state(|state| {
        state
            .segmented_response
            .as_ref()
            .map_or(u32::MAX, |response| response.status)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_metadata_ptr() -> u32 {
    with_state(|state| {
        state
            .segmented_response
            .as_ref()
            .and_then(|response| u32::try_from(response.metadata.as_ptr() as usize).ok())
            .unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_metadata_len() -> u32 {
    with_state(|state| {
        state
            .segmented_response
            .as_ref()
            .and_then(|response| u32::try_from(response.metadata.len()).ok())
            .unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_artifact_count() -> u32 {
    with_state(|state| {
        state
            .segmented_response
            .as_ref()
            .and_then(|response| u32::try_from(response.artifacts.len()).ok())
            .unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_artifact_len(index: u32) -> u32 {
    with_state(|state| {
        segmented_artifact(state, index)
            .and_then(|bytes| u32::try_from(bytes.len()).ok())
            .unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_chunk_ptr(index: u32, offset: u32) -> u32 {
    with_state(|state| {
        let Some(bytes) = segmented_artifact(state, index) else {
            return 0;
        };
        let offset = offset as usize;
        if offset >= bytes.len() {
            return 0;
        }
        u32::try_from(bytes[offset..].as_ptr() as usize).unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_chunk_len(index: u32, offset: u32) -> u32 {
    with_state(|state| {
        let Some(bytes) = segmented_artifact(state, index) else {
            return 0;
        };
        let offset = offset as usize;
        if offset >= bytes.len() {
            return 0;
        }
        u32::try_from((bytes.len() - offset).min(RESPONSE_CHUNK_BYTES)).unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_segmented_release() {
    with_state(|state| {
        state.segmented_response = None;
    });
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_reset_allocation_counts() {
    ALLOCATION_CALLS.store(0, Ordering::Relaxed);
    REALLOCATION_CALLS.store(0, Ordering::Relaxed);
    DEALLOCATION_CALLS.store(0, Ordering::Relaxed);
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_allocation_calls() -> u32 {
    u32::try_from(ALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_reallocation_calls() -> u32 {
    u32::try_from(REALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_slug_deallocation_calls() -> u32 {
    u32::try_from(DEALLOCATION_CALLS.load(Ordering::Relaxed)).unwrap_or(u32::MAX)
}

#[derive(Default)]
struct WasmState {
    allocations: Vec<Allocation>,
    #[cfg(feature = "artifact-baker")]
    artifact_result_pointer: u32,
    #[cfg(feature = "artifact-baker")]
    artifact_result_length: u32,
    #[cfg(feature = "artifact-baker")]
    segmented_response: Option<PreparedArtifactResponse>,
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
        self.adopt(bytes).map_or(0, |(pointer, _)| pointer)
    }

    fn adopt(&mut self, mut bytes: Vec<u8>) -> Option<(u32, u32)> {
        let length = u32::try_from(bytes.len()).ok()?;
        if length == 0 || self.allocations.try_reserve(1).is_err() {
            return None;
        }
        let pointer = u32::try_from(bytes.as_mut_ptr() as usize).ok()?;
        if pointer == 0
            || self
                .allocations
                .iter()
                .any(|allocation| allocation.pointer == pointer)
        {
            return None;
        }
        self.allocations.push(Allocation {
            pointer,
            length,
            bytes,
        });
        Some((pointer, length))
    }

    fn deallocate(&mut self, pointer: u32, length: u32) {
        if let Some(index) = self
            .allocations
            .iter()
            .position(|allocation| allocation.pointer == pointer && allocation.length == length)
        {
            self.allocations.swap_remove(index);
            #[cfg(feature = "artifact-baker")]
            if self.artifact_result_pointer == pointer {
                self.artifact_result_pointer = 0;
                self.artifact_result_length = 0;
            }
        }
    }
}

#[cfg(feature = "artifact-baker")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmResultMetadata<'result> {
    raster_key: &'result str,
    kind: &'result str,
    extension: &'result str,
    version: u8,
    artifacts: Vec<WasmArtifactMetadata<'result>>,
    report: &'result crate::SlugPayloadReportV0,
}

#[cfg(feature = "artifact-baker")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmArtifactMetadata<'artifact> {
    role: &'artifact str,
    id: &'artifact str,
    sha256: &'artifact str,
    byte_offset: usize,
    byte_length: usize,
}

#[cfg(feature = "artifact-baker")]
struct PreparedArtifactResponse {
    status: u32,
    metadata: Vec<u8>,
    artifacts: Vec<SlugBakeArtifactV0>,
    artifact_bytes_length: usize,
}

#[cfg(feature = "artifact-baker")]
impl PreparedArtifactResponse {
    fn encoded_byte_length(&self) -> usize {
        RESPONSE_HEADER_SIZE
            .checked_add(self.metadata.len())
            .and_then(|value| value.checked_add(self.artifact_bytes_length))
            .unwrap_or(usize::MAX)
    }
}

#[cfg(feature = "artifact-baker")]
fn prepare_artifact_response(
    result: Result<SlugBakeResultV0, crate::SlugBakeError>,
) -> PreparedArtifactResponse {
    let result = match result {
        Ok(result) => result,
        Err(error) => return prepared_error_response(error),
    };
    let mut offset = 0_usize;
    let mut artifacts = Vec::new();
    if artifacts.try_reserve_exact(result.artifacts.len()).is_err() {
        return prepared_error_response(crate::SlugBakeError::new(
            crate::SlugBakeErrorCode::ArithmeticOverflow,
            "Slug baker response metadata allocation failed",
        ));
    }
    for artifact in &result.artifacts {
        let Some(next_offset) = offset.checked_add(artifact.bytes.len()) else {
            return prepared_error_response(crate::SlugBakeError::new(
                crate::SlugBakeErrorCode::ArithmeticOverflow,
                "Slug baker artifact offsets exceed the ABI address space",
            ));
        };
        artifacts.push(WasmArtifactMetadata {
            role: &artifact.role,
            id: &artifact.id,
            sha256: &artifact.sha256,
            byte_offset: offset,
            byte_length: artifact.bytes.len(),
        });
        offset = next_offset;
    }
    if u32::try_from(offset).is_err() {
        return prepared_error_response(crate::SlugBakeError::new(
            crate::SlugBakeErrorCode::ArithmeticOverflow,
            "Slug baker artifact bytes exceed the ABI address space",
        ));
    }
    let metadata = WasmResultMetadata {
        raster_key: &result.raster_key,
        kind: &result.kind,
        extension: &result.extension,
        version: result.version,
        artifacts,
        report: &result.report,
    };
    let Ok(metadata) = serde_json::to_vec(&metadata) else {
        return prepared_error_response(crate::SlugBakeError::new(
            crate::SlugBakeErrorCode::SerializationFailed,
            "failed to serialize Slug result metadata",
        ));
    };
    if u32::try_from(metadata.len()).is_err() {
        return prepared_error_response(crate::SlugBakeError::new(
            crate::SlugBakeErrorCode::ArithmeticOverflow,
            "Slug baker response metadata exceeds the ABI address space",
        ));
    }
    PreparedArtifactResponse {
        status: 0,
        metadata,
        artifacts: result.artifacts,
        artifact_bytes_length: offset,
    }
}

#[cfg(feature = "artifact-baker")]
fn prepared_error_response(error: crate::SlugBakeError) -> PreparedArtifactResponse {
    PreparedArtifactResponse {
        status: 1,
        metadata: serde_json::to_vec(&error).unwrap_or_else(|_| serialization_error()),
        artifacts: Vec::new(),
        artifact_bytes_length: 0,
    }
}

#[cfg(feature = "artifact-baker")]
fn encode_artifact_response(
    prepared: PreparedArtifactResponse,
) -> Result<Vec<u8>, PreparedArtifactResponse> {
    let metadata_length = prepared.metadata.len() as u32;
    let artifact_length = prepared.artifact_bytes_length as u32;
    let total_length = prepared.encoded_byte_length();
    let mut response = Vec::new();
    if response.try_reserve_exact(total_length).is_err() {
        return Err(prepared);
    }
    response.resize(RESPONSE_HEADER_SIZE, 0);
    let magic_offset = RESPONSE_MAGIC_OFFSET as usize;
    response[magic_offset..magic_offset + 4].copy_from_slice(b"PMSL");
    write_u32(&mut response, RESPONSE_STATUS_OFFSET, prepared.status);
    write_u32(
        &mut response,
        RESPONSE_METADATA_LENGTH_OFFSET,
        metadata_length,
    );
    write_u32(
        &mut response,
        RESPONSE_ARTIFACT_LENGTH_OFFSET,
        artifact_length,
    );
    response.extend_from_slice(&prepared.metadata);
    for artifact in prepared.artifacts {
        response.extend_from_slice(&artifact.bytes);
    }
    Ok(response)
}

#[cfg(feature = "artifact-baker")]
fn serialization_error() -> Vec<u8> {
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize Slug result\"}".to_vec()
}

#[cfg(feature = "artifact-baker")]
fn leak_artifact_response(bytes: Vec<u8>) -> u32 {
    with_state(|state| {
        state.artifact_result_pointer = 0;
        state.artifact_result_length = 0;
        let Some((pointer, length)) = state.adopt(bytes) else {
            return 0;
        };
        state.artifact_result_pointer = pointer;
        state.artifact_result_length = length;
        pointer
    })
}

#[cfg(feature = "artifact-baker")]
fn retain_segmented_response(prepared: PreparedArtifactResponse) -> u32 {
    with_state(|state| {
        state.artifact_result_pointer = 0;
        state.artifact_result_length = 0;
        state.segmented_response = Some(prepared);
    });
    0
}

#[cfg(feature = "artifact-baker")]
fn segmented_artifact(state: &WasmState, index: u32) -> Option<&[u8]> {
    state
        .segmented_response
        .as_ref()?
        .artifacts
        .get(index as usize)
        .map(|artifact| artifact.bytes.as_slice())
}

fn owned_bytes(allocations: &[Allocation], pointer: u32, length: u32) -> Option<&[u8]> {
    allocations
        .iter()
        .find(|allocation| allocation.pointer == pointer && allocation.length == length)
        .map(|allocation| allocation.bytes.as_slice())
}

#[cfg(feature = "artifact-baker")]
fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    let encoded = value.to_le_bytes();
    bytes[offset..offset + encoded.len()].copy_from_slice(&encoded);
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
