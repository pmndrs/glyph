//! Production and laboratory kernels for segmentation and line planning.
//!
//! Production keeps the early-exit bidi transition scan scalar and visits
//! justification flags four `v128` blocks at a time. The four-block limit is a
//! measured, deterministic unroll choice; wider candidates remain behind the
//! `kernel-lab` feature until representative mobile browser evidence justifies
//! their register pressure. Scalar tails preserve identical native and Wasm
//! results at every slice length.

/// The first index after `start` whose level differs from `levels[start]`,
/// or `levels.len()` when the run extends to the end.
pub(crate) fn next_transition(levels: &[u8], start: usize) -> usize {
    let level = levels[start];
    let mut index = start + 1;
    while index < levels.len() && levels[index] == level {
        index += 1;
    }
    index
}

#[cfg(feature = "kernel-lab")]
fn next_transition_grouped<const GROUPS: usize>(levels: &[u8], start: usize) -> usize {
    let level = levels[start];
    #[allow(unused_mut)]
    let mut index = start + 1;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    {
        index = next_transition_simd::<GROUPS>(levels, index, level);
    }
    while index < levels.len() && levels[index] == level {
        index += 1;
    }
    index
}

#[cfg(all(target_arch = "wasm32", feature = "simd128", feature = "kernel-lab"))]
fn next_transition_simd<const GROUPS: usize>(levels: &[u8], mut index: usize, level: u8) -> usize {
    use core::arch::wasm32::{i8x16_bitmask, i8x16_ne, u8x16_splat, v128, v128_load};

    let expected = u8x16_splat(level);
    let bytes_per_group = GROUPS * 16;
    while index + bytes_per_group <= levels.len() {
        let mut blocks = [u8x16_splat(0); GROUPS];
        for (group, block) in blocks.iter_mut().enumerate() {
            // SAFETY: the loop bound keeps every grouped load inside `levels`.
            *block = unsafe { v128_load(levels.as_ptr().add(index + group * 16).cast::<v128>()) };
        }
        for (group, block) in blocks.into_iter().enumerate() {
            let mask = i8x16_bitmask(i8x16_ne(block, expected));
            if mask != 0 {
                return index + group * 16 + mask.trailing_zeros() as usize;
            }
        }
        index += bytes_per_group;
    }
    index
}

/// Invoke `visit` for every index in `[start, end)` whose flags carry `flag`.
pub(crate) fn for_each_flagged(
    flags: &[u8],
    start: usize,
    end: usize,
    flag: u8,
    visit: impl FnMut(usize),
) {
    for_each_flagged_grouped::<4>(flags, start, end, flag, visit);
}

fn for_each_flagged_grouped<const GROUPS: usize>(
    flags: &[u8],
    start: usize,
    end: usize,
    flag: u8,
    mut visit: impl FnMut(usize),
) {
    #[allow(unused_mut)]
    let mut index = start;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    {
        use core::arch::wasm32::{i8x16_bitmask, i8x16_ne, u8x16_splat, v128, v128_and, v128_load};

        let selected = u8x16_splat(flag);
        let zero = u8x16_splat(0);
        let bytes_per_group = GROUPS * 16;
        while index + bytes_per_group <= end {
            let mut blocks = [zero; GROUPS];
            for (group, block) in blocks.iter_mut().enumerate() {
                // SAFETY: the loop bound keeps every grouped load inside `flags`.
                *block =
                    unsafe { v128_load(flags.as_ptr().add(index + group * 16).cast::<v128>()) };
            }
            for (group, block) in blocks.into_iter().enumerate() {
                let mut mask = i8x16_bitmask(i8x16_ne(v128_and(block, selected), zero));
                while mask != 0 {
                    let lane = mask.trailing_zeros() as usize;
                    visit(index + group * 16 + lane);
                    mask &= mask - 1;
                }
            }
            index += bytes_per_group;
        }
    }
    while index < end {
        if flags[index] & flag != 0 {
            visit(index);
        }
        index += 1;
    }
}

#[cfg(feature = "kernel-lab")]
pub(crate) fn transition_scan_checksum(levels: &[u8], group_count: usize) -> u64 {
    let mut checksum = 0_u64;
    let mut start = 0;
    while start < levels.len() {
        let end = match group_count {
            1 => next_transition_grouped::<1>(levels, start),
            2 => next_transition_grouped::<2>(levels, start),
            4 => next_transition_grouped::<4>(levels, start),
            8 => next_transition_grouped::<8>(levels, start),
            _ => unreachable!(),
        };
        checksum = checksum.wrapping_add(end as u64);
        start = end;
    }
    checksum
}

#[cfg(feature = "kernel-lab")]
pub(crate) fn flagged_scan_checksum(flags: &[u8], flag: u8, group_count: usize) -> u64 {
    let mut checksum = 0_u64;
    let mut visit = |index| checksum = checksum.wrapping_add(index as u64 + 1);
    match group_count {
        1 => for_each_flagged_grouped::<1>(flags, 0, flags.len(), flag, &mut visit),
        2 => for_each_flagged_grouped::<2>(flags, 0, flags.len(), flag, &mut visit),
        4 => for_each_flagged_grouped::<4>(flags, 0, flags.len(), flag, &mut visit),
        8 => for_each_flagged_grouped::<8>(flags, 0, flags.len(), flag, &mut visit),
        _ => unreachable!(),
    }
    checksum
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    #[test]
    fn transitions_match_the_naive_scan_across_block_boundaries() {
        let mut levels = [0_u8; 40];
        for (index, level) in levels.iter_mut().enumerate() {
            *level = match index {
                0..=14 => 1,
                15..=16 => 2,
                17..=32 => 1,
                _ => 3,
            };
        }
        let naive = |start: usize| {
            let mut end = start + 1;
            while end < levels.len() && levels[end] == levels[start] {
                end += 1;
            }
            end
        };
        for start in 0..levels.len() {
            assert_eq!(
                next_transition(&levels, start),
                naive(start),
                "start {start}"
            );
        }
        let uniform = [7_u8; 33];
        assert_eq!(next_transition(&uniform, 0), 33);
    }

    #[test]
    fn flagged_visits_match_the_naive_filter_for_every_alignment() {
        let mut flags = [0_u8; 50];
        for (index, flag) in flags.iter_mut().enumerate() {
            if index % 3 == 0 {
                *flag |= 0b1_0000;
            }
            if index % 7 == 0 {
                *flag |= 0b0_1000;
            }
        }
        for start in [0, 1, 15, 16, 17] {
            for end in [start, 31, 32, 33, 50] {
                if end < start {
                    continue;
                }
                let mut visited = Vec::new();
                for_each_flagged(&flags, start, end, 0b1_0000, |index| visited.push(index));
                let naive: Vec<usize> = (start..end)
                    .filter(|index| flags[*index] & 0b1_0000 != 0)
                    .collect();
                assert_eq!(visited, naive, "range {start}..{end}");
            }
        }
    }

    #[cfg(feature = "kernel-lab")]
    #[test]
    fn every_grouped_production_scan_matches_x1() {
        let flags = (0..259)
            .map(|index| if index % 5 == 0 { 0b1_0000 } else { 0 })
            .collect::<Vec<_>>();
        let levels = (0..259)
            .map(|index| ((index / 19) % 5) as u8)
            .collect::<Vec<_>>();
        let flagged_oracle = flagged_scan_checksum(&flags, 0b1_0000, 1);
        let transition_oracle = transition_scan_checksum(&levels, 1);
        for group_count in [2, 4, 8] {
            assert_eq!(
                flagged_scan_checksum(&flags, 0b1_0000, group_count),
                flagged_oracle
            );
            assert_eq!(
                transition_scan_checksum(&levels, group_count),
                transition_oracle
            );
        }
    }
}
