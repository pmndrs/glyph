//! Host-ownership primitives every baker's Wasm boundary shares: the table of byte buffers the
//! host may read or write, the published result, the module's single state, and an allocation
//! counter for evidence builds.
//!
//! The host names memory only by `(pointer, length)` pairs this table handed out. Every lookup
//! requires the exact pair, so a forged, stale or resized range is refused rather than trusted.

#![no_std]

extern crate alloc;

use alloc::{boxed::Box, vec::Vec};
use core::{
    alloc::{GlobalAlloc, Layout},
    marker::PhantomData,
    sync::atomic::{AtomicUsize, Ordering},
};

/// One buffer the host owns a view of.
struct Allocation {
    pointer: u32,
    length: u32,
    bytes: Vec<u8>,
}

/// The buffers lent to the host, and the one published as the current result.
#[derive(Default)]
pub struct AllocationTable {
    allocations: Vec<Allocation>,
    result_pointer: u32,
    result_length: u32,
}

impl AllocationTable {
    /// Lends a zeroed buffer of `length` bytes, or returns 0 when the length is zero, above
    /// `max_length`, or cannot be allocated.
    pub fn allocate(&mut self, length: u32, max_length: u32) -> u32 {
        if length == 0 || length > max_length || self.allocations.try_reserve(1).is_err() {
            return 0;
        }
        let mut bytes = Vec::new();
        if bytes.try_reserve_exact(length as usize).is_err() {
            return 0;
        }
        bytes.resize(length as usize, 0);
        self.adopt(bytes).map_or(0, |(pointer, _)| pointer)
    }

    /// Takes ownership of `bytes` and lends them to the host. Refuses an empty buffer, an
    /// address outside `u32`, and a pointer already lent.
    pub fn adopt(&mut self, mut bytes: Vec<u8>) -> Option<(u32, u32)> {
        let length = u32::try_from(bytes.len()).ok()?;
        if length == 0 || self.allocations.try_reserve(1).is_err() {
            return None;
        }
        let pointer = u32::try_from(bytes.as_mut_ptr() as usize).ok()?;
        if pointer == 0
            || self
                .allocations
                .iter()
                .any(|allocation| allocation.pointer == pointer)
        {
            return None;
        }
        self.allocations.push(Allocation {
            pointer,
            length,
            bytes,
        });
        Some((pointer, length))
    }

    /// Releases the buffer lent as exactly `(pointer, length)`; any other pair is ignored.
    /// Releasing the published result unpublishes it.
    pub fn deallocate(&mut self, pointer: u32, length: u32) {
        if let Some(index) = self
            .allocations
            .iter()
            .position(|allocation| allocation.pointer == pointer && allocation.length == length)
        {
            self.allocations.swap_remove(index);
            if self.result_pointer == pointer {
                self.result_pointer = 0;
                self.result_length = 0;
            }
        }
    }

    /// The bytes lent as exactly `(pointer, length)`.
    pub fn owned_bytes(&self, pointer: u32, length: u32) -> Option<&[u8]> {
        self.allocations
            .iter()
            .find(|allocation| allocation.pointer == pointer && allocation.length == length)
            .map(|allocation| allocation.bytes.as_slice())
    }

    /// Like `owned_bytes`, with `(0, 0)` naming the empty input.
    pub fn owned_bytes_or_empty(&self, pointer: u32, length: u32) -> Option<&[u8]> {
        if length == 0 {
            return (pointer == 0).then_some(&[]);
        }
        self.owned_bytes(pointer, length)
    }

    /// Lends `bytes` as the new published result and returns its pointer, or unpublishes and
    /// returns 0 when they cannot be lent.
    pub fn publish(&mut self, bytes: Vec<u8>) -> u32 {
        self.unpublish();
        let Some((pointer, length)) = self.adopt(bytes) else {
            return 0;
        };
        self.result_pointer = pointer;
        self.result_length = length;
        pointer
    }

    /// Forgets the published result; its buffer stays lent until the host releases it.
    pub fn unpublish(&mut self) {
        self.result_pointer = 0;
        self.result_length = 0;
    }

    pub fn result_pointer(&self) -> u32 {
        self.result_pointer
    }

    pub fn result_length(&self) -> u32 {
        self.result_length
    }
}

/// A module's one state, created on first use and never freed.
pub struct WasmSingleton<T> {
    pointer: AtomicUsize,
    _state: PhantomData<fn() -> T>,
}

impl<T: Default> WasmSingleton<T> {
    pub const fn new() -> Self {
        Self {
            pointer: AtomicUsize::new(0),
            _state: PhantomData,
        }
    }

    /// Runs `operation` on the state.
    ///
    /// Callers are the module's exported entry points on a single-threaded Wasm host, which do
    /// not re-enter one another, so at most one `&mut T` is live at a time.
    pub fn with<R>(&self, operation: impl FnOnce(&mut T) -> R) -> R {
        let mut pointer = self.pointer.load(Ordering::Acquire);
        if pointer == 0 {
            let candidate = Box::into_raw(Box::<T>::default()) as usize;
            match self
                .pointer
                .compare_exchange(0, candidate, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => pointer = candidate,
                Err(existing) => {
                    // SAFETY: this allocation was never published because another caller won
                    // initialization, so this is its only owner.
                    drop(unsafe { Box::from_raw(candidate as *mut T) });
                    pointer = existing;
                }
            }
        }
        // SAFETY: the pointer came from `Box::into_raw` of a `T`, is published once and never
        // freed, and the single-threaded, non-reentrant host makes this the only live borrow.
        operation(unsafe { &mut *(pointer as *mut T) })
    }
}

impl<T: Default> Default for WasmSingleton<T> {
    fn default() -> Self {
        Self::new()
    }
}

/// Writes `value` little-endian at `offset`. The caller sized `bytes` for its header.
pub fn write_u32_le(bytes: &mut [u8], offset: usize, value: u32) {
    let encoded = value.to_le_bytes();
    bytes[offset..offset + encoded.len()].copy_from_slice(&encoded);
}

/// The length of a header, metadata and artifact response, when it fits `max` and `u32`.
pub fn response_total_length(
    max: usize,
    header: usize,
    metadata: usize,
    artifact: usize,
) -> Option<usize> {
    let total = header.checked_add(metadata)?.checked_add(artifact)?;
    (total <= max && u32::try_from(total).is_ok()).then_some(total)
}

/// A global allocator that counts the calls it forwards, for allocation-evidence builds.
pub struct CountingAllocator<A> {
    backing: A,
    allocations: AtomicUsize,
    reallocations: AtomicUsize,
    deallocations: AtomicUsize,
}

impl<A> CountingAllocator<A> {
    pub const fn new(backing: A) -> Self {
        Self {
            backing,
            allocations: AtomicUsize::new(0),
            reallocations: AtomicUsize::new(0),
            deallocations: AtomicUsize::new(0),
        }
    }

    pub fn reset(&self) {
        self.allocations.store(0, Ordering::Relaxed);
        self.reallocations.store(0, Ordering::Relaxed);
        self.deallocations.store(0, Ordering::Relaxed);
    }

    pub fn allocations(&self) -> usize {
        self.allocations.load(Ordering::Relaxed)
    }

    pub fn reallocations(&self) -> usize {
        self.reallocations.load(Ordering::Relaxed)
    }

    pub fn deallocations(&self) -> usize {
        self.deallocations.load(Ordering::Relaxed)
    }
}

// SAFETY: every method forwards the allocator contract and exact arguments to `backing`.
unsafe impl<A: GlobalAlloc> GlobalAlloc for CountingAllocator<A> {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        self.allocations.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the caller upholds `GlobalAlloc::alloc`'s contract for `layout`.
        unsafe { self.backing.alloc(layout) }
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        self.deallocations.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from this allocator, so from `backing`.
        unsafe { self.backing.dealloc(pointer, layout) };
    }

    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        self.reallocations.fetch_add(1, Ordering::Relaxed);
        // SAFETY: the pointer and layout came from `backing`; new_size is forwarded unchanged.
        unsafe { self.backing.realloc(pointer, layout, new_size) }
    }
}

// Lending needs 32-bit addresses, so the round trips are covered by each baker's Wasm ABI tests;
// natively only the refusals are observable.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_empty_oversized_and_unlent_ranges() {
        let mut table = AllocationTable::default();
        assert_eq!(table.allocate(0, 16), 0);
        assert_eq!(table.allocate(17, 16), 0);
        assert_eq!(table.owned_bytes(8, 8), None);
        assert_eq!(table.owned_bytes_or_empty(0, 0), Some(&[][..]));
        assert_eq!(table.owned_bytes_or_empty(4, 0), None);
        assert_eq!(table.owned_bytes(0, 0), None);
        assert_eq!(table.publish(Vec::new()), 0);
        assert_eq!((table.result_pointer(), table.result_length()), (0, 0));
    }
}
