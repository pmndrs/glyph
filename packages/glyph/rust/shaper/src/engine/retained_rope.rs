//! Persistent chunked storage for retained layout records.
//!
//! The tree owns copy-on-write leaf chunks behind `Arc`; shared nodes are never mutated.
//! Splicing a range therefore retains complete interior chunks and copies only the two
//! boundary chunks. Interior summaries
//! carry both record and fragment counts plus source-coordinate coverage, so callers can
//! navigate in either coordinate without flattening the tree.

use alloc::{sync::Arc, vec::Vec};
#[cfg(test)]
use core::fmt;
use core::{iter::FusedIterator, ops::Range};

pub(crate) const LEAF_CAPACITY: usize = 32;
const MAX_HEIGHT: usize = usize::BITS as usize + 1;

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

pub(crate) trait RopeRecord: Copy {
    /// Summarizes exactly one stored record. Implementations are package-owned;
    /// `records` must therefore be one.
    fn rope_summary(&self) -> RopeSummary;
}

enum Node<T: RopeRecord> {
    Leaf {
        items: Vec<T>,
        summary: RopeSummary,
    },
    Branch {
        left: Arc<Self>,
        right: Arc<Self>,
        height: u8,
        summary: RopeSummary,
    },
}

type SplitNodes<T> = (Option<Arc<Node<T>>>, Option<Arc<Node<T>>>);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RopeEditError<E> {
    Storage,
    Callback(E),
}

/// A stopped ordered update adopts its successful prefix and leaves the remaining rows shared.
pub(crate) enum RopeUpdate<T> {
    Keep,
    Replace(T),
    Stop,
}

impl<T: RopeRecord> Node<T> {
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

#[derive(Clone)]
pub(crate) struct RetainedRope<T: RopeRecord> {
    root: Option<Arc<Node<T>>>,
}

impl<T: RopeRecord> Default for RetainedRope<T> {
    fn default() -> Self {
        Self { root: None }
    }
}

impl<T: RopeRecord> RetainedRope<T> {
    pub(crate) fn len(&self) -> usize {
        self.summary().records
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.root.is_none()
    }

    pub(crate) fn summary(&self) -> RopeSummary {
        self.root.as_deref().map(Node::summary).unwrap_or_default()
    }

    pub(crate) fn clear(&mut self) {
        self.root = None;
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
        let fitting_all = fitting == items.len();
        let mut staged = None;
        // The kernel validates summaries and reserves before its logical write. Only
        // multi-chunk input needs staging against a failure in a later chunk.
        let root = if fitting_all {
            &mut self.root
        } else {
            staged = self.root.clone();
            &mut staged
        };
        if fitting != 0 {
            append_right(
                root.as_mut().ok_or(())?,
                &items[..fitting],
                summarize(&items[..fitting]).ok_or(())?,
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
        for chunk in items[fitting..].chunks(LEAF_CAPACITY) {
            let leaf = leaf_from_items(copy_items(chunk)?)?;
            *root = join(root.take(), Some(leaf))?;
            #[cfg(test)]
            super::work_attribution::record(|work| {
                work.rope_bulk_records += chunk.len();
                work.rope_bulk_chunks += 1;
            });
        }
        self.root = staged;
        Ok(())
    }

    pub(crate) fn push(&mut self, item: T) -> Result<(), ()> {
        #[cfg(test)]
        super::work_attribution::record(|work| work.rope_record_pushes += 1);
        if self
            .root
            .as_deref()
            .is_some_and(|root| rightmost_leaf_space(root) != 0)
        {
            return append_right(
                self.root.as_mut().ok_or(())?,
                core::slice::from_ref(&item),
                item.rope_summary(),
            );
        }
        let mut items = Vec::new();
        items.try_reserve(LEAF_CAPACITY).map_err(|_| ())?;
        items.push(item);
        let leaf = leaf_from_items(items)?;
        let root = join(self.root.clone(), Some(leaf))?;
        self.root = root;
        Ok(())
    }

    pub(crate) fn truncate(&mut self, len: usize) -> Result<(), ()> {
        if len >= self.len() {
            return Ok(());
        }
        let Some(root) = self.root.as_ref().map(Arc::clone) else {
            return Ok(());
        };
        let root = split(root, len)?.0;
        self.root = root;
        Ok(())
    }

    pub(crate) fn append_shared_range(
        &mut self,
        source: &Self,
        range: Range<usize>,
    ) -> Result<bool, ()> {
        if range.start > range.end || range.end > source.len() {
            return Ok(false);
        }
        if range.is_empty() {
            return Ok(true);
        }
        let Some(source_root) = source.root.as_ref() else {
            return Ok(false);
        };
        let (_, tail) = split(Arc::clone(source_root), range.start)?;
        let Some(tail) = tail else {
            return Ok(false);
        };
        let (middle, _) = split(tail, range.end - range.start)?;
        let root = join(self.root.clone(), middle)?;
        self.root = root;
        Ok(true)
    }

    /// Atomically replaces an ordered interval, sharing untouched chunks.
    pub(crate) fn replace_range(
        &mut self,
        range: Range<usize>,
        replacement: &Self,
    ) -> Result<bool, ()> {
        if range.start > range.end || range.end > self.len() {
            return Ok(false);
        }
        let (prefix, suffix) = match self.root.as_ref() {
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
        let root = join(join(prefix, replacement.root.clone())?, suffix)?;
        self.root = root;
        Ok(true)
    }

    pub(crate) fn get(&self, index: usize) -> Option<&T> {
        record_index_lookup();
        get_record(self.root.as_deref()?, index)
    }

    pub(crate) fn update(&mut self, index: usize, update: impl FnOnce(&mut T)) -> Result<bool, ()> {
        let Some(root) = self.root.as_ref() else {
            return Ok(false);
        };
        let Some(current) = get_record(root, index).copied() else {
            return Ok(false);
        };
        let mut candidate = current;
        update(&mut candidate);

        // Prove every replacement summary before touching a uniquely owned path. A shared
        // path is rebuilt functionally and published only after all fallible work succeeds.
        // Both cases therefore preserve the old root on a deep summary overflow.
        let mut summaries = [RopeSummary::default(); MAX_HEIGHT];
        preflight_update(root, index, candidate, 0, &mut summaries).ok_or(())?;
        if path_is_unique(root, index)
            && let Some(root) = self.root.as_mut()
        {
            return apply_unique_update(root, index, candidate, 0, &summaries)
                .then_some(true)
                .ok_or(());
        }
        let root = self.root.as_ref().ok_or(())?;
        let replacement = replace_record(root, index, candidate)?;
        self.root = Some(replacement);
        Ok(true)
    }

    /// Visits a record range once in storage order and transactionally replaces records
    /// selected by `update`. Unchanged leaves remain shared; changed leaves and their branch
    /// paths are copied once regardless of how many records in that leaf change. Stop adopts
    /// the successful prefix; callback or storage failure leaves the whole root unchanged.
    pub(crate) fn update_ordered<E>(
        &mut self,
        range: Range<usize>,
        mut update: impl FnMut(usize, &T) -> Result<RopeUpdate<T>, E>,
    ) -> Result<bool, RopeEditError<E>> {
        if range.start > range.end || range.end > self.len() {
            return Ok(false);
        }
        if range.is_empty() {
            return Ok(false);
        }
        let Some(root) = self.root.as_ref() else {
            return Ok(false);
        };
        record_ordered_traversal();
        let mut stopped = false;
        if let Some(replacement) = update_ordered_node(root, 0, &range, &mut update, &mut stopped)?
        {
            self.root = Some(replacement);
            Ok(true)
        } else {
            Ok(false)
        }
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
                Node::Leaf { items, .. } => {
                    for (offset, item) in items.iter().enumerate() {
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
        fn capacity<T: RopeRecord>(node: &Node<T>) -> usize {
            match node {
                Node::Leaf { items, .. } => items.capacity(),
                Node::Branch { left, right, .. } => capacity(left).saturating_add(capacity(right)),
            }
        }
        self.root.as_deref().map(capacity).unwrap_or(0)
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
    root: Option<&'a Node<T>>,
    range: Range<usize>,
}

impl<'a, T: RopeRecord> RopeRange<'a, T> {
    /// Store coordinates relative to the smallest node covering the range. Leaf-local
    /// ranges need no tree traversal when iterated or inspected.
    fn new(mut root: Option<&'a Node<T>>, mut range: Range<usize>) -> Self {
        if range.is_empty() {
            return Self {
                root: None,
                range: 0..0,
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
        Self { root, range }
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
    front_stack: [Option<&'a Node<T>>; MAX_HEIGHT],
    front_depth: usize,
    front_leaf: Option<core::slice::Iter<'a, T>>,
    front_node: Option<&'a Node<T>>,
    back_stack: [Option<&'a Node<T>>; MAX_HEIGHT],
    back_depth: usize,
    back_leaf: Option<core::slice::Iter<'a, T>>,
    remaining: usize,
}

impl<'a, T: RopeRecord> RopeIter<'a, T> {
    fn new(root: Option<&'a Node<T>>, range: Range<usize>) -> Self {
        #[cfg(test)]
        super::work_attribution::record(|work| work.rope_iterator_starts += 1);
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
        if let Some(root) = root
            && !range.is_empty()
        {
            this.descend_front_at(root, range.start);
            this.descend_back_at(root, range.end);
        }
        this
    }

    fn descend_front_at(&mut self, mut node: &'a Node<T>, mut index: usize) {
        loop {
            match node {
                Node::Leaf { items, .. } => {
                    self.front_node = Some(node);
                    self.front_leaf = Some(items[index..].iter());
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

    fn descend_back_at(&mut self, mut node: &'a Node<T>, mut end: usize) {
        loop {
            match node {
                Node::Leaf { items, .. } => {
                    self.back_leaf = Some(items[..end].iter());
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

    fn descend_front(&mut self, mut node: &'a Node<T>) {
        loop {
            match node {
                Node::Leaf { items, .. } => {
                    self.front_node = Some(node);
                    self.front_leaf = Some(items.iter());
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

    fn descend_back(&mut self, mut node: &'a Node<T>) {
        loop {
            match node {
                Node::Leaf { items, .. } => {
                    self.back_leaf = Some(items.iter());
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
        if self.remaining == 0 {
            return None;
        }
        let item = self.next_front_raw()?;
        self.remaining -= 1;
        Some(item)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        (self.remaining, Some(self.remaining))
    }
}

impl<T: RopeRecord> DoubleEndedIterator for RopeIter<'_, T> {
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
    root: Option<&'a Node<T>>,
    index: usize,
    iter: RopeIter<'a, T>,
}

impl<'a, T: RopeRecord> RopeCursor<'a, T> {
    pub(crate) fn peek(&mut self, count: usize) -> Option<RopeCursorRange<'a, T>> {
        if count > self.iter.len() {
            return None;
        }
        let range = if count == 0 {
            RopeRange::new(None, 0..0)
        } else {
            self.iter.ensure_front_leaf()?;
            let leaf = self.iter.front_leaf.as_ref()?.as_slice();
            if count <= leaf.len() {
                let node = self.iter.front_node?;
                let start = node.summary().records - leaf.len();
                RopeRange::new(Some(node), start..start + count)
            } else {
                RopeRange::new(self.root, self.index..self.index + count)
            }
        };
        Some(range)
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

fn rightmost_leaf_space<T: RopeRecord>(mut node: &Node<T>) -> usize {
    loop {
        match node {
            Node::Leaf { items, .. } => return LEAF_CAPACITY - items.len(),
            Node::Branch { right, .. } => node = right,
        }
    }
}

fn append_right<T: RopeRecord>(
    node: &mut Arc<Node<T>>,
    appended: &[T],
    appended_summary: RopeSummary,
) -> Result<(), ()> {
    let next_summary = node.summary().combine(appended_summary).ok_or(())?;
    match make_node_mut(node)? {
        Node::Leaf { items, summary } => {
            items.try_reserve(appended.len()).map_err(|_| ())?;
            items.extend_from_slice(appended);
            *summary = next_summary;
        }
        Node::Branch { right, summary, .. } => {
            append_right(right, appended, appended_summary)?;
            *summary = next_summary;
        }
    }
    Ok(())
}

fn leaf_from_items<T: RopeRecord>(items: Vec<T>) -> Result<Arc<Node<T>>, ()> {
    let summary = summarize(&items).ok_or(())?;
    // Stable Rust has no fallible `Arc` constructor. Caller-derived bulk storage is
    // reserved fallibly in fixed-capacity leaves; each tree node is one constant-size
    // allocation and stays in safe Rust rather than introducing a custom allocator.
    #[cfg(test)]
    LEAF_ALLOCATIONS.with(|count| count.set(count.get() + 1));
    Ok(Arc::new(Node::Leaf { items, summary }))
}

fn branch<T: RopeRecord>(left: Arc<Node<T>>, right: Arc<Node<T>>) -> Result<Arc<Node<T>>, ()> {
    let height = left.height().max(right.height()).checked_add(1).ok_or(())?;
    let summary = left.summary().combine(right.summary()).ok_or(())?;
    Ok(Arc::new(Node::Branch {
        left,
        right,
        height,
        summary,
    }))
}

fn join<T: RopeRecord>(
    left: Option<Arc<Node<T>>>,
    right: Option<Arc<Node<T>>>,
) -> Result<Option<Arc<Node<T>>>, ()> {
    Ok(match (left, right) {
        (None, right) => right,
        (left, None) => left,
        (Some(left), Some(right)) => Some(join_nodes(left, right)?),
    })
}

fn join_nodes<T: RopeRecord>(left: Arc<Node<T>>, right: Arc<Node<T>>) -> Result<Arc<Node<T>>, ()> {
    if let (
        Node::Leaf {
            items: left_items, ..
        },
        Node::Leaf {
            items: right_items, ..
        },
    ) = (left.as_ref(), right.as_ref())
        && left_items.len() + right_items.len() <= LEAF_CAPACITY
    {
        record_copies(left_items.len() + right_items.len());
        let mut items = Vec::new();
        items
            .try_reserve_exact(left_items.len() + right_items.len())
            .map_err(|_| ())?;
        items.extend_from_slice(left_items);
        items.extend_from_slice(right_items);
        return leaf_from_items(items);
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

fn balance<T: RopeRecord>(left: Arc<Node<T>>, right: Arc<Node<T>>) -> Result<Arc<Node<T>>, ()> {
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

fn split<T: RopeRecord>(node: Arc<Node<T>>, index: usize) -> Result<SplitNodes<T>, ()> {
    if index == 0 {
        return Ok((None, Some(node)));
    }
    if index >= node.summary().records {
        return Ok((Some(node), None));
    }
    Ok(match node.as_ref() {
        Node::Leaf { items, .. } => {
            record_copies(items.len());
            (
                Some(leaf_from_items(copy_items(&items[..index])?)?),
                Some(leaf_from_items(copy_items(&items[index..])?)?),
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

fn get_record<T: RopeRecord>(mut node: &Node<T>, mut index: usize) -> Option<&T> {
    #[cfg(test)]
    super::work_attribution::record(|work| work.rope_point_queries += 1);
    loop {
        match node {
            Node::Leaf { items, .. } => return items.get(index),
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

fn preflight_update<T: RopeRecord>(
    node: &Node<T>,
    index: usize,
    candidate: T,
    depth: usize,
    summaries: &mut [RopeSummary; MAX_HEIGHT],
) -> Option<RopeSummary> {
    let summary = match node {
        Node::Leaf { items, .. } => {
            if index >= items.len() {
                return None;
            }
            items.iter().enumerate().try_fold(
                RopeSummary::default(),
                |summary, (item_index, item)| {
                    summary.combine(if item_index == index {
                        candidate.rope_summary()
                    } else {
                        item.rope_summary()
                    })
                },
            )?
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

fn path_is_unique<T: RopeRecord>(node: &Arc<Node<T>>, index: usize) -> bool {
    if Arc::strong_count(node) != 1 || index >= node.summary().records {
        return false;
    }
    match node.as_ref() {
        Node::Leaf { items, .. } => index < items.len(),
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

fn apply_unique_update<T: RopeRecord>(
    node: &mut Arc<Node<T>>,
    index: usize,
    candidate: T,
    depth: usize,
    summaries: &[RopeSummary; MAX_HEIGHT],
) -> bool {
    let Some(node) = Arc::get_mut(node) else {
        return false;
    };
    match node {
        Node::Leaf { items, summary } => {
            let Some(item) = items.get_mut(index) else {
                return false;
            };
            let Some(next_summary) = summaries.get(depth).copied() else {
                return false;
            };
            *item = candidate;
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

fn replace_record<T: RopeRecord>(
    node: &Arc<Node<T>>,
    index: usize,
    candidate: T,
) -> Result<Arc<Node<T>>, ()> {
    if index >= node.summary().records {
        return Err(());
    }
    match node.as_ref() {
        Node::Leaf { items, .. } => {
            record_copies(items.len());
            let mut replacement = copy_items(items)?;
            let Some(item) = replacement.get_mut(index) else {
                return Err(());
            };
            *item = candidate;
            leaf_from_items(replacement)
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

fn update_ordered_node<T: RopeRecord, E>(
    node: &Arc<Node<T>>,
    record_start: usize,
    range: &Range<usize>,
    update: &mut impl FnMut(usize, &T) -> Result<RopeUpdate<T>, E>,
    stopped: &mut bool,
) -> Result<Option<Arc<Node<T>>>, RopeEditError<E>> {
    if *stopped {
        return Ok(None);
    }
    let record_end = record_start
        .checked_add(node.summary().records)
        .ok_or(RopeEditError::Storage)?;
    if range.end <= record_start || record_end <= range.start {
        return Ok(None);
    }
    match node.as_ref() {
        Node::Leaf { items, .. } => {
            record_ordered_leaf_visit();
            let local_start = range.start.saturating_sub(record_start).min(items.len());
            let local_end = range.end.saturating_sub(record_start).min(items.len());
            let mut replacement = None;
            for item_index in local_start..local_end {
                record_ordered_record_visit();
                let global_index = record_start
                    .checked_add(item_index)
                    .ok_or(RopeEditError::Storage)?;
                let candidate = match update(global_index, &items[item_index])
                    .map_err(RopeEditError::Callback)?
                {
                    RopeUpdate::Keep => continue,
                    RopeUpdate::Replace(candidate) => candidate,
                    RopeUpdate::Stop => {
                        *stopped = true;
                        break;
                    }
                };
                if replacement.is_none() {
                    record_copies(items.len());
                    replacement = Some(copy_items(items).map_err(|()| RopeEditError::Storage)?);
                }
                replacement
                    .as_mut()
                    .and_then(|items| items.get_mut(item_index))
                    .map(|item| *item = candidate)
                    .ok_or(RopeEditError::Storage)?;
            }
            let Some(replacement) = replacement else {
                return Ok(None);
            };
            leaf_from_items(replacement)
                .map(Some)
                .map_err(|()| RopeEditError::Storage)
        }
        Node::Branch { left, right, .. } => {
            let right_start = record_start
                .checked_add(left.summary().records)
                .ok_or(RopeEditError::Storage)?;
            let next_left = update_ordered_node(left, record_start, range, update, stopped)?;
            let next_right = update_ordered_node(right, right_start, range, update, stopped)?;
            let replacement = match (next_left, next_right) {
                (None, None) => return Ok(None),
                (Some(next_left), None) => branch(next_left, Arc::clone(right)),
                (None, Some(next_right)) => branch(Arc::clone(left), next_right),
                (Some(next_left), Some(next_right)) => branch(next_left, next_right),
            }
            .map_err(|()| RopeEditError::Storage)?;
            Ok(Some(replacement))
        }
    }
}

fn make_node_mut<T: RopeRecord>(node: &mut Arc<Node<T>>) -> Result<&mut Node<T>, ()> {
    if Arc::get_mut(node).is_none() {
        let replacement = match node.as_ref() {
            Node::Leaf { items, summary } => {
                record_copies(items.len());
                #[cfg(test)]
                LEAF_ALLOCATIONS.with(|count| count.set(count.get() + 1));
                Node::Leaf {
                    items: copy_items(items)?,
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

fn prefix_summary<T: RopeRecord>(node: Option<&Node<T>>, index: usize) -> Option<RopeSummary> {
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
        Node::Leaf { items, .. } => summarize(&items[..index]),
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

fn copy_items<T: Copy>(source: &[T]) -> Result<Vec<T>, ()> {
    let mut copied = Vec::new();
    copied.try_reserve_exact(source.len()).map_err(|_| ())?;
    copied.extend_from_slice(source);
    Ok(copied)
}

fn find_source<T: RopeRecord>(
    node: &Node<T>,
    offset: u32,
    base: usize,
    contains: impl Fn(&T, u32) -> bool + Copy,
) -> Option<usize> {
    if !node.summary().contains_source(offset) {
        return None;
    }
    match node {
        Node::Leaf { items, .. } => items.iter().enumerate().find_map(|(index, item)| {
            record_source_visit();
            contains(item, offset).then_some(base + index)
        }),
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

    fn assert_node_invariants(node: &Node<Record>) -> (u8, RopeSummary) {
        match node {
            Node::Leaf { items, summary } => {
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
        for value in &values {
            singles.push(*value).unwrap();
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

        for width in [1, 2, 31, 32, 33, 73, 257] {
            let mut cursor = rope.cursor_from(0).unwrap();
            let mut offset = 0;
            while offset < values.len() {
                let count = width.min(values.len() - offset);
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
        }
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
}
