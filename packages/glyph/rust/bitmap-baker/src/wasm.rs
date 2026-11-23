use pmndrs_glyph_wasm_abi::{AllocationTable, WasmSingleton, write_u32_le};
use std::{string::ToString, vec::Vec};

use serde::Serialize;

use crate::{BitmapBakeRequestV0, BitmapBakeResultV0, bake_bitmap};

const MAX_REQUEST_ALLOCATION_BYTES: u32 = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_REQUEST_ALLOCATION_BYTES as usize;

static STATE: WasmSingleton<AllocationTable> = WasmSingleton::new();

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
    fingerprint: &'a str,
    byte_offset: usize,
    byte_length: usize,
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_alloc(len: u32) -> u32 {
    STATE.with(|table| table.allocate(len, MAX_REQUEST_ALLOCATION_BYTES))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_dealloc(pointer: u32, len: u32) {
    STATE.with(|table| table.deallocate(pointer, len));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_bitmap_baker_bake(
    source_pointer: u32,
    source_len: u32,
    request_pointer: u32,
    request_len: u32,
) -> u32 {
    let result = STATE.with(|table| {
        let Some(source) = table.owned_bytes_or_empty(source_pointer, source_len) else {
            return Err(crate::BitmapBakeError::new(
                crate::BitmapBakeErrorCode::InvalidDescriptor,
                "bitmap baker source range is not an active module allocation",
            ));
        };
        let Some(request_bytes) = table.owned_bytes_or_empty(request_pointer, request_len) else {
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
    STATE.with(|table| table.publish(encode_response(result)))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_bitmap_baker_result_len() -> u32 {
    STATE.with(|table| table.result_length())
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
                    fingerprint: &artifact.fingerprint,
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
    let Some(total_length) = pmndrs_glyph_wasm_abi::response_total_length(
        MAX_RESPONSE_BYTES,
        header_length,
        metadata.len(),
        artifact_bytes.len(),
    ) else {
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

fn serialization_error() -> Vec<u8> {
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize bitmap result\"}"
        .to_vec()
}

fn write_header_u32(response: &mut [u8], offset: u32, value: u32) {
    write_u32_le(response, offset as usize, value);
}
