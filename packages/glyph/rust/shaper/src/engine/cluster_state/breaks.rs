//! Word and optional break flags on clusters.

use super::*;

impl ClusterArena {
    /// Derives the word-root sidecar used by wrapping and stable placement segments.
    /// Width-only reflow reuses the selected representation without another scan.
    pub(crate) fn ensure_word_breaks(&mut self) -> Result<(), EngineError> {
        if self.word_sidecar_mode != WordSidecarMode::Unbuilt {
            return Ok(());
        }
        self.word_breaks.clear();
        // Below one chunk, scalar composition is cheaper than allocating a sidecar.
        if self.flags.len() < LAYOUT_CHUNK {
            self.word_sidecar_mode = WordSidecarMode::Short;
            return Ok(());
        }
        let mut opportunity_count = 0usize;
        for &flags in &self.flags {
            opportunity_count += usize::from(
                flags & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0,
            );
        }
        // Dense break streams stay on chunk/scalar composition; sparse records would rival the
        // source lanes, while negative-prefix summaries preserve first-overflow semantics.
        if opportunity_count.saturating_mul(2) >= self.flags.len() {
            self.word_sidecar_mode = WordSidecarMode::Dense;
            return Ok(());
        }
        reserve(&mut self.word_breaks, opportunity_count.saturating_add(1))?;
        let mut advance_units = 0_i64;
        let mut space_units = 0_i64;
        for (index, (&advance, &flags)) in self.advance_units.iter().zip(&self.flags).enumerate() {
            advance_units = advance_units.saturating_add(advance);
            if flags & CLUSTER_SPACE != 0 {
                space_units = space_units.saturating_add(advance);
            }
            if flags & (CLUSTER_ALLOWED_BREAK | CLUSTER_REQUIRED_BREAK | CLUSTER_HARD_BREAK) != 0 {
                let Ok(segment_advance) = i32::try_from(advance_units) else {
                    self.word_breaks.clear();
                    self.word_sidecar_mode = WordSidecarMode::Overflow;
                    return Ok(());
                };
                let Ok(segment_space) = i32::try_from(space_units) else {
                    self.word_breaks.clear();
                    self.word_sidecar_mode = WordSidecarMode::Overflow;
                    return Ok(());
                };
                self.word_breaks.push(WordBreakRecord {
                    cluster_end: u32::try_from(index + 1)
                        .map_err(|_| EngineError::ResultTooLarge)?,
                    advance_units: segment_advance,
                    space_units: segment_space,
                });
                advance_units = 0;
                space_units = 0;
            }
        }
        let count = self.advance_units.len();
        if count > 0
            && self
                .word_breaks
                .last()
                .is_none_or(|record| record.cluster_end as usize != count)
        {
            let Ok(segment_advance) = i32::try_from(advance_units) else {
                self.word_breaks.clear();
                self.word_sidecar_mode = WordSidecarMode::Overflow;
                return Ok(());
            };
            let Ok(segment_space) = i32::try_from(space_units) else {
                self.word_breaks.clear();
                self.word_sidecar_mode = WordSidecarMode::Overflow;
                return Ok(());
            };
            self.word_breaks.push(WordBreakRecord {
                cluster_end: u32::try_from(count).map_err(|_| EngineError::ResultTooLarge)?,
                advance_units: segment_advance,
                space_units: segment_space,
            });
        }
        self.word_sidecar_mode = WordSidecarMode::Sparse;
        Ok(())
    }

    pub(super) fn apply_break_flags(
        &mut self,
        unicode: &UnicodeAnalysis,
    ) -> Result<(), EngineError> {
        for line_break in unicode.line_breaks() {
            let end = line_break.position;
            if self.ends.is_empty() && end == 0 {
                continue;
            }
            let Some(preceding) = self.break_target(end, line_break.required) else {
                continue;
            };
            if line_break.required {
                self.flags[preceding] |= CLUSTER_REQUIRED_BREAK;
                continue;
            }
            self.mark_optional_break(preceding);
        }
        Ok(())
    }

    /// Records a UAX #14 optional opportunity that ends cluster `preceding`. A shaping-safe boundary is an allowed break outright. An unsafe boundary
    /// is still a legal break — dropping it produces the short lines of #216 — so it is
    /// allowed with a correction the fitter charges, provided one font owns both sides so
    /// the island can be reshaped; across owners it is dropped.
    pub(super) fn mark_optional_break(&mut self, preceding: usize) {
        if self.boundary_is_shaping_safe(preceding) {
            self.flags[preceding] |= CLUSTER_ALLOWED_BREAK;
        } else if self.ltr && self.same_owner(preceding, preceding + 1) {
            self.flags[preceding] |= CLUSTER_ALLOWED_BREAK | CLUSTER_BREAK_CORRECTION;
            // The correction lane exists only for paragraphs that have a correctable boundary.
            self.break_corrections
                .resize_with(self.starts.len(), Default::default);
        }
    }

    /// Resolve a UAX #14 opportunity to the cluster it can act on, or discard it.
    ///
    /// The two standards disagree by design: UAX #14 LB9 does not attach a combining mark to a
    /// preceding SPACE while UAX #29 GB9 does, so an opportunity can fall strictly inside a
    /// grapheme cluster. A cluster is indivisible for layout, so an OPTIONAL opportunity there is
    /// unusable and is discarded rather than promoted to the enclosing boundary -- promoting it
    /// would manufacture a break UAX #14 never offered. A REQUIRED break must never be dropped, so
    /// it acts on the cluster that contains it.
    ///
    /// `index_at` names the cluster ending at the offset when the offset is a boundary and the
    /// cluster containing it otherwise. Both consumers of
    /// `line_breaks()` route through here; writing the rule twice let them disagree about whether
    /// an interior required break survives.
    pub(super) fn break_target(&self, position: u32, required: bool) -> Option<usize> {
        // The cluster holding the unit before the offset is the first whose end reaches it.
        let index = match position.checked_sub(1) {
            Some(before) => *self.index_at.get(before as usize)? as usize,
            None => 0,
        };
        let target = self.ends.get(index)?;
        (*target == position || required).then_some(index)
    }
}
