use alloc::{boxed::Box, collections::BTreeMap, vec::Vec};
use core::sync::atomic::{AtomicUsize, Ordering};

use crate::{
    STATUS_CODEC_CONFLICT, STATUS_CODEC_MISSING, STATUS_FONT_IN_USE, STATUS_FONT_STACK_MISSING,
    STATUS_INVALID_HANDLE, STATUS_INVALID_REQUEST, STATUS_OK, STATUS_ROOT_CONFLICT,
    STATUS_ROOT_MISSING, STATUS_REGISTRATION_IN_USE, STATUS_RESULT_TOO_LARGE,
    STATUS_REVISION_CONFLICT, ShaperRegistry,
    engine::{
        EngineError, FrameFault, TextEngine,
        codec::CapabilitySetId,
        codec_wire::parse_codec,
        font_binding_wire::parse_font_binding,
        frame::RootRevision,
        frame_wire::parse_update_request,
        render_plan_compiler::RenderPlanCompilerError,
        render_plan_wire::{publication_layout, query_layout},
        transport::{FrameTransport, UpdateBatchResult, UpdateBatchTransport},
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
pub extern "C" fn pmndrs_glyph_shaper_initialize() -> u32 {
    with_state(|state| {
        if let Err(status) = state.registry.initialize() {
            return status;
        }
        match state.engine.initialize() {
            Ok(()) => STATUS_OK,
            Err(error) => engine_status(error),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_shaper_alloc(length: u32) -> u32 {
    with_state(|state| state.allocate(length))
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_shaper_dealloc(pointer: u32, length: u32) {
    with_state(|state| state.deallocate(pointer, length));
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_shaper_register_font(
    handle: u32,
    sfnt_pointer: u32,
    sfnt_length: u32,
    extents_pointer: u32,
    extents_length: u32,
    availability_pointer: u32,
    availability_length: u32,
    underline_packed: u32,
    strikeout_packed: u32,
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
        registry.register_font(
            handle,
            sfnt,
            extents,
            availability,
            underline_packed,
            strikeout_packed,
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_shaper_dispose_font(handle: u32) -> u32 {
    with_state(|state| {
        if state.engine.references_shaping_font(handle) {
            STATUS_FONT_IN_USE
        } else {
            let status = state.registry.dispose_font(handle);
            if status == STATUS_OK {
                state.engine.dispose_bindings_for_shaping_font(handle);
            }
            status
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_shaper_font_count() -> u32 {
    with_state(|state| state.registry.font_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_shaper_retained_font_bytes() -> u32 {
    with_state(|state| state.registry.retained_font_bytes())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_shaper_plan_count() -> u32 {
    with_state(|state| state.registry.plan_count())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_register_font_stack(
    handle: u32,
    pointer: u32,
    count: u32,
) -> u32 {
    with_state(|state| {
        let Some(length) = count.checked_mul(4) else {
            return STATUS_INVALID_REQUEST;
        };
        let Some(bytes) = owned_bytes(&state.allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let mut fonts = Vec::new();
        if fonts.try_reserve_exact(count as usize).is_err() {
            return STATUS_RESULT_TOO_LARGE;
        }
        for bytes in bytes.chunks_exact(4) {
            let font = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
            let Some(shaping_handle) = state.engine.shaping_handle_for_binding(font) else {
                return crate::STATUS_FONT_MISSING;
            };
            if !state.registry.contains_font(shaping_handle) {
                return crate::STATUS_FONT_MISSING;
            }
            fonts.push(font);
        }
        match state.engine.register_font_stack(handle, &fonts) {
            Ok(()) => STATUS_OK,
            Err(error) => engine_status(error),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_dispose_font_stack(handle: u32) -> u32 {
    with_state(|state| match state.engine.dispose_font_stack(handle) {
        Ok(()) => STATUS_OK,
        Err(error) => engine_status(error),
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_font_stack_count() -> u32 {
    with_state(|state| state.engine.font_stack_count())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_register_font_binding(
    handle: u32,
    shaping_handle: u32,
    pointer: u32,
    length: u32,
) -> u32 {
    with_state(|state| {
        let Some(glyph_count) = state.registry.glyph_count(shaping_handle) else {
            return crate::STATUS_FONT_MISSING;
        };
        let Some(bytes) = owned_bytes(&state.allocations, pointer, length) else {
            return STATUS_INVALID_REQUEST;
        };
        let binding = match parse_font_binding(bytes) {
            Ok(binding) => binding,
            Err(status) => return status,
        };
        match state
            .engine
            .register_font_binding(handle, shaping_handle, glyph_count, binding)
        {
            Ok(()) => STATUS_OK,
            Err(error) => engine_status(error),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_dispose_font_binding(handle: u32) -> u32 {
    if handle == 0 {
        return STATUS_INVALID_HANDLE;
    }
    with_state(|state| {
        state.engine.dispose_font_binding(handle);
        STATUS_OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_font_binding_count() -> u32 {
    with_state(|state| state.engine.font_binding_count())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_register_codec(
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
        let codec = match parse_codec(bytes) {
            Ok(codec) => codec,
            Err(status) => return status,
        };
        match engine.register_codec(handle, codec) {
            Ok(()) => 0,
            Err(error) => engine_status(error),
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_dispose_codec(handle: u32) -> u32 {
    with_state(|state| match state.engine.dispose_codec(handle) {
        Ok(()) => 0,
        Err(error) => engine_status(error),
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_codec_count() -> u32 {
    with_state(|state| state.engine.codec_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_create_root(
    handle: u32,
    request_capacity: u32,
    result_capacity: u32,
    text_capacity: u32,
) -> u32 {
    with_state(|state| {
        if handle == 0 {
            return STATUS_INVALID_HANDLE;
        }
        if state.frames.contains_key(&handle) {
            return STATUS_ROOT_CONFLICT;
        }
        let transport = match FrameTransport::new(request_capacity, result_capacity) {
            Ok(transport) => transport,
            Err(status) => return status,
        };
        if let Err(error) = state.engine.create_root(handle) {
            return engine_status(error);
        }
        let text_capacity = if text_capacity == 0 {
            crate::engine::frame::DEFAULT_ROOT_TEXT_CAPACITY
        } else {
            text_capacity
        };
        if let Err(error) = state.engine.reserve_root_text(handle, text_capacity) {
            let _ = state.engine.dispose_root(handle);
            return engine_status(error);
        }
        state.frames.insert(handle, transport);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_reserve_root(
    handle: u32,
    request_capacity: u32,
    result_capacity: u32,
    text_capacity: u32,
) -> u32 {
    with_state(|state| {
        let Some(transport) = state.frames.get_mut(&handle) else {
            return STATUS_ROOT_MISSING;
        };
        if let Err(status) = transport.reserve(request_capacity, result_capacity) {
            return status;
        }
        if text_capacity != 0
            && let Err(error) = state.engine.reserve_root_text(handle, text_capacity)
        {
            return engine_status(error);
        }
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_dispose_root(handle: u32) -> u32 {
    with_state(|state| {
        if !state.frames.contains_key(&handle) {
            return STATUS_ROOT_MISSING;
        }
        if let Err(error) = state.engine.dispose_root(handle) {
            return engine_status(error);
        }
        state.frames.remove(&handle);
        0
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_root_count() -> u32 {
    with_state(|state| state.engine.root_count())
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_request_ptr(handle: u32) -> u32 {
    with_state(|state| {
        state
            .frames
            .get(&handle)
            .and_then(|transport| u32::try_from(transport.request_pointer()).ok())
            .unwrap_or(0)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_request_capacity(handle: u32) -> u32 {
    with_state(|state| {
        state
            .frames
            .get(&handle)
            .map_or(0, FrameTransport::request_capacity)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_reserve_update_batch(count: u32) -> u32 {
    with_state(|state| match state.update_batch.reserve(count) {
        Ok(()) => STATUS_OK,
        Err(status) => status,
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_update_batch_ptr() -> u32 {
    with_state(|state| u32::try_from(state.update_batch.pointer()).unwrap_or(0))
}

#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_engine_update_batch_capacity() -> u32 {
    with_state(|state| state.update_batch.capacity())
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub extern "C" fn pmndrs_glyph_kernel_lab_backend() -> u32 {
    crate::engine::kernel_lab::BACKEND
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_pack(
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
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_break_masks(
    count: u32,
    group_count: u32,
    flags_pointer: u32,
    output_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_break_masks(
            count,
            group_count,
            flags_pointer,
            output_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_bidi_masks(
    count: u32,
    group_count: u32,
    levels_pointer: u32,
    output_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_bidi_masks(
            count,
            group_count,
            levels_pointer,
            output_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_flagged_scan(
    count: u32,
    group_count: u32,
    flags_pointer: u32,
    checksum_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_flagged_scan(
            count,
            group_count,
            flags_pointer,
            checksum_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_transition_scan(
    count: u32,
    group_count: u32,
    levels_pointer: u32,
    checksum_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_transition_scan(
            count,
            group_count,
            levels_pointer,
            checksum_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_chunk_summaries(
    count: u32,
    chunk_size: u32,
    advances_pointer: u32,
    flags_pointer: u32,
    advance_sums_pointer: u32,
    space_sums_pointer: u32,
    flags_or_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_chunk_summaries(
            count,
            chunk_size,
            advances_pointer,
            flags_pointer,
            advance_sums_pointer,
            space_sums_pointer,
            flags_or_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_chunk_summaries_i64(
    count: u32,
    chunk_size: u32,
    accumulator_count: u32,
    advances_pointer: u32,
    flags_pointer: u32,
    advance_sums_pointer: u32,
    space_sums_pointer: u32,
    flags_or_pointer: u32,
) -> u32 {
    // SAFETY: the test-only kernel validates every direct-memory region before creating slices.
    unsafe {
        crate::engine::kernel_lab::exported_chunk_summaries_i64(
            count,
            chunk_size,
            accumulator_count,
            advances_pointer,
            flags_pointer,
            advance_sums_pointer,
            space_sums_pointer,
            flags_or_pointer,
        )
    }
}

#[cfg(feature = "kernel-lab")]
#[unsafe(no_mangle)]
#[allow(clippy::too_many_arguments)]
pub unsafe extern "C" fn pmndrs_glyph_kernel_lab_codec(
    codec_handle: u32,
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
        let codec = match state.engine.codec(codec_handle) {
            Ok(codec) => codec,
            Err(_) => return STATUS_CODEC_MISSING,
        };
        // SAFETY: every direct-memory region belongs to a live caller allocation, so it cannot
        // alias engine-owned state. The kernel validates alignment, bounds, and pairwise
        // disjointness before creating slices, and this state borrow remains synchronous.
        unsafe {
            crate::engine::kernel_lab::exported_codec(
                codec,
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
pub unsafe extern "C" fn pmndrs_glyph_engine_update(
    root_id: u32,
    request_offset: u32,
    request_len: u32,
) -> u32 {
    with_state(|state| {
        update(
            state,
            root_id,
            Some(request_offset as usize),
            request_len,
            false,
        )
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_update_batch(entries_pointer: u32, count: u32) -> u32 {
    with_state(|state| {
        // Moving the arena wrapper out permits each entry to borrow the remaining engine state.
        // The arena's allocation itself does not move, so the validated host pointer stays exact.
        let mut batch = core::mem::take(&mut state.update_batch);
        let status = batch.process(
            entries_pointer as usize,
            count,
            |root_id, request_length| {
                let result_pointer = update(state, root_id, None, request_length, true);
                let status = if result_pointer == 0 {
                    STATUS_ROOT_MISSING
                } else {
                    state
                        .frames
                        .get(&root_id)
                        .and_then(|transport| transport.result_status(result_pointer as usize))
                        .unwrap_or(STATUS_INVALID_REQUEST)
                };
                UpdateBatchResult {
                    result_pointer,
                    status,
                }
            },
        );
        state.update_batch = batch;
        status
    })
}

fn update(
    state: &mut WasmState,
    root_id: u32,
    request_pointer: Option<usize>,
    request_len: u32,
    grow_output: bool,
) -> u32 {
    let revision = match state.engine.root_revision(root_id) {
        Ok(revision) => revision,
        Err(_) => return 0,
    };
    let request = {
        let Some(transport) = state.frames.get(&root_id) else {
            return 0;
        };
        let request_bytes = match request_pointer {
            Some(pointer) => transport.request_at(pointer, request_len),
            None => transport.request_at_current(request_len),
        };
        let bytes = match request_bytes {
            Ok(bytes) => bytes,
            Err(status) => {
                return publish_failure(state, root_id, revision, status, request_len, 0);
            }
        };
        match parse_update_request(bytes, root_id) {
            Ok(request) => request,
            Err(status) => {
                return publish_failure(state, root_id, revision, status, 0, 0);
            }
        }
    };
    let publication_generation = match state
        .frames
        .get(&root_id)
        .and_then(|transport| transport.next_publication_generation().ok())
    {
        Some(generation) => generation,
        None => {
            return publish_failure(state, root_id, revision, STATUS_RESULT_TOO_LARGE, 0, 0);
        }
    };
    let prepared = match state.engine.prepare_update_with_shaper(
        &mut state.registry,
        request,
        publication_generation,
    ) {
        Ok(prepared) => prepared,
        Err(error) => {
            return publish_engine_failure(state, root_id, revision, error);
        }
    };
    let plan = match state.engine.prepared_plan(prepared) {
        Ok(plan) => plan,
        Err(error) => {
            return publish_prepared_failure(
                state,
                prepared,
                revision,
                engine_status(error),
                error.fault(),
                0,
                0,
            );
        }
    };
    let semantic_views = match state.engine.prepared_semantic_views(prepared) {
        Ok(views) => views,
        Err(error) => {
            return publish_prepared_failure(
                state,
                prepared,
                revision,
                engine_status(error),
                error.fault(),
                0,
                0,
            );
        }
    };
    let required_output = match publication_layout(plan, semantic_views) {
        Ok(layout) => layout.byte_length,
        Err(status) => {
            return publish_prepared_failure(
                state,
                prepared,
                revision,
                status,
                FrameFault::default(),
                0,
                0,
            );
        }
    };
    if required_output > request.limits.max_output_bytes {
        return publish_prepared_failure(
            state,
            prepared,
            revision,
            STATUS_RESULT_TOO_LARGE,
            FrameFault::default(),
            0,
            required_output,
        );
    }
    if !state.frames.contains_key(&root_id) {
        let _ = state.engine.abort_update(prepared);
        return 0;
    }
    let capacity = if grow_output {
        state
            .frames
            .get_mut(&root_id)
            .ok_or(STATUS_ROOT_MISSING)
            .and_then(|transport| transport.reserve_publish_capacity(required_output))
    } else {
        state
            .frames
            .get(&root_id)
            .ok_or(STATUS_ROOT_MISSING)
            .and_then(|transport| transport.ensure_publish_capacity(required_output))
    };
    if let Err(status) = capacity {
        return publish_prepared_failure(
            state,
            prepared,
            revision,
            status,
            FrameFault::default(),
            0,
            required_output,
        );
    }
    let staged = match state
        .frames
        .get_mut(&root_id)
        .and_then(|transport| transport.stage_publication(plan, semantic_views).ok())
    {
        Some(staged) => staged,
        None => {
            return publish_prepared_failure(
                state,
                prepared,
                revision,
                STATUS_RESULT_TOO_LARGE,
                FrameFault::default(),
                0,
                required_output,
            );
        }
    };
    let commit = match state.engine.commit_update(prepared) {
        Ok(commit) => commit,
        Err(error) => {
            return publish_prepared_failure(
                state,
                prepared,
                revision,
                engine_status(error),
                error.fault(),
                0,
                0,
            );
        }
    };
    let Some(transport) = state.frames.get_mut(&root_id) else {
        return 0;
    };
    debug_assert_eq!(
        transport.next_publication_generation().ok(),
        Some(publication_generation)
    );
    u32::try_from(transport.publish_success(commit, staged)).unwrap_or(0)
}

/// Publishes a complete checkpoint containing only the requested committed glyph records.
/// The root and renderer fence are not mutated.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_copy_glyphs(
    root_id: u32,
    paragraph_id: u32,
    codec_handle: u32,
    capability_set: u32,
    max_output_bytes: u32,
    stable_ids_pointer: u32,
    stable_ids_count: u32,
) -> u32 {
    with_state(|state| {
        let revision = match state.engine.root_revision(root_id) {
            Ok(revision) => revision,
            Err(_) => return 0,
        };
        let byte_length = match stable_ids_count.checked_mul(4) {
            Some(length) => length,
            None => {
                return publish_failure(state, root_id, revision, STATUS_INVALID_REQUEST, 0, 0);
            }
        };
        let Some(bytes) = owned_bytes(&state.allocations, stable_ids_pointer, byte_length) else {
            return publish_failure(state, root_id, revision, STATUS_INVALID_REQUEST, 0, 0);
        };
        let stable_ids: Vec<u32> = bytes
            .chunks_exact(4)
            .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
            .collect();
        let plan = match state.engine.copy_glyphs(
            root_id,
            paragraph_id,
            codec_handle,
            capability_set,
            &stable_ids,
        ) {
            Ok(plan) => plan,
            Err(error) => return publish_engine_failure(state, root_id, revision, error),
        };
        let view = match plan.plan_view(
            codec_handle,
            CapabilitySetId(capability_set),
            state
                .engine
                .codec(codec_handle)
                .map(|codec| codec.fingerprint())
                .unwrap_or(0),
        ) {
            Ok(view) => view,
            Err(error) => {
                return publish_engine_failure(
                    state,
                    root_id,
                    revision,
                    detached_plan_error(error),
                );
            }
        };
        let Some(transport) = state.frames.get_mut(&root_id) else {
            return 0;
        };
        match transport.stage_detached_plan(root_id, revision, view, max_output_bytes) {
            Ok(pointer) => u32::try_from(pointer).unwrap_or(0),
            Err(status) => publish_failure(state, root_id, revision, status, 0, 0),
        }
    })
}

/// Publishes a complete checkpoint containing one paragraph's committed decorations.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_copy_decorations(
    root_id: u32,
    codec_handle: u32,
    capability_set: u32,
    paragraph_id: u32,
    max_output_bytes: u32,
) -> u32 {
    with_state(|state| {
        let revision = match state.engine.root_revision(root_id) {
            Ok(revision) => revision,
            Err(_) => return 0,
        };
        let plan = match state.engine.copy_decorations(
            root_id,
            codec_handle,
            capability_set,
            paragraph_id,
        ) {
            Ok(plan) => plan,
            Err(error) => return publish_engine_failure(state, root_id, revision, error),
        };
        let view = match plan.plan_view(
            codec_handle,
            CapabilitySetId(capability_set),
            state
                .engine
                .codec(codec_handle)
                .map(|codec| codec.fingerprint())
                .unwrap_or(0),
        ) {
            Ok(view) => view,
            Err(error) => {
                return publish_engine_failure(
                    state,
                    root_id,
                    revision,
                    detached_plan_error(error),
                );
            }
        };
        let Some(transport) = state.frames.get_mut(&root_id) else {
            return 0;
        };
        match transport.stage_detached_plan(root_id, revision, view, max_output_bytes) {
            Ok(pointer) => u32::try_from(pointer).unwrap_or(0),
            Err(status) => publish_failure(state, root_id, revision, status, 0, 0),
        }
    })
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn pmndrs_glyph_engine_measure_paragraph(
    root_id: u32,
    request_offset: u32,
    request_len: u32,
    paragraph_id: u32,
) -> u32 {
    with_state(|state| {
        let revision = match state.engine.root_revision(root_id) {
            Ok(revision) => revision,
            Err(_) => return 0,
        };
        let request = {
            let Some(transport) = state.frames.get(&root_id) else {
                return 0;
            };
            let bytes = match transport.request_at(request_offset as usize, request_len) {
                Ok(bytes) => bytes,
                Err(status) => {
                    return publish_failure(state, root_id, revision, status, request_len, 0);
                }
            };
            match parse_update_request(bytes, root_id) {
                Ok(request) => request,
                Err(status) => {
                    return publish_failure(state, root_id, revision, status, 0, 0);
                }
            }
        };
        let measured = match state.engine.measure_paragraph_with_shaper(
            &mut state.registry,
            request,
            paragraph_id,
        ) {
            Ok(measured) => measured,
            Err(error) => {
                return publish_engine_failure(state, root_id, revision, error);
            }
        };
        let staged = match state.engine.measured_semantic_views(measured) {
            Ok(semantic_views) => match query_layout(semantic_views) {
                Ok(layout) if layout.byte_length > request.limits.max_output_bytes => Err((
                    STATUS_RESULT_TOO_LARGE,
                    FrameFault::default(),
                    layout.byte_length,
                )),
                Ok(layout) => state
                    .frames
                    .get_mut(&root_id)
                    .ok_or(STATUS_ROOT_MISSING)
                    .and_then(|transport| {
                        transport.ensure_publish_capacity(layout.byte_length)?;
                        transport.stage_query(root_id, revision, semantic_views)
                    })
                    .map_err(|status| (status, FrameFault::default(), layout.byte_length)),
                Err(status) => Err((status, FrameFault::default(), 0)),
            },
            Err(error) => Err((engine_status(error), error.fault(), 0)),
        };
        match staged {
            Ok(pointer) => u32::try_from(pointer).unwrap_or(0),
            Err((status, fault, required_result_capacity)) => {
                // A query the caller only observes as failed must not leave an
                // adoptable transaction behind; the reported watermark lets the
                // host reserve and retry exactly like an update.
                let _ = state.engine.abort_measure(measured);
                publish_attributed_failure(
                    state,
                    root_id,
                    revision,
                    status,
                    fault,
                    0,
                    required_result_capacity,
                )
            }
        }
    })
}

#[derive(Default)]
struct WasmState {
    registry: ShaperRegistry,
    engine: TextEngine,
    frames: BTreeMap<u32, FrameTransport>,
    update_batch: UpdateBatchTransport,
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

fn engine_status(error: EngineError) -> u32 {
    match error {
        EngineError::InvalidHandle => STATUS_INVALID_HANDLE,
        EngineError::HandleConflict => STATUS_CODEC_CONFLICT,
        EngineError::CodecMissing => STATUS_CODEC_MISSING,
        EngineError::FontStackMissing | EngineError::StyleFontStackMissing(_) => {
            STATUS_FONT_STACK_MISSING
        }
        EngineError::RootConflict => STATUS_ROOT_CONFLICT,
        EngineError::RootMissing => STATUS_ROOT_MISSING,
        EngineError::RevisionConflict => STATUS_REVISION_CONFLICT,
        EngineError::RevisionExhausted => STATUS_RESULT_TOO_LARGE,
        EngineError::InvalidRequest => STATUS_INVALID_REQUEST,
        EngineError::ResultTooLarge => STATUS_RESULT_TOO_LARGE,
        EngineError::RegistrationInUse => STATUS_REGISTRATION_IN_USE,
        EngineError::StyleRangeInvalid(_) => crate::STATUS_STYLE_RANGE_INVALID,
        EngineError::StyleSplitsCluster(_) => crate::STATUS_STYLE_SPLITS_CLUSTER,
        EngineError::StyleNestingInvalid(_) => crate::STATUS_STYLE_NESTING_INVALID,
        EngineError::StyleRootInvalid(_) => crate::STATUS_STYLE_ROOT_INVALID,
        EngineError::FontMetricsMissing(_) => crate::STATUS_FONT_METRICS_MISSING,
    }
}

fn publish_prepared_failure(
    state: &mut WasmState,
    prepared: crate::engine::frame::PreparedUpdate,
    revision: RootRevision,
    status: u32,
    fault: FrameFault,
    required_request_capacity: u32,
    required_result_capacity: u32,
) -> u32 {
    let root_id = prepared.root_id();
    let _ = state.engine.abort_update(prepared);
    publish_attributed_failure(
        state,
        root_id,
        revision,
        status,
        fault,
        required_request_capacity,
        required_result_capacity,
    )
}

fn publish_failure(
    state: &mut WasmState,
    root_id: u32,
    revision: RootRevision,
    status: u32,
    required_request_capacity: u32,
    required_result_capacity: u32,
) -> u32 {
    publish_attributed_failure(
        state,
        root_id,
        revision,
        status,
        FrameFault::default(),
        required_request_capacity,
        required_result_capacity,
    )
}

/// Publishes a rejection together with the paragraph and style it names, so the host reads the
/// cause out of the header instead of inferring it from a bare status number.
fn publish_engine_failure(
    state: &mut WasmState,
    root_id: u32,
    revision: RootRevision,
    error: EngineError,
) -> u32 {
    publish_attributed_failure(
        state,
        root_id,
        revision,
        engine_status(error),
        error.fault(),
        0,
        0,
    )
}

fn detached_plan_error(error: RenderPlanCompilerError) -> EngineError {
    if error.is_result_too_large() {
        EngineError::ResultTooLarge
    } else {
        EngineError::InvalidRequest
    }
}

fn publish_attributed_failure(
    state: &mut WasmState,
    root_id: u32,
    revision: RootRevision,
    status: u32,
    fault: FrameFault,
    required_request_capacity: u32,
    required_result_capacity: u32,
) -> u32 {
    state
        .frames
        .get_mut(&root_id)
        .and_then(|transport| {
            u32::try_from(transport.publish_failure(
                root_id,
                revision,
                status,
                fault,
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
