//! A map from a `u32` handle to a value, for the engine's few handle registries (roots, codecs,
//! frame transports).
//!
//! It replaces `BTreeMap<u32, V>`, whose node code is instantiated once per value type and cost
//! about 23 kB of the shaper for four registries that each hold a handful of entries. Keys live in
//! their own sorted vector, so every lookup runs the one non-generic [`position`] binary search, and
//! values sit beside them in the same order. Iteration is in key order, as `BTreeMap`'s was.

use alloc::vec::Vec;

#[derive(Clone, Debug)]
pub(crate) struct IdMap<V> {
    keys: Vec<u32>,
    values: Vec<V>,
}

impl<V> Default for IdMap<V> {
    fn default() -> Self {
        Self {
            keys: Vec::new(),
            values: Vec::new(),
        }
    }
}

/// Where `key` is in the sorted `keys`, or where it would be inserted.
#[inline(never)]
fn position(keys: &[u32], key: u32) -> Result<usize, usize> {
    keys.binary_search(&key)
}

impl<V> IdMap<V> {
    pub(crate) fn len(&self) -> usize {
        self.keys.len()
    }

    pub(crate) fn contains_key(&self, key: &u32) -> bool {
        position(&self.keys, *key).is_ok()
    }

    pub(crate) fn get(&self, key: &u32) -> Option<&V> {
        position(&self.keys, *key)
            .ok()
            .map(|index| &self.values[index])
    }

    pub(crate) fn get_mut(&mut self, key: &u32) -> Option<&mut V> {
        position(&self.keys, *key)
            .ok()
            .map(|index| &mut self.values[index])
    }

    /// Inserts `value` under `key`, returning the value it replaced.
    pub(crate) fn insert(&mut self, key: u32, value: V) -> Option<V> {
        match position(&self.keys, key) {
            Ok(index) => Some(core::mem::replace(&mut self.values[index], value)),
            Err(index) => {
                self.keys.insert(index, key);
                self.values.insert(index, value);
                None
            }
        }
    }

    pub(crate) fn remove(&mut self, key: &u32) -> Option<V> {
        let index = position(&self.keys, *key).ok()?;
        self.keys.remove(index);
        Some(self.values.remove(index))
    }

    /// Values in key order.
    pub(crate) fn values(&self) -> core::slice::Iter<'_, V> {
        self.values.iter()
    }
}

#[cfg(test)]
mod tests {
    use alloc::collections::BTreeMap;

    use super::IdMap;

    #[test]
    fn agrees_with_btree_map_over_a_seeded_operation_sequence() {
        let mut map = IdMap::default();
        let mut reference = BTreeMap::new();
        let mut state = 0x2545_f491_u32;
        for step in 0..20_000_u32 {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            let key = state % 64;
            match state % 3 {
                0 => assert_eq!(map.insert(key, step), reference.insert(key, step)),
                1 => assert_eq!(map.remove(&key), reference.remove(&key)),
                _ => {
                    if let (Some(value), Some(expected)) =
                        (map.get_mut(&key), reference.get_mut(&key))
                    {
                        *value += 1;
                        *expected += 1;
                    }
                }
            }
            assert_eq!(map.get(&key), reference.get(&key));
            assert_eq!(map.contains_key(&key), reference.contains_key(&key));
            assert_eq!(map.len(), reference.len());
        }
        assert!(map.values().eq(reference.values()));
    }
}
