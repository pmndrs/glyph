//! One pipeline stage's committed value beside its optional pending replacement.
//!
//! A retained paragraph carries every stage twice: what the session has committed, and
//! what an in-flight update has prepared. Holding those as three independent fields —
//! `value`, `pending_value`, and a `value_prepared` flag — spreads one indivisible fact
//! across three places and leaves the selection to be written out by hand at every read
//! site. That idiom appeared over sixty times in the engine, and each occurrence was an
//! opportunity to read the committed value where the pending one was live, or to leave a
//! flag set over a buffer that no longer described anything.
//!
//! [`Staged`] makes the trio one value with one way to read it. It also has to be a type
//! rather than an accessor method on the paragraph: `self.active_clusters()` would borrow
//! the whole paragraph and collide with the mutable borrow of the stage being written,
//! which is precisely why the hand-written selectors were inlined in the first place.
//! `self.clusters.active()` borrows one field, so the natural expression is also the one
//! that compiles.

/// A stage value that may have a prepared replacement waiting to commit.
///
/// `T: Default` covers construction; every arena in the engine is default-constructible
/// and reused rather than reallocated, which is why `abort` and `commit` return buffers to
/// the pool instead of dropping them.
#[derive(Default)]
pub(crate) struct Staged<T> {
    committed: T,
    pending: T,
    prepared: bool,
}

impl<T> Staged<T> {
    /// The value this paragraph currently answers with: the pending one while an update
    /// is in flight, the committed one otherwise. This is the only selection expression
    /// in the engine.
    pub(crate) fn active(&self) -> &T {
        if self.prepared {
            &self.pending
        } else {
            &self.committed
        }
    }

    /// The last committed value, ignoring anything in flight. Used where a stage must
    /// compare against what the session already published — the equivalence proofs — and
    /// nowhere else.
    pub(crate) fn committed(&self) -> &T {
        &self.committed
    }

    pub(crate) const fn is_prepared(&self) -> bool {
        self.prepared
    }

    /// The pending buffer for reading, live or not. An equivalence proof builds a pending
    /// value and then compares it against the committed one to decide whether keeping it
    /// is worth a publication, so it needs both halves immutably at once.
    pub(crate) fn pending(&self) -> &T {
        &self.pending
    }

    /// Borrows the pending buffer for writing WITHOUT declaring it prepared. A stage that
    /// can fail builds here and calls [`Staged::mark_prepared`] only once it has
    /// succeeded, so a failed preparation cannot leave a half-built buffer live.
    pub(crate) fn pending_mut(&mut self) -> &mut T {
        &mut self.pending
    }

    /// Declares the pending buffer complete and live.
    pub(crate) fn mark_prepared(&mut self) {
        self.prepared = true;
    }

    /// Both buffers at once, for lifecycle operations that touch each equally — reset and
    /// capacity reservation. Returns `(committed, pending)`.
    pub(crate) fn pair_mut(&mut self) -> (&mut T, &mut T) {
        (&mut self.committed, &mut self.pending)
    }

    /// The pending buffer for writing beside the committed one for reading. This is the
    /// shape of every stage that rebuilds its pending value FROM what is already
    /// published — incremental flow rebuilds, retained positioning — and it is the reason
    /// the pair has to live behind one field: two separate fields would make the borrow
    /// checker's job the author's job.
    pub(crate) fn derive_mut(&mut self) -> (&mut T, &T) {
        (&mut self.pending, &self.committed)
    }

    /// Drops anything in flight. The pending buffer keeps its capacity for reuse.
    pub(crate) fn abort(&mut self) {
        self.prepared = false;
    }

    /// Publishes a prepared value, retiring the previous committed buffer into the
    /// pending slot for reuse. A stage with nothing prepared commits unchanged, so this
    /// is total: every stage can be committed on every frame without asking whether it
    /// participated.
    pub(crate) fn commit(&mut self) {
        if self.prepared {
            core::mem::swap(&mut self.committed, &mut self.pending);
        }
        self.prepared = false;
    }

    /// Replaces the committed value outright, discarding anything in flight. Session
    /// reuse resets a paragraph this way.
    pub(crate) fn reset(&mut self, value: T) {
        self.committed = value;
        self.prepared = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_follows_preparation_and_commit_publishes_once() {
        let mut stage: Staged<u32> = Staged::default();
        stage.reset(1);
        assert_eq!(*stage.active(), 1);
        assert!(!stage.is_prepared());

        // Writing the pending buffer alone does not change what the paragraph answers:
        // a stage that fails after this point must not become live.
        *stage.pending_mut() = 2;
        assert_eq!(*stage.active(), 1);

        stage.mark_prepared();
        assert_eq!(*stage.active(), 2);
        assert_eq!(
            *stage.committed(),
            1,
            "the committed value is untouched while in flight"
        );

        stage.commit();
        assert_eq!(*stage.active(), 2);
        assert_eq!(*stage.committed(), 2);
        assert!(!stage.is_prepared(), "commit clears the in-flight state");
    }

    #[test]
    fn abort_restores_the_committed_value_and_commit_is_total() {
        let mut stage: Staged<u32> = Staged::default();
        stage.reset(7);
        *stage.pending_mut() = 9;
        stage.mark_prepared();
        stage.abort();
        assert_eq!(*stage.active(), 7);

        // Committing a stage that prepared nothing is a no-op rather than an error, which
        // is what lets the commit path run every stage unconditionally.
        stage.commit();
        assert_eq!(*stage.active(), 7);
        stage.commit();
        assert_eq!(*stage.active(), 7);
    }

    #[test]
    fn committed_buffers_are_recycled_rather_than_dropped() {
        // Commit swaps, so the retired committed buffer becomes the next pending buffer.
        // The engine depends on this to keep arena capacity across frames.
        let mut stage: Staged<alloc::vec::Vec<u32>> = Staged::default();
        stage.reset(alloc::vec![1, 2, 3]);
        stage.pending_mut().extend_from_slice(&[4, 5, 6, 7]);
        stage.mark_prepared();
        stage.commit();
        assert_eq!(stage.active().as_slice(), &[4, 5, 6, 7]);
        assert_eq!(
            stage.pending_mut().as_slice(),
            &[1, 2, 3],
            "the old committed buffer is reused"
        );
    }
}
