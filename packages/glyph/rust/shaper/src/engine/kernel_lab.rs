//! Test-only kernels used to choose the retained engine's data layout before semantic storage lands.

#[cfg(target_arch = "wasm32")]
use core::{mem, slice};

#[cfg(target_arch = "wasm32")]
use crate::STATUS_INVALID_REQUEST;
#[cfg(target_arch = "wasm32")]
use crate::engine::codec::{
    BUFFER_USAGE_COPY_DST, BUFFER_USAGE_STORAGE, BufferId, BufferSchema, CapabilitySetId,
    PhysicalBufferMut, ScalarType, SemanticInputBatch, TechniqueId, ValidatedCodec,
};

const MAX_RECORDS: usize = 1_000_000;
const VALID_CHUNK_SIZES: [usize; 3] = [32, 64, 128];

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
pub(crate) const BACKEND: u32 = 1;
#[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
pub(crate) const BACKEND: u32 = 0;

#[allow(clippy::too_many_arguments)]
pub(crate) fn pack_origins_and_sizes(
    x: &[f32],
    y: &[f32],
    font_size: &[f32],
    plane_left: &[f32],
    plane_bottom: &[f32],
    plane_right: &[f32],
    plane_top: &[f32],
    inverse_units_per_em: f32,
    origins: &mut [f32],
    sizes: &mut [f32],
) {
    debug_assert_eq!(x.len(), y.len());
    debug_assert_eq!(x.len(), font_size.len());
    debug_assert_eq!(x.len(), plane_left.len());
    debug_assert_eq!(x.len(), plane_bottom.len());
    debug_assert_eq!(x.len(), plane_right.len());
    debug_assert_eq!(x.len(), plane_top.len());
    debug_assert_eq!(origins.len(), x.len() * 2);
    debug_assert_eq!(sizes.len(), x.len() * 2);

    // This straight-line loop is deliberately shared by both builds. With `+simd128`, LLVM
    // vectorizes it more efficiently than the rejected hand-written shuffle/store candidate.
    pack_scalar(
        0,
        x,
        y,
        font_size,
        plane_left,
        plane_bottom,
        plane_right,
        plane_top,
        inverse_units_per_em,
        origins,
        sizes,
    );
}

#[allow(clippy::too_many_arguments)]
fn pack_scalar(
    start: usize,
    x: &[f32],
    y: &[f32],
    font_size: &[f32],
    plane_left: &[f32],
    plane_bottom: &[f32],
    plane_right: &[f32],
    plane_top: &[f32],
    inverse_units_per_em: f32,
    origins: &mut [f32],
    sizes: &mut [f32],
) {
    for index in start..x.len() {
        let scale = font_size[index] * inverse_units_per_em;
        let output = index * 2;
        origins[output] = x[index] + plane_left[index] * scale;
        origins[output + 1] = y[index] - plane_top[index] * scale;
        sizes[output] = (plane_right[index] - plane_left[index]) * scale;
        sizes[output + 1] = (plane_top[index] - plane_bottom[index]) * scale;
    }
}

pub(crate) fn break_masks(flags: &[u8], group_count: usize, output: &mut [u16]) {
    debug_assert!([1, 2, 4, 8].contains(&group_count));
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    let completed = unsafe {
        match group_count {
            1 => break_masks_simd::<1>(flags, output),
            2 => break_masks_simd::<2>(flags, output),
            4 => break_masks_simd::<4>(flags, output),
            8 => break_masks_simd::<8>(flags, output),
            _ => unreachable!(),
        }
    };
    #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
    let completed = 0;

    for (block, output_mask) in output.iter_mut().enumerate().skip(completed / 16) {
        let start = block * 16;
        let end = flags.len().min(start + 16);
        let mut mask = 0_u16;
        for (lane, flag) in flags[start..end].iter().enumerate() {
            if flag & 1 != 0 {
                mask |= 1 << lane;
            }
        }
        *output_mask = mask;
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn break_masks_simd<const GROUPS: usize>(flags: &[u8], output: &mut [u16]) -> usize {
    use core::arch::wasm32::{i8x16_bitmask, i8x16_ne, u8x16_splat, v128, v128_and, v128_load};

    let bytes_per_group = GROUPS * 16;
    let completed = flags.len() / bytes_per_group * bytes_per_group;
    for start in (0..completed).step_by(bytes_per_group) {
        let mut values = [u8x16_splat(0); GROUPS];
        for (group, value) in values.iter_mut().enumerate() {
            // SAFETY: `completed` includes only complete groups of sixteen-byte blocks.
            *value = unsafe { v128_load(flags.as_ptr().add(start + group * 16).cast::<v128>()) };
        }
        for (group, value) in values.into_iter().enumerate() {
            let allowed = i8x16_ne(v128_and(value, u8x16_splat(1)), u8x16_splat(0));
            output[start / 16 + group] = i8x16_bitmask(allowed);
        }
    }
    completed
}

pub(crate) fn bidi_transition_masks(levels: &[u8], group_count: usize, output: &mut [u16]) {
    debug_assert!([1, 2, 4, 8].contains(&group_count));
    let mut previous = 0_u8;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    let completed = unsafe {
        match group_count {
            1 => bidi_masks_simd::<1>(levels, output, &mut previous),
            2 => bidi_masks_simd::<2>(levels, output, &mut previous),
            4 => bidi_masks_simd::<4>(levels, output, &mut previous),
            8 => bidi_masks_simd::<8>(levels, output, &mut previous),
            _ => unreachable!(),
        }
    };
    #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
    let completed = 0;

    for (block, output_mask) in output.iter_mut().enumerate().skip(completed / 16) {
        let start = block * 16;
        let end = levels.len().min(start + 16);
        let mut mask = 0_u16;
        for (lane, level) in levels[start..end].iter().copied().enumerate() {
            if level != previous {
                mask |= 1 << lane;
            }
            previous = level;
        }
        *output_mask = mask;
    }
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn bidi_masks_simd<const GROUPS: usize>(
    levels: &[u8],
    output: &mut [u16],
    previous: &mut u8,
) -> usize {
    use core::arch::wasm32::{
        i8x16_bitmask, i8x16_ne, i8x16_shuffle, u8x16_splat, v128, v128_load,
    };

    let bytes_per_group = GROUPS * 16;
    let completed = levels.len() / bytes_per_group * bytes_per_group;
    for start in (0..completed).step_by(bytes_per_group) {
        let mut values = [u8x16_splat(0); GROUPS];
        for (group, value) in values.iter_mut().enumerate() {
            // SAFETY: `completed` includes only complete groups of sixteen-byte blocks.
            *value = unsafe { v128_load(levels.as_ptr().add(start + group * 16).cast::<v128>()) };
        }
        for (group, value) in values.into_iter().enumerate() {
            let block_start = start + group * 16;
            let prior = u8x16_splat(*previous);
            let shifted =
                i8x16_shuffle::<0, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30>(
                    prior, value,
                );
            output[block_start / 16] = i8x16_bitmask(i8x16_ne(value, shifted));
            *previous = levels[block_start + 15];
        }
    }
    completed
}

pub(crate) fn chunk_summaries(
    advances: &[i32],
    flags: &[u8],
    chunk_size: usize,
    advance_sums: &mut [i64],
    space_sums: &mut [i64],
    flags_or: &mut [u8],
) {
    debug_assert!(VALID_CHUNK_SIZES.contains(&chunk_size));
    for chunk in 0..advance_sums.len() {
        let start = chunk * chunk_size;
        let end = advances.len().min(start + chunk_size);
        #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
        let (completed, mut advance_sum) =
            unsafe { chunk_summary_simd(&advances[start..end], &flags[start..end]) };
        #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
        let (completed, mut advance_sum) = (0, 0_i64);

        for index in completed..end - start {
            advance_sum += i64::from(advances[start + index]);
        }
        let (space_sum, combined_flags) =
            summarize_flags(&advances[start..end], &flags[start..end]);
        advance_sums[chunk] = advance_sum;
        space_sums[chunk] = space_sum;
        flags_or[chunk] = combined_flags;
    }
}

/// F16.16 candidate matching the production lane width. The accumulator count is
/// benchmark-only tuning state; every specialization must return identical sums.
pub(crate) fn chunk_summaries_i64(
    advances: &[i64],
    flags: &[u8],
    chunk_size: usize,
    accumulator_count: usize,
    advance_sums: &mut [i64],
    space_sums: &mut [i64],
    flags_or: &mut [u8],
) {
    debug_assert!(VALID_CHUNK_SIZES.contains(&chunk_size));
    debug_assert!([1, 2, 4, 8].contains(&accumulator_count));
    for chunk in 0..advance_sums.len() {
        let start = chunk * chunk_size;
        let end = advances.len().min(start + chunk_size);
        let chunk_advances = &advances[start..end];
        let chunk_flags = &flags[start..end];
        #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
        let advance_sum = unsafe {
            match accumulator_count {
                1 => chunk_sum_i64_simd::<1>(chunk_advances),
                2 => chunk_sum_i64_simd::<2>(chunk_advances),
                4 => chunk_sum_i64_simd::<4>(chunk_advances),
                8 => chunk_sum_i64_simd::<8>(chunk_advances),
                _ => unreachable!(),
            }
        };
        #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
        let advance_sum = chunk_advances.iter().copied().sum();

        let (space_sum, combined_flags) = summarize_flags(chunk_advances, chunk_flags);

        advance_sums[chunk] = advance_sum;
        space_sums[chunk] = space_sum;
        flags_or[chunk] = combined_flags;
    }
}

fn summarize_flags<Unit: Copy + Into<i64>>(advances: &[Unit], flags: &[u8]) -> (i64, u8) {
    advances
        .iter()
        .zip(flags)
        .fold((0_i64, 0_u8), |(space_sum, flags_or), (advance, flag)| {
            (
                space_sum + (*advance).into() * i64::from(flag & (1 << 4) != 0),
                flags_or | *flag,
            )
        })
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn chunk_sum_i64_simd<const ACCUMULATORS: usize>(advances: &[i64]) -> i64 {
    use core::arch::wasm32::{i64x2_add, i64x2_extract_lane, i64x2_splat, v128, v128_load};

    let values_per_group = ACCUMULATORS * 2;
    let completed = advances.len() / values_per_group * values_per_group;
    let mut sums = [i64x2_splat(0); ACCUMULATORS];
    for start in (0..completed).step_by(values_per_group) {
        for (accumulator, sum) in sums.iter_mut().enumerate() {
            // SAFETY: `completed` contains only complete accumulator groups.
            let values = unsafe {
                v128_load(
                    advances
                        .as_ptr()
                        .add(start + accumulator * 2)
                        .cast::<v128>(),
                )
            };
            *sum = i64x2_add(*sum, values);
        }
    }
    let mut total = 0_i64;
    for sum in sums {
        total += i64x2_extract_lane::<0>(sum) + i64x2_extract_lane::<1>(sum);
    }
    total + advances[completed..].iter().copied().sum::<i64>()
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
unsafe fn chunk_summary_simd(advances: &[i32], _flags: &[u8]) -> (usize, i64) {
    use core::arch::wasm32::{
        i64x2_add, i64x2_extend_high_i32x4, i64x2_extend_low_i32x4, i64x2_extract_lane,
        i64x2_splat, v128, v128_load,
    };

    let completed = advances.len() & !15;
    let mut sums = i64x2_splat(0);
    for start in (0..completed).step_by(16) {
        for lane_group in 0..4 {
            // SAFETY: each group contains four in-bounds i32 values.
            let values =
                unsafe { v128_load(advances.as_ptr().add(start + lane_group * 4).cast::<v128>()) };
            sums = i64x2_add(sums, i64x2_extend_low_i32x4(values));
            sums = i64x2_add(sums, i64x2_extend_high_i32x4(values));
        }
    }
    (
        completed,
        i64x2_extract_lane::<0>(sums) + i64x2_extract_lane::<1>(sums),
    )
}

#[cfg(target_arch = "wasm32")]
#[allow(clippy::too_many_arguments)]
pub(crate) unsafe fn exported_pack(
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
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Some(pair_count) = count.checked_mul(2) else {
        return STATUS_INVALID_REQUEST;
    };
    let regions = [
        region::<f32>(x_pointer, count),
        region::<f32>(y_pointer, count),
        region::<f32>(font_size_pointer, count),
        region::<f32>(plane_left_pointer, count),
        region::<f32>(plane_bottom_pointer, count),
        region::<f32>(plane_right_pointer, count),
        region::<f32>(plane_top_pointer, count),
        region::<f32>(origins_pointer, pair_count),
        region::<f32>(sizes_pointer, pair_count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: all typed regions are aligned, in linear memory, and pairwise disjoint.
    unsafe {
        pack_origins_and_sizes(
            typed_slice(x_pointer, count),
            typed_slice(y_pointer, count),
            typed_slice(font_size_pointer, count),
            typed_slice(plane_left_pointer, count),
            typed_slice(plane_bottom_pointer, count),
            typed_slice(plane_right_pointer, count),
            typed_slice(plane_top_pointer, count),
            inverse_units_per_em,
            typed_slice_mut(origins_pointer, pair_count),
            typed_slice_mut(sizes_pointer, pair_count),
        );
    }
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_break_masks(
    count: u32,
    group_count: u32,
    flags_pointer: u32,
    output_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(group_count) = usize::try_from(group_count) else {
        return STATUS_INVALID_REQUEST;
    };
    if ![1, 2, 4, 8].contains(&group_count) {
        return STATUS_INVALID_REQUEST;
    }
    let output_count = count.div_ceil(16);
    let regions = [
        region::<u8>(flags_pointer, count),
        region::<u16>(output_pointer, output_count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: both typed regions are aligned, in linear memory, and disjoint.
    unsafe {
        break_masks(
            typed_slice(flags_pointer, count),
            group_count,
            typed_slice_mut(output_pointer, output_count),
        )
    };
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_bidi_masks(
    count: u32,
    group_count: u32,
    levels_pointer: u32,
    output_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(group_count) = usize::try_from(group_count) else {
        return STATUS_INVALID_REQUEST;
    };
    if ![1, 2, 4, 8].contains(&group_count) {
        return STATUS_INVALID_REQUEST;
    }
    let output_count = count.div_ceil(16);
    let regions = [
        region::<u8>(levels_pointer, count),
        region::<u16>(output_pointer, output_count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: both typed regions are aligned, in linear memory, and disjoint.
    unsafe {
        bidi_transition_masks(
            typed_slice(levels_pointer, count),
            group_count,
            typed_slice_mut(output_pointer, output_count),
        )
    };
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_flagged_scan(
    count: u32,
    group_count: u32,
    flags_pointer: u32,
    checksum_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(group_count) = usize::try_from(group_count) else {
        return STATUS_INVALID_REQUEST;
    };
    if ![1, 2, 4, 8].contains(&group_count) {
        return STATUS_INVALID_REQUEST;
    }
    let regions = [
        region::<u8>(flags_pointer, count),
        region::<u64>(checksum_pointer, 1),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: validation proves the input and output regions are readable/writable.
    let checksum = super::line_kernels::flagged_scan_checksum(
        unsafe { typed_slice(flags_pointer, count) },
        1 << 4,
        group_count,
    );
    // SAFETY: validation proves one writable u64 is available.
    unsafe { typed_slice_mut(checksum_pointer, 1)[0] = checksum };
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_transition_scan(
    count: u32,
    group_count: u32,
    levels_pointer: u32,
    checksum_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(group_count) = usize::try_from(group_count) else {
        return STATUS_INVALID_REQUEST;
    };
    if ![1, 2, 4, 8].contains(&group_count) {
        return STATUS_INVALID_REQUEST;
    }
    let regions = [
        region::<u8>(levels_pointer, count),
        region::<u64>(checksum_pointer, 1),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: validation proves the input and output regions are readable/writable.
    let checksum = super::line_kernels::transition_scan_checksum(
        unsafe { typed_slice(levels_pointer, count) },
        group_count,
    );
    // SAFETY: validation proves one writable u64 is available.
    unsafe { typed_slice_mut(checksum_pointer, 1)[0] = checksum };
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_chunk_summaries(
    count: u32,
    chunk_size: u32,
    advances_pointer: u32,
    flags_pointer: u32,
    advance_sums_pointer: u32,
    space_sums_pointer: u32,
    flags_or_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(chunk_size) = usize::try_from(chunk_size) else {
        return STATUS_INVALID_REQUEST;
    };
    if !VALID_CHUNK_SIZES.contains(&chunk_size) {
        return STATUS_INVALID_REQUEST;
    }
    let summary_count = count.div_ceil(chunk_size);
    let regions = [
        region::<i32>(advances_pointer, count),
        region::<u8>(flags_pointer, count),
        region::<i64>(advance_sums_pointer, summary_count),
        region::<i64>(space_sums_pointer, summary_count),
        region::<u8>(flags_or_pointer, summary_count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: all typed regions are aligned, in linear memory, and pairwise disjoint.
    unsafe {
        chunk_summaries(
            typed_slice(advances_pointer, count),
            typed_slice(flags_pointer, count),
            chunk_size,
            typed_slice_mut(advance_sums_pointer, summary_count),
            typed_slice_mut(space_sums_pointer, summary_count),
            typed_slice_mut(flags_or_pointer, summary_count),
        );
    }
    0
}

#[cfg(target_arch = "wasm32")]
pub(crate) unsafe fn exported_chunk_summaries_i64(
    count: u32,
    chunk_size: u32,
    accumulator_count: u32,
    advances_pointer: u32,
    flags_pointer: u32,
    advance_sums_pointer: u32,
    space_sums_pointer: u32,
    flags_or_pointer: u32,
) -> u32 {
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let (Ok(chunk_size), Ok(accumulator_count)) = (
        usize::try_from(chunk_size),
        usize::try_from(accumulator_count),
    ) else {
        return STATUS_INVALID_REQUEST;
    };
    if !VALID_CHUNK_SIZES.contains(&chunk_size) || ![1, 2, 4, 8].contains(&accumulator_count) {
        return STATUS_INVALID_REQUEST;
    }
    let summary_count = count.div_ceil(chunk_size);
    let regions = [
        region::<i64>(advances_pointer, count),
        region::<u8>(flags_pointer, count),
        region::<i64>(advance_sums_pointer, summary_count),
        region::<i64>(space_sums_pointer, summary_count),
        region::<u8>(flags_or_pointer, summary_count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: all typed regions are aligned, in linear memory, and pairwise disjoint.
    unsafe {
        chunk_summaries_i64(
            typed_slice(advances_pointer, count),
            typed_slice(flags_pointer, count),
            chunk_size,
            accumulator_count,
            typed_slice_mut(advance_sums_pointer, summary_count),
            typed_slice_mut(space_sums_pointer, summary_count),
            typed_slice_mut(flags_or_pointer, summary_count),
        );
    }
    0
}

#[cfg(target_arch = "wasm32")]
#[allow(clippy::too_many_arguments)]
pub(crate) unsafe fn exported_codec(
    codec: &ValidatedCodec,
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
    let Some(count) = bounded_count(count) else {
        return STATUS_INVALID_REQUEST;
    };
    let Ok(variant) = u16::try_from(variant) else {
        return STATUS_INVALID_REQUEST;
    };
    let Some(f32_output_count) = count.checked_mul(4) else {
        return STATUS_INVALID_REQUEST;
    };
    let regions = [
        region::<f32>(f32_input0_pointer, count),
        region::<f32>(f32_input1_pointer, count),
        region::<f32>(f32_input2_pointer, count),
        region::<f32>(f32_input3_pointer, count),
        region::<u32>(u32_input0_pointer, count),
        region::<f32>(f32_output_pointer, f32_output_count),
        region::<u32>(u32_output_pointer, count),
        region::<u16>(u16_output_pointer, count),
    ];
    if !valid_disjoint_regions(&regions) {
        return STATUS_INVALID_REQUEST;
    }
    // SAFETY: all input and output regions are aligned, in linear memory, and pairwise disjoint.
    unsafe {
        let f32_inputs = [
            typed_slice(f32_input0_pointer, count),
            typed_slice(f32_input1_pointer, count),
            typed_slice(f32_input2_pointer, count),
            typed_slice(f32_input3_pointer, count),
        ];
        let u32_inputs = [typed_slice(u32_input0_pointer, count)];
        let mut outputs = [
            PhysicalBufferMut {
                schema: BufferSchema::packed(
                    BufferId(1),
                    ScalarType::F32,
                    4,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
                bytes: byte_slice_mut(f32_output_pointer, f32_output_count * mem::size_of::<f32>()),
            },
            PhysicalBufferMut {
                schema: BufferSchema::packed(
                    BufferId(2),
                    ScalarType::U32,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
                bytes: byte_slice_mut(u32_output_pointer, count * mem::size_of::<u32>()),
            },
            PhysicalBufferMut {
                schema: BufferSchema::packed(
                    BufferId(3),
                    ScalarType::U16,
                    1,
                    BUFFER_USAGE_STORAGE | BUFFER_USAGE_COPY_DST,
                    1,
                ),
                bytes: byte_slice_mut(u16_output_pointer, count * mem::size_of::<u16>()),
            },
        ];
        codec
            .execute(
                CapabilitySetId(1),
                TechniqueId(technique),
                variant,
                SemanticInputBatch {
                    f32_fields: &f32_inputs,
                    u32_fields: &u32_inputs,
                    record_count: count,
                },
                0,
                &mut outputs,
            )
            .map_or(STATUS_INVALID_REQUEST, |()| 0)
    }
}

#[cfg(target_arch = "wasm32")]
#[derive(Clone, Copy)]
struct MemoryRegion {
    start: usize,
    end: usize,
    alignment: usize,
}

#[cfg(target_arch = "wasm32")]
fn region<Value>(pointer: u32, count: usize) -> Option<MemoryRegion> {
    let start = pointer as usize;
    let bytes = count.checked_mul(mem::size_of::<Value>())?;
    Some(MemoryRegion {
        start,
        end: start.checked_add(bytes)?,
        alignment: mem::align_of::<Value>(),
    })
}

#[cfg(target_arch = "wasm32")]
fn valid_disjoint_regions(regions: &[Option<MemoryRegion>]) -> bool {
    let memory_bytes = core::arch::wasm32::memory_size::<0>().saturating_mul(65_536);
    for (index, region) in regions.iter().enumerate() {
        let Some(region) = region else {
            return false;
        };
        if region.start == 0 || region.start % region.alignment != 0 || region.end > memory_bytes {
            return false;
        }
        for previous in regions[..index].iter().flatten() {
            if region.start < previous.end && previous.start < region.end {
                return false;
            }
        }
    }
    true
}

#[cfg(target_arch = "wasm32")]
unsafe fn typed_slice<Value>(pointer: u32, count: usize) -> &'static [Value] {
    // SAFETY: exported entry points validate alignment, memory bounds, and non-overlap first.
    unsafe { slice::from_raw_parts(pointer as *const Value, count) }
}

#[cfg(target_arch = "wasm32")]
unsafe fn typed_slice_mut<Value>(pointer: u32, count: usize) -> &'static mut [Value] {
    // SAFETY: exported entry points validate alignment, memory bounds, and non-overlap first.
    unsafe { slice::from_raw_parts_mut(pointer as *mut Value, count) }
}

#[cfg(target_arch = "wasm32")]
unsafe fn byte_slice_mut(pointer: u32, count: usize) -> &'static mut [u8] {
    // SAFETY: exported entry points validate the corresponding typed region and non-overlap first.
    unsafe { slice::from_raw_parts_mut(pointer as *mut u8, count) }
}

fn bounded_count(count: u32) -> Option<usize> {
    let count = usize::try_from(count).ok()?;
    (count != 0 && count <= MAX_RECORDS).then_some(count)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn scalar_packing_is_bit_exact_for_partial_groups() {
        let x = [10.0, -2.0, 3.5, 8.0, 1.0];
        let y = [20.0, 7.0, -4.0, 2.0, 9.0];
        let font_sizes = [16.0, 24.0, 12.0, 32.0, 18.0];
        let left = [-2.0, 0.0, 1.0, -1.0, 2.0];
        let bottom = [-3.0, -2.0, 0.0, 1.0, -1.0];
        let right = [8.0, 9.0, 7.0, 11.0, 10.0];
        let top = [12.0, 14.0, 9.0, 17.0, 13.0];
        let mut origins = [0.0; 10];
        let mut packed_sizes = [0.0; 10];
        pack_origins_and_sizes(
            &x,
            &y,
            &font_sizes,
            &left,
            &bottom,
            &right,
            &top,
            1.0 / 16.0,
            &mut origins,
            &mut packed_sizes,
        );
        let mut expected_origins = [0.0; 10];
        let mut expected_sizes = [0.0; 10];
        pack_scalar(
            0,
            &x,
            &y,
            &font_sizes,
            &left,
            &bottom,
            &right,
            &top,
            1.0 / 16.0,
            &mut expected_origins,
            &mut expected_sizes,
        );
        assert_eq!(
            origins.map(f32::to_bits),
            expected_origins.map(f32::to_bits)
        );
        assert_eq!(
            packed_sizes.map(f32::to_bits),
            expected_sizes.map(f32::to_bits)
        );
    }

    #[test]
    fn masks_preserve_partial_blocks_and_cross_block_bidi_state() {
        let flags = (0..35)
            .map(|index| u8::from(index % 3 == 0))
            .collect::<vec::Vec<_>>();
        let mut masks = [0_u16; 3];
        break_masks(&flags, 1, &mut masks);
        assert_eq!(masks, [0x9249, 0x4924, 0x0002]);

        let levels = [0, 0, 1, 1, 1, 2, 2, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 0];
        let mut transitions = [0_u16; 2];
        bidi_transition_masks(&levels, 1, &mut transitions);
        assert_eq!(transitions, [0x94a4, 0x0004]);
    }

    #[test]
    fn every_candidate_chunk_size_has_exact_integer_summaries() {
        let advances = (0..259)
            .map(|index| index % 17 - 8)
            .collect::<vec::Vec<_>>();
        let flags = (0..259)
            .map(|index| u8::from(index % 7 == 0))
            .collect::<vec::Vec<_>>();
        for chunk_size in VALID_CHUNK_SIZES {
            let count = advances.len().div_ceil(chunk_size);
            let mut sums = vec![0_i64; count];
            let mut spaces = vec![0_i64; count];
            let mut combined_flags = vec![0_u8; count];
            chunk_summaries(
                &advances,
                &flags,
                chunk_size,
                &mut sums,
                &mut spaces,
                &mut combined_flags,
            );
            for chunk in 0..count {
                let start = chunk * chunk_size;
                let end = advances.len().min(start + chunk_size);
                assert_eq!(
                    sums[chunk],
                    advances[start..end]
                        .iter()
                        .map(|value| i64::from(*value))
                        .sum::<i64>()
                );
                assert_eq!(
                    spaces[chunk],
                    flags[start..end]
                        .iter()
                        .zip(&advances[start..end])
                        .filter(|(flag, _)| **flag & (1 << 4) != 0)
                        .map(|(_, advance)| i64::from(*advance))
                        .sum::<i64>()
                );
                assert_eq!(
                    combined_flags[chunk],
                    flags[start..end]
                        .iter()
                        .fold(0, |result, flag| result | flag)
                );
            }
        }
    }

    #[test]
    fn every_i64_accumulator_specialization_matches_the_scalar_oracle() {
        let advances = (0_i64..259)
            .map(|index| (index % 17 - 8) * 65_536)
            .collect::<vec::Vec<_>>();
        let flags = (0..259)
            .map(|index| u8::from(index % 7 == 0))
            .collect::<vec::Vec<_>>();
        for chunk_size in VALID_CHUNK_SIZES {
            let count = advances.len().div_ceil(chunk_size);
            for accumulator_count in [1, 2, 4, 8] {
                let mut sums = vec![0_i64; count];
                let mut spaces = vec![0_i64; count];
                let mut combined_flags = vec![0_u8; count];
                chunk_summaries_i64(
                    &advances,
                    &flags,
                    chunk_size,
                    accumulator_count,
                    &mut sums,
                    &mut spaces,
                    &mut combined_flags,
                );
                for chunk in 0..count {
                    let start = chunk * chunk_size;
                    let end = advances.len().min(start + chunk_size);
                    assert_eq!(sums[chunk], advances[start..end].iter().sum::<i64>());
                    assert_eq!(
                        spaces[chunk],
                        flags[start..end]
                            .iter()
                            .zip(&advances[start..end])
                            .filter(|(flag, _)| **flag & (1 << 4) != 0)
                            .map(|(_, advance)| *advance)
                            .sum::<i64>()
                    );
                    assert_eq!(
                        combined_flags[chunk],
                        flags[start..end]
                            .iter()
                            .fold(0, |result, flag| result | flag)
                    );
                }
            }
        }
    }

    #[test]
    fn every_mask_group_specialization_matches_the_x1_oracle() {
        let flags = (0..259)
            .map(|index| u8::from(index % 7 == 0))
            .collect::<vec::Vec<_>>();
        let levels = (0..259)
            .map(|index| ((index / 11) % 5) as u8)
            .collect::<vec::Vec<_>>();
        let mut break_oracle = vec![0_u16; flags.len().div_ceil(16)];
        let mut bidi_oracle = vec![0_u16; levels.len().div_ceil(16)];
        break_masks(&flags, 1, &mut break_oracle);
        bidi_transition_masks(&levels, 1, &mut bidi_oracle);
        for group_count in [2, 4, 8] {
            let mut breaks = vec![0_u16; break_oracle.len()];
            let mut bidi = vec![0_u16; bidi_oracle.len()];
            break_masks(&flags, group_count, &mut breaks);
            bidi_transition_masks(&levels, group_count, &mut bidi);
            assert_eq!(breaks, break_oracle);
            assert_eq!(bidi, bidi_oracle);
        }
    }
}
