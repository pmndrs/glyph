use pmndrs_glyph_wasm_abi::{AllocationTable, WasmSingleton, write_u32_le};
use std::{string::ToString, vec::Vec};

use serde::Serialize;

use crate::{BakeDescriptorV0, BakeResultV0, bake_font};
#[cfg(feature = "subsetting")]
use crate::{FontSelectionV0, inspect_font, prepare_font};

const MAX_REQUEST_ALLOCATION_BYTES: u32 = 64 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = MAX_REQUEST_ALLOCATION_BYTES as usize;

static STATE: WasmSingleton<WasmState> = WasmSingleton::new();

#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

#[cfg(not(feature = "std"))]
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
    fingerprint: &'a str,
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_alloc(len: u32) -> u32 {
    with_state(|state| state.table.allocate(len, MAX_REQUEST_ALLOCATION_BYTES))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_dealloc(pointer: u32, len: u32) {
    with_state(|state| state.table.deallocate(pointer, len));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_bake(
    source_pointer: u32,
    source_len: u32,
    descriptor_pointer: u32,
    descriptor_len: u32,
) -> u32 {
    let result = with_state(|state| {
        let Some(source) = state.table.owned_bytes_or_empty(source_pointer, source_len) else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidDescriptor,
                "font baker source range is not an active module allocation",
            ));
        };
        let Some(descriptor_bytes) = state
            .table
            .owned_bytes_or_empty(descriptor_pointer, descriptor_len)
        else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidDescriptor,
                "font baker descriptor range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<BakeDescriptorV0>(descriptor_bytes)
            .map_err(|error| {
                crate::BakeError::new(crate::BakeErrorCode::InvalidDescriptor, error.to_string())
            })
            .and_then(|descriptor| bake_font(source, descriptor))
    });
    leak_response(encode_response(result))
}

#[cfg(feature = "subsetting")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_prepare(
    source_pointer: u32,
    source_len: u32,
    selection_pointer: u32,
    selection_len: u32,
) -> u32 {
    let result = with_state(|state| {
        let Some(source) = state.table.owned_bytes_or_empty(source_pointer, source_len) else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidSelection,
                "font preparation source range is not an active module allocation",
            ));
        };
        let Some(selection_bytes) = state
            .table
            .owned_bytes_or_empty(selection_pointer, selection_len)
        else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidSelection,
                "font selection range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<FontSelectionV0>(selection_bytes)
            .map_err(|error| {
                crate::BakeError::new(crate::BakeErrorCode::InvalidSelection, error.to_string())
            })
            .and_then(|selection| prepare_font(source, selection))
    });
    leak_response(encode_value_response(
        result.map(|prepared| (prepared.report, prepared.bytes)),
    ))
}

#[cfg(feature = "subsetting")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_font_baker_inspect(
    source_pointer: u32,
    source_len: u32,
    descriptor_pointer: u32,
    descriptor_len: u32,
) -> u32 {
    let result = with_state(|state| {
        let Some(source) = state.table.owned_bytes_or_empty(source_pointer, source_len) else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidDescriptor,
                "font inspection source range is not an active module allocation",
            ));
        };
        let Some(descriptor_bytes) = state
            .table
            .owned_bytes_or_empty(descriptor_pointer, descriptor_len)
        else {
            return Err(crate::BakeError::new(
                crate::BakeErrorCode::InvalidDescriptor,
                "font inspection descriptor range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<BakeDescriptorV0>(descriptor_bytes)
            .map_err(|error| {
                crate::BakeError::new(crate::BakeErrorCode::InvalidDescriptor, error.to_string())
            })
            .and_then(|descriptor| descriptor.validate())
            .and_then(|descriptor| inspect_font(source, descriptor.font_face_index))
    });
    leak_response(encode_value_response(
        result.map(|inspection| (inspection, Vec::new())),
    ))
}

/// Decodes one glyph from an outline SFNT in an owned allocation. The encoded words, aligned to 4
/// bytes, stay readable through the pointer and byte-length exports until the next decode.
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_glyph_outline(
    sfnt_pointer: u32,
    sfnt_length: u32,
    glyph_id: u32,
) -> u32 {
    use crate::abi_contract::{
        GLYPH_OUTLINE_STATUS_INVALID_FONT, GLYPH_OUTLINE_STATUS_INVALID_REQUEST,
        GLYPH_OUTLINE_STATUS_OK, GLYPH_OUTLINE_STATUS_OUT_OF_MEMORY,
    };
    use pmndrs_glyph_outline::OutlineError;
    with_state(|state| {
        let WasmState {
            table,
            outline,
            outline_result,
        } = state;
        outline_result.clear();
        let Some(sfnt) = table.owned_bytes_or_empty(sfnt_pointer, sfnt_length) else {
            return GLYPH_OUTLINE_STATUS_INVALID_REQUEST;
        };
        match outline
            .decode(sfnt, glyph_id)
            .and_then(|()| outline.encode(outline_result))
        {
            Ok(()) => GLYPH_OUTLINE_STATUS_OK,
            Err(OutlineError::InvalidFont | OutlineError::InvalidGlyph) => {
                GLYPH_OUTLINE_STATUS_INVALID_FONT
            }
            Err(OutlineError::OutOfMemory) => GLYPH_OUTLINE_STATUS_OUT_OF_MEMORY,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_glyph_outline_ptr() -> u32 {
    with_state(|state| u32::try_from(state.outline_result.as_ptr() as usize).unwrap_or(0))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_glyph_outline_len() -> u32 {
    with_state(|state| {
        u32::try_from(core::mem::size_of_val(state.outline_result.as_slice())).unwrap_or(0)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_font_baker_result_len() -> u32 {
    with_state(|state| state.table.result_length())
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
                        fingerprint: &value.fingerprint,
                    })
                    .collect(),
                report: &result.report,
                warnings: &result.warnings,
            };
            (
                crate::abi_contract::RESPONSE_SUCCESS_STATUS,
                serde_json::to_vec(&metadata).unwrap_or_else(|_| {
                    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize result\"}"
                        .to_vec()
                }),
                result
                    .artifacts
                    .into_iter()
                    .next()
                    .map(|value| value.bytes)
                    .unwrap_or_default(),
            )
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
    encode_envelope(status, metadata, artifact)
}

#[cfg(feature = "subsetting")]
fn encode_value_response<Metadata: Serialize>(
    result: Result<(Metadata, Vec<u8>), crate::BakeError>,
) -> Vec<u8> {
    match result {
        Ok((metadata, artifact)) => encode_envelope(
            crate::abi_contract::RESPONSE_SUCCESS_STATUS,
            serde_json::to_vec(&metadata).unwrap_or_else(|_| {
                b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize result\"}"
                    .to_vec()
            }),
            artifact,
        ),
        Err(error) => encode_envelope(
            1,
            serde_json::to_vec(&error).unwrap_or_else(|_| {
                b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize error\"}"
                    .to_vec()
            }),
            Vec::new(),
        ),
    }
}

fn encode_envelope(status: u32, metadata: Vec<u8>, artifact: Vec<u8>) -> Vec<u8> {
    let header_len = crate::abi_contract::RESPONSE_HEADER_BYTES as usize;
    let Ok(metadata_len) = u32::try_from(metadata.len()) else {
        return encode_response(Err(crate::BakeError::new(
            crate::BakeErrorCode::IntegerOverflow,
            "font baker response metadata exceeds the ABI address space",
        )));
    };
    let Ok(artifact_len) = u32::try_from(artifact.len()) else {
        return encode_response(Err(crate::BakeError::new(
            crate::BakeErrorCode::IntegerOverflow,
            "font baker response artifact exceeds the ABI address space",
        )));
    };
    let Some(total_length) = pmndrs_glyph_wasm_abi::response_total_length(
        MAX_RESPONSE_BYTES,
        header_len,
        metadata.len(),
        artifact.len(),
    ) else {
        return encode_response(Err(crate::BakeError::new(
            crate::BakeErrorCode::IntegerOverflow,
            "font baker response length exceeds the ABI address space",
        )));
    };
    let mut response = Vec::new();
    if response.try_reserve_exact(total_length).is_err() {
        return Vec::new();
    }
    response.resize(header_len, 0);
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
    debug_assert_eq!(
        header_len,
        crate::abi_contract::RESPONSE_PAYLOAD_OFFSET as usize
    );
    response.extend_from_slice(&metadata);
    response.extend_from_slice(&artifact);
    response
}

fn write_header_u32(response: &mut [u8], offset: u32, value: u32) {
    write_u32_le(response, offset as usize, value);
}

fn leak_response(bytes: Vec<u8>) -> u32 {
    with_state(|state| state.table.publish(bytes))
}

#[derive(Default)]
struct WasmState {
    table: AllocationTable,
    outline: pmndrs_glyph_outline::GlyphOutline,
    outline_result: Vec<u32>,
}

fn with_state<Result>(operation: impl FnOnce(&mut WasmState) -> Result) -> Result {
    STATE.with(operation)
}
