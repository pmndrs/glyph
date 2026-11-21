//! Grapheme, word and sentence boundaries for editing: one byte per UTF-16 offset.
//!
//! `lane[offset]` holds `GRAPHEME_BOUNDARY`, `WORD_BOUNDARY` and `SENTENCE_BOUNDARY` bits for the
//! boundary before unit `offset`; the lane has `text.len() + 1` entries and both ends of the text
//! are boundaries of every kind. Nothing here runs during `UnicodeAnalysis::analyze`: the lane is
//! filled on the first query for a paragraph, one kind at a time, so an edit or layout that never
//! asks for words or sentences pays only for marking the lane stale.
//!
//! Word and sentence bits come from a `BreakSource`, UAX #29 by default. After a local edit
//! (`BoundaryLanes::splice`) a lane keeps its bits outside the edit and recomputes only the window
//! between the restart points around it (`unicode_resync.rs`), with the joint at each window end
//! taken from the restart predicate.

use alloc::{boxed::Box, string::String, vec::Vec};

use unicode_segmentation::UnicodeSegmentation;

use super::{
    UnicodeError,
    resync::{self, Joint, Lane},
};

/// An extended grapheme cluster starts here (UAX #29 section 3).
pub const GRAPHEME_BOUNDARY: u8 = 1 << 0;
/// A word boundary (UAX #29 section 4, or the installed `BreakSource`).
pub const WORD_BOUNDARY: u8 = 1 << 1;
/// A sentence boundary (UAX #29 section 5, or the installed `BreakSource`).
pub const SENTENCE_BOUNDARY: u8 = 1 << 2;

/// A lazily computed lane a `BreakSource` provides.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Segmentation {
    Word,
    Sentence,
}

impl Segmentation {
    const ALL: [Self; 2] = [Self::Word, Self::Sentence];

    /// The lane bit this segmentation writes.
    pub const fn bit(self) -> u8 {
        match self {
            Self::Word => WORD_BOUNDARY,
            Self::Sentence => SENTENCE_BOUNDARY,
        }
    }

    const fn resync_lane(self) -> Lane {
        match self {
            Self::Word => Lane::Word,
            Self::Sentence => Lane::Sentence,
        }
    }

    const fn index(self) -> usize {
        match self {
            Self::Word => 0,
            Self::Sentence => 1,
        }
    }
}

/// Where word and sentence boundaries come from.
///
/// The default, `Uax29BreakSource`, is the UAX #29 default rules, which only know character
/// classes. That is poor for scripts written without spaces: a reviewer measured 16 "words" for one
/// Thai phrase and 8 for a Japanese one, where a reader sees a handful. A dictionary or model based
/// source can replace the word lane by implementing this trait; the lane, its laziness and its
/// windowed recompute stay the same.
///
/// A replacement must keep the restart points of `unicode_resync.rs` valid for its lane: its
/// boundaries of a text must equal its boundaries of the two halves at every restart point, with the
/// joint the restart predicate reports. A dictionary source that looks across a single space
/// between two letters needs its own restart predicate before it can use windowed recompute.
pub trait BreakSource {
    /// Sets `segmentation.bit()` in `lane[offset]` for every boundary of `text`, read as an
    /// independent string, strictly between its ends. `lane` has `text.len() + 1` entries with that
    /// bit clear, and `text` is well-formed UTF-16. The ends are the caller's.
    fn mark(
        &self,
        segmentation: Segmentation,
        text: &[u16],
        lane: &mut [u8],
    ) -> Result<(), UnicodeError>;
}

/// UAX #29 word and sentence boundaries, through the `unicode-segmentation` crate (Unicode 17).
#[derive(Clone, Copy, Debug, Default)]
pub struct Uax29BreakSource;

impl BreakSource for Uax29BreakSource {
    fn mark(
        &self,
        segmentation: Segmentation,
        text: &[u16],
        lane: &mut [u8],
    ) -> Result<(), UnicodeError> {
        let mut utf8 = String::new();
        utf8.try_reserve(text.len().saturating_mul(3))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
        for character in char::decode_utf16(text.iter().copied()) {
            utf8.push(character.map_err(|_| UnicodeError::InvalidUtf16)?);
        }
        let bit = segmentation.bit();
        // Segments arrive in order, so their UTF-16 starts accumulate without a byte-offset map.
        let mut start = 0usize;
        let mut mark = |segment: &str| {
            if start != 0 {
                lane[start] |= bit;
            }
            start += segment.chars().map(char::len_utf16).sum::<usize>();
        };
        match segmentation {
            Segmentation::Word => utf8.split_word_bounds().for_each(&mut mark),
            Segmentation::Sentence => utf8.split_sentence_bounds().for_each(&mut mark),
        }
        Ok(())
    }
}

/// The state of one lazily computed lane.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum LaneState {
    /// Not computed for the current text.
    Stale,
    /// Every bit is current.
    Ready,
    /// Current outside `[start, end]`, a range of offsets in the current text that edits touched.
    Dirty { start: usize, end: usize },
}

/// The boundary lane of one paragraph and the source of its word and sentence bits.
pub struct BoundaryLanes {
    lane: Vec<u8>,
    graphemes_ready: bool,
    states: [LaneState; 2],
    /// `None` is `Uax29BreakSource`, called directly: a boxed default would put its vtable, and
    /// with it the UAX #29 word and sentence tables, in every build that never queries a lane.
    source: Option<Box<dyn BreakSource>>,
    window: Vec<u8>,
}

impl Default for BoundaryLanes {
    fn default() -> Self {
        Self {
            lane: Vec::new(),
            graphemes_ready: false,
            states: [LaneState::Stale; 2],
            source: None,
            window: Vec::new(),
        }
    }
}

impl BoundaryLanes {
    /// Replaces the source of word and sentence boundaries; both lanes recompute on next query.
    pub fn set_source(&mut self, source: Box<dyn BreakSource>) {
        self.source = Some(source);
        self.states = [LaneState::Stale; 2];
    }

    /// Forgets every lane: the text was replaced. Constant time; storage is kept.
    pub fn invalidate(&mut self) {
        self.graphemes_ready = false;
        self.states = [LaneState::Stale; 2];
    }

    fn any_kept(&self) -> bool {
        self.states.iter().any(|state| *state != LaneState::Stale)
    }

    /// Records that units `[start, start + removed)` of the previous text were replaced by
    /// `inserted` units. Computed lanes keep their bits outside the edit and recompute the window
    /// around it on their next query; lanes never queried stay stale and cost nothing here.
    ///
    /// The grapheme bits are copied again from the new analysis on their next query.
    pub fn splice(&mut self, start: usize, removed: usize, inserted: usize) {
        self.graphemes_ready = false;
        if !self.any_kept() {
            return;
        }
        let end = start.saturating_add(removed);
        if end >= self.lane.len() {
            // Not an edit of the text these lanes describe.
            self.invalidate();
            return;
        }
        let edited_end = start + inserted;
        for state in &mut self.states {
            *state = match *state {
                LaneState::Stale => LaneState::Stale,
                LaneState::Ready => LaneState::Dirty {
                    start,
                    end: edited_end,
                },
                LaneState::Dirty {
                    start: dirty_start,
                    end: dirty_end,
                } => {
                    // Offsets after the edit shift; offsets inside or before it fall into it.
                    let shifted_end = if dirty_end >= end {
                        dirty_end - removed + inserted
                    } else {
                        edited_end
                    };
                    LaneState::Dirty {
                        start: dirty_start.min(start),
                        end: shifted_end.max(edited_end),
                    }
                }
            };
        }
        self.lane
            .splice(start..end, core::iter::repeat_n(0, inserted));
    }

    /// The lane for `text` with every kind in `kinds` current. `graphemes` are the analysis's
    /// grapheme boundaries of the same text.
    pub(crate) fn ensure(
        &mut self,
        text: &[u16],
        graphemes: &[u32],
        kinds: u8,
    ) -> Result<&[u8], UnicodeError> {
        if self.lane.len() != text.len() + 1 {
            // Never computed, or computed for another text: start over.
            self.invalidate();
            self.lane.clear();
            self.lane
                .try_reserve_exact(text.len() + 1)
                .map_err(|_| UnicodeError::ResultTooLarge)?;
            self.lane.resize(text.len() + 1, 0);
        }
        if kinds & GRAPHEME_BOUNDARY != 0 && !self.graphemes_ready {
            for entry in &mut self.lane {
                *entry &= !GRAPHEME_BOUNDARY;
            }
            for &boundary in graphemes {
                self.lane[boundary as usize] |= GRAPHEME_BOUNDARY;
            }
            self.graphemes_ready = true;
        }
        for segmentation in Segmentation::ALL {
            if kinds & segmentation.bit() == 0 {
                continue;
            }
            match self.states[segmentation.index()] {
                LaneState::Ready => {}
                LaneState::Stale => self.compute(segmentation, text, 0, text.len())?,
                LaneState::Dirty { start, end } => {
                    // Two units of margin keep every unit a restart predicate reads at the window
                    // ends outside the edit, so the restart also held before it.
                    let (from, to) = resync::resync_window(
                        segmentation.resync_lane(),
                        text,
                        start.saturating_sub(2),
                        end.saturating_add(2).min(text.len()),
                    );
                    self.compute(segmentation, text, from, to)?;
                }
            }
            self.states[segmentation.index()] = LaneState::Ready;
        }
        Ok(&self.lane)
    }

    /// Recomputes one lane over offsets `[from, to]`, where both are text ends or restart points.
    fn compute(
        &mut self,
        segmentation: Segmentation,
        text: &[u16],
        from: usize,
        to: usize,
    ) -> Result<(), UnicodeError> {
        let bit = segmentation.bit();
        self.window.clear();
        self.window
            .try_reserve_exact(to - from + 1)
            .map_err(|_| UnicodeError::ResultTooLarge)?;
        self.window.resize(to - from + 1, 0);
        let window = &text[from..to];
        match &self.source {
            Some(source) => source.mark(segmentation, window, &mut self.window)?,
            None => Uax29BreakSource.mark(segmentation, window, &mut self.window)?,
        }
        let joint = |position: usize| {
            position == 0
                || position == text.len()
                || resync::restart(segmentation.resync_lane(), text, position)
                    != Some(Joint::Continuation)
        };
        self.window[0] = if joint(from) { bit } else { 0 };
        self.window[to - from] = if joint(to) { bit } else { 0 };
        for (entry, computed) in self.lane[from..=to].iter_mut().zip(&self.window) {
            *entry = (*entry & !bit) | (computed & bit);
        }
        Ok(())
    }
}

/// The first offset after `offset` whose lane entry has `kind`, or the text end.
pub fn next_boundary(lane: &[u8], offset: usize, kind: u8) -> usize {
    let last = lane.len().saturating_sub(1);
    (offset.saturating_add(1)..last)
        .find(|position| lane[*position] & kind != 0)
        .unwrap_or(last)
}

/// The last offset before `offset` whose lane entry has `kind`, or 0.
pub fn previous_boundary(lane: &[u8], offset: usize, kind: u8) -> usize {
    (1..offset.min(lane.len()))
        .rev()
        .find(|position| lane[*position] & kind != 0)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use alloc::{string::String, vec::Vec};
    use core::sync::atomic::{AtomicUsize, Ordering};

    use unicode_segmentation::UnicodeSegmentation;

    use super::*;
    use crate::unicode::{UnicodeAnalysis, resync::tests::ALPHABET};

    fn units(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    fn positions(lane: &[u8], bit: u8) -> Vec<u32> {
        (0..lane.len())
            .filter(|position| lane[*position] & bit != 0)
            .map(|position| position as u32)
            .collect()
    }

    /// The crate's boundaries of the whole text, both ends included.
    fn reference(text: &[u16], segmentation: Segmentation) -> Vec<u32> {
        let string = String::from_utf16(text).unwrap();
        let mut all: Vec<u32> = match segmentation {
            Segmentation::Word => string
                .split_word_bound_indices()
                .map(|(byte, _)| string[..byte].encode_utf16().count() as u32)
                .collect(),
            Segmentation::Sentence => string
                .split_sentence_bound_indices()
                .map(|(byte, _)| string[..byte].encode_utf16().count() as u32)
                .collect(),
        };
        all.push(0);
        all.push(text.len() as u32);
        all.sort_unstable();
        all.dedup();
        all
    }

    static COUNTED_CALLS: AtomicUsize = AtomicUsize::new(0);

    struct Counting;

    impl BreakSource for Counting {
        fn mark(
            &self,
            segmentation: Segmentation,
            text: &[u16],
            lane: &mut [u8],
        ) -> Result<(), UnicodeError> {
            COUNTED_CALLS.fetch_add(1, Ordering::Relaxed);
            Uax29BreakSource.mark(segmentation, text, lane)
        }
    }

    #[test]
    fn analysis_and_unqueried_edits_do_no_word_or_sentence_work() {
        let mut analysis = UnicodeAnalysis::default();
        analysis.boundary_lanes_mut().set_source(Box::new(Counting));
        let calls = || COUNTED_CALLS.load(Ordering::Relaxed);
        for text in ["Hello world. Next one.", "ไทย ภาษา", "a b c"] {
            analysis.analyze(&units(text)).unwrap();
        }
        let text = units("Hello world. Next one.");
        analysis.analyze(&text).unwrap();
        let edited = units("Hello there world. Next one.");
        analysis.analyze_edit(&edited, 6, 0, 6).unwrap();
        assert_eq!(
            calls(),
            0,
            "analysis and edits computed word or sentence bits"
        );
        // Graphemes come from the analysis and never reach the source.
        let lane = analysis
            .boundary_lane(&edited, GRAPHEME_BOUNDARY)
            .unwrap()
            .to_vec();
        assert_eq!(positions(&lane, GRAPHEME_BOUNDARY).len(), edited.len() + 1);
        assert_eq!(calls(), 0);
        analysis.boundary_lane(&edited, WORD_BOUNDARY).unwrap();
        assert_eq!(calls(), 1);
        analysis.boundary_lane(&edited, WORD_BOUNDARY).unwrap();
        assert_eq!(calls(), 1, "a current lane is not recomputed");
        // An edit nobody queries pays nothing, even with a lane computed.
        let again = units("Hello there, world. Next one.");
        analysis.analyze_edit(&again, 11, 0, 1).unwrap();
        analysis.analyze(&again).unwrap();
        assert_eq!(calls(), 1);
        analysis.boundary_lane(&again, SENTENCE_BOUNDARY).unwrap();
        assert_eq!(calls(), 2);
    }

    #[test]
    fn lanes_match_the_reference_and_navigate() {
        let text = units("Mr. Smith's dog\u{2014}isn't it? Yes.\nไทย 日本語");
        let mut analysis = UnicodeAnalysis::default();
        analysis.analyze(&text).unwrap();
        let lane = analysis
            .boundary_lane(&text, GRAPHEME_BOUNDARY | WORD_BOUNDARY | SENTENCE_BOUNDARY)
            .unwrap()
            .to_vec();
        assert_eq!(
            positions(&lane, WORD_BOUNDARY),
            reference(&text, Segmentation::Word)
        );
        assert_eq!(
            positions(&lane, SENTENCE_BOUNDARY),
            reference(&text, Segmentation::Sentence)
        );
        assert_eq!(next_boundary(&lane, 0, WORD_BOUNDARY), 2);
        assert_eq!(previous_boundary(&lane, 2, WORD_BOUNDARY), 0);
        assert_eq!(next_boundary(&lane, text.len(), WORD_BOUNDARY), text.len());
        assert_eq!(previous_boundary(&lane, 0, WORD_BOUNDARY), 0);
        let empty: [u16; 0] = [];
        analysis.analyze(&empty).unwrap();
        let lane = analysis
            .boundary_lane(&empty, WORD_BOUNDARY | SENTENCE_BOUNDARY)
            .unwrap();
        assert_eq!(lane, &[WORD_BOUNDARY | SENTENCE_BOUNDARY]);
    }

    fn xorshift(state: &mut u64) -> u64 {
        *state ^= *state << 13;
        *state ^= *state >> 7;
        *state ^= *state << 17;
        *state
    }

    fn random_text(state: &mut u64, length: usize) -> String {
        let mut text = String::new();
        for _ in 0..length {
            text.push_str(ALPHABET[(xorshift(state) as usize >> 8) % ALPHABET.len()]);
        }
        text
    }

    /// Several edits, queried at random between them: the windowed lanes equal the lanes of the
    /// final text computed whole.
    #[test]
    fn windowed_recompute_equals_whole_text_recompute() {
        let mut state = 0x6a09_e667_f3bc_c909u64;
        let rounds = if cfg!(debug_assertions) {
            4_000
        } else {
            100_000
        };
        let all = GRAPHEME_BOUNDARY | WORD_BOUNDARY | SENTENCE_BOUNDARY;
        let mut analysis = UnicodeAnalysis::default();
        let mut fresh = UnicodeAnalysis::default();
        let mut windowed = 0usize;
        for _ in 0..rounds {
            let length = 1 + (xorshift(&mut state) % 24) as usize;
            let mut text = units(&random_text(&mut state, length));
            analysis.analyze(&text).unwrap();
            analysis.boundary_lane(&text, all).unwrap();
            let edits = 1 + (xorshift(&mut state) % 3) as usize;
            for _ in 0..edits {
                let inserted = (xorshift(&mut state) % 4) as usize;
                let insert = units(&random_text(&mut state, inserted));
                let start = (xorshift(&mut state) as usize) % (text.len() + 1);
                let removed = ((xorshift(&mut state) as usize) % 4).min(text.len() - start);
                let mut next = text[..start].to_vec();
                next.extend_from_slice(&insert);
                next.extend_from_slice(&text[start + removed..]);
                // The engine rejects edits that split a surrogate pair before analysis.
                if String::from_utf16(&next).is_err() {
                    continue;
                }
                analysis
                    .analyze_edit(&next, start, removed, insert.len())
                    .unwrap();
                text = next;
                windowed += 1;
                let query = match xorshift(&mut state) % 4 {
                    0 => 0,
                    1 => WORD_BOUNDARY,
                    2 => SENTENCE_BOUNDARY,
                    _ => all,
                };
                analysis.boundary_lane(&text, query).unwrap();
            }
            let lane = analysis.boundary_lane(&text, all).unwrap().to_vec();
            fresh.analyze(&text).unwrap();
            let expected = fresh.boundary_lane(&text, all).unwrap();
            assert_eq!(
                lane,
                expected,
                "{}",
                String::from_utf16_lossy(&text).escape_unicode()
            );
            assert_eq!(
                positions(expected, WORD_BOUNDARY),
                reference(&text, Segmentation::Word)
            );
            assert_eq!(
                positions(expected, SENTENCE_BOUNDARY),
                reference(&text, Segmentation::Sentence)
            );
        }
        assert!(windowed > rounds);
    }

    /// A window recompute must not rerun the whole text when the edit sits between resync points.
    #[test]
    fn a_local_edit_recomputes_only_its_window() {
        struct Widest;
        static WIDEST: AtomicUsize = AtomicUsize::new(0);
        impl BreakSource for Widest {
            fn mark(
                &self,
                segmentation: Segmentation,
                text: &[u16],
                lane: &mut [u8],
            ) -> Result<(), UnicodeError> {
                WIDEST.fetch_max(text.len(), Ordering::Relaxed);
                Uax29BreakSource.mark(segmentation, text, lane)
            }
        }
        let text = units(&"word ".repeat(200));
        let mut analysis = UnicodeAnalysis::default();
        analysis.boundary_lanes_mut().set_source(Box::new(Widest));
        analysis.analyze(&text).unwrap();
        analysis.boundary_lane(&text, WORD_BOUNDARY).unwrap();
        assert_eq!(WIDEST.swap(0, Ordering::Relaxed), text.len());
        let mut edited = text.clone();
        edited[502] = u16::from(b'a');
        analysis.analyze_edit(&edited, 502, 1, 1).unwrap();
        analysis.boundary_lane(&edited, WORD_BOUNDARY).unwrap();
        assert!(WIDEST.load(Ordering::Relaxed) <= 12);
    }
}
