use core::sync::atomic::{AtomicUsize, Ordering};
use std::{boxed::Box, string::ToString, vec::Vec};

use serde::Serialize;

use crate::{BitmapBakeRequestV0, BitmapBakeResultV0, bake_bitmap};

const MAX_REQUEST_ALLOCATION_BYTES: u32 = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_REQUEST_ALLOCATION_BYTES as usize;

static STATE: AtomicUsize = AtomicUsize::new(0);

#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmResultMetadata<'a> {
    raster_key: &'a str,
    kind: &'a str,
    extension: &'a str,
    version: u8,
    artifacts: Vec<WasmArtifactMetadata<'a>>,
    report: &'a crate::BitmapPayloadReportV0,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmArtifactMetadata<'a> {
    role: &'a str,
    id: &'a str,
    sha256: &'a str,
    byte_offset: usize,
    byte_length: usize,
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_alloc(len: u32) -> u32 {
    with_state(|state| state.allocate(len))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_dealloc(pointer: u32, len: u32) {
    with_state(|state| state.deallocate(pointer, len));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_bake(
    source_pointer: u32,
    source_len: u32,
    request_pointer: u32,
    request_len: u32,
) -> u32 {
    let result = with_state(|state| {
        let Some(source) = state.owned_bytes(source_pointer, source_len) else {
            return Err(crate::BitmapBakeError::new(
                crate::BitmapBakeErrorCode::InvalidDescriptor,
                "bitmap baker source range is not an active module allocation",
            ));
        };
        let Some(request_bytes) = state.owned_bytes(request_pointer, request_len) else {
            return Err(crate::BitmapBakeError::new(
                crate::BitmapBakeErrorCode::InvalidDescriptor,
                "bitmap baker request range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<BitmapBakeRequestV0>(request_bytes)
            .map_err(|error| {
                crate::BitmapBakeError::new(
                    crate::BitmapBakeErrorCode::InvalidDescriptor,
                    error.to_string(),
                )
            })
            .and_then(|request| bake_bitmap(source, request))
    });
    leak_response(encode_response(result))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_result_len() -> u32 {
    with_state(|state| state.result_len)
}

fn encode_response(result: Result<BitmapBakeResultV0, crate::BitmapBakeError>) -> Vec<u8> {
    let (status, metadata, artifact_bytes) = match result {
        Ok(result) => {
            let mut offset = 0_usize;
            let mut artifacts = Vec::new();
            if artifacts.try_reserve_exact(result.artifacts.len()).is_err() {
                return Vec::new();
            }
            for artifact in &result.artifacts {
                let Some(next_offset) = offset.checked_add(artifact.bytes.len()) else {
                    return encode_response(Err(crate::BitmapBakeError::new(
                        crate::BitmapBakeErrorCode::ArithmeticOverflow,
                        "bitmap baker artifact offsets exceed the ABI address space",
                    )));
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
            if offset > MAX_RESPONSE_BYTES || u32::try_from(offset).is_err() {
                return encode_response(Err(crate::BitmapBakeError::new(
                    crate::BitmapBakeErrorCode::ArithmeticOverflow,
                    "bitmap baker artifact bytes exceed the ABI address space",
                )));
            }
            let metadata = WasmResultMetadata {
                raster_key: &result.raster_key,
                kind: &result.kind,
                extension: &result.extension,
                version: result.version,
                artifacts,
                report: &result.report,
            };
            let metadata = serde_json::to_vec(&metadata).unwrap_or_else(|_| serialization_error());
            let mut artifact_bytes = Vec::new();
            if artifact_bytes.try_reserve_exact(offset).is_err() {
                return Vec::new();
            }
            for artifact in result.artifacts {
                artifact_bytes.extend_from_slice(&artifact.bytes);
            }
            (
                crate::abi_contract::RESPONSE_SUCCESS_STATUS,
                metadata,
                artifact_bytes,
            )
        }
        Err(error) => (
            1,
            serde_json::to_vec(&error).unwrap_or_else(|_| serialization_error()),
            Vec::new(),
        ),
    };
    let header_length = crate::abi_contract::RESPONSE_HEADER_BYTES as usize;
    let Ok(metadata_len) = u32::try_from(metadata.len()) else {
        return encode_response(Err(crate::BitmapBakeError::new(
            crate::BitmapBakeErrorCode::ArithmeticOverflow,
            "bitmap baker response metadata exceeds the ABI address space",
        )));
    };
    let Ok(artifact_len) = u32::try_from(artifact_bytes.len()) else {
        return encode_response(Err(crate::BitmapBakeError::new(
            crate::BitmapBakeErrorCode::ArithmeticOverflow,
            "bitmap baker response artifact exceeds the ABI address space",
        )));
    };
    let Some(total_length) =
        response_total_length(header_length, metadata.len(), artifact_bytes.len())
    else {
        return encode_response(Err(crate::BitmapBakeError::new(
            crate::BitmapBakeErrorCode::ArithmeticOverflow,
            "bitmap baker response length exceeds the ABI address space",
        )));
    };
    let mut response = Vec::new();
    if response.try_reserve_exact(total_length).is_err() {
        return Vec::new();
    }
    response.resize(header_length, 0);
    let magic_offset = crate::abi_contract::RESPONSE_MAGIC_OFFSET as usize;
    response[magic_offset..magic_offset + crate::abi_contract::RESPONSE_MAGIC.len()]
        .copy_from_slice(crate::abi_contract::RESPONSE_MAGIC.as_bytes());
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_STATUS_OFFSET,
        status,
    );
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_METADATA_LEN_OFFSET,
        metadata_len,
    );
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_ARTIFACT_LEN_OFFSET,
        artifact_len,
    );
    response.extend_from_slice(&metadata);
    response.extend_from_slice(&artifact_bytes);
    response
}

fn response_total_length(header: usize, metadata: usize, artifact: usize) -> Option<usize> {
    let total = header.checked_add(metadata)?.checked_add(artifact)?;
    (total <= MAX_RESPONSE_BYTES && u32::try_from(total).is_ok()).then_some(total)
}

fn serialization_error() -> Vec<u8> {
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize bitmap result\"}"
        .to_vec()
}

fn write_header_u32(response: &mut [u8], offset: u32, value: u32) {
    let Ok(offset) = usize::try_from(offset) else {
        return;
    };
    response[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn leak_response(bytes: Vec<u8>) -> u32 {
    with_state(|state| {
        state.result_pointer = 0;
        state.result_len = 0;
        let Some((pointer, length)) = state.adopt(bytes) else {
            return 0;
        };
        state.result_pointer = pointer;
        state.result_len = length;
        pointer
    })
}

struct WasmState {
    allocations: Vec<Allocation>,
    result_pointer: u32,
    result_len: u32,
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
                .any(|entry| entry.pointer == pointer)
        {
            return None;
        }
        self.allocations.push(Allocation {
            pointer,
            requested_length: length,
            bytes,
        });
        Some((pointer, length))
    }

    fn deallocate(&mut self, pointer: u32, length: u32) {
        if let Some(index) = self
            .allocations
            .iter()
            .position(|entry| entry.pointer == pointer && entry.requested_length == length)
        {
            self.allocations.swap_remove(index);
            if self.result_pointer == pointer {
                self.result_pointer = 0;
                self.result_len = 0;
            }
        }
    }

    fn owned_bytes(&self, pointer: u32, length: u32) -> Option<&[u8]> {
        if length == 0 {
            return (pointer == 0).then_some(&[]);
        }
        self.allocations
            .iter()
            .find(|entry| entry.pointer == pointer && entry.requested_length == length)
            .map(|entry| entry.bytes.as_slice())
    }
}

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    let mut pointer = STATE.load(Ordering::Acquire);
    if pointer == 0 {
        let candidate = Box::into_raw(Box::new(WasmState {
            allocations: Vec::new(),
            result_pointer: 0,
            result_len: 0,
        })) as usize;
        match STATE.compare_exchange(0, candidate, Ordering::AcqRel, Ordering::Acquire) {
            Ok(_) => pointer = candidate,
            Err(existing) => {
                // SAFETY: this allocation was not published because another invocation won.
                drop(unsafe { Box::from_raw(candidate as *mut WasmState) });
                pointer = existing;
            }
        }
    }
    // SAFETY: V0 Wasm is single-threaded; state is initialized once and never freed.
    operation(unsafe { &mut *(pointer as *mut WasmState) })
}
