use core::{
    mem,
    sync::atomic::{AtomicU32, Ordering},
};
use std::{string::ToString, vec::Vec};

use serde::Serialize;

use crate::{BitmapBakeRequestV0, BitmapBakeResultV0, bake_bitmap};

static RESULT_LEN: AtomicU32 = AtomicU32::new(0);
static ABI_JSON: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/bitmap-baker-abi-v0.json"));

#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

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
    let mut bytes = Vec::<u8>::with_capacity(len as usize);
    let pointer = bytes.as_mut_ptr();
    mem::forget(bytes);
    pointer as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_dealloc(pointer: u32, len: u32) {
    if pointer != 0 && len != 0 {
        // SAFETY: JavaScript returns only pointers and lengths allocated by this module.
        unsafe { drop(Vec::from_raw_parts(pointer as *mut u8, 0, len as usize)) };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_bake(
    source_pointer: u32,
    source_len: u32,
    request_pointer: u32,
    request_len: u32,
) -> u32 {
    // SAFETY: The host allocates both regions in this module and writes exactly their lengths.
    let source =
        unsafe { std::slice::from_raw_parts(source_pointer as *const u8, source_len as usize) };
    // SAFETY: Same allocation contract as source.
    let request_bytes =
        unsafe { std::slice::from_raw_parts(request_pointer as *const u8, request_len as usize) };
    let result = serde_json::from_slice::<BitmapBakeRequestV0>(request_bytes)
        .map_err(|error| {
            crate::BitmapBakeError::new(
                crate::BitmapBakeErrorCode::InvalidDescriptor,
                error.to_string(),
            )
        })
        .and_then(|request| bake_bitmap(source, request));
    leak_response(encode_response(result))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_result_len() -> u32 {
    RESULT_LEN.load(Ordering::Relaxed)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_abi_ptr() -> u32 {
    ABI_JSON.as_ptr() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_abi_len() -> u32 {
    ABI_JSON.len() as u32
}

fn encode_response(result: Result<BitmapBakeResultV0, crate::BitmapBakeError>) -> Vec<u8> {
    let (status, metadata, artifact_bytes) = match result {
        Ok(result) => {
            let mut offset = 0_usize;
            let artifacts = result
                .artifacts
                .iter()
                .map(|artifact| {
                    let metadata = WasmArtifactMetadata {
                        role: &artifact.role,
                        id: &artifact.id,
                        sha256: &artifact.sha256,
                        byte_offset: offset,
                        byte_length: artifact.bytes.len(),
                    };
                    offset += artifact.bytes.len();
                    metadata
                })
                .collect();
            let metadata = WasmResultMetadata {
                raster_key: &result.raster_key,
                kind: &result.kind,
                extension: &result.extension,
                version: result.version,
                artifacts,
                report: &result.report,
            };
            let metadata = serde_json::to_vec(&metadata).unwrap_or_else(|_| serialization_error());
            let artifact_bytes = result
                .artifacts
                .into_iter()
                .flat_map(|artifact| artifact.bytes)
                .collect();
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
    let mut response = vec![0_u8; crate::abi_contract::RESPONSE_HEADER_BYTES as usize];
    response[..crate::abi_contract::RESPONSE_MAGIC.len()]
        .copy_from_slice(crate::abi_contract::RESPONSE_MAGIC.as_bytes());
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_STATUS_OFFSET,
        status,
    );
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_METADATA_LEN_OFFSET,
        metadata.len() as u32,
    );
    write_header_u32(
        &mut response,
        crate::abi_contract::RESPONSE_ARTIFACT_LEN_OFFSET,
        artifact_bytes.len() as u32,
    );
    response.extend_from_slice(&metadata);
    response.extend_from_slice(&artifact_bytes);
    response
}

fn serialization_error() -> Vec<u8> {
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize bitmap result\"}"
        .to_vec()
}

fn write_header_u32(response: &mut [u8], offset: u32, value: u32) {
    let offset = offset as usize;
    response[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn leak_response(bytes: Vec<u8>) -> u32 {
    let mut bytes = bytes.into_boxed_slice();
    let len = bytes.len() as u32;
    let pointer = bytes.as_mut_ptr();
    mem::forget(bytes);
    RESULT_LEN.store(len, Ordering::Relaxed);
    pointer as u32
}
