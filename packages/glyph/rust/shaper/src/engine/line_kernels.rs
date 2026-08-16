//! Production SIMD lanes for segmentation and line planning (D-245).
//!
//! Each entry point is a scalar function with an explicit `simd128` prefix that
//! computes the identical integer result sixteen lanes at a time; the scalar
//! tail finishes every call, so native builds and Wasm builds agree exactly.
//! Consumers: the bidi run scan (`transition masks`) and the justification
//! space scan (`flag masks`). Chunk-64 advance summaries remain lab-admitted
//! until cluster advances gain a fixed-point representation (see D-245).

/// The first index after `start` whose level differs from `levels[start]`,
/// or `levels.len()` when the run extends to the end.
pub(crate) fn next_transition(levels: &[u8], start: usize) -> usize {
    let level = levels[start];
    #[allow(unused_mut)]
    let mut index = start + 1;
    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    {
        index = next_transition_simd(levels, index, level);
    }
    while index < levels.len() && levels[index] == level {
        index += 1;
    }
    index
}

#[cfg(all(target_arch = "wasm32", feature = "simd128"))]
fn next_transition_simd(levels: &[u8], mut index: usize, level: u8) -> usize {
    use core::arch::wasm32::{i8x16_bitmask, i8x16_ne, u8x16_splat, v128, v128_load};

    let expected = u8x16_splat(level);
    while index + 16 <= levels.len() {
        // SAFETY: the loop bound keeps every sixteen-byte load inside `levels`.
        let block = unsafe { v128_load(levels.as_ptr().add(index).cast::<v128>()) };
        let mask = i8x16_bitmask(i8x16_ne(block, expected));
        if mask != 0 {
            return index + mask.trailing_zeros() as usize;
        }
        index += 16;
    }
    index
}

/// Invoke `visit` for every index in `[start, end)` whose flags carry `flag`.
pub(crate) fn for_each_flagged(
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
        while index + 16 <= end {
            // SAFETY: the loop bound keeps every sixteen-byte load inside `flags`.
            let block = unsafe { v128_load(flags.as_ptr().add(index).cast::<v128>()) };
            let mut mask = i8x16_bitmask(i8x16_ne(v128_and(block, selected), zero));
            while mask != 0 {
                let lane = mask.trailing_zeros() as usize;
                visit(index + lane);
                mask &= mask - 1;
            }
            index += 16;
        }
    }
    while index < end {
        if flags[index] & flag != 0 {
            visit(index);
        }
        index += 1;
    }
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
}
