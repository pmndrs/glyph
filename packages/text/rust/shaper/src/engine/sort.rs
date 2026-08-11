//! Shared sort kernels for every engine ordering.
//!
//! Each call site lowers its ordering key into a `u64` — packed integer fields, or the
//! order-preserving bit image of an `f64` — so the compiler emits exactly one unstable
//! sort for keyed records and one for raw keys instead of one full sorting network per
//! key type. Keyed sorts carry the source index, which both applies the permutation and
//! makes equal-key order total and deterministic.

use super::EngineError;
use alloc::vec::Vec;

/// The one keyed-sort instantiation: `(key, source index)` pairs in ascending order.
/// The index tiebreak makes the result independent of the sort algorithm.
pub(crate) fn sort_pairs(pairs: &mut [(u64, u32)]) {
    pairs.sort_unstable();
}

/// The one raw-key instantiation.
pub(crate) fn sort_keys(keys: &mut [u64]) {
    keys.sort_unstable();
}

/// Packs two `u32` fields so numeric `u64` order equals `(high, low)` tuple order.
pub(crate) fn pack2(high: u32, low: u32) -> u64 {
    (u64::from(high) << 32) | u64::from(low)
}

/// Order-preserving `u64` image of an `f64`: key order equals `f64::total_cmp` order.
pub(crate) fn f64_key(value: f64) -> u64 {
    let bits = value.to_bits();
    bits ^ ((((bits as i64) >> 63) as u64) | 0x8000_0000_0000_0000)
}

/// Sorts an `f64` slice in `total_cmp` order through the shared raw-key kernel.
pub(crate) fn sort_f64_total(values: &mut [f64]) {
    // SAFETY: `f64` and `u64` have identical size and alignment, every bit pattern is
    // valid for both, and the slice is viewed exclusively through this reborrow. Each
    // element is mapped to its order-preserving key image, sorted, and mapped back, so
    // the slice again holds `f64` payloads before the view ends.
    let keys =
        unsafe { core::slice::from_raw_parts_mut(values.as_mut_ptr().cast::<u64>(), values.len()) };
    for key in keys.iter_mut() {
        *key = f64_key(f64::from_bits(*key));
    }
    sort_keys(keys);
    for key in keys.iter_mut() {
        *key ^= if *key & (1 << 63) != 0 {
            1u64 << 63
        } else {
            !0u64
        };
    }
}

/// Clears `pairs` and reserves capacity for `len` entries, rejecting oversize requests.
pub(crate) fn prepare_pairs(pairs: &mut Vec<(u64, u32)>, len: usize) -> Result<(), EngineError> {
    if u32::try_from(len).is_err() {
        return Err(EngineError::ResultTooLarge);
    }
    pairs.clear();
    pairs
        .try_reserve(len)
        .map_err(|_| EngineError::ResultTooLarge)
}

/// Applies the permutation captured in sorted `pairs` to `records` in place.
///
/// `pairs[destination].1` names the source slot for each destination. Cycle walking
/// consumes the index field as a visited marker, so `pairs` holds no meaningful indices
/// afterwards. Callers guarantee the pairs were built as `(key, 0..len)` over the same
/// records, which `debug_assert` re-checks.
pub(crate) fn apply_pair_order<T>(records: &mut [T], pairs: &mut [(u64, u32)]) {
    debug_assert_eq!(records.len(), pairs.len());
    const VISITED: u32 = 1 << 31;
    for start in 0..pairs.len() {
        if pairs[start].1 & VISITED != 0 {
            continue;
        }
        let mut destination = start;
        loop {
            let source = pairs[destination].1 as usize;
            pairs[destination].1 |= VISITED;
            if source == start {
                break;
            }
            records.swap(destination, source);
            destination = source;
        }
    }
    for pair in pairs.iter_mut() {
        pair.1 &= !VISITED;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn pack2_matches_tuple_order() {
        let mut tuples = [(3u32, 1u32), (0, 9), (3, 0), (0, 0), (u32::MAX, u32::MAX)];
        let mut packed: Vec<u64> = tuples.iter().map(|&(a, b)| pack2(a, b)).collect();
        tuples.sort_unstable();
        packed.sort_unstable();
        let repacked: Vec<u64> = tuples.iter().map(|&(a, b)| pack2(a, b)).collect();
        assert_eq!(packed, repacked);
    }

    #[test]
    fn f64_key_matches_total_cmp() {
        let mut values = [
            3.5,
            -0.0,
            0.0,
            f64::NEG_INFINITY,
            -7.25,
            f64::INFINITY,
            1e-308,
        ];
        let mut keyed: Vec<u64> = values.iter().map(|&v| f64_key(v)).collect();
        values.sort_by(f64::total_cmp);
        keyed.sort_unstable();
        let rekeyed: Vec<u64> = values.iter().map(|&v| f64_key(v)).collect();
        assert_eq!(keyed, rekeyed);
    }

    #[test]
    fn sort_f64_total_round_trips_payloads() {
        let mut values = vec![2.0, -1.5, 0.0, -0.0, 55.25, -1.5];
        sort_f64_total(&mut values);
        assert_eq!(values, vec![-1.5, -1.5, -0.0, 0.0, 2.0, 55.25]);
        assert!(values[2].is_sign_negative());
        assert!(!values[3].is_sign_negative());
    }

    #[test]
    fn apply_pair_order_permutes_and_restores_indices() {
        let mut records = vec![30u32, 10, 20, 10];
        let mut pairs: Vec<(u64, u32)> = records
            .iter()
            .enumerate()
            .map(|(index, &value)| (u64::from(value), index as u32))
            .collect();
        sort_pairs(&mut pairs);
        apply_pair_order(&mut records, &mut pairs);
        assert_eq!(records, vec![10, 10, 20, 30]);
        assert_eq!(
            pairs.iter().map(|pair| pair.1).collect::<Vec<_>>(),
            vec![1, 3, 2, 0]
        );
    }
}
