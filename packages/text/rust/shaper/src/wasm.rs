use alloc::{boxed::Box, collections::BTreeMap, vec::Vec};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{
    STATUS_INVALID_HANDLE, STATUS_INVALID_REQUEST, STATUS_POLICY_CONFLICT, STATUS_POLICY_MISSING,
    STATUS_RESULT_TOO_LARGE, STATUS_REVISION_CONFLICT, STATUS_SESSION_CONFLICT,
    STATUS_SESSION_MISSING, ShaperRegistry, bidi,
    engine::{
        EngineError, TextEngine, frame::SessionRevision, frame_wire::parse_update_request,
        render_plan::RenderPlanView, render_plan_wire::plan_layout, transport::FrameTransport,
        wire::parse_policy,
    },
    wire::{
        pack_bidi_result, pack_result, parse_bidi_request, parse_reshape_request,
        parse_shape_request,
    },
};

#[cfg(target_arch = "wasm32")]
#[global_allocator]
static ALLOCATOR: talc::wasm::WasmDynamicTalc = talc::wasm::new_wasm_dynamic_allocator();

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
            ..
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
pub unsafe extern "C" fn pmndrs_text_engine_register_policy(
    handle: u32,
    pointer: u32,
    length: u32,
) -> u32 {
    with_state(|state| {
        let WasmState {
            engine,
            allocations,
            ..
        } = state;
        let Some(bytes) = owned_bytes(allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let policy = match parse_policy(bytes) {
            Ok(policy) => policy,
            Err(status) => return status,
        };
        match engine.register_policy(handle, policy) {
            Ok(()) => 0,
            Err(error) => engine_status(error),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_dispose_policy(handle: u32) -> u32 {
    with_state(|state| match state.engine.dispose_policy(handle) {
        Ok(()) => 0,
        Err(error) => engine_status(error),
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_policy_count() -> u32 {
    with_state(|state| state.engine.policy_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_create_session(
    handle: u32,
    request_capacity: u32,
    result_capacity: u32,
) -> u32 {
    with_state(|state| {
        if handle == 0 {
            return STATUS_INVALID_HANDLE;
        }
        if state.frames.contains_key(&handle) {
            return STATUS_SESSION_CONFLICT;
        }
        let transport = match FrameTransport::new(request_capacity, result_capacity) {
            Ok(transport) => transport,
            Err(status) => return status,
        };
        if let Err(error) = state.engine.create_session(handle) {
            return engine_status(error);
        }
        state.frames.insert(handle, transport);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_reserve_session(
    handle: u32,
    request_capacity: u32,
    result_capacity: u32,
) -> u32 {
    with_state(|state| {
        let Some(transport) = state.frames.get_mut(&handle) else {
            return STATUS_SESSION_MISSING;
        };
        match transport.reserve(request_capacity, result_capacity) {
            Ok(()) => 0,
            Err(status) => status,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_dispose_session(handle: u32) -> u32 {
    with_state(|state| {
        if !state.frames.contains_key(&handle) {
            return STATUS_SESSION_MISSING;
        }
        if let Err(error) = state.engine.dispose_session(handle) {
            return engine_status(error);
        }
        state.frames.remove(&handle);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_session_count() -> u32 {
    with_state(|state| state.engine.session_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_request_ptr(handle: u32) -> u32 {
    with_state(|state| {
        state
            .frames
            .get(&handle)
            .and_then(|transport| u32::try_from(transport.request_pointer()).ok())
            .unwrap_or(0)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_engine_request_capacity(handle: u32) -> u32 {
    with_state(|state| {
        state
            .frames
            .get(&handle)
            .map_or(0, FrameTransport::request_capacity)
    })
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_text_kernel_lab_backend() -> u32 {
    crate::engine::kernel_lab::BACKEND
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn pmndrs_text_kernel_lab_pack(
    count: u32,
    x_pointer: u32,
    y_pointer: u32,
    font_size_pointer: u32,
    plane_left_pointer: u32,
    plane_bottom_pointer: u32,
    plane_right_pointer: u32,
    plane_top_pointer: u32,
    inverse_units_per_em: f32,
    origins_pointer: u32,
    sizes_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_pack(
            count,
            x_pointer,
            y_pointer,
            font_size_pointer,
            plane_left_pointer,
            plane_bottom_pointer,
            plane_right_pointer,
            plane_top_pointer,
            inverse_units_per_em,
            origins_pointer,
            sizes_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_kernel_lab_break_masks(
    count: u32,
    flags_pointer: u32,
    output_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe { crate::engine::kernel_lab::exported_break_masks(count, flags_pointer, output_pointer) }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_kernel_lab_bidi_masks(
    count: u32,
    levels_pointer: u32,
    output_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe { crate::engine::kernel_lab::exported_bidi_masks(count, levels_pointer, output_pointer) }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_kernel_lab_chunk_summaries(
    count: u32,
    chunk_size: u32,
    advances_pointer: u32,
    flags_pointer: u32,
    advance_sums_pointer: u32,
    break_counts_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_chunk_summaries(
            count,
            chunk_size,
            advances_pointer,
            flags_pointer,
            advance_sums_pointer,
            break_counts_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn pmndrs_text_kernel_lab_policy(
    policy_handle: u32,
    technique: u32,
    variant: u32,
    count: u32,
    f32_input0_pointer: u32,
    f32_input1_pointer: u32,
    f32_input2_pointer: u32,
    f32_input3_pointer: u32,
    u32_input0_pointer: u32,
    f32_output_pointer: u32,
    u32_output_pointer: u32,
    u16_output_pointer: u32,
) -> u32 {
    let Some(f32_bytes) = count.checked_mul(core::mem::size_of::<f32>() as u32) else {
        return STATUS_INVALID_REQUEST;
    };
    let Some(f32_output_bytes) = f32_bytes.checked_mul(4) else {
        return STATUS_INVALID_REQUEST;
    };
    let Some(u16_bytes) = count.checked_mul(core::mem::size_of::<u16>() as u32) else {
        return STATUS_INVALID_REQUEST;
    };
    with_state(|state| {
        let regions = [
            (f32_input0_pointer, f32_bytes),
            (f32_input1_pointer, f32_bytes),
            (f32_input2_pointer, f32_bytes),
            (f32_input3_pointer, f32_bytes),
            (u32_input0_pointer, f32_bytes),
            (f32_output_pointer, f32_output_bytes),
            (u32_output_pointer, f32_bytes),
            (u16_output_pointer, u16_bytes),
        ];
        if !regions
            .iter()
            .all(|&(pointer, length)| owns_region(&state.allocations, pointer, length))
        {
            return STATUS_INVALID_REQUEST;
        }
        let policy = match state.engine.policy(policy_handle) {
            Ok(policy) => policy,
            Err(_) => return STATUS_POLICY_MISSING,
        };
        // SAFETY: every direct-memory region belongs to a live caller allocation, so it cannot
        // alias engine-owned state. The kernel validates alignment, bounds, and pairwise
        // disjointness before creating slices, and this state borrow remains synchronous.
        unsafe {
            crate::engine::kernel_lab::exported_policy(
                policy,
                technique,
                variant,
                count,
                f32_input0_pointer,
                f32_input1_pointer,
                f32_input2_pointer,
                f32_input3_pointer,
                u32_input0_pointer,
                f32_output_pointer,
                u32_output_pointer,
                u16_output_pointer,
            )
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_text_engine_update(
    session_id: u32,
    request_offset: u32,
    request_len: u32,
) -> u32 {
    with_state(|state| {
        let revision = match state.engine.session_revision(session_id) {
            Ok(revision) => revision,
            Err(_) => return 0,
        };
        let request = {
            let Some(transport) = state.frames.get(&session_id) else {
                return 0;
            };
            let bytes = match transport.request_at(request_offset as usize, request_len) {
                Ok(bytes) => bytes,
                Err(status) => {
                    return publish_failure(state, session_id, revision, status, request_len, 0);
                }
            };
            match parse_update_request(bytes, session_id) {
                Ok(request) => request,
                Err(status) => {
                    return publish_failure(state, session_id, revision, status, 0, 0);
                }
            }
        };
        let prepared = match state.engine.prepare_update(request) {
            Ok(prepared) => prepared,
            Err(error) => {
                return publish_failure(state, session_id, revision, engine_status(error), 0, 0);
            }
        };
        let policy_fingerprint = match state.engine.policy(request.policy_handle) {
            Ok(policy) => policy.fingerprint(),
            Err(error) => {
                return publish_failure(state, session_id, revision, engine_status(error), 0, 0);
            }
        };
        let plan = RenderPlanView {
            policy_handle: request.policy_handle,
            capability_set: 0,
            policy_fingerprint,
            ..RenderPlanView::default()
        };
        let required_output = match plan_layout(plan) {
            Ok(layout) => layout.byte_length,
            Err(status) => return publish_failure(state, session_id, revision, status, 0, 0),
        };
        if required_output > request.limits.max_output_bytes {
            return publish_failure(
                state,
                session_id,
                revision,
                STATUS_RESULT_TOO_LARGE,
                0,
                required_output,
            );
        }
        let Some(transport) = state.frames.get(&session_id) else {
            return 0;
        };
        if let Err(status) = transport.ensure_publish_capacity(required_output) {
            return publish_failure(state, session_id, revision, status, 0, required_output);
        }
        if let Err(status) = transport.next_publication_generation() {
            return publish_failure(state, session_id, revision, status, 0, 0);
        }
        let staged = match state
            .frames
            .get_mut(&session_id)
            .and_then(|transport| transport.stage_plan(plan).ok())
        {
            Some(staged) => staged,
            None => {
                return publish_failure(
                    state,
                    session_id,
                    revision,
                    STATUS_RESULT_TOO_LARGE,
                    0,
                    required_output,
                );
            }
        };
        let commit = match state.engine.commit_update(prepared) {
            Ok(commit) => commit,
            Err(error) => {
                return publish_failure(state, session_id, revision, engine_status(error), 0, 0);
            }
        };
        let Some(transport) = state.frames.get_mut(&session_id) else {
            return 0;
        };
        u32::try_from(transport.publish_success(commit, staged)).unwrap_or(0)
    })
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
    engine: TextEngine,
    frames: BTreeMap<u32, FrameTransport>,
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

#[cfg(feature = "kernel-lab")]
fn owns_region(allocations: &[Allocation], pointer: u32, length: u32) -> bool {
    let Some(end) = pointer.checked_add(length) else {
        return false;
    };
    length != 0
        && allocations.iter().any(|entry| {
            entry
                .pointer
                .checked_add(entry.requested_length)
                .is_some_and(|allocation_end| pointer >= entry.pointer && end <= allocation_end)
        })
}

fn store_result(registry: &mut ShaperRegistry, result: Vec<u8>) -> u32 {
    match registry.set_result(result) {
        Ok(()) => 0,
        Err(status) => status,
    }
}

fn engine_status(error: EngineError) -> u32 {
    match error {
        EngineError::InvalidHandle => STATUS_INVALID_HANDLE,
        EngineError::HandleConflict => STATUS_POLICY_CONFLICT,
        EngineError::PolicyMissing => STATUS_POLICY_MISSING,
        EngineError::SessionConflict => STATUS_SESSION_CONFLICT,
        EngineError::SessionMissing => STATUS_SESSION_MISSING,
        EngineError::RevisionConflict => STATUS_REVISION_CONFLICT,
        EngineError::RevisionExhausted => STATUS_RESULT_TOO_LARGE,
        EngineError::InvalidRequest => STATUS_INVALID_REQUEST,
    }
}

fn publish_failure(
    state: &mut WasmState,
    session_id: u32,
    revision: SessionRevision,
    status: u32,
    required_request_capacity: u32,
    required_result_capacity: u32,
) -> u32 {
    state
        .frames
        .get_mut(&session_id)
        .and_then(|transport| {
            u32::try_from(transport.publish_failure(
                session_id,
                revision,
                status,
                required_request_capacity,
                required_result_capacity,
            ))
            .ok()
        })
        .unwrap_or(0)
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
