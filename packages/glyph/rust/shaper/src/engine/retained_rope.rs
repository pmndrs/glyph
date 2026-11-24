//! Persistent chunked storage for retained layout records.
//!
//! The tree owns copy-on-write leaf chunks behind `Arc`; shared nodes are never mutated.
//! Splicing a range therefore retains complete interior chunks and copies only the two
//! boundary chunks. Interior summaries
//! carry both record and fragment counts plus source-coordinate coverage, so callers can
//! navigate in either coordinate without flattening the tree.
//!
//! The tree is type-erased: one `Node` serves every record type, and a leaf stores its
//! records as bytes at the type's stride beside a `RecordKind` that summarises them. The
//! structural algorithms (split, join, balance, append, point and ordered update) are
//! therefore compiled once, not once per record type. `RetainedRope<T>` is the typed shell:
//! it converts records to bytes on the way in and borrows leaves as `&[T]` on the read
//! paths (iteration, cursors, point lookup), which stay specialised per record type.

use crate::cold_growth::ColdGrowth as _;

use alloc::{sync::Arc, vec::Vec};
#[cfg(test)]
use core::fmt;
use core::{
    iter::FusedIterator,
    marker::PhantomData,
    mem::{MaybeUninit, align_of, size_of},
    ops::Range,
};

pub(crate) const LEAF_CAPACITY: usize = 32;
const MAX_HEIGHT: usize = usize::BITS as usize + 1;
/// Largest record the tree stores. An ordered update stages one candidate record in a stack
/// buffer of this size.
const MAX_RECORD_BYTES: usize = 256;
const WORD_BYTES: usize = size_of::<u64>();

type Word = MaybeUninit<u64>;
type Byte = MaybeUninit<u8>;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct RopeSummary {
    pub records: usize,
    pub fragments: usize,
    pub source_start: u32,
    pub source_end: u32,
    pub has_source: bool,
}

impl RopeSummary {
    pub(crate) fn combine(self, right: Self) -> Option<Self> {
        let (source_start, source_end, has_source) = match (self.has_source, right.has_source) {
            (false, false) => (0, 0, false),
            (true, false) => (self.source_start, self.source_end, true),
            (false, true) => (right.source_start, right.source_end, true),
            (true, true) => (
                self.source_start.min(right.source_start),
                self.source_end.max(right.source_end),
                true,
            ),
        };
        Some(Self {
            records: self.records.checked_add(right.records)?,
            fragments: self.fragments.checked_add(right.fragments)?,
            source_start,
            source_end,
            has_source,
        })
    }

    fn contains_source(self, offset: u32) -> bool {
        self.has_source && self.source_start <= offset && offset < self.source_end
    }
}

pub(crate) trait RopeRecord: Copy + 'static {
    /// Summarizes exactly one stored record. Implementations are package-owned;
    /// `records` must therefore be one.
    fn rope_summary(&self) -> RopeSummary;
}

/// What the type-erased tree needs from one record type: its stride, and how to summarise a
/// run of a leaf's records.
struct RecordKind {
    size: usize,
    summarize: fn(&Leaf, Range<usize>) -> Option<RopeSummary>,
}

struct KindOf<T>(PhantomData<T>);

impl<T: RopeRecord> KindOf<T> {
    const KIND: &'static RecordKind = &RecordKind {
        size: {
            assert!(align_of::<T>() <= align_of::<u64>());
            assert!(size_of::<T>() != 0 && size_of::<T>() <= MAX_RECORD_BYTES);
            size_of::<T>()
        },
        summarize: summarize_leaf::<T>,
    };
}

fn summarize_leaf<T: RopeRecord>(leaf: &Leaf, range: Range<usize>) -> Option<RopeSummary> {
    summarize(leaf.records::<T>().get(range)?)
}

/// The bytes of a record slice. Padding is uninitialised, which `MaybeUninit` admits.
fn record_bytes<T: RopeRecord>(records: &[T]) -> &[Byte] {
    // SAFETY: the view covers exactly the slice's `size_of_val` bytes, lives as long as the
    // borrow, and reads nothing: every byte is `MaybeUninit<u8>`, which has no validity
    // requirement and alignment one.
    unsafe {
        core::slice::from_raw_parts(
            records.as_ptr().cast::<Byte>(),
            core::mem::size_of_val(records),
        )
    }
}

/// One leaf's records, packed at their kind's stride from the start of `u64` words, so every
/// record type `KindOf` admits is aligned. Only `RetainedRope<T>` writes records, and every
/// node reachable from a `RetainedRope<T>` holds records of `T` written from values of `T`:
/// that module invariant is what makes the typed view `records` sound.
struct Leaf {
    kind: &'static RecordKind,
    words: Vec<Word>,
    len: usize,
}

impl Leaf {
    fn empty(kind: &'static RecordKind) -> Self {
        Self {
            kind,
            words: Vec::new(),
            len: 0,
        }
    }

    fn with_capacity(kind: &'static RecordKind, records: usize) -> Result<Self, ()> {
        let mut leaf = Self::empty(kind);
        leaf.reserve_exact(records)?;
        Ok(leaf)
    }

    fn copy_of(kind: &'static RecordKind, records: &[Byte]) -> Result<Self, ()> {
        let mut leaf = Self::with_capacity(kind, records.len() / kind.size)?;
        leaf.extend(records)?;
        Ok(leaf)
    }

    fn len(&self) -> usize {
        self.len
    }

    fn capacity(&self) -> usize {
        self.words.capacity() * WORD_BYTES / self.kind.size
    }

    fn words_for(&self, records: usize) -> Result<usize, ()> {
        records
            .checked_mul(self.kind.size)
            .map(|bytes| bytes.div_ceil(WORD_BYTES))
            .ok_or(())
    }

    fn reserve_exact(&mut self, additional: usize) -> Result<(), ()> {
        let words = self.words_for(self.len.checked_add(additional).ok_or(())?)?;
        self.words
            .try_reserve_exact_cold(words.saturating_sub(self.words.len()))
            .map_err(|_| ())
    }

    /// Grows as `Vec::try_reserve` does, at least doubling, so repeated pushes stay amortised.
    fn reserve(&mut self, additional: usize) -> Result<(), ()> {
        let required = self.len.checked_add(additional).ok_or(())?;
        let capacity = self.capacity();
        if required <= capacity {
            return Ok(());
        }
        self.reserve_exact(required.max(capacity.saturating_mul(2)).max(4) - self.len)
    }

    fn bytes(&self) -> &[Byte] {
        // SAFETY: `words` owns `words.len()` initialised `MaybeUninit<u64>` slots; the view
        // covers exactly their bytes for the borrow's lifetime and reads nothing, since every
        // byte is `MaybeUninit<u8>`.
        let bytes = unsafe {
            core::slice::from_raw_parts(
                self.words.as_ptr().cast::<Byte>(),
                self.words.len() * WORD_BYTES,
            )
        };
        &bytes[..self.len * self.kind.size]
    }

    fn bytes_mut(&mut self) -> &mut [Byte] {
        let len = self.len * self.kind.size;
        // SAFETY: as in `bytes`, over the uniquely borrowed `words`; writing `MaybeUninit`
        // bytes cannot break the `MaybeUninit<u64>` slots they belong to.
        let bytes = unsafe {
            core::slice::from_raw_parts_mut(
                self.words.as_mut_ptr().cast::<Byte>(),
                self.words.len() * WORD_BYTES,
            )
        };
        &mut bytes[..len]
    }

    /// Appends whole records' bytes, growing like `Vec::try_reserve`.
    fn extend(&mut self, records: &[Byte]) -> Result<(), ()> {
        debug_assert!(records.len().is_multiple_of(self.kind.size));
        self.reserve(records.len() / self.kind.size)?;
        let start = self.len * self.kind.size;
        let end = start + records.len();
        self.words
            .resize(end.div_ceil(WORD_BYTES), MaybeUninit::uninit());
        self.len += records.len() / self.kind.size;
        self.bytes_mut()[start..end].copy_from_slice(records);
        Ok(())
    }

    fn push<T: RopeRecord>(&mut self, record: T) -> Result<(), ()> {
        debug_assert_eq!(self.kind.size, size_of::<T>());
        self.reserve(1)?;
        let start = self.len * size_of::<T>();
        let end = start + size_of::<T>();
        self.words
            .resize(end.div_ceil(WORD_BYTES), MaybeUninit::uninit());
        self.len += 1;
        self.bytes_mut()[start..end].copy_from_slice(record_bytes(core::slice::from_ref(&record)));
        Ok(())
    }

    /// Overwrites record `index` with `record`; a copy of statically known size.
    fn set_record<T: RopeRecord>(&mut self, index: usize, record: &T) -> Option<()> {
        debug_assert_eq!(self.kind.size, size_of::<T>());
        let start = index.checked_mul(size_of::<T>())?;
        self.bytes_mut()
            .get_mut(start..start.checked_add(size_of::<T>())?)?
            .copy_from_slice(record_bytes(core::slice::from_ref(record)));
        Some(())
    }

    fn record_mut(&mut self, index: usize) -> Option<&mut [Byte]> {
        let size = self.kind.size;
        self.bytes_mut()
            .get_mut(index.checked_mul(size)?..index.checked_add(1)?.checked_mul(size)?)
    }

    fn clear(&mut self) {
        self.words.clear();
        self.len = 0;
    }

    fn summary(&self, range: Range<usize>) -> Option<RopeSummary> {
        (self.kind.summarize)(self, range)
    }

    /// The leaf's records as `T`. Only for a leaf reachable from a `RetainedRope<T>`.
    fn records<T: RopeRecord>(&self) -> &[T] {
        debug_assert_eq!(self.kind.size, size_of::<T>());
        // SAFETY: by the module invariant on `Leaf`, the first `len * size_of::<T>()` bytes
        // are `len` records of `T` copied from values of `T`. They start a `u64`-aligned
        // allocation and `KindOf<T>` proves `align_of::<T>() <= align_of::<u64>()`, so every
        // record is aligned; the borrow of `self` keeps the words alive and unmodified.
        unsafe { core::slice::from_raw_parts(self.words.as_ptr().cast::<T>(), self.len) }
    }
}

enum Node {
    Leaf {
        leaf: Leaf,
        summary: RopeSummary,
    },
    Branch {
        left: Arc<Self>,
        right: Arc<Self>,
        height: u8,
        summary: RopeSummary,
    },
}

type Root = Option<Arc<Node>>;
type SplitNodes = (Root, Root);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RopeEditError<E> {
    Storage,
    Callback(E),
}

/// A stopped ordered update adopts its successful prefix and leaves the remaining rows shared.
pub(crate) enum RopeUpdate<T> {
    Keep,
    Replace(T),
    // Only the test-only Flat gather stops an update; production callers keep or replace.
    #[cfg_attr(not(test), allow(dead_code))]
    Stop,
}

/// An erased edit failure. The typed shell holds the callback's own error.
#[derive(Clone, Copy)]
enum Failure {
    Storage,
    Callback,
}

impl Failure {
    fn into_edit_error<E>(self, callback: Option<E>) -> RopeEditError<E> {
        match (self, callback) {
            (Self::Callback, Some(error)) => RopeEditError::Callback(error),
            _ => RopeEditError::Storage,
        }
    }
}

impl Node {
    fn summary(&self) -> RopeSummary {
        match self {
            Self::Leaf { summary, .. } | Self::Branch { summary, .. } => *summary,
        }
    }

    fn height(&self) -> u8 {
        match self {
            Self::Leaf { .. } => 1,
            Self::Branch { height, .. } => *height,
        }
    }
}

pub(crate) struct RetainedRope<T: RopeRecord> {
    root: Root,
    records: PhantomData<T>,
}

impl<T: RopeRecord> Clone for RetainedRope<T> {
    fn clone(&self) -> Self {
        Self::with_root(self.root.clone())
    }
}

impl<T: RopeRecord> Default for RetainedRope<T> {
    fn default() -> Self {
        Self::with_root(None)
    }
}

impl<T: RopeRecord> RetainedRope<T> {
    const fn with_root(root: Root) -> Self {
        Self {
            root,
            records: PhantomData,
        }
    }

    /// Constructs a packed, balanced root from exactly `count` records in storage order.
    /// A failed producer or summary leaves no published root.
    pub(crate) fn try_from_exact<E>(
        count: usize,
        mut produce: impl FnMut(usize) -> Result<T, E>,
    ) -> Result<Self, RopeEditError<E>> {
        if count == 0 {
            return Ok(Self::default());
        }
        let leaf_count = count / LEAF_CAPACITY + usize::from(!count.is_multiple_of(LEAF_CAPACITY));
        let mut failure = None;
        let root = build_exact_node(
            KindOf::<T>::KIND,
            count,
            0..leaf_count,
            &mut |leaf, records| {
                for index in records {
                    let record = produce(index).map_err(|error| {
                        failure = Some(error);
                        Failure::Callback
                    })?;
                    leaf.push(record).map_err(|()| Failure::Storage)?;
                }
                Ok(())
            },
        );
        match root {
            Ok(root) => Ok(Self::with_root(Some(root))),
            Err(error) => Err(error.into_edit_error(failure)),
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.summary().records
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Whether this root has the exact leaf partitions and midpoint tree of `try_from_exact`.
    pub(crate) fn is_exact_shape(&self) -> bool {
        is_exact_shape(self.root.as_deref())
    }

    pub(crate) fn summary(&self) -> RopeSummary {
        self.root.as_deref().map(Node::summary).unwrap_or_default()
    }

    pub(crate) fn clear(&mut self) {
        clear_root(&mut self.root);
    }

    #[cfg(test)]
    fn try_from_vec(items: Vec<T>) -> Result<Self, ()> {
        let mut rope = Self::default();
        rope.append_records(&items)?;
        Ok(rope)
    }

    /// Appends packed leaves, adopting the candidate root only after every chunk succeeds.
    pub(crate) fn append_records(&mut self, items: &[T]) -> Result<(), ()> {
        if items.is_empty() {
            return Ok(());
        }
        let fitting = self
            .root
            .as_deref()
            .map_or(0, rightmost_leaf_space)
            .min(items.len());
        let fitting_summary = summarize(&items[..fitting]).ok_or(())?;
        append_records(
            &mut self.root,
            KindOf::<T>::KIND,
            record_bytes(items),
            fitting,
            fitting_summary,
        )
    }

    pub(crate) fn push(&mut self, item: T) -> Result<(), ()> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.rope_record_pushes += 1);
        push_record(
            &mut self.root,
            KindOf::<T>::KIND,
            record_bytes(core::slice::from_ref(&item)),
            item.rope_summary(),
        )
    }

    pub(crate) fn truncate(&mut self, len: usize) -> Result<(), ()> {
        truncate_root(&mut self.root, len)
    }

    pub(crate) fn append_shared_range(
        &mut self,
        source: &Self,
        range: Range<usize>,
    ) -> Result<bool, ()> {
        append_shared_range(&mut self.root, source.root.as_ref(), range)
    }

    /// Atomically replaces an ordered interval, sharing untouched chunks.
    pub(crate) fn replace_range(
        &mut self,
        range: Range<usize>,
        replacement: &Self,
    ) -> Result<bool, ()> {
        replace_range(&mut self.root, range, replacement.root.as_ref())
    }

    pub(crate) fn get(&self, index: usize) -> Option<&T> {
        record_index_lookup();
        get_record(self.root.as_deref()?, index)
    }

    pub(crate) fn update(&mut self, index: usize, update: impl FnOnce(&mut T)) -> Result<bool, ()> {
        let Some(current) = self
            .root
            .as_deref()
            .and_then(|root| get_record::<T>(root, index))
            .copied()
        else {
            return Ok(false);
        };
        let mut candidate = current;
        update(&mut candidate);
        update_record(
            &mut self.root,
            index,
            record_bytes(core::slice::from_ref(&candidate)),
            candidate.rope_summary(),
        )
    }

    /// Visits a record range once in storage order and transactionally replaces records
    /// selected by `update`. Unchanged leaves remain shared; changed leaves and their branch
    /// paths are copied once regardless of how many records in that leaf change. Stop adopts
    /// the successful prefix; callback or storage failure leaves the whole root unchanged.
    pub(crate) fn update_ordered<E>(
        &mut self,
        range: Range<usize>,
        update: impl FnMut(usize, &T) -> Result<RopeUpdate<T>, E>,
    ) -> Result<bool, RopeEditError<E>> {
        if range.start > range.end || range.end > self.len() || range.is_empty() {
            return Ok(false);
        }
        self.update_ordered_ranges(core::iter::once(Ok(range)), update)
    }

    /// Applies sorted disjoint ranges in one tree traversal. Each changed leaf and branch
    /// is reconstructed once even when several ranges intersect it.
    pub(crate) fn update_ordered_ranges<E>(
        &mut self,
        mut ranges: impl Iterator<Item = Result<Range<usize>, E>>,
        mut update: impl FnMut(usize, &T) -> Result<RopeUpdate<T>, E>,
    ) -> Result<bool, RopeEditError<E>> {
        let mut range_failure = None;
        let mut update_failure = None;
        let result = update_ordered(
            &mut self.root,
            &mut || {
                Some(ranges.next()?.map_err(|error| {
                    range_failure = Some(error);
                }))
            },
            &mut |leaf, record_start, ranges, stopped| {
                update_leaf_records(
                    leaf,
                    record_start,
                    ranges,
                    stopped,
                    &mut update,
                    &mut update_failure,
                )
            },
        );
        result.map_err(|failure| failure.into_edit_error(range_failure.or(update_failure)))
    }

    pub(crate) fn iter(&self) -> RopeIter<'_, T> {
        RopeIter::new(self.root.as_deref(), 0..self.len())
    }

    pub(crate) fn cursor_from(&self, index: usize) -> Option<RopeCursor<'_, T>> {
        (index <= self.len()).then(|| RopeCursor {
            root: self.root.as_deref(),
            index,
            iter: RopeIter::new(self.root.as_deref(), index..self.len()),
        })
    }

    pub(crate) fn range(&self, range: Range<usize>) -> Option<RopeRange<'_, T>> {
        (range.start <= range.end && range.end <= self.len())
            .then(|| RopeRange::new(self.root.as_deref(), range))
    }

    pub(crate) fn prefix_summary(&self, index: usize) -> Option<RopeSummary> {
        if index > self.len() {
            return None;
        }
        prefix_summary(self.root.as_deref(), index)
    }

    pub(crate) fn index_for_fragment(&self, mut fragment: usize) -> Option<usize> {
        let mut node = self.root.as_deref()?;
        let mut record_base = 0usize;
        loop {
            match node {
                Node::Leaf { leaf, .. } => {
                    for (offset, item) in leaf.records::<T>().iter().enumerate() {
                        let count = item.rope_summary().fragments;
                        if fragment < count {
                            return Some(record_base + offset);
                        }
                        fragment = fragment.checked_sub(count)?;
                    }
                    return None;
                }
                Node::Branch { left, right, .. } => {
                    let left_fragments = left.summary().fragments;
                    if fragment < left_fragments {
                        node = left;
                    } else {
                        fragment = fragment.checked_sub(left_fragments)?;
                        record_base = record_base.checked_add(left.summary().records)?;
                        node = right;
                    }
                }
            }
        }
    }

    pub(crate) fn find_source(
        &self,
        offset: u32,
        contains: impl Fn(&T, u32) -> bool + Copy,
    ) -> Option<usize> {
        find_source(self.root.as_deref()?, offset, 0, contains)
    }

    #[cfg(test)]
    pub(crate) fn retained_capacity(&self) -> usize {
        fn capacity(node: &Node) -> usize {
            match node {
                Node::Leaf { leaf, .. } => leaf.capacity(),
                Node::Branch { left, right, .. } => capacity(left).saturating_add(capacity(right)),
            }
        }
        self.root.as_deref().map(capacity).unwrap_or(0)
    }
}

fn is_exact_shape(root: Option<&Node>) -> bool {
    let Some(root) = root else {
        return true;
    };
    let count = root.summary().records;
    if count == 0 {
        return true;
    }
    let leaves = count / LEAF_CAPACITY + usize::from(!count.is_multiple_of(LEAF_CAPACITY));
    exact_shape(root, count, 0..leaves)
}

fn clear_root(root: &mut Root) {
    // A unique root leaf can serve as empty scratch without exposing records.
    if let Some(Node::Leaf { leaf, summary }) = root.as_mut().and_then(Arc::get_mut) {
        leaf.clear();
        *summary = RopeSummary::default();
        return;
    }
    *root = None;
}

fn append_records(
    root: &mut Root,
    kind: &'static RecordKind,
    records: &[Byte],
    fitting: usize,
    fitting_summary: RopeSummary,
) -> Result<(), ()> {
    let size = kind.size;
    let fitting_all = fitting * size == records.len();
    let mut staged = None;
    // The kernel validates summaries and reserves before its logical write. Only
    // multi-chunk input needs staging against a failure in a later chunk.
    let target = if fitting_all {
        &mut *root
    } else {
        staged = root.clone();
        &mut staged
    };
    if fitting != 0 {
        append_right(
            target.as_mut().ok_or(())?,
            &records[..fitting * size],
            fitting_summary,
        )?;
        #[cfg(test)]
        super::work_attribution::record(|work| {
            work.rope_bulk_records += fitting;
            work.rope_bulk_chunks += 1;
        });
    }
    if fitting_all {
        return Ok(());
    }
    for chunk in records[fitting * size..].chunks(LEAF_CAPACITY * size) {
        let leaf = leaf_node(Leaf::copy_of(kind, chunk)?)?;
        *target = join(target.take(), Some(leaf))?;
        #[cfg(test)]
        super::work_attribution::record(|work| {
            work.rope_bulk_records += chunk.len() / size;
            work.rope_bulk_chunks += 1;
        });
    }
    *root = staged;
    Ok(())
}

fn push_record(
    root: &mut Root,
    kind: &'static RecordKind,
    record: &[Byte],
    record_summary: RopeSummary,
) -> Result<(), ()> {
    if root
        .as_deref()
        .is_some_and(|root| rightmost_leaf_space(root) != 0)
    {
        return append_right(root.as_mut().ok_or(())?, record, record_summary);
    }
    let mut leaf = Leaf::empty(kind);
    leaf.extend(record)?;
    let leaf = leaf_node(leaf)?;
    *root = join(root.clone(), Some(leaf))?;
    Ok(())
}

fn truncate_root(root: &mut Root, len: usize) -> Result<(), ()> {
    let Some(node) = root.as_ref().map(Arc::clone) else {
        return Ok(());
    };
    if len >= node.summary().records {
        return Ok(());
    }
    *root = split(node, len)?.0;
    Ok(())
}

fn append_shared_range(
    root: &mut Root,
    source: Option<&Arc<Node>>,
    range: Range<usize>,
) -> Result<bool, ()> {
    let source_len = source.map_or(0, |source| source.summary().records);
    if range.start > range.end || range.end > source_len {
        return Ok(false);
    }
    if range.is_empty() {
        return Ok(true);
    }
    let Some(source) = source else {
        return Ok(false);
    };
    let (_, tail) = split(Arc::clone(source), range.start)?;
    let Some(tail) = tail else {
        return Ok(false);
    };
    let (middle, _) = split(tail, range.end - range.start)?;
    *root = join(root.clone(), middle)?;
    Ok(true)
}

fn replace_range(
    root: &mut Root,
    range: Range<usize>,
    replacement: Option<&Arc<Node>>,
) -> Result<bool, ()> {
    let len = root.as_deref().map_or(0, |root| root.summary().records);
    if range.start > range.end || range.end > len {
        return Ok(false);
    }
    let (prefix, suffix) = match root.as_ref() {
        Some(root) => {
            let (prefix, tail) = split(Arc::clone(root), range.start)?;
            let suffix = match tail {
                Some(tail) => split(tail, range.end - range.start)?.1,
                None => None,
            };
            (prefix, suffix)
        }
        None => (None, None),
    };
    *root = join(join(prefix, replacement.cloned())?, suffix)?;
    Ok(true)
}

type FillLeaf<'a> = dyn FnMut(&mut Leaf, Range<usize>) -> Result<(), Failure> + 'a;

fn build_exact_node(
    kind: &'static RecordKind,
    count: usize,
    leaves: Range<usize>,
    fill: &mut FillLeaf<'_>,
) -> Result<Arc<Node>, Failure> {
    if leaves.end - leaves.start == 1 {
        let start = leaves
            .start
            .checked_mul(LEAF_CAPACITY)
            .ok_or(Failure::Storage)?;
        let end = start
            .checked_add(LEAF_CAPACITY)
            .map_or(count, |end| end.min(count));
        let mut leaf = Leaf::with_capacity(kind, end - start).map_err(|()| Failure::Storage)?;
        fill(&mut leaf, start..end)?;
        return leaf_node(leaf).map_err(|()| Failure::Storage);
    }
    let middle = leaves.start + (leaves.end - leaves.start) / 2;
    let left = build_exact_node(kind, count, leaves.start..middle, fill)?;
    let right = build_exact_node(kind, count, middle..leaves.end, fill)?;
    branch(left, right).map_err(|()| Failure::Storage)
}

fn exact_shape(node: &Node, count: usize, leaves: Range<usize>) -> bool {
    #[cfg(test)]
    super::work_attribution::record(|work| work.ordered_shape_nodes += 1);
    if leaves.end - leaves.start == 1 {
        let start = leaves.start * LEAF_CAPACITY;
        let expected = (count - start).min(LEAF_CAPACITY);
        return matches!(node, Node::Leaf { leaf, .. } if leaf.len() == expected);
    }
    let middle = leaves.start + (leaves.end - leaves.start) / 2;
    match node {
        Node::Branch { left, right, .. } => {
            exact_shape(left, count, leaves.start..middle)
                && exact_shape(right, count, middle..leaves.end)
        }
        Node::Leaf { .. } => false,
    }
}

#[cfg(test)]
impl<T: RopeRecord + PartialEq> PartialEq for RetainedRope<T> {
    fn eq(&self, other: &Self) -> bool {
        self.len() == other.len()
            && self
                .iter()
                .zip(other.iter())
                .all(|(left, right)| left == right)
    }
}

#[cfg(test)]
impl<T: RopeRecord + Eq> Eq for RetainedRope<T> {}

#[cfg(test)]
impl<T: RopeRecord + fmt::Debug> fmt::Debug for RetainedRope<T> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_list().entries(self.iter()).finish()
    }
}

#[cfg(test)]
impl<T: RopeRecord> From<Vec<T>> for RetainedRope<T> {
    fn from(items: Vec<T>) -> Self {
        Self::try_from_vec(items).unwrap()
    }
}

impl<T: RopeRecord> core::ops::Index<usize> for RetainedRope<T> {
    type Output = T;

    fn index(&self, index: usize) -> &Self::Output {
        self.get(index)
            .unwrap_or_else(|| panic!("rope index out of bounds"))
    }
}

pub(crate) struct RopeRange<'a, T: RopeRecord> {
    root: Option<&'a Node>,
    range: Range<usize>,
    records: PhantomData<&'a [T]>,
}

impl<'a, T: RopeRecord> RopeRange<'a, T> {
    /// Store coordinates relative to the smallest node covering the range. Leaf-local
    /// ranges need no tree traversal when iterated or inspected.
    fn new(mut root: Option<&'a Node>, mut range: Range<usize>) -> Self {
        if range.is_empty() {
            return Self {
                root: None,
                range: 0..0,
                records: PhantomData,
            };
        }
        while let Some(Node::Branch { left, right, .. }) = root {
            let left_len = left.summary().records;
            if range.end <= left_len {
                root = Some(left);
            } else if range.start >= left_len {
                range.start -= left_len;
                range.end -= left_len;
                root = Some(right);
            } else {
                break;
            }
        }
        Self {
            root,
            range,
            records: PhantomData,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.range.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.range.is_empty()
    }

    pub(crate) fn range(&self, range: Range<usize>) -> Option<Self> {
        (range.start <= range.end && range.end <= self.len()).then(|| {
            Self::new(
                self.root,
                self.range.start + range.start..self.range.start + range.end,
            )
        })
    }

    pub(crate) fn first(&self) -> Option<&'a T> {
        if self.is_empty() {
            None
        } else {
            get_record(self.root?, self.range.start)
        }
    }

    pub(crate) fn last(&self) -> Option<&'a T> {
        if self.is_empty() {
            return None;
        }
        self.range
            .end
            .checked_sub(1)
            .and_then(|index| get_record(self.root?, index))
    }

    pub(crate) fn iter(&self) -> RopeRangeIter<'a, T> {
        RopeIter::new(self.root, self.range.clone())
    }

    #[cfg(test)]
    pub(crate) fn to_vec(&self) -> Vec<T> {
        self.iter().cloned().collect()
    }
}

pub(crate) type RopeRangeIter<'a, T> = RopeIter<'a, T>;

pub(crate) struct RopeIter<'a, T: RopeRecord> {
    state: RopeIterState<'a, T>,
}

#[expect(
    clippy::large_enum_variant,
    reason = "tree iteration keeps its stacks inline without an allocation"
)]
enum RopeIterState<'a, T: RopeRecord> {
    Leaf(core::slice::Iter<'a, T>),
    Tree(TreeRopeIter<'a, T>),
}

impl<'a, T: RopeRecord> RopeIter<'a, T> {
    fn new(root: Option<&'a Node>, range: Range<usize>) -> Self {
        #[cfg(test)]
        super::work_attribution::record(|work| work.rope_iterator_starts += 1);
        match root {
            Some(Node::Leaf { leaf, .. }) if !range.is_empty() => Self {
                state: RopeIterState::Leaf(leaf.records::<T>()[range].iter()),
            },
            Some(root @ Node::Branch { .. }) if !range.is_empty() => Self {
                state: RopeIterState::Tree(TreeRopeIter::new(root, range)),
            },
            _ => Self {
                state: RopeIterState::Leaf([].iter()),
            },
        }
    }

    fn skip_front(&mut self, count: usize) {
        match &mut self.state {
            RopeIterState::Leaf(leaf) => {
                if count > 0 {
                    leaf.nth(count - 1);
                }
            }
            RopeIterState::Tree(tree) => tree.skip_front(count),
        }
    }
}

struct TreeRopeIter<'a, T: RopeRecord> {
    front_stack: [Option<&'a Node>; MAX_HEIGHT],
    front_depth: usize,
    front_leaf: Option<core::slice::Iter<'a, T>>,
    front_node: Option<&'a Node>,
    back_stack: [Option<&'a Node>; MAX_HEIGHT],
    back_depth: usize,
    back_leaf: Option<core::slice::Iter<'a, T>>,
    remaining: usize,
}

impl<'a, T: RopeRecord> TreeRopeIter<'a, T> {
    fn new(root: &'a Node, range: Range<usize>) -> Self {
        let mut this = Self {
            front_stack: [None; MAX_HEIGHT],
            front_depth: 0,
            front_leaf: None,
            front_node: None,
            back_stack: [None; MAX_HEIGHT],
            back_depth: 0,
            back_leaf: None,
            remaining: range.len(),
        };
        this.descend_front_at(root, range.start);
        this.descend_back_at(root, range.end);
        this
    }

    fn descend_front_at(&mut self, mut node: &'a Node, mut index: usize) {
        loop {
            match node {
                Node::Leaf { leaf, .. } => {
                    self.front_node = Some(node);
                    self.front_leaf = Some(leaf.records::<T>()[index..].iter());
                    return;
                }
                Node::Branch { left, right, .. } => {
                    let left_len = left.summary().records;
                    if index < left_len {
                        self.front_stack[self.front_depth] = Some(right);
                        self.front_depth += 1;
                        node = left;
                    } else {
                        index -= left_len;
                        node = right;
                    }
                }
            }
        }
    }

    fn descend_back_at(&mut self, mut node: &'a Node, mut end: usize) {
        loop {
            match node {
                Node::Leaf { leaf, .. } => {
                    self.back_leaf = Some(leaf.records::<T>()[..end].iter());
                    return;
                }
                Node::Branch { left, right, .. } => {
                    let left_len = left.summary().records;
                    if end <= left_len {
                        node = left;
                    } else {
                        self.back_stack[self.back_depth] = Some(left);
                        self.back_depth += 1;
                        end -= left_len;
                        node = right;
                    }
                }
            }
        }
    }

    fn descend_front(&mut self, mut node: &'a Node) {
        loop {
            match node {
                Node::Leaf { leaf, .. } => {
                    self.front_node = Some(node);
                    self.front_leaf = Some(leaf.records::<T>().iter());
                    return;
                }
                Node::Branch { left, right, .. } => {
                    self.front_stack[self.front_depth] = Some(right);
                    self.front_depth += 1;
                    node = left;
                }
            }
        }
    }

    fn descend_back(&mut self, mut node: &'a Node) {
        loop {
            match node {
                Node::Leaf { leaf, .. } => {
                    self.back_leaf = Some(leaf.records::<T>().iter());
                    return;
                }
                Node::Branch { left, right, .. } => {
                    self.back_stack[self.back_depth] = Some(left);
                    self.back_depth += 1;
                    node = right;
                }
            }
        }
    }

    fn ensure_front_leaf(&mut self) -> Option<()> {
        if self
            .front_leaf
            .as_ref()
            .is_some_and(|leaf| !leaf.as_slice().is_empty())
        {
            return Some(());
        }
        self.front_leaf = None;
        self.front_node = None;
        let next = self.front_depth.checked_sub(1)?;
        self.front_depth = next;
        let node = self.front_stack[next].take()?;
        self.descend_front(node);
        Some(())
    }

    /// Advance across complete leaves/subtrees by their summaries, without reading records.
    fn skip_front(&mut self, mut count: usize) {
        self.remaining -= count;
        while count > 0 {
            if let Some(leaf) = self.front_leaf.as_mut() {
                let available = leaf.len();
                if count < available {
                    leaf.nth(count - 1);
                    return;
                }
                count -= available;
                self.front_leaf = None;
                self.front_node = None;
            }
            if count == 0 {
                return;
            }
            let Some(next) = self.front_depth.checked_sub(1) else {
                return;
            };
            self.front_depth = next;
            let Some(node) = self.front_stack[next].take() else {
                return;
            };
            if node.summary().records <= count {
                count -= node.summary().records;
            } else {
                self.descend_front(node);
            }
        }
    }

    fn next_front_raw(&mut self) -> Option<&'a T> {
        self.ensure_front_leaf()?;
        let item = self.front_leaf.as_mut()?.next()?;
        record_iteration_visit();
        Some(item)
    }

    fn next_back_raw(&mut self) -> Option<&'a T> {
        loop {
            if let Some(item) = self
                .back_leaf
                .as_mut()
                .and_then(DoubleEndedIterator::next_back)
            {
                return Some(item);
            }
            self.back_leaf = None;
            let next = self.back_depth.checked_sub(1)?;
            self.back_depth = next;
            let node = self.back_stack[next].take()?;
            self.descend_back(node);
        }
    }
}

impl<'a, T: RopeRecord> Iterator for RopeIter<'a, T> {
    type Item = &'a T;

    fn next(&mut self) -> Option<Self::Item> {
        match &mut self.state {
            RopeIterState::Leaf(leaf) => {
                let item = leaf.next()?;
                record_iteration_visit();
                Some(item)
            }
            RopeIterState::Tree(tree) => tree.next(),
        }
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let remaining = match &self.state {
            RopeIterState::Leaf(leaf) => leaf.len(),
            RopeIterState::Tree(tree) => tree.remaining,
        };
        (remaining, Some(remaining))
    }
}

impl<T: RopeRecord> DoubleEndedIterator for RopeIter<'_, T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        match &mut self.state {
            RopeIterState::Leaf(leaf) => leaf.next_back(),
            RopeIterState::Tree(tree) => tree.next_back(),
        }
    }
}

impl<'a, T: RopeRecord> Iterator for TreeRopeIter<'a, T> {
    type Item = &'a T;

    fn next(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let item = self.next_front_raw()?;
        self.remaining -= 1;
        Some(item)
    }
}

impl<T: RopeRecord> DoubleEndedIterator for TreeRopeIter<'_, T> {
    fn next_back(&mut self) -> Option<Self::Item> {
        if self.remaining == 0 {
            return None;
        }
        let item = self.next_back_raw()?;
        self.remaining -= 1;
        Some(item)
    }
}

impl<T: RopeRecord> ExactSizeIterator for RopeIter<'_, T> {}
impl<T: RopeRecord> FusedIterator for RopeIter<'_, T> {}

pub(crate) struct RopeCursor<'a, T: RopeRecord> {
    root: Option<&'a Node>,
    index: usize,
    iter: RopeIter<'a, T>,
}

impl<'a, T: RopeRecord> RopeCursor<'a, T> {
    /// Borrow the current record from the cursor's leaf without starting another rope walk.
    pub(crate) fn peek_record(&mut self) -> Option<&'a T> {
        if self.iter.len() == 0 {
            return None;
        }
        match &mut self.iter.state {
            RopeIterState::Leaf(leaf) => leaf.as_slice().first(),
            RopeIterState::Tree(tree) => {
                tree.ensure_front_leaf()?;
                tree.front_leaf.as_ref()?.as_slice().first()
            }
        }
    }

    pub(crate) fn peek(&mut self, count: usize) -> Option<RopeCursorRange<'a, T>> {
        if count > self.iter.len() {
            return None;
        }
        let range = if count == 0 {
            RopeRange::new(None, 0..0)
        } else {
            match &mut self.iter.state {
                RopeIterState::Leaf(_) => RopeRange::new(self.root, self.index..self.index + count),
                RopeIterState::Tree(tree) => {
                    tree.ensure_front_leaf()?;
                    let leaf = tree.front_leaf.as_ref()?.as_slice();
                    if count <= leaf.len() {
                        let node = tree.front_node?;
                        let start = node.summary().records - leaf.len();
                        RopeRange::new(Some(node), start..start + count)
                    } else {
                        RopeRange::new(self.root, self.index..self.index + count)
                    }
                }
            }
        };
        Some(range)
    }

    pub(crate) fn next_record(&mut self) -> Option<&'a T> {
        let record = self.iter.next()?;
        self.index += 1;
        Some(record)
    }

    pub(crate) fn advance(&mut self, count: usize) -> Option<()> {
        if count > self.iter.len() {
            return None;
        }
        self.iter.skip_front(count);
        self.index += count;
        Some(())
    }

    pub(crate) fn take(&mut self, count: usize) -> Option<RopeCursorRange<'a, T>> {
        let range = self.peek(count)?;
        self.advance(count)?;
        Some(range)
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.iter.len() == 0
    }
}

pub(crate) type RopeCursorRange<'a, T> = RopeRange<'a, T>;

fn summarize<T: RopeRecord>(items: &[T]) -> Option<RopeSummary> {
    items
        .iter()
        .try_fold(RopeSummary::default(), |summary, item| {
            summary.combine(item.rope_summary())
        })
}

fn rightmost_leaf_space(mut node: &Node) -> usize {
    loop {
        match node {
            Node::Leaf { leaf, .. } => return LEAF_CAPACITY - leaf.len(),
            Node::Branch { right, .. } => node = right,
        }
    }
}

fn append_right(
    node: &mut Arc<Node>,
    appended: &[Byte],
    appended_summary: RopeSummary,
) -> Result<(), ()> {
    let next_summary = node.summary().combine(appended_summary).ok_or(())?;
    match make_node_mut(node)? {
        Node::Leaf { leaf, summary } => {
            leaf.extend(appended)?;
            *summary = next_summary;
        }
        Node::Branch { right, summary, .. } => {
            append_right(right, appended, appended_summary)?;
            *summary = next_summary;
        }
    }
    Ok(())
}

fn leaf_node(leaf: Leaf) -> Result<Arc<Node>, ()> {
    let summary = leaf.summary(0..leaf.len()).ok_or(())?;
    // Stable Rust has no fallible `Arc` constructor. Caller-derived bulk storage is
    // reserved fallibly in fixed-capacity leaves; each tree node is one constant-size
    // allocation and stays in safe Rust rather than introducing a custom allocator.
    #[cfg(test)]
    LEAF_ALLOCATIONS.with(|count| count.set(count.get() + 1));
    Ok(Arc::new(Node::Leaf { leaf, summary }))
}

fn branch(left: Arc<Node>, right: Arc<Node>) -> Result<Arc<Node>, ()> {
    let height = left.height().max(right.height()).checked_add(1).ok_or(())?;
    let summary = left.summary().combine(right.summary()).ok_or(())?;
    Ok(Arc::new(Node::Branch {
        left,
        right,
        height,
        summary,
    }))
}

fn join(left: Root, right: Root) -> Result<Root, ()> {
    // Empty root leaves are scratch only; they must never become branch children.
    let left = left.filter(|node| node.summary().records != 0);
    let right = right.filter(|node| node.summary().records != 0);
    Ok(match (left, right) {
        (None, right) => right,
        (left, None) => left,
        (Some(left), Some(right)) => Some(join_nodes(left, right)?),
    })
}

fn join_nodes(left: Arc<Node>, right: Arc<Node>) -> Result<Arc<Node>, ()> {
    if let (
        Node::Leaf {
            leaf: left_leaf, ..
        },
        Node::Leaf {
            leaf: right_leaf, ..
        },
    ) = (left.as_ref(), right.as_ref())
        && left_leaf.len() + right_leaf.len() <= LEAF_CAPACITY
    {
        record_copies(left_leaf.len() + right_leaf.len());
        let mut merged = Leaf::with_capacity(left_leaf.kind, left_leaf.len() + right_leaf.len())?;
        merged.extend(left_leaf.bytes())?;
        merged.extend(right_leaf.bytes())?;
        return leaf_node(merged);
    }
    if left.height() > right.height().saturating_add(1)
        && let Node::Branch {
            left: outer,
            right: inner,
            ..
        } = left.as_ref()
    {
        return balance(Arc::clone(outer), join_nodes(Arc::clone(inner), right)?);
    }
    if right.height() > left.height().saturating_add(1)
        && let Node::Branch {
            left: inner,
            right: outer,
            ..
        } = right.as_ref()
    {
        return balance(join_nodes(left, Arc::clone(inner))?, Arc::clone(outer));
    }
    branch(left, right)
}

fn balance(left: Arc<Node>, right: Arc<Node>) -> Result<Arc<Node>, ()> {
    if left.height() > right.height().saturating_add(1)
        && let Node::Branch {
            left: left_left,
            right: left_right,
            ..
        } = left.as_ref()
    {
        if left_left.height() >= left_right.height() {
            return branch(
                Arc::clone(left_left),
                branch(Arc::clone(left_right), right)?,
            );
        }
        if let Node::Branch {
            left: middle_left,
            right: middle_right,
            ..
        } = left_right.as_ref()
        {
            return branch(
                branch(Arc::clone(left_left), Arc::clone(middle_left))?,
                branch(Arc::clone(middle_right), right)?,
            );
        }
    }
    if right.height() > left.height().saturating_add(1)
        && let Node::Branch {
            left: right_left,
            right: right_right,
            ..
        } = right.as_ref()
    {
        if right_right.height() >= right_left.height() {
            return branch(
                branch(left, Arc::clone(right_left))?,
                Arc::clone(right_right),
            );
        }
        if let Node::Branch {
            left: middle_left,
            right: middle_right,
            ..
        } = right_left.as_ref()
        {
            return branch(
                branch(left, Arc::clone(middle_left))?,
                branch(Arc::clone(middle_right), Arc::clone(right_right))?,
            );
        }
    }
    branch(left, right)
}

fn split(node: Arc<Node>, index: usize) -> Result<SplitNodes, ()> {
    if index == 0 {
        return Ok((None, Some(node)));
    }
    if index >= node.summary().records {
        return Ok((Some(node), None));
    }
    Ok(match node.as_ref() {
        Node::Leaf { leaf, .. } => {
            record_copies(leaf.len());
            let (prefix, suffix) = leaf.bytes().split_at(index * leaf.kind.size);
            (
                Some(leaf_node(Leaf::copy_of(leaf.kind, prefix)?)?),
                Some(leaf_node(Leaf::copy_of(leaf.kind, suffix)?)?),
            )
        }
        Node::Branch { left, right, .. } => {
            let left_len = left.summary().records;
            if index < left_len {
                let (prefix, middle) = split(Arc::clone(left), index)?;
                (prefix, join(middle, Some(Arc::clone(right)))?)
            } else if index == left_len {
                (Some(Arc::clone(left)), Some(Arc::clone(right)))
            } else {
                let (middle, suffix) = split(Arc::clone(right), index - left_len)?;
                (join(Some(Arc::clone(left)), middle)?, suffix)
            }
        }
    })
}

/// The leaf holding record `index`, and the record's offset within it.
fn leaf_at(mut node: &Node, mut index: usize) -> Option<(&Leaf, usize)> {
    #[cfg(test)]
    super::work_attribution::record(|work| work.rope_point_queries += 1);
    loop {
        match node {
            Node::Leaf { leaf, .. } => return (index < leaf.len()).then_some((leaf, index)),
            Node::Branch { left, right, .. } => {
                let left_len = left.summary().records;
                if index < left_len {
                    node = left;
                } else {
                    index = index.checked_sub(left_len)?;
                    node = right;
                }
            }
        }
    }
}

fn get_record<T: RopeRecord>(node: &Node, index: usize) -> Option<&T> {
    let (leaf, offset) = leaf_at(node, index)?;
    leaf.records::<T>().get(offset)
}

fn update_record(
    root: &mut Root,
    index: usize,
    candidate: &[Byte],
    candidate_summary: RopeSummary,
) -> Result<bool, ()> {
    let Some(node) = root.as_ref() else {
        return Ok(false);
    };
    // Prove every replacement summary before touching a uniquely owned path. A shared
    // path is rebuilt functionally and published only after all fallible work succeeds.
    // Both cases therefore preserve the old root on a deep summary overflow.
    let mut summaries = [RopeSummary::default(); MAX_HEIGHT];
    preflight_update(node, index, candidate_summary, 0, &mut summaries).ok_or(())?;
    if path_is_unique(node, index)
        && let Some(node) = root.as_mut()
    {
        return apply_unique_update(node, index, candidate, 0, &summaries)
            .then_some(true)
            .ok_or(());
    }
    let node = root.as_ref().ok_or(())?;
    let replacement = replace_record(node, index, candidate)?;
    *root = Some(replacement);
    Ok(true)
}

fn preflight_update(
    node: &Node,
    index: usize,
    candidate: RopeSummary,
    depth: usize,
    summaries: &mut [RopeSummary; MAX_HEIGHT],
) -> Option<RopeSummary> {
    let summary = match node {
        Node::Leaf { leaf, .. } => {
            if index >= leaf.len() {
                return None;
            }
            leaf.summary(0..index)?
                .combine(candidate)?
                .combine(leaf.summary(index + 1..leaf.len())?)?
        }
        Node::Branch { left, right, .. } => {
            let left_len = left.summary().records;
            if index < left_len {
                preflight_update(left, index, candidate, depth.checked_add(1)?, summaries)?
                    .combine(right.summary())?
            } else {
                left.summary().combine(preflight_update(
                    right,
                    index.checked_sub(left_len)?,
                    candidate,
                    depth.checked_add(1)?,
                    summaries,
                )?)?
            }
        }
    };
    *summaries.get_mut(depth)? = summary;
    Some(summary)
}

fn path_is_unique(node: &Arc<Node>, index: usize) -> bool {
    if Arc::strong_count(node) != 1 || index >= node.summary().records {
        return false;
    }
    match node.as_ref() {
        Node::Leaf { leaf, .. } => index < leaf.len(),
        Node::Branch { left, right, .. } => {
            let left_len = left.summary().records;
            if index < left_len {
                path_is_unique(left, index)
            } else {
                path_is_unique(right, index - left_len)
            }
        }
    }
}

fn apply_unique_update(
    node: &mut Arc<Node>,
    index: usize,
    candidate: &[Byte],
    depth: usize,
    summaries: &[RopeSummary; MAX_HEIGHT],
) -> bool {
    let Some(node) = Arc::get_mut(node) else {
        return false;
    };
    match node {
        Node::Leaf { leaf, summary } => {
            let Some(record) = leaf.record_mut(index) else {
                return false;
            };
            let Some(next_summary) = summaries.get(depth).copied() else {
                return false;
            };
            record.copy_from_slice(candidate);
            *summary = next_summary;
            true
        }
        Node::Branch {
            left,
            right,
            summary,
            ..
        } => {
            let left_len = left.summary().records;
            let Some(next_depth) = depth.checked_add(1) else {
                return false;
            };
            let updated = if index < left_len {
                apply_unique_update(left, index, candidate, next_depth, summaries)
            } else {
                apply_unique_update(right, index - left_len, candidate, next_depth, summaries)
            };
            if updated && let Some(next_summary) = summaries.get(depth).copied() {
                *summary = next_summary;
                true
            } else {
                false
            }
        }
    }
}

fn replace_record(node: &Arc<Node>, index: usize, candidate: &[Byte]) -> Result<Arc<Node>, ()> {
    if index >= node.summary().records {
        return Err(());
    }
    match node.as_ref() {
        Node::Leaf { leaf, .. } => {
            record_copies(leaf.len());
            let mut replacement = Leaf::copy_of(leaf.kind, leaf.bytes())?;
            replacement
                .record_mut(index)
                .ok_or(())?
                .copy_from_slice(candidate);
            leaf_node(replacement)
        }
        Node::Branch { left, right, .. } => {
            let left_len = left.summary().records;
            if index < left_len {
                branch(replace_record(left, index, candidate)?, Arc::clone(right))
            } else {
                branch(
                    Arc::clone(left),
                    replace_record(right, index - left_len, candidate)?,
                )
            }
        }
    }
}

/// The next requested range, or `Err` when the caller's range source failed.
type NextRange<'a> = dyn FnMut() -> Option<Result<Range<usize>, ()>> + 'a;

/// Visits one leaf `(leaf, index of its first record, ranges, stopped)` and returns its
/// replacement when a record changed. One indirect call per leaf; the per-record loop inside
/// is `update_leaf_records`, monomorphised for each record type and update.
type VisitLeaf<'a> = dyn FnMut(&Leaf, usize, &mut OrderedRanges<'_, '_>, &mut bool) -> Result<Option<Leaf>, Failure>
    + 'a;

struct OrderedRanges<'a, 'b> {
    ranges: &'a mut NextRange<'b>,
    current: Option<Range<usize>>,
    previous_end: usize,
    len: usize,
}

impl OrderedRanges<'_, '_> {
    fn advance_to(&mut self, offset: usize) -> Result<(), Failure> {
        while self
            .current
            .as_ref()
            .is_none_or(|range| range.end <= offset)
        {
            let Some(range) = (self.ranges)() else {
                self.current = None;
                return Ok(());
            };
            let range = range.map_err(|()| Failure::Callback)?;
            if range.start < self.previous_end || range.start > range.end || range.end > self.len {
                return Err(Failure::Storage);
            }
            self.previous_end = range.end;
            if range.is_empty() {
                continue;
            }
            self.current = Some(range);
        }
        Ok(())
    }
}

fn update_ordered(
    root: &mut Root,
    ranges: &mut NextRange<'_>,
    visit: &mut VisitLeaf<'_>,
) -> Result<bool, Failure> {
    let Some(node) = root.as_ref() else {
        return Ok(false);
    };
    let len = node.summary().records;
    if len == 0 {
        return Ok(false);
    }
    let mut ranges = OrderedRanges {
        ranges,
        current: None,
        previous_end: 0,
        len,
    };
    ranges.advance_to(0)?;
    if ranges.current.is_none() {
        return Ok(false);
    }
    record_ordered_traversal();
    let mut stopped = false;
    let replacement = update_ordered_node(node, 0, &mut ranges, visit, &mut stopped)?;
    if !stopped {
        ranges.advance_to(len)?;
    }
    if let Some(replacement) = replacement {
        *root = Some(replacement);
        Ok(true)
    } else {
        Ok(false)
    }
}

fn update_ordered_node(
    node: &Arc<Node>,
    record_start: usize,
    ranges: &mut OrderedRanges<'_, '_>,
    visit: &mut VisitLeaf<'_>,
    stopped: &mut bool,
) -> Result<Option<Arc<Node>>, Failure> {
    if *stopped {
        return Ok(None);
    }
    let record_end = record_start
        .checked_add(node.summary().records)
        .ok_or(Failure::Storage)?;
    ranges.advance_to(record_start)?;
    if ranges
        .current
        .as_ref()
        .is_none_or(|range| record_end <= range.start)
    {
        return Ok(None);
    }
    match node.as_ref() {
        Node::Leaf { leaf, .. } => {
            record_ordered_leaf_visit();
            let Some(replacement) = visit(leaf, record_start, ranges, stopped)? else {
                return Ok(None);
            };
            leaf_node(replacement)
                .map(Some)
                .map_err(|()| Failure::Storage)
        }
        Node::Branch { left, right, .. } => {
            let right_start = record_start
                .checked_add(left.summary().records)
                .ok_or(Failure::Storage)?;
            let next_left = update_ordered_node(left, record_start, ranges, visit, stopped)?;
            let next_right = update_ordered_node(right, right_start, ranges, visit, stopped)?;
            let replacement = match (next_left, next_right) {
                (None, None) => return Ok(None),
                (Some(next_left), None) => branch(next_left, Arc::clone(right)),
                (None, Some(next_right)) => branch(Arc::clone(left), next_right),
                (Some(next_left), Some(next_right)) => branch(next_left, next_right),
            }
            .map_err(|()| Failure::Storage)?;
            Ok(Some(replacement))
        }
    }
}

/// The per-record step of an ordered update over one leaf. Generic over the record type and the
/// caller's update so the record read, the update call and the replacement write are static and
/// inline; the tree walk around it stays type-erased.
#[inline(always)]
fn update_leaf_records<T: RopeRecord, E>(
    leaf: &Leaf,
    record_start: usize,
    ranges: &mut OrderedRanges<'_, '_>,
    stopped: &mut bool,
    update: &mut impl FnMut(usize, &T) -> Result<RopeUpdate<T>, E>,
    update_failure: &mut Option<E>,
) -> Result<Option<Leaf>, Failure> {
    let records = leaf.records::<T>();
    let record_end = record_start
        .checked_add(records.len())
        .ok_or(Failure::Storage)?;
    // The first replacement copies the whole leaf; later replacements overwrite their record in
    // that copy.
    let mut replacement: Option<Leaf> = None;
    let mut replaced = 0;
    let mut item_index = 0;
    while item_index < records.len() {
        let global_index = record_start + item_index;
        if ranges
            .current
            .as_ref()
            .is_none_or(|range| range.end <= global_index)
        {
            ranges.advance_to(global_index)?;
        }
        let Some(range) = ranges.current.as_ref() else {
            break;
        };
        if range.start >= record_end {
            break;
        }
        item_index = item_index.max(range.start.saturating_sub(record_start));
        let visited_index = item_index;
        item_index += 1;
        record_ordered_record_visit();
        let global_index = record_start
            .checked_add(visited_index)
            .ok_or(Failure::Storage)?;
        let next = match update(global_index, &records[visited_index]) {
            Ok(RopeUpdate::Keep) => continue,
            Ok(RopeUpdate::Replace(next)) => next,
            Ok(RopeUpdate::Stop) => {
                *stopped = true;
                break;
            }
            Err(error) => {
                *update_failure = Some(error);
                return Err(Failure::Callback);
            }
        };
        let copy = match replacement.as_mut() {
            Some(copy) => copy,
            None => replacement
                .insert(Leaf::copy_of(leaf.kind, leaf.bytes()).map_err(|()| Failure::Storage)?),
        };
        copy.set_record(visited_index, &next)
            .ok_or(Failure::Storage)?;
        replaced += 1;
    }
    if replacement.is_some() {
        record_copies(records.len() - replaced);
    }
    Ok(replacement)
}

fn make_node_mut(node: &mut Arc<Node>) -> Result<&mut Node, ()> {
    if Arc::get_mut(node).is_none() {
        let replacement = match node.as_ref() {
            Node::Leaf { leaf, summary } => {
                record_copies(leaf.len());
                #[cfg(test)]
                LEAF_ALLOCATIONS.with(|count| count.set(count.get() + 1));
                Node::Leaf {
                    leaf: Leaf::copy_of(leaf.kind, leaf.bytes())?,
                    summary: *summary,
                }
            }
            Node::Branch {
                left,
                right,
                height,
                summary,
            } => Node::Branch {
                left: Arc::clone(left),
                right: Arc::clone(right),
                height: *height,
                summary: *summary,
            },
        };
        // Branch and leaf node shells are fixed-size allocations. Variable-sized leaf
        // storage was copied with `try_reserve_exact` above before this is published.
        *node = Arc::new(replacement);
    }
    Arc::get_mut(node).ok_or(())
}

fn prefix_summary(node: Option<&Node>, index: usize) -> Option<RopeSummary> {
    let Some(node) = node else {
        return Some(RopeSummary::default());
    };
    if index == 0 {
        return Some(RopeSummary::default());
    }
    if index >= node.summary().records {
        return Some(node.summary());
    }
    match node {
        Node::Leaf { leaf, .. } => leaf.summary(0..index),
        Node::Branch { left, right, .. } => {
            let left_len = left.summary().records;
            if index <= left_len {
                prefix_summary(Some(left), index)
            } else {
                left.summary()
                    .combine(prefix_summary(Some(right), index - left_len)?)
            }
        }
    }
}

fn find_source<T: RopeRecord>(
    node: &Node,
    offset: u32,
    base: usize,
    contains: impl Fn(&T, u32) -> bool + Copy,
) -> Option<usize> {
    if !node.summary().contains_source(offset) {
        return None;
    }
    match node {
        Node::Leaf { leaf, .. } => {
            leaf.records::<T>()
                .iter()
                .enumerate()
                .find_map(|(index, item)| {
                    record_source_visit();
                    contains(item, offset).then_some(base + index)
                })
        }
        Node::Branch { left, right, .. } => {
            find_source(left, offset, base, contains).or_else(|| {
                find_source(
                    right,
                    offset,
                    base.checked_add(left.summary().records)?,
                    contains,
                )
            })
        }
    }
}

#[cfg(test)]
std::thread_local! {
    static ITERATION_RECORD_VISITS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static COPIED_RECORDS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static SOURCE_RECORD_VISITS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static INDEX_LOOKUPS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static LEAF_ALLOCATIONS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static ORDERED_TRAVERSALS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static ORDERED_LEAF_VISITS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
    static ORDERED_RECORD_VISITS: core::cell::Cell<usize> = const { core::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_iteration_visit() {
    ITERATION_RECORD_VISITS.with(|visits| visits.set(visits.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_iteration_visit() {}

#[cfg(test)]
fn record_copies(count: usize) {
    COPIED_RECORDS.with(|copied| copied.set(copied.get().saturating_add(count)));
}

#[cfg(not(test))]
fn record_copies(_: usize) {}

#[cfg(test)]
fn record_source_visit() {
    SOURCE_RECORD_VISITS.with(|visits| visits.set(visits.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_source_visit() {}

#[cfg(test)]
fn record_index_lookup() {
    INDEX_LOOKUPS.with(|lookups| lookups.set(lookups.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_index_lookup() {}

#[cfg(test)]
fn record_ordered_traversal() {
    ORDERED_TRAVERSALS.with(|visits| visits.set(visits.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_ordered_traversal() {}

#[cfg(test)]
fn record_ordered_leaf_visit() {
    ORDERED_LEAF_VISITS.with(|visits| visits.set(visits.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_ordered_leaf_visit() {}

#[cfg(test)]
fn record_ordered_record_visit() {
    ORDERED_RECORD_VISITS.with(|visits| visits.set(visits.get().saturating_add(1)));
}

#[cfg(not(test))]
fn record_ordered_record_visit() {}

#[cfg(test)]
pub(crate) fn reset_work_counters() {
    ITERATION_RECORD_VISITS.with(|visits| visits.set(0));
    COPIED_RECORDS.with(|copied| copied.set(0));
    LEAF_ALLOCATIONS.with(|count| count.set(0));
    SOURCE_RECORD_VISITS.with(|visits| visits.set(0));
    INDEX_LOOKUPS.with(|lookups| lookups.set(0));
    ORDERED_TRAVERSALS.with(|visits| visits.set(0));
    ORDERED_LEAF_VISITS.with(|visits| visits.set(0));
    ORDERED_RECORD_VISITS.with(|visits| visits.set(0));
}

#[cfg(test)]
pub(crate) fn index_lookups() -> usize {
    INDEX_LOOKUPS.with(core::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn work_counters() -> (usize, usize) {
    (
        COPIED_RECORDS.with(core::cell::Cell::get),
        SOURCE_RECORD_VISITS.with(core::cell::Cell::get),
    )
}

#[cfg(test)]
pub(crate) fn ordered_work_counters() -> (usize, usize, usize) {
    (
        ORDERED_TRAVERSALS.with(core::cell::Cell::get),
        ORDERED_LEAF_VISITS.with(core::cell::Cell::get),
        ORDERED_RECORD_VISITS.with(core::cell::Cell::get),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    struct Record {
        source_start: u32,
        source_end: u32,
        fragments: usize,
    }

    impl RopeRecord for Record {
        fn rope_summary(&self) -> RopeSummary {
            RopeSummary {
                records: 1,
                fragments: self.fragments,
                source_start: self.source_start,
                source_end: self.source_end.max(self.source_start.saturating_add(1)),
                has_source: true,
            }
        }
    }

    fn records(count: usize) -> Vec<Record> {
        (0..count)
            .map(|index| Record {
                source_start: u32::try_from(index * 2).unwrap(),
                source_end: u32::try_from(index * 2 + 2).unwrap(),
                fragments: index % 3 + 1,
            })
            .collect()
    }

    fn flat_summary(values: &[Record]) -> RopeSummary {
        values
            .iter()
            .try_fold(RopeSummary::default(), |summary, value| {
                summary.combine(value.rope_summary())
            })
            .unwrap()
    }

    fn assert_node_invariants(node: &Node) -> (u8, RopeSummary) {
        match node {
            Node::Leaf { leaf, summary } => {
                let items = leaf.records::<Record>();
                assert!(!items.is_empty());
                assert!(items.len() <= LEAF_CAPACITY);
                let expected = flat_summary(items);
                assert_eq!(*summary, expected);
                (1, expected)
            }
            Node::Branch {
                left,
                right,
                height,
                summary,
            } => {
                let (left_height, left_summary) = assert_node_invariants(left);
                let (right_height, right_summary) = assert_node_invariants(right);
                assert!(left_height.abs_diff(right_height) <= 1);
                let expected_height = left_height.max(right_height) + 1;
                let expected_summary = left_summary.combine(right_summary).unwrap();
                assert_eq!(*height, expected_height);
                assert_eq!(*summary, expected_summary);
                (expected_height, expected_summary)
            }
        }
    }

    fn assert_matches_flat(rope: &RetainedRope<Record>, values: &[Record]) {
        assert_eq!(rope.len(), values.len());
        assert_eq!(rope.summary(), flat_summary(values));
        assert_eq!(rope.iter().copied().collect::<Vec<_>>(), values);
        assert_eq!(
            rope.iter().rev().copied().collect::<Vec<_>>(),
            values.iter().rev().copied().collect::<Vec<_>>()
        );
        match rope.root.as_deref() {
            Some(Node::Leaf { leaf, summary }) if leaf.len() == 0 => {
                assert!(values.is_empty());
                assert_eq!(*summary, RopeSummary::default());
            }
            Some(root) => {
                let (_, summary) = assert_node_invariants(root);
                assert_eq!(summary, rope.summary());
            }
            None => assert!(values.is_empty()),
        }

        let middle = values.len() / 2;
        for range in [
            0..0,
            0..values.len(),
            middle..middle,
            0..middle,
            middle..values.len(),
        ] {
            assert_eq!(
                rope.range(range.clone())
                    .unwrap()
                    .iter()
                    .copied()
                    .collect::<Vec<_>>(),
                values[range].to_vec()
            );
        }
        assert!(
            rope.range(values.len().saturating_add(1)..values.len())
                .is_none()
        );
        assert!(rope.get(values.len()).is_none());
        assert!(rope.cursor_from(values.len().saturating_add(1)).is_none());

        let mut expected_prefix = RopeSummary::default();
        assert_eq!(rope.prefix_summary(0), Some(expected_prefix));
        for (index, value) in values.iter().enumerate() {
            expected_prefix = expected_prefix.combine(value.rope_summary()).unwrap();
            assert_eq!(rope.prefix_summary(index + 1), Some(expected_prefix));
        }
        assert_eq!(rope.prefix_summary(values.len().saturating_add(1)), None);

        let mut fragment_index = 0usize;
        for (record_index, record) in values.iter().enumerate() {
            for _ in 0..record.fragments {
                assert_eq!(rope.index_for_fragment(fragment_index), Some(record_index));
                fragment_index += 1;
            }
        }
        assert_eq!(rope.index_for_fragment(fragment_index), None);

        for record in values.iter().step_by(values.len().div_ceil(7).max(1)) {
            let expected = values.iter().position(|candidate| {
                candidate.source_start <= record.source_start
                    && record.source_start < candidate.source_end
            });
            assert_eq!(
                rope.find_source(record.source_start, |candidate, offset| {
                    candidate.source_start <= offset && offset < candidate.source_end
                }),
                expected
            );
        }
        assert_eq!(
            rope.find_source(u32::MAX, |candidate, offset| {
                candidate.source_start <= offset && offset < candidate.source_end
            }),
            None
        );

        let first_count = values.len() / 3;
        let second_count = values.len() / 4;
        let mut cursor = rope.cursor_from(0).unwrap();
        assert_eq!(
            cursor
                .take(first_count)
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            values[..first_count]
        );
        assert_eq!(
            cursor
                .take(second_count)
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            values[first_count..first_count + second_count]
        );
        assert_eq!(
            cursor
                .take(values.len() - first_count - second_count)
                .unwrap()
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            values[first_count + second_count..]
        );
        assert!(cursor.is_empty());
        assert!(cursor.take(1).is_none());
    }

    #[test]
    fn exact_producer_builds_packed_balanced_roots_with_flat_navigation() {
        fn leaf_lengths(node: &Node, lengths: &mut Vec<usize>) {
            match node {
                Node::Leaf { leaf, .. } => lengths.push(leaf.len()),
                Node::Branch { left, right, .. } => {
                    leaf_lengths(left, lengths);
                    leaf_lengths(right, lengths);
                }
            }
        }

        for count in [0, 1, 31, 32, 33, 65, 257, 1025] {
            let values = records(count);
            let mut produced = 0;
            let rope = RetainedRope::try_from_exact(count, |index| {
                assert_eq!(index, produced);
                produced += 1;
                Ok::<_, u8>(values[index])
            })
            .unwrap();
            assert_eq!(produced, count);
            assert_matches_flat(&rope, &values);
            for (index, expected) in values.iter().enumerate() {
                assert_eq!(rope.get(index), Some(expected));
                assert_eq!(
                    rope.cursor_from(index).unwrap().next_record(),
                    Some(expected)
                );
                assert_eq!(
                    rope.prefix_summary(index),
                    Some(flat_summary(&values[..index]))
                );
            }
            assert_eq!(rope.prefix_summary(count), Some(flat_summary(&values)));
            let mut lengths = Vec::new();
            if let Some(root) = rope.root.as_deref() {
                leaf_lengths(root, &mut lengths);
            }
            assert!(
                lengths
                    .iter()
                    .take(lengths.len().saturating_sub(1))
                    .all(|&len| len == LEAF_CAPACITY)
            );
            assert_eq!(lengths.iter().sum::<usize>(), count);
            let snapshot = rope.clone();
            let mut changed = rope;
            if count != 0 {
                changed.update(0, |record| record.fragments += 1).unwrap();
                let mut changed_values = values.clone();
                changed_values[0].fragments += 1;
                assert_matches_flat(&changed, &changed_values);
                assert_matches_flat(&snapshot, &values);
            }
        }
    }

    #[test]
    fn exact_producer_failure_discards_partial_tree_and_preserves_snapshot() {
        let values = records(65);
        let snapshot = RetainedRope::from(values.clone());
        let mut calls = 0;
        assert!(matches!(
            RetainedRope::try_from_exact(65, |index| {
                calls += 1;
                if index == 40 {
                    Err(7u8)
                } else {
                    Ok(values[index])
                }
            }),
            Err(RopeEditError::Callback(7))
        ));
        assert_eq!(calls, 41);
        let overflow = [
            Record {
                fragments: usize::MAX,
                ..values[0]
            },
            Record {
                fragments: 1,
                ..values[1]
            },
        ];
        assert!(matches!(
            RetainedRope::try_from_exact(2, |index| Ok::<_, u8>(overflow[index])),
            Err(RopeEditError::Storage)
        ));
        assert_matches_flat(&snapshot, &values);
    }

    #[test]
    fn summary_composition_is_associative_with_an_identity() {
        let values = records(3);
        let a = values[0].rope_summary();
        let b = values[1].rope_summary();
        let c = values[2].rope_summary();
        assert_eq!(
            a.combine(b).and_then(|ab| ab.combine(c)),
            a.combine(b.combine(c).unwrap())
        );
        assert_eq!(RopeSummary::default().combine(a), Some(a));
        assert_eq!(a.combine(RopeSummary::default()), Some(a));
    }

    #[test]
    fn summary_composition_rejects_count_overflow() {
        let records = RopeSummary {
            records: usize::MAX,
            ..RopeSummary::default()
        };
        let fragments = RopeSummary {
            fragments: usize::MAX,
            ..RopeSummary::default()
        };
        let one = RopeSummary {
            records: 1,
            fragments: 1,
            ..RopeSummary::default()
        };
        assert_eq!(records.combine(one), None);
        assert_eq!(fragments.combine(one), None);
    }

    #[test]
    fn failed_summary_updates_leave_shared_committed_storage_unchanged() {
        let committed = RetainedRope::from(vec![Record {
            source_start: 0,
            source_end: 1,
            fragments: usize::MAX,
        }]);
        let mut pending = committed.clone();
        assert_eq!(
            pending.push(Record {
                source_start: 1,
                source_end: 2,
                fragments: 1,
            }),
            Err(())
        );
        assert_eq!(pending, committed);

        let committed = RetainedRope::from(records(2));
        let mut pending = committed.clone();
        assert_eq!(
            pending.update(0, |record| record.fragments = usize::MAX),
            Err(())
        );
        assert_eq!(pending, committed);

        let values = records(257);
        let mut unique = RetainedRope::from(values.clone());
        assert_eq!(
            unique.update(256, |record| record.fragments = usize::MAX),
            Err(())
        );
        assert_matches_flat(&unique, &values);

        let committed = RetainedRope::from(values.clone());
        let mut pending = committed.clone();
        assert_eq!(
            pending.update(256, |record| record.fragments = usize::MAX),
            Err(())
        );
        assert_matches_flat(&committed, &values);
        assert_matches_flat(&pending, &values);
        let mut appended = records(LEAF_CAPACITY + 1);
        appended[LEAF_CAPACITY].fragments = usize::MAX;
        assert_eq!(pending.append_records(&appended), Err(()));
        assert_matches_flat(&committed, &values);
        assert_matches_flat(&pending, &values);

        // Filling a shared short leaf allocates only its COW replacement, not an
        // intermediate leaf followed by a merged replacement. The snapshot remains cold.
        let values = records(1_000);
        let committed = RetainedRope::from(values[..1].to_vec());
        let mut pending = committed.clone();
        reset_work_counters();
        pending.append_records(&values[1..LEAF_CAPACITY]).unwrap();
        assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 1);
        assert_eq!(work_counters().0, 1);
        assert_matches_flat(&committed, &values[..1]);
        assert_matches_flat(&pending, &values[..LEAF_CAPACITY]);

        reset_work_counters();
        let mut singles = RetainedRope::default();
        for (index, value) in values.iter().enumerate() {
            singles.push(*value).unwrap();
            if index == 0 {
                assert!(singles.retained_capacity() < LEAF_CAPACITY);
            } else if index == LEAF_CAPACITY - 1 {
                assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 1);
                assert_matches_flat(&singles, &values[..LEAF_CAPACITY]);
            } else if index == LEAF_CAPACITY {
                assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 2);
                assert_matches_flat(&singles, &values[..LEAF_CAPACITY + 1]);
            }
        }
        let single_allocations = LEAF_ALLOCATIONS.with(core::cell::Cell::get);
        let single_copies = work_counters().0;
        assert_eq!(single_allocations, values.len().div_ceil(LEAF_CAPACITY));
        assert_eq!(single_copies, 0);
        reset_work_counters();
        let mut bulk = RetainedRope::default();
        bulk.append_records(&values).unwrap();
        assert_eq!(
            LEAF_ALLOCATIONS.with(core::cell::Cell::get),
            values.len().div_ceil(LEAF_CAPACITY)
        );
        assert_eq!(work_counters().0, 0);
        assert_matches_flat(&singles, &values);
        assert_matches_flat(&bulk, &values);

        reset_work_counters();
        let mut short_appends = RetainedRope::default();
        for value in &values {
            short_appends
                .append_records(core::slice::from_ref(value))
                .unwrap();
        }
        let short_allocations = LEAF_ALLOCATIONS.with(core::cell::Cell::get);
        let short_copies = work_counters().0;
        assert_eq!(short_allocations, values.len().div_ceil(LEAF_CAPACITY));
        assert_eq!(short_copies, 0);
        assert_matches_flat(&short_appends, &values);
        eprintln!(
            "rope append1000: push_leaf_allocations={single_allocations}, push_copies={single_copies}, short_append_leaf_allocations={short_allocations}, short_append_copies={short_copies}"
        );

        // A fitting shared append must leave both logical roots unchanged on overflow.
        let committed = RetainedRope::from(vec![Record {
            source_start: 0,
            source_end: 1,
            fragments: usize::MAX,
        }]);
        let mut pending = committed.clone();
        assert_eq!(
            pending.append_records(core::slice::from_ref(&Record {
                source_start: 1,
                source_end: 2,
                fragments: 1,
            })),
            Err(())
        );
        assert_eq!(pending, committed);
    }

    #[test]
    fn unique_updates_mutate_in_place_and_shared_updates_copy_only_the_leaf() {
        let mut unique = RetainedRope::from(records(257));
        reset_work_counters();
        assert!(unique.update(130, |record| record.fragments += 1).unwrap());
        assert_eq!(work_counters().0, 0);

        let committed = unique;
        let previous = committed[130];
        let mut pending = committed.clone();
        reset_work_counters();
        assert!(pending.update(130, |record| record.fragments += 1).unwrap());
        let (copied, _) = work_counters();
        assert!(copied <= LEAF_CAPACITY, "copied {copied} records");
        assert_eq!(committed[130], previous);
        assert_eq!(pending[130].fragments, previous.fragments + 1);
    }

    #[test]
    fn range_cursor_matches_flat_oracle_without_per_record_root_lookups() {
        let values = records(257);
        let rope = RetainedRope::from(values.clone());
        reset_work_counters();
        let actual = rope.range(29..231).unwrap().to_vec();
        assert_eq!(actual, values[29..231]);
        assert_eq!(index_lookups(), 0);

        reset_work_counters();
        let reversed = rope
            .range(29..231)
            .unwrap()
            .iter()
            .rev()
            .cloned()
            .collect::<Vec<_>>();
        assert_eq!(
            reversed,
            values[29..231].iter().rev().cloned().collect::<Vec<_>>()
        );
        assert_eq!(index_lookups(), 0);

        reset_work_counters();
        let mut cursor = rope.cursor_from(29).unwrap();
        let first = cursor.take(73).unwrap();
        let second = cursor.take(129).unwrap();
        let third = cursor.take(26).unwrap();
        assert_eq!(ITERATION_RECORD_VISITS.with(core::cell::Cell::get), 0);
        assert_eq!(first.iter().copied().collect::<Vec<_>>(), values[29..102]);
        assert_eq!(second.iter().copied().collect::<Vec<_>>(), values[102..231]);
        assert_eq!(third.iter().copied().collect::<Vec<_>>(), values[231..257]);
        assert_eq!(ITERATION_RECORD_VISITS.with(core::cell::Cell::get), 228);
        assert_eq!(first.first(), values.get(29));
        assert_eq!(second.last(), values.get(230));
        assert!(cursor.is_empty());
        assert_eq!(index_lookups(), 0);

        let mut cursor = rope.cursor_from(29).unwrap();
        for offset in 29..102 {
            assert_eq!(cursor.peek_record(), values.get(offset));
            assert_eq!(cursor.peek(1).unwrap().first(), values.get(offset));
            assert_eq!(cursor.next_record(), values.get(offset));
        }
        assert_eq!(cursor.take(33).unwrap().to_vec(), values[102..135]);
        cursor.advance(122).unwrap();
        assert!(cursor.is_empty());
        assert_eq!(cursor.next_record(), None);
        assert_eq!(cursor.peek(0).unwrap().len(), 0);

        for width in [1, 2, 31, 32, 33, 73, 257] {
            let mut cursor = rope.cursor_from(0).unwrap();
            let mut offset = 0;
            while offset < values.len() {
                let count = width.min(values.len() - offset);
                assert_eq!(cursor.peek_record(), values.get(offset));
                assert!(cursor.take(values.len() + 1).is_none());
                assert!(cursor.take(0).unwrap().is_empty());
                let peek = cursor.peek(count).unwrap();
                assert_eq!(peek.first(), values.get(offset));
                assert_eq!(peek.last(), values.get(offset + count - 1));
                let range = cursor.take(count).unwrap();
                assert_eq!(
                    range.iter().copied().collect::<Vec<_>>(),
                    values[offset..offset + count]
                );
                offset += count;
            }
            assert!(cursor.is_empty());
            assert_eq!(cursor.peek_record(), None);
        }
    }

    #[test]
    fn bounded_iteration_and_cursor_match_flat_slices_across_leaf_boundaries() {
        for size in [0, 1, 31, 32, 33, 65] {
            let values = records(size);
            let rope = RetainedRope::from(values.clone());
            for start in 0..=size {
                for end in start..=size {
                    let range = rope.range(start..end).unwrap();
                    let expected = &values[start..end];
                    assert_eq!(range.first(), expected.first());
                    assert_eq!(range.last(), expected.last());
                    let mut iter = range.iter();
                    let (mut front, mut back) = (0, expected.len());
                    let mut from_front = true;
                    while front < back {
                        assert_eq!(iter.len(), back - front);
                        assert_eq!(iter.size_hint(), (back - front, Some(back - front)));
                        if from_front {
                            assert_eq!(iter.next(), expected.get(front));
                            front += 1;
                        } else {
                            back -= 1;
                            assert_eq!(iter.next_back(), expected.get(back));
                        }
                        from_front = !from_front;
                    }
                    assert_eq!(iter.next(), None);
                    assert_eq!(iter.next_back(), None);
                    assert_eq!(iter.next(), None);
                    assert_eq!(iter.len(), 0);

                    for skip in [0, expected.len() / 2, expected.len(), expected.len() + 1] {
                        let mut iter = range.iter();
                        assert_eq!(iter.nth(skip), expected.get(skip));
                        assert_eq!(iter.len(), expected.len().saturating_sub(skip + 1));
                    }
                    if expected.len() > 1 {
                        assert_eq!(
                            range.range(1..expected.len()).unwrap().to_vec(),
                            expected[1..]
                        );
                    }
                }

                let mut cursor = rope.cursor_from(start).unwrap();
                assert_eq!(cursor.peek_record(), values.get(start));
                for count in [0, 1.min(size - start), size - start] {
                    assert_eq!(
                        cursor.peek(count).unwrap().to_vec(),
                        values[start..start + count]
                    );
                }
                assert!(cursor.peek(size - start + 1).is_none());
                reset_work_counters();
                let count = (size - start).min(2);
                assert_eq!(
                    cursor.take(count).unwrap().to_vec(),
                    values[start..start + count]
                );
                assert_eq!(ITERATION_RECORD_VISITS.with(core::cell::Cell::get), count);
                let remaining = size - start - count;
                assert_eq!(cursor.advance(remaining), Some(()));
                assert_eq!(ITERATION_RECORD_VISITS.with(core::cell::Cell::get), count);
                assert!(cursor.is_empty());
                assert_eq!(cursor.peek_record(), None);
            }
        }
    }

    #[test]
    fn single_leaf_cursor_keeps_bounded_slice_and_index_in_sync() {
        let values = records(20);
        let rope = RetainedRope::from(values.clone());
        let mut cursor = rope.cursor_from(3).unwrap();

        assert_eq!(cursor.peek(4).unwrap().to_vec(), values[3..7]);
        assert_eq!(cursor.next_record(), values.get(3));
        assert_eq!(cursor.advance(2), Some(()));
        assert_eq!(cursor.peek_record(), values.get(6));
        assert_eq!(cursor.take(3).unwrap().to_vec(), values[6..9]);
        assert_eq!(cursor.next_record(), values.get(9));
        assert_eq!(cursor.advance(1), Some(()));
        assert_eq!(cursor.peek(2).unwrap().to_vec(), values[11..13]);
        assert_eq!(cursor.take(2).unwrap().to_vec(), values[11..13]);
        assert_eq!(cursor.peek_record(), values.get(13));
        for expected in &values[13..] {
            assert_eq!(cursor.next_record(), Some(expected));
        }
        assert!(cursor.is_empty());
        assert_eq!(cursor.next_record(), None);
    }

    #[test]
    fn boundary_lookup_and_fragment_navigation_match_a_flat_oracle() {
        let values = records(257);
        let rope = RetainedRope::from(values.clone());
        for offset in 0..514u32 {
            let expected = values
                .iter()
                .position(|record| record.source_start <= offset && offset < record.source_end);
            assert_eq!(
                rope.find_source(offset, |record, offset| {
                    record.source_start <= offset && offset < record.source_end
                }),
                expected
            );
        }
        let total_fragments = values.iter().map(|record| record.fragments).sum::<usize>();
        for fragment in 0..total_fragments {
            let mut remaining = fragment;
            let expected = values.iter().position(|record| {
                if remaining < record.fragments {
                    true
                } else {
                    remaining -= record.fragments;
                    false
                }
            });
            assert_eq!(rope.index_for_fragment(fragment), expected);
        }
    }

    #[test]
    fn replace_ranges_match_vec_and_preserve_shared_snapshots() {
        let mut values = records(100);
        let mut rope = RetainedRope::try_from_vec(values.clone()).unwrap();
        let mut seed = 0x3456_789a_u32;
        for step in 0..100 {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let start = seed as usize % (values.len() + 1);
            let end = (start + step % 7).min(values.len());
            let replacement_values = records(step % 5);
            let replacement = RetainedRope::try_from_vec(replacement_values.clone()).unwrap();
            let snapshot = rope.clone();
            let before = values.clone();
            assert!(rope.replace_range(start..end, &replacement).unwrap());
            values.splice(start..end, replacement_values);
            assert_eq!(rope.iter().copied().collect::<Vec<_>>(), values);
            assert_eq!(snapshot.iter().copied().collect::<Vec<_>>(), before);
            assert_eq!(rope.summary(), flat_summary(&values));
            if let Some(root) = rope.root.as_deref() {
                assert_node_invariants(root);
            }
        }
        let snapshot = rope.clone();
        assert!(
            !rope
                .replace_range(0..rope.len() + 1, &RetainedRope::default())
                .unwrap()
        );
        assert_eq!(rope, snapshot);
        assert!(
            rope.replace_range(0..rope.len(), &RetainedRope::default())
                .unwrap()
        );
        assert!(rope.is_empty());
        let replacement = RetainedRope::try_from_vec(records(3)).unwrap();
        assert!(rope.replace_range(0..0, &replacement).unwrap());
        assert_eq!(rope, replacement);
    }

    #[test]
    fn splice_retains_interior_chunks_with_bounded_record_copying() {
        let source = RetainedRope::from(records(4096));
        let mut target = RetainedRope::from(records(4));
        reset_work_counters();
        assert!(target.append_shared_range(&source, 3..4093).unwrap());
        let (copied, _) = work_counters();
        assert!(copied <= LEAF_CAPACITY * 6, "copied {copied} records");
        assert_eq!(target.len(), 4094);
    }

    #[test]
    fn ordered_ranges_copy_each_leaf_once_across_owner_boundaries() {
        let original = records(128);
        let snapshot = RetainedRope::from(original.clone());
        let mut pending = snapshot.clone();
        let ranges = (0..16).map(|owner| Ok::<_, u8>(owner * 8..owner * 8 + 2));
        reset_work_counters();
        pending
            .update_ordered_ranges(ranges, |_, previous| {
                Ok(RopeUpdate::Replace(Record {
                    fragments: previous.fragments + 1,
                    ..*previous
                }))
            })
            .unwrap();
        assert_eq!(ordered_work_counters(), (1, 4, 32));
        assert_eq!(work_counters().0, 96);
        let mut expected = original.clone();
        for (index, record) in expected.iter_mut().enumerate() {
            if index % 8 < 2 {
                record.fragments += 1;
            }
        }
        assert_matches_flat(&pending, &expected);
        assert_matches_flat(&snapshot, &original);
    }

    #[test]
    fn exact_shape_checks_midpoint_partition_even_with_full_leaves() {
        let original = records(96);
        let exact = RetainedRope::try_from_exact(96, |index| Ok::<_, ()>(original[index])).unwrap();
        assert!(exact.is_exact_shape());
        let first = leaf_node(
            Leaf::copy_of(KindOf::<Record>::KIND, record_bytes(&original[..32])).unwrap(),
        )
        .unwrap();
        let second = leaf_node(
            Leaf::copy_of(KindOf::<Record>::KIND, record_bytes(&original[32..64])).unwrap(),
        )
        .unwrap();
        let third = leaf_node(
            Leaf::copy_of(KindOf::<Record>::KIND, record_bytes(&original[64..])).unwrap(),
        )
        .unwrap();
        let skewed =
            RetainedRope::with_root(Some(branch(branch(first, second).unwrap(), third).unwrap()));
        assert_matches_flat(&skewed, &original);
        assert!(!skewed.is_exact_shape());
        let mut updated = skewed.clone();
        updated
            .update_ordered(0..96, |_, previous| {
                Ok::<_, ()>(RopeUpdate::Replace(*previous))
            })
            .unwrap();
        assert!(!updated.is_exact_shape());
        let partial =
            RetainedRope::try_from_exact(65, |index| Ok::<_, ()>(original[index])).unwrap();
        assert!(partial.is_exact_shape());
    }

    #[test]
    fn ordered_stop_preserves_prefix_and_copies_only_unchanged_old_rows() {
        let original = records(70);
        for stop_at in [0, 15, 32, 47, 69] {
            let mut pending = RetainedRope::from(original.clone());
            let accepted = pending.clone();
            reset_work_counters();
            pending
                .update_ordered(0..original.len(), |index, previous| {
                    Ok::<_, ()>(if index == stop_at {
                        RopeUpdate::Stop
                    } else if index % 3 == 0 {
                        RopeUpdate::Replace(Record {
                            fragments: previous.fragments + 1,
                            ..*previous
                        })
                    } else {
                        RopeUpdate::Keep
                    })
                })
                .unwrap();
            let mut expected = original.clone();
            for (index, row) in expected.iter_mut().enumerate().take(stop_at) {
                if index % 3 == 0 {
                    row.fragments += 1;
                }
            }
            assert_matches_flat(&pending, &expected);
            assert_matches_flat(&accepted, &original);
            assert!(work_counters().0 <= original.len());
        }
    }

    #[test]
    fn ordered_range_stream_failure_and_stop_preserve_their_contracts() {
        let original = records(65);
        let mut pending = RetainedRope::from(original.clone());
        let snapshot = pending.clone();
        assert_eq!(
            pending.update_ordered_ranges([Ok(0..1), Err(7u8)].into_iter(), |_, previous| {
                Ok(RopeUpdate::Replace(Record {
                    fragments: previous.fragments + 1,
                    ..*previous
                }))
            }),
            Err(RopeEditError::Callback(7))
        );
        assert_eq!(pending, snapshot);
        assert_eq!(
            pending.update_ordered_ranges(
                [Ok::<_, u8>(0..1), Ok(65..66)].into_iter(),
                |_, previous| { Ok(RopeUpdate::Replace(*previous)) }
            ),
            Err(RopeEditError::Storage)
        );
        assert_eq!(pending, snapshot);
        pending
            .update_ordered_ranges(
                [Ok::<_, u8>(0..20), Err(7)].into_iter(),
                |index, previous| {
                    Ok(if index == 9 {
                        RopeUpdate::Stop
                    } else {
                        RopeUpdate::Replace(Record {
                            fragments: previous.fragments + 1,
                            ..*previous
                        })
                    })
                },
            )
            .unwrap();
        let mut expected = original;
        for record in &mut expected[..9] {
            record.fragments += 1;
        }
        assert_matches_flat(&pending, &expected);
    }

    #[test]
    fn seeded_disjoint_ordered_ranges_match_flat_updates_and_share_snapshots() {
        let mut seed = 0x5317_u32;
        let mut expected = records(257);
        let mut pending = RetainedRope::from(expected.clone());
        for _ in 0..64 {
            let snapshot = pending.clone();
            let before = expected.clone();
            let mut indexes = Vec::new();
            for _ in 0..24 {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                indexes.push(seed as usize % expected.len());
            }
            indexes.sort_unstable();
            indexes.dedup();
            pending
                .update_ordered_ranges(
                    indexes.iter().map(|&index| Ok::<_, u8>(index..index + 1)),
                    |_, previous| {
                        Ok(RopeUpdate::Replace(Record {
                            fragments: previous.fragments + 1,
                            ..*previous
                        }))
                    },
                )
                .unwrap();
            for index in indexes {
                expected[index].fragments += 1;
            }
            assert_matches_flat(&pending, &expected);
            assert_matches_flat(&snapshot, &before);
        }
    }

    #[test]
    fn ordered_updates_cross_leaves_transactionally_without_root_lookup_per_record() {
        let values = records(257);
        let committed = RetainedRope::from(values.clone());
        let mut pending = committed.clone();
        let mut expected = values.clone();
        for (index, record) in expected.iter_mut().enumerate().take(231).skip(29) {
            if index % 3 == 0 {
                record.fragments += 1;
            }
        }

        reset_work_counters();
        assert!(
            pending
                .update_ordered(29..231, |index, record| {
                    Ok::<_, u8>(if index % 3 == 0 {
                        RopeUpdate::Replace(Record {
                            fragments: record.fragments + 1,
                            ..*record
                        })
                    } else {
                        RopeUpdate::Keep
                    })
                })
                .unwrap()
        );
        let (traversals, leaf_visits, record_visits) = ordered_work_counters();
        assert_eq!(traversals, 1);
        assert_eq!(record_visits, 202);
        assert!(leaf_visits < record_visits / 4);
        assert_eq!(index_lookups(), 0);
        assert_matches_flat(&committed, &values);
        assert_matches_flat(&pending, &expected);

        let before_error = pending.clone();
        assert_eq!(
            pending.update_ordered(0..pending.len(), |index, record| {
                if index == 130 {
                    return Err(7u8);
                }
                Ok(RopeUpdate::Replace(Record {
                    fragments: record.fragments + 1,
                    ..*record
                }))
            }),
            Err(RopeEditError::Callback(7))
        );
        assert_eq!(pending, before_error);

        assert_eq!(
            pending.update_ordered(0..pending.len(), |index, record| {
                Ok::<_, u8>(RopeUpdate::Replace(Record {
                    fragments: if index == 130 {
                        usize::MAX
                    } else {
                        record.fragments
                    },
                    ..*record
                }))
            }),
            Err(RopeEditError::Storage)
        );
        assert_eq!(pending, before_error);
        // Stop is successful prefix adoption, unlike callback/storage failures above.
        let mut stopped_expected = expected.clone();
        for record in &mut stopped_expected[..130] {
            record.fragments += 1;
        }
        reset_work_counters();
        assert!(
            pending
                .update_ordered(0..pending.len(), |index, record| {
                    Ok::<_, u8>(if index == 130 {
                        RopeUpdate::Stop
                    } else {
                        RopeUpdate::Replace(Record {
                            fragments: record.fragments + 1,
                            ..*record
                        })
                    })
                })
                .unwrap()
        );
        assert_eq!(ordered_work_counters().2, 131);
        assert_matches_flat(&pending, &stopped_expected);
        assert_matches_flat(&committed, &values);
    }

    #[test]
    fn seeded_mixed_mutations_match_vec_and_preserve_retained_snapshots() {
        let mut random = 0x2475_a11c_u32;
        let mut next_record = 0u32;
        let mut rope = RetainedRope::default();
        let mut values = Vec::new();
        let mut snapshots: Vec<(RetainedRope<Record>, Vec<Record>)> = Vec::new();

        for step in 0..384usize {
            random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            match random % 4 {
                0 => {
                    let source_start = next_record.checked_mul(4).unwrap();
                    let record = Record {
                        source_start,
                        source_end: source_start + 2,
                        fragments: usize::try_from(next_record % 5 + 1).unwrap(),
                    };
                    next_record += 1;
                    rope.push(record).unwrap();
                    values.push(record);
                }
                1 if !snapshots.is_empty() => {
                    let snapshot_index = usize::try_from(random).unwrap() % snapshots.len();
                    let (source, source_values) = &snapshots[snapshot_index];
                    if !source_values.is_empty() {
                        let start = (step * 7) % source_values.len();
                        let count = (step % 17 + 1).min(source_values.len() - start);
                        assert!(
                            rope.append_shared_range(source, start..start + count)
                                .unwrap()
                        );
                        values.extend_from_slice(&source_values[start..start + count]);
                    }
                }
                2 if !values.is_empty() => {
                    let keep = usize::try_from(random.rotate_left(9)).unwrap() % (values.len() + 1);
                    rope.truncate(keep).unwrap();
                    values.truncate(keep);
                }
                _ if !values.is_empty() => {
                    let index = usize::try_from(random.rotate_right(7)).unwrap() % values.len();
                    rope.update(index, |record| {
                        record.fragments = record.fragments % 7 + 1;
                        record.source_end = record.source_end.saturating_add(1);
                    })
                    .unwrap();
                    values[index].fragments = values[index].fragments % 7 + 1;
                    values[index].source_end = values[index].source_end.saturating_add(1);
                }
                _ => {}
            }
            if values.len() > 192 {
                let keep = 96 + step % 64;
                rope.truncate(keep).unwrap();
                values.truncate(keep);
            }
            if step % 19 == 0 {
                snapshots.push((rope.clone(), values.clone()));
            }
            assert_matches_flat(&rope, &values);
        }

        for (snapshot, expected) in snapshots {
            assert_matches_flat(&snapshot, &expected);
        }
    }

    #[test]
    fn clear_reuses_unique_leaf_and_preserves_shared_snapshots() {
        let values = records(LEAF_CAPACITY + 1);
        let mut one = RetainedRope::from(values[..1].to_vec());
        let one_capacity = one.retained_capacity();
        reset_work_counters();
        one.clear();
        assert!(one.is_empty());
        assert_eq!(one.retained_capacity(), one_capacity);
        assert_matches_flat(&one, &[]);
        assert_eq!(one.range(0..0).unwrap().first(), None);
        assert_eq!(one.cursor_from(0).unwrap().peek(0).unwrap().last(), None);
        assert_eq!(one.find_source(0, |_, _| true), None);
        assert_eq!(
            one.update_ordered_ranges(core::iter::once(Err::<Range<usize>, ()>(())), |_, _| {
                Ok(RopeUpdate::Keep)
            }),
            Ok(false)
        );
        one.push(values[0]).unwrap();
        assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 0);
        assert_matches_flat(&one, &values[..1]);

        let mut packed = RetainedRope::default();
        packed.append_records(&values[..LEAF_CAPACITY]).unwrap();
        let packed_capacity = packed.retained_capacity();
        reset_work_counters();
        packed.clear();
        assert_eq!(packed.retained_capacity(), packed_capacity);
        assert_matches_flat(&packed, &[]);
        packed.append_records(&values[..LEAF_CAPACITY]).unwrap();
        assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 0);
        assert_matches_flat(&packed, &values[..LEAF_CAPACITY]);
        packed.push(values[LEAF_CAPACITY]).unwrap();
        assert_eq!(LEAF_ALLOCATIONS.with(core::cell::Cell::get), 1);
        assert_matches_flat(&packed, &values);

        let mut unique_tree = RetainedRope::from(values.clone());
        unique_tree.clear();
        assert!(unique_tree.root.is_none());
        assert_matches_flat(&unique_tree, &[]);
        let mut shared_tree = packed.clone();
        shared_tree.clear();
        assert!(shared_tree.root.is_none());
        assert_matches_flat(&shared_tree, &[]);
        assert_matches_flat(&packed, &values);

        let snapshot = one.clone();
        one.clear();
        assert!(one.root.is_none());
        assert_matches_flat(&one, &[]);
        one.push(values[1]).unwrap();
        assert_matches_flat(&one, &values[1..2]);
        assert_matches_flat(&snapshot, &values[..1]);

        one.clear();
        assert!(one.append_shared_range(&packed, 0..packed.len()).unwrap());
        assert_matches_flat(&one, &values);
        let mut empty = RetainedRope::from(values[..1].to_vec());
        empty.clear();
        assert!(empty.replace_range(0..0, &packed).unwrap());
        assert_matches_flat(&empty, &values);
    }

    /// Records whose stride is not a whole number of storage words: packing, splitting,
    /// joining and replacing must move exact record bytes across word boundaries.
    #[test]
    fn odd_stride_records_match_vec_through_every_edit() {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        struct Packed5([u8; 5]);
        impl RopeRecord for Packed5 {
            fn rope_summary(&self) -> RopeSummary {
                RopeSummary {
                    records: 1,
                    fragments: usize::from(self.0[4] % 3 + 1),
                    ..RopeSummary::default()
                }
            }
        }
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        struct Wide12(u32, u32, u32);
        impl RopeRecord for Wide12 {
            fn rope_summary(&self) -> RopeSummary {
                RopeSummary {
                    records: 1,
                    fragments: 1,
                    source_start: self.0,
                    source_end: self.0 + 1,
                    has_source: true,
                }
            }
        }

        fn exercise<T: RopeRecord + PartialEq + core::fmt::Debug>(make: impl Fn(u32) -> T) {
            let values: Vec<T> = (0..200).map(&make).collect();
            let exact =
                RetainedRope::try_from_exact(values.len(), |index| Ok::<_, ()>(values[index]))
                    .unwrap();
            let mut pushed = RetainedRope::default();
            for value in &values {
                pushed.push(*value).unwrap();
            }
            let mut appended = RetainedRope::default();
            for chunk in values.chunks(13) {
                appended.append_records(chunk).unwrap();
            }
            for rope in [&exact, &pushed, &appended] {
                assert_eq!(rope.iter().copied().collect::<Vec<_>>(), values);
                assert_eq!(rope.iter().rev().count(), values.len());
            }

            let mut model = values.clone();
            let mut rope = appended.clone();
            let mut random = 0x51ed_270b_u32;
            for step in 0..96u32 {
                random = random.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                let index = random as usize % model.len();
                match step % 4 {
                    0 => {
                        let next = make(1_000 + step);
                        assert!(rope.update(index, |record| *record = next).unwrap());
                        model[index] = next;
                    }
                    1 => {
                        let end = (index + 1 + step as usize % 40).min(model.len());
                        let replacement: RetainedRope<T> =
                            RetainedRope::from(values[..(step as usize % 7)].to_vec());
                        assert!(rope.replace_range(index..end, &replacement).unwrap());
                        model.splice(index..end, values[..(step as usize % 7)].iter().copied());
                    }
                    2 => {
                        let end = (index + 37).min(model.len());
                        let next = make(2_000 + step);
                        rope.update_ordered(index..end, |position, _| {
                            Ok::<_, ()>(if position % 3 == 0 {
                                RopeUpdate::Replace(next)
                            } else {
                                RopeUpdate::Keep
                            })
                        })
                        .unwrap();
                        for (position, record) in model.iter_mut().enumerate().take(end).skip(index)
                        {
                            if position % 3 == 0 {
                                *record = next;
                            }
                        }
                    }
                    _ => {
                        let source = exact.clone();
                        let start = index % 150;
                        assert!(
                            rope.append_shared_range(&source, start..start + 50)
                                .unwrap()
                        );
                        model.extend_from_slice(&values[start..start + 50]);
                        rope.truncate(260.min(model.len())).unwrap();
                        model.truncate(260);
                    }
                }
                assert_eq!(rope.iter().copied().collect::<Vec<_>>(), model);
                assert_eq!(rope.summary().records, model.len());
                assert_eq!(rope.is_empty(), model.is_empty());
                if model.is_empty() {
                    model = values.clone();
                    rope = appended.clone();
                }
            }
            assert_eq!(exact.iter().copied().collect::<Vec<_>>(), values);
        }

        exercise(|value| Packed5([value as u8, (value >> 8) as u8, 7, 0xa5, value as u8 ^ 0x5a]));
        exercise(|value| Wide12(value, !value, value.rotate_left(13)));
    }
}
