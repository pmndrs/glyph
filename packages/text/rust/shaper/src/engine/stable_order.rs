//! Transactional fixed-chunk order storage for stable-indirect glyph records.

use alloc::vec::Vec;

pub const ORDER_CHUNK_RECORDS: u32 = 64;
const SCRATCH_NONE: u32 = u32::MAX;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct OrderEntry {
    pub stable_id: u32,
    pub record_slot: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ChunkState {
    slot: u32,
    len: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PendingChunk {
    pub slot: u32,
    pub len: u16,
    scratch_start: u32,
}

impl PendingChunk {
    pub const fn record_start(self) -> u32 {
        self.slot * ORDER_CHUNK_RECORDS
    }

    pub const fn changed(self) -> bool {
        self.scratch_start != SCRATCH_NONE
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChunkedOrderError {
    AllocationFailed,
    AlreadyPrepared,
    NotPrepared,
    ArithmeticOverflow,
    InvalidIdentity,
}

#[derive(Default)]
pub struct ChunkedOrder {
    chunks: Vec<ChunkState>,
    entries: Vec<OrderEntry>,
    free_chunks: Vec<u32>,
    pending_chunks: Vec<PendingChunk>,
    pending_entries: Vec<OrderEntry>,
    pending_retired: Vec<u32>,
    allocated_free_chunks: Vec<u32>,
    next_chunk_slot: u32,
    pending_next_chunk_slot: u32,
    capacity_chunks: u32,
    pending_capacity_chunks: u32,
    prepared: bool,
}

impl ChunkedOrder {
    pub fn prepare(&mut self, desired: &[OrderEntry]) -> Result<(), ChunkedOrderError> {
        if self.prepared {
            return Err(ChunkedOrderError::AlreadyPrepared);
        }
        let result = (|| {
            validate_desired(desired)?;
            self.pending_chunks.clear();
            self.pending_entries.clear();
            self.pending_retired.clear();
            self.allocated_free_chunks.clear();
            self.pending_next_chunk_slot = self.next_chunk_slot;
            self.pending_capacity_chunks = self.capacity_chunks;

            let old_len = self
                .chunks
                .iter()
                .try_fold(0_usize, |total, chunk| {
                    total.checked_add(usize::from(chunk.len))
                })
                .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
            let common_prefix = self.common_prefix(desired);
            let common_suffix = self.common_suffix(desired, common_prefix, old_len);

            let mut prefix_chunk_count = 0_usize;
            let mut prefix_entries = 0_usize;
            while let Some(chunk) = self.chunks.get(prefix_chunk_count) {
                let next = prefix_entries + usize::from(chunk.len);
                if next > common_prefix {
                    break;
                }
                prefix_entries = next;
                prefix_chunk_count += 1;
            }

            let old_changed_end = old_len - common_suffix;
            let mut suffix_chunk_start = self.chunks.len();
            let mut suffix_entries = 0_usize;
            let mut chunk_start = old_len;
            while suffix_chunk_start > prefix_chunk_count {
                let candidate = self.chunks[suffix_chunk_start - 1];
                chunk_start -= usize::from(candidate.len);
                if chunk_start < old_changed_end {
                    break;
                }
                suffix_chunk_start -= 1;
                suffix_entries += usize::from(candidate.len);
            }

            reserve(
                &mut self.pending_chunks,
                self.chunks.len().saturating_add(1),
            )?;
            for chunk in &self.chunks[..prefix_chunk_count] {
                self.pending_chunks.push(PendingChunk {
                    slot: chunk.slot,
                    len: chunk.len,
                    scratch_start: SCRATCH_NONE,
                });
            }

            let rebuild_end = desired
                .len()
                .checked_sub(suffix_entries)
                .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
            let rebuild = desired
                .get(prefix_entries..rebuild_end)
                .ok_or(ChunkedOrderError::InvalidIdentity)?;
            let old_rebuild_len = suffix_chunk_start - prefix_chunk_count;
            let required_chunks = rebuild.len().div_ceil(ORDER_CHUNK_RECORDS as usize);
            let mut rebuilt_offset = 0_usize;
            for index in 0..required_chunks {
                let remaining = rebuild.len() - rebuilt_offset;
                let remaining_chunks = required_chunks - index;
                let len = remaining.div_ceil(remaining_chunks);
                let next_offset = rebuilt_offset + len;
                let entries = &rebuild[rebuilt_offset..next_offset];
                let slot = if index < old_rebuild_len {
                    self.chunks[prefix_chunk_count + index].slot
                } else {
                    self.allocate_chunk()?
                };
                self.push_pending_chunk(slot, entries)?;
                rebuilt_offset = next_offset;
            }
            for index in required_chunks.min(old_rebuild_len)..old_rebuild_len {
                let slot = self.chunks[prefix_chunk_count + index].slot;
                reserve(&mut self.pending_retired, 1)?;
                self.pending_retired.push(slot);
            }

            for chunk in &self.chunks[suffix_chunk_start..] {
                self.pending_chunks.push(PendingChunk {
                    slot: chunk.slot,
                    len: chunk.len,
                    scratch_start: SCRATCH_NONE,
                });
            }
            self.grow_capacity()?;
            if self.pending_capacity_chunks != self.capacity_chunks {
                self.mark_every_chunk_changed()?;
            }
            self.prepared = true;
            Ok(())
        })();
        if result.is_err() {
            self.abort();
        }
        result
    }

    pub fn pending_chunks(&self) -> Result<&[PendingChunk], ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        Ok(&self.pending_chunks)
    }

    pub fn entries(&self, chunk: PendingChunk) -> Result<&[OrderEntry], ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        let len = usize::from(chunk.len);
        if chunk.changed() {
            let start = chunk.scratch_start as usize;
            return self
                .pending_entries
                .get(start..start + len)
                .ok_or(ChunkedOrderError::InvalidIdentity);
        }
        self.committed_entries(chunk.slot, chunk.len)
    }

    pub fn retired_chunks(&self) -> Result<&[u32], ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        Ok(&self.pending_retired)
    }

    /// Makes consumer-acknowledged chunk slots available to a later transaction.
    ///
    /// Retired chunks deliberately do not enter the free list during `commit`: the consumer may
    /// still be reading an older publication. The owner calls this only after that publication's
    /// retirement fence has been acknowledged.
    pub fn reclaim_chunks(&mut self, chunks: &[u32]) -> Result<(), ChunkedOrderError> {
        if self.prepared {
            return Err(ChunkedOrderError::AlreadyPrepared);
        }
        for &slot in chunks {
            if slot >= self.next_chunk_slot
                || self.chunks.iter().any(|chunk| chunk.slot == slot)
                || self.free_chunks.contains(&slot)
            {
                return Err(ChunkedOrderError::InvalidIdentity);
            }
        }
        reserve(&mut self.free_chunks, chunks.len())?;
        self.free_chunks.extend_from_slice(chunks);
        Ok(())
    }

    pub fn capacity_records(&self) -> Result<u32, ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        self.pending_capacity_chunks
            .checked_mul(ORDER_CHUNK_RECORDS)
            .ok_or(ChunkedOrderError::ArithmeticOverflow)
    }

    pub fn grew(&self) -> Result<bool, ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        Ok(self.pending_capacity_chunks != self.capacity_chunks)
    }

    pub fn commit(&mut self) -> Result<(), ChunkedOrderError> {
        if !self.prepared {
            return Err(ChunkedOrderError::NotPrepared);
        }
        let required = usize::try_from(self.pending_capacity_chunks)
            .ok()
            .and_then(|chunks| chunks.checked_mul(ORDER_CHUNK_RECORDS as usize))
            .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
        let additional = required.saturating_sub(self.entries.len());
        reserve(&mut self.entries, additional)?;
        self.entries.resize(required, OrderEntry::default());
        for chunk in self
            .pending_chunks
            .iter()
            .copied()
            .filter(|chunk| chunk.changed())
        {
            let source_start = chunk.scratch_start as usize;
            let destination_start = chunk.record_start() as usize;
            let len = usize::from(chunk.len);
            let source = self
                .pending_entries
                .get(source_start..source_start + len)
                .ok_or(ChunkedOrderError::InvalidIdentity)?;
            let destination = self
                .entries
                .get_mut(destination_start..destination_start + len)
                .ok_or(ChunkedOrderError::InvalidIdentity)?;
            destination.copy_from_slice(source);
        }
        self.chunks.clear();
        reserve(&mut self.chunks, self.pending_chunks.len())?;
        self.chunks
            .extend(self.pending_chunks.iter().map(|chunk| ChunkState {
                slot: chunk.slot,
                len: chunk.len,
            }));
        self.next_chunk_slot = self.pending_next_chunk_slot;
        self.capacity_chunks = self.pending_capacity_chunks;
        self.pending_chunks.clear();
        self.pending_entries.clear();
        self.pending_retired.clear();
        self.allocated_free_chunks.clear();
        self.prepared = false;
        Ok(())
    }

    pub fn abort(&mut self) {
        for slot in self.allocated_free_chunks.drain(..) {
            self.free_chunks.push(slot);
        }
        self.pending_chunks.clear();
        self.pending_entries.clear();
        self.pending_retired.clear();
        self.prepared = false;
    }

    fn common_prefix(&self, desired: &[OrderEntry]) -> usize {
        let mut matched = 0_usize;
        for chunk in &self.chunks {
            let Ok(entries) = self.committed_entries(chunk.slot, chunk.len) else {
                return matched;
            };
            for entry in entries {
                if desired.get(matched) != Some(entry) {
                    return matched;
                }
                matched += 1;
            }
        }
        matched
    }

    fn common_suffix(&self, desired: &[OrderEntry], prefix: usize, old_len: usize) -> usize {
        let mut matched = 0_usize;
        for chunk in self.chunks.iter().rev() {
            let Ok(entries) = self.committed_entries(chunk.slot, chunk.len) else {
                return matched;
            };
            for entry in entries.iter().rev() {
                if prefix + matched >= old_len.min(desired.len())
                    || desired.get(desired.len() - 1 - matched) != Some(entry)
                {
                    return matched;
                }
                matched += 1;
            }
        }
        matched
    }

    fn committed_entries(&self, slot: u32, len: u16) -> Result<&[OrderEntry], ChunkedOrderError> {
        let start = usize::try_from(slot)
            .ok()
            .and_then(|slot| slot.checked_mul(ORDER_CHUNK_RECORDS as usize))
            .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
        self.entries
            .get(start..start + usize::from(len))
            .ok_or(ChunkedOrderError::InvalidIdentity)
    }

    fn allocate_chunk(&mut self) -> Result<u32, ChunkedOrderError> {
        if let Some(slot) = self.free_chunks.pop() {
            reserve(&mut self.allocated_free_chunks, 1)?;
            self.allocated_free_chunks.push(slot);
            return Ok(slot);
        }
        let slot = self.pending_next_chunk_slot;
        self.pending_next_chunk_slot = self
            .pending_next_chunk_slot
            .checked_add(1)
            .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
        Ok(slot)
    }

    fn push_pending_chunk(
        &mut self,
        slot: u32,
        entries: &[OrderEntry],
    ) -> Result<(), ChunkedOrderError> {
        let len =
            u16::try_from(entries.len()).map_err(|_| ChunkedOrderError::ArithmeticOverflow)?;
        let unchanged = self
            .chunks
            .iter()
            .find(|chunk| chunk.slot == slot && chunk.len == len)
            .and_then(|chunk| self.committed_entries(chunk.slot, chunk.len).ok())
            == Some(entries);
        let scratch_start = if unchanged {
            SCRATCH_NONE
        } else {
            let start = u32::try_from(self.pending_entries.len())
                .map_err(|_| ChunkedOrderError::ArithmeticOverflow)?;
            reserve(&mut self.pending_entries, entries.len())?;
            self.pending_entries.extend_from_slice(entries);
            start
        };
        self.pending_chunks.push(PendingChunk {
            slot,
            len,
            scratch_start,
        });
        Ok(())
    }

    fn grow_capacity(&mut self) -> Result<(), ChunkedOrderError> {
        if self.pending_next_chunk_slot == 0 {
            self.pending_capacity_chunks = 0;
            return Ok(());
        }
        let mut capacity = self.pending_capacity_chunks.max(1);
        while capacity < self.pending_next_chunk_slot {
            capacity = capacity
                .checked_mul(2)
                .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
        }
        self.pending_capacity_chunks = capacity;
        Ok(())
    }

    fn mark_every_chunk_changed(&mut self) -> Result<(), ChunkedOrderError> {
        for index in 0..self.pending_chunks.len() {
            if self.pending_chunks[index].changed() {
                continue;
            }
            let chunk = self.pending_chunks[index];
            let committed_start = usize::try_from(chunk.slot)
                .ok()
                .and_then(|slot| slot.checked_mul(ORDER_CHUNK_RECORDS as usize))
                .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
            let committed_end = committed_start
                .checked_add(usize::from(chunk.len))
                .ok_or(ChunkedOrderError::ArithmeticOverflow)?;
            if committed_end > self.entries.len() {
                return Err(ChunkedOrderError::InvalidIdentity);
            }
            let start = u32::try_from(self.pending_entries.len())
                .map_err(|_| ChunkedOrderError::ArithmeticOverflow)?;
            reserve(&mut self.pending_entries, usize::from(chunk.len))?;
            let entries = &self.entries[committed_start..committed_end];
            self.pending_entries.extend_from_slice(entries);
            self.pending_chunks[index].scratch_start = start;
        }
        Ok(())
    }
}

fn validate_desired(desired: &[OrderEntry]) -> Result<(), ChunkedOrderError> {
    if desired
        .iter()
        .any(|entry| entry.stable_id == 0 || entry.record_slot == u32::MAX)
    {
        return Err(ChunkedOrderError::InvalidIdentity);
    }
    Ok(())
}

fn reserve<T>(values: &mut Vec<T>, additional: usize) -> Result<(), ChunkedOrderError> {
    values
        .try_reserve(additional)
        .map_err(|_| ChunkedOrderError::AllocationFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn localized_insert_rewrites_one_chunk_until_it_splits() {
        let mut order = ChunkedOrder::default();
        let initial: Vec<_> = (1..=64).map(entry).collect();
        order.prepare(&initial).unwrap();
        assert!(order.grew().unwrap());
        assert_eq!(order.capacity_records().unwrap(), 64);
        assert_eq!(changed_chunks(&order), vec![0]);
        order.commit().unwrap();

        let mut inserted = initial.clone();
        inserted.insert(
            32,
            OrderEntry {
                stable_id: 100,
                record_slot: 100,
            },
        );
        order.prepare(&inserted).unwrap();
        assert_eq!(order.pending_chunks().unwrap().len(), 2);
        assert_eq!(changed_chunks(&order), vec![0, 1]);
        assert_eq!(flatten(&order), inserted);
    }

    #[test]
    fn insertion_at_a_chunk_boundary_preserves_both_neighbor_chunks() {
        let mut order = ChunkedOrder::default();
        // Establish spare physical capacity so this assertion measures order reconciliation rather
        // than the intentionally full rewrite required by an order-buffer resize.
        let capacity_seed: Vec<_> = (1..=129).map(entry).collect();
        order.prepare(&capacity_seed).unwrap();
        order.commit().unwrap();
        let initial: Vec<_> = (1..=128).map(entry).collect();
        order.prepare(&initial).unwrap();
        order.commit().unwrap();

        let mut inserted = initial.clone();
        inserted.insert(
            64,
            OrderEntry {
                stable_id: 200,
                record_slot: 200,
            },
        );
        order.prepare(&inserted).unwrap();
        assert_eq!(order.pending_chunks().unwrap().len(), 3);
        assert_eq!(changed_chunks(&order).len(), 1);
        assert_eq!(flatten(&order), inserted);
    }

    #[test]
    fn deletion_retires_unused_chunks_and_abort_preserves_committed_order() {
        let mut order = ChunkedOrder::default();
        let initial: Vec<_> = (1..=128).map(entry).collect();
        order.prepare(&initial).unwrap();
        order.commit().unwrap();

        let shortened = &initial[..32];
        order.prepare(shortened).unwrap();
        assert_eq!(order.retired_chunks().unwrap().len(), 1);
        order.abort();
        order.prepare(&initial).unwrap();
        assert!(changed_chunks(&order).is_empty());
        assert_eq!(flatten(&order), initial);
    }

    #[test]
    fn retired_chunks_are_reused_only_after_explicit_reclamation() {
        let mut order = ChunkedOrder::default();
        let initial: Vec<_> = (1..=128).map(entry).collect();
        order.prepare(&initial).unwrap();
        order.commit().unwrap();

        order.prepare(&initial[..32]).unwrap();
        let retired = order.retired_chunks().unwrap().to_vec();
        assert_eq!(retired.len(), 1);
        order.commit().unwrap();

        let expanded: Vec<_> = (1..=96).map(entry).collect();
        order.prepare(&expanded).unwrap();
        let allocated_before_ack = order.pending_chunks().unwrap()[1].slot;
        order.abort();
        assert_ne!(allocated_before_ack, retired[0]);

        order.reclaim_chunks(&retired).unwrap();
        order.prepare(&expanded).unwrap();
        assert_eq!(order.pending_chunks().unwrap()[1].slot, retired[0]);
    }

    #[test]
    fn arbitrary_reorder_is_correct_even_when_it_rewrites_every_chunk() {
        let mut order = ChunkedOrder::default();
        let initial: Vec<_> = (1..=130).map(entry).collect();
        order.prepare(&initial).unwrap();
        order.commit().unwrap();
        let mut reversed = initial.clone();
        reversed.reverse();
        order.prepare(&reversed).unwrap();
        assert_eq!(flatten(&order), reversed);
        assert_eq!(changed_chunks(&order).len(), 3);
    }

    fn entry(stable_id: u32) -> OrderEntry {
        OrderEntry {
            stable_id,
            record_slot: stable_id - 1,
        }
    }

    fn changed_chunks(order: &ChunkedOrder) -> Vec<u32> {
        order
            .pending_chunks()
            .unwrap()
            .iter()
            .copied()
            .filter(|chunk| chunk.changed())
            .map(|chunk| chunk.slot)
            .collect()
    }

    fn flatten(order: &ChunkedOrder) -> Vec<OrderEntry> {
        let mut entries = Vec::new();
        for chunk in order.pending_chunks().unwrap().iter().copied() {
            entries.extend_from_slice(order.entries(chunk).unwrap());
        }
        entries
    }
}
