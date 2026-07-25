use core::{
    mem,
    sync::atomic::{AtomicU32, Ordering},
};
use std::{string::ToString, vec::Vec};

use serde::Serialize;

use crate::{BakeDescriptorV0, BakeResultV0, bake_font};

static RESULT_LEN: AtomicU32 = AtomicU32::new(0);
static ABI_JSON: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/font-baker-abi-v0.json"));

#[global_allocator]
static ALLOCATOR: dlmalloc::GlobalDlmalloc = dlmalloc::GlobalDlmalloc;

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmResultMetadata<'a> {
    artifacts: Vec<WasmArtifactMetadata<'a>>,
    report: &'a crate::BakeReportV0,
    warnings: &'a [crate::BakeWarning],
}

#[derive(Serialize)]
struct WasmArtifactMetadata<'a> {
    role: &'a str,
    id: &'a str,
    sha256: &'a str,
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_alloc(len: u32) -> u32 {
    let mut bytes = Vec::<u8>::with_capacity(len as usize);
    let pointer = bytes.as_mut_ptr();
    mem::forget(bytes);
    pointer as u32
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_dealloc(pointer: u32, len: u32) {
    if pointer != 0 && len != 0 {
        // SAFETY: JavaScript returns only pointers and lengths obtained from this module.
        unsafe { drop(Vec::from_raw_parts(pointer as *mut u8, 0, len as usize)) };
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_bake(
    source_pointer: u32,
    source_len: u32,
    descriptor_pointer: u32,
    descriptor_len: u32,
) -> u32 {
    // SAFETY: The wrapper allocates both regions in this module and writes exactly their lengths.
    let source =
        unsafe { std::slice::from_raw_parts(source_pointer as *const u8, source_len as usize) };
    // SAFETY: Same allocation contract as source.
    let descriptor_bytes = unsafe {
        std::slice::from_raw_parts(descriptor_pointer as *const u8, descriptor_len as usize)
    };
    let result = serde_json::from_slice::<BakeDescriptorV0>(descriptor_bytes)
        .map_err(|error| {
            crate::BakeError::new(crate::BakeErrorCode::InvalidDescriptor, error.to_string())
        })
        .and_then(|descriptor| bake_font(source, descriptor));
    leak_response(encode_response(result))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_result_len() -> u32 {
    RESULT_LEN.load(Ordering::Relaxed)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_abi_ptr() -> u32 {
    ABI_JSON.as_ptr() as u32
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_abi_len() -> u32 {
    ABI_JSON.len() as u32
}

fn encode_response(result: Result<BakeResultV0, crate::BakeError>) -> Vec<u8> {
    let (status, metadata, artifact) = match result {
        Ok(result) => {
            let metadata = WasmResultMetadata {
                artifacts: result
                    .artifacts
                    .iter()
                    .map(|value| WasmArtifactMetadata {
                        role: &value.role,
                        id: &value.id,
                        sha256: &value.sha256,
                    })
                    .collect(),
                report: &result.report,
                warnings: &result.warnings,
            };
            (crate::abi_contract::RESPONSE_SUCCESS_STATUS, serde_json::to_vec(&metadata).unwrap_or_else(|_| b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize result\"}".to_vec()), result.artifacts.into_iter().next().map(|value| value.bytes).unwrap_or_default())
        }
        Err(error) => (
            1_u32,
            serde_json::to_vec(&error).unwrap_or_else(|_| {
                b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize error\"}"
                    .to_vec()
            }),
            Vec::new(),
        ),
    };
    let header_len = crate::abi_contract::RESPONSE_HEADER_BYTES as usize;
    let mut response = vec![0_u8; header_len];
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
        artifact.len() as u32,
    );
    debug_assert_eq!(
        header_len,
        crate::abi_contract::RESPONSE_PAYLOAD_OFFSET as usize
    );
    response.extend_from_slice(&metadata);
    response.extend_from_slice(&artifact);
    response
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
