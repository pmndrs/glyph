#[cfg(feature = "artifact-baker")]
use alloc::string::ToString;
#[cfg(feature = "artifact-baker")]
use alloc::vec::Vec;

#[cfg(feature = "allocation-evidence")]
use pmndrs_glyph_wasm_abi::CountingAllocator;
#[cfg(feature = "artifact-baker")]
use pmndrs_glyph_wasm_abi::write_u32_le as write_u32;
use pmndrs_glyph_wasm_abi::{AllocationTable, WasmSingleton};

use pmndrs_glyph_mtsdf_core::{AtlasRegion, Bounds, MtsdfGenerator, OutlineSink, OutlineSource};
#[cfg(feature = "artifact-baker")]
use serde::Serialize;

use crate::abi_layout::{
    COMMAND_OPCODE, COMMAND_SIZE, COMMAND_X0, COMMAND_X1, COMMAND_X2, COMMAND_Y0, COMMAND_Y1,
    COMMAND_Y2, REQUEST_BYTE_LENGTH, REQUEST_COMMAND_COUNT, REQUEST_COMMANDS_OFFSET,
    REQUEST_HEADER_SIZE, REQUEST_INNER_HEIGHT, REQUEST_INNER_WIDTH, REQUEST_MAX_X, REQUEST_MAX_Y,
    REQUEST_MIN_X, REQUEST_MIN_Y, REQUEST_PADDING_X, REQUEST_PADDING_Y, REQUEST_UNITS_PER_EM,
};
#[cfg(feature = "artifact-baker")]
use crate::abi_layout::{
    RESPONSE_ARTIFACT_LENGTH_OFFSET, RESPONSE_HEADER_SIZE, RESPONSE_MAGIC_OFFSET,
    RESPONSE_METADATA_LENGTH_OFFSET, RESPONSE_STATUS_OFFSET,
};
#[cfg(feature = "artifact-baker")]
use crate::{MtsdfBakeArtifactV0, MtsdfBakeRequestV0, MtsdfBakeResultV0, bake_mtsdf};

#[cfg(not(feature = "allocation-evidence"))]
#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

#[cfg(feature = "allocation-evidence")]
#[global_allocator]
static ALLOCATOR: CountingAllocator<talc::wasm::WasmDynamicTalc> =
    CountingAllocator::new(talc::wasm::new_wasm_dynamic_allocator());

const MAX_REQUEST_BYTES: u32 = 64 * 1024 * 1024;
#[cfg(feature = "artifact-baker")]
const MAX_SINGLE_RESPONSE_BYTES: usize = MAX_REQUEST_BYTES as usize;
#[cfg(feature = "artifact-baker")]
const RESPONSE_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const STATUS_OK: u32 = 0;
const STATUS_INVALID_REQUEST: u32 = 1;
const STATUS_INVALID_OUTLINE: u32 = 2;
const STATUS_GENERATION_FAILED: u32 = 3;

static STATE: WasmSingleton<WasmState> = WasmSingleton::new();

#[panic_handler]
fn panic(_info: &core::panic::PanicInfo<'_>) -> ! {
    core::arch::wasm32::unreachable()
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_alloc(length: u32) -> u32 {
    with_state(|state| state.table.allocate(length, MAX_REQUEST_BYTES))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_dealloc(pointer: u32, length: u32) {
    with_state(|state| state.table.deallocate(pointer, length));
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_generate(pointer: u32, length: u32) -> u32 {
    with_state(|state| {
        state.result_pointer = 0;
        state.result_length = 0;
        let WasmState {
            generator,
            table,
            result_pointer,
            result_length,
            ..
        } = state;
        let Some(bytes) = table.owned_bytes(pointer, length) else {
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
pub extern "C" fn pmndrs_glyph_mtsdf_result_ptr() -> u32 {
    with_state(|state| state.result_pointer)
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_result_len() -> u32 {
    with_state(|state| state.result_length)
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_bake(
    source_pointer: u32,
    source_length: u32,
    request_pointer: u32,
    request_length: u32,
) -> u32 {
    with_state(|state| {
        state.segmented_response = None;
    });
    let result = with_state(|state| {
        let Some(source) = state.table.owned_bytes(source_pointer, source_length) else {
            return Err(crate::MtsdfBakeError::new(
                crate::MtsdfBakeErrorCode::InvalidDescriptor,
                "MTSDF baker source range is not an active module allocation",
            ));
        };
        let Some(request_bytes) = state.table.owned_bytes(request_pointer, request_length) else {
            return Err(crate::MtsdfBakeError::new(
                crate::MtsdfBakeErrorCode::InvalidDescriptor,
                "MTSDF baker request range is not an active module allocation",
            ));
        };
        serde_json::from_slice::<MtsdfBakeRequestV0>(request_bytes)
            .map_err(|error| {
                crate::MtsdfBakeError::new(
                    crate::MtsdfBakeErrorCode::InvalidDescriptor,
                    error.to_string(),
                )
            })
            .and_then(|request| bake_mtsdf(source, request))
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
pub extern "C" fn pmndrs_glyph_mtsdf_bake_result_len() -> u32 {
    with_state(|state| state.table.result_length())
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_status() -> u32 {
    with_state(|state| {
        state
            .segmented_response
            .as_ref()
            .map_or(u32::MAX, |response| response.status)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_metadata_ptr() -> u32 {
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
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_metadata_len() -> u32 {
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
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_artifact_count() -> u32 {
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
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_artifact_len(index: u32) -> u32 {
    with_state(|state| {
        segmented_artifact(state, index)
            .and_then(|bytes| u32::try_from(bytes.len()).ok())
            .unwrap_or(0)
    })
}

#[cfg(feature = "artifact-baker")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_chunk_ptr(index: u32, offset: u32) -> u32 {
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
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_chunk_len(index: u32, offset: u32) -> u32 {
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
pub extern "C" fn pmndrs_glyph_mtsdf_segmented_release() {
    with_state(|state| {
        state.segmented_response = None;
    });
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_reset_allocation_counts() {
    ALLOCATOR.reset();
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_allocation_calls() -> u32 {
    u32::try_from(ALLOCATOR.allocations()).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_reallocation_calls() -> u32 {
    u32::try_from(ALLOCATOR.reallocations()).unwrap_or(u32::MAX)
}

#[cfg(feature = "allocation-evidence")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_mtsdf_deallocation_calls() -> u32 {
    u32::try_from(ALLOCATOR.deallocations()).unwrap_or(u32::MAX)
}

#[derive(Default)]
struct WasmState {
    generator: MtsdfGenerator,
    table: AllocationTable,
    /// The last generated atlas region; it stays owned by the generator.
    result_pointer: u32,
    result_length: u32,
    #[cfg(feature = "artifact-baker")]
    segmented_response: Option<PreparedArtifactResponse>,
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
    report: &'result crate::MtsdfPayloadReportV0,
}

#[cfg(feature = "artifact-baker")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WasmArtifactMetadata<'artifact> {
    role: &'artifact str,
    id: &'artifact str,
    fingerprint: &'artifact str,
    byte_offset: usize,
    byte_length: usize,
}

#[cfg(feature = "artifact-baker")]
struct PreparedArtifactResponse {
    status: u32,
    metadata: Vec<u8>,
    artifacts: Vec<MtsdfBakeArtifactV0>,
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
    result: Result<MtsdfBakeResultV0, crate::MtsdfBakeError>,
) -> PreparedArtifactResponse {
    let result = match result {
        Ok(result) => result,
        Err(error) => return prepared_error_response(error),
    };
    let mut offset = 0_usize;
    let mut artifacts = Vec::new();
    if artifacts.try_reserve_exact(result.artifacts.len()).is_err() {
        return prepared_error_response(crate::MtsdfBakeError::new(
            crate::MtsdfBakeErrorCode::ArithmeticOverflow,
            "MTSDF baker response metadata allocation failed",
        ));
    }
    for artifact in &result.artifacts {
        let Some(next_offset) = offset.checked_add(artifact.bytes.len()) else {
            return prepared_error_response(crate::MtsdfBakeError::new(
                crate::MtsdfBakeErrorCode::ArithmeticOverflow,
                "MTSDF baker artifact offsets exceed the ABI address space",
            ));
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
    if u32::try_from(offset).is_err() {
        return prepared_error_response(crate::MtsdfBakeError::new(
            crate::MtsdfBakeErrorCode::ArithmeticOverflow,
            "MTSDF baker artifact bytes exceed the ABI address space",
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
        return prepared_error_response(crate::MtsdfBakeError::new(
            crate::MtsdfBakeErrorCode::SerializationFailed,
            "failed to serialize MTSDF result metadata",
        ));
    };
    if u32::try_from(metadata.len()).is_err() {
        return prepared_error_response(crate::MtsdfBakeError::new(
            crate::MtsdfBakeErrorCode::ArithmeticOverflow,
            "MTSDF baker response metadata exceeds the ABI address space",
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
fn prepared_error_response(error: crate::MtsdfBakeError) -> PreparedArtifactResponse {
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
    response[magic_offset..magic_offset + 4].copy_from_slice(b"PMMS");
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
    b"{\"code\":\"SERIALIZATION_FAILED\",\"message\":\"failed to serialize MTSDF result\"}".to_vec()
}

#[cfg(feature = "artifact-baker")]
fn leak_artifact_response(bytes: Vec<u8>) -> u32 {
    with_state(|state| state.table.publish(bytes))
}

#[cfg(feature = "artifact-baker")]
fn retain_segmented_response(prepared: PreparedArtifactResponse) -> u32 {
    with_state(|state| {
        state.table.unpublish();
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
        if bytes.len() < REQUEST_HEADER_SIZE
            || read_u32(bytes, REQUEST_BYTE_LENGTH)? as usize != bytes.len()
        {
            return None;
        }
        let commands_offset = read_u32(bytes, REQUEST_COMMANDS_OFFSET)? as usize;
        let command_count = read_u32(bytes, REQUEST_COMMAND_COUNT)? as usize;
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
            units_per_em: read_f32(bytes, REQUEST_UNITS_PER_EM)?,
            bounds: Bounds::new(
                read_f32(bytes, REQUEST_MIN_X)?,
                read_f32(bytes, REQUEST_MIN_Y)?,
                read_f32(bytes, REQUEST_MAX_X)?,
                read_f32(bytes, REQUEST_MAX_Y)?,
            ),
            region: AtlasRegion {
                inner_width: read_u32(bytes, REQUEST_INNER_WIDTH)? as usize,
                inner_height: read_u32(bytes, REQUEST_INNER_HEIGHT)? as usize,
                padding_x: read_u32(bytes, REQUEST_PADDING_X)? as usize,
                padding_y: read_u32(bytes, REQUEST_PADDING_Y)? as usize,
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
            let opcode = read_u32(self.bytes, offset + COMMAND_OPCODE).ok_or(())?;
            let value = |field| read_f32(self.bytes, offset + field).ok_or(());
            match opcode {
                0 => sink.move_to(value(COMMAND_X0)?, value(COMMAND_Y0)?),
                1 => sink.line_to(value(COMMAND_X0)?, value(COMMAND_Y0)?),
                2 => sink.quad_to(
                    value(COMMAND_X0)?,
                    value(COMMAND_Y0)?,
                    value(COMMAND_X1)?,
                    value(COMMAND_Y1)?,
                ),
                3 => sink.cubic_to(
                    value(COMMAND_X0)?,
                    value(COMMAND_Y0)?,
                    value(COMMAND_X1)?,
                    value(COMMAND_Y1)?,
                    value(COMMAND_X2)?,
                    value(COMMAND_Y2)?,
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
    STATE.with(operation)
}
