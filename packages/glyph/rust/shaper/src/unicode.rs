use crate::cold_growth::ColdGrowth as _;
use alloc::{boxed::Box, string::String, vec::Vec};
use unicode_segmentation::UnicodeSegmentation;

use crate::line_break::{LineBreak, LineBreakAnalysis};

mod generated {
    include!("generated/script_data.rs");
}

#[path = "unicode_kernel.rs"]
pub(crate) mod kernel;

#[path = "unicode_resync.rs"]
pub mod resync;

#[path = "unicode_boundaries.rs"]
pub mod boundaries;

#[path = "unicode_trie.rs"]
pub(crate) mod trie;

pub use boundaries::{
    BoundaryLanes, BreakSource, GRAPHEME_BOUNDARY, SENTENCE_BOUNDARY, Segmentation,
    Uax29BreakSource, WORD_BOUNDARY,
};
pub use generated::UNICODE_VERSION;
pub use kernel::KernelCoverage;

pub const COMMON_SCRIPT: u32 = generated::COMMON_SCRIPT;
pub const INHERITED_SCRIPT: u32 = generated::INHERITED_SCRIPT;
pub const UNKNOWN_SCRIPT: u32 = generated::UNKNOWN_SCRIPT;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnicodeError {
    InvalidUtf16,
    ResultTooLarge,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ScriptItem {
    pub text_start: u32,
    pub text_end: u32,
    pub script: u32,
}

/// A neutral grapheme whose script waits for the next explicit script.
#[derive(Clone, Copy)]
struct DeferredScript {
    text_start: u32,
    text_end: u32,
    /// The script the forward pass gave it, or `COMMON_SCRIPT` while it still waits.
    forward: u32,
    candidates_start: u32,
    candidates_end: u32,
}

#[derive(Default)]
pub struct UnicodeAnalysis {
    utf8: String,
    kernel: kernel::Kernel,
    /// The scalar line breaker: the whole text on the scalar path, one window at a time otherwise.
    line_breaks: LineBreakAnalysis,
    breaks: Vec<LineBreak>,
    grapheme_boundaries: Vec<u32>,
    grapheme_scripts: Vec<u32>,
    candidate_offsets: Vec<u32>,
    candidate_tags: Vec<u32>,
    candidate_scratch: Vec<u32>,
    script_items: Vec<ScriptItem>,
    deferred_scripts: Vec<DeferredScript>,
    deferred_tags: Vec<u32>,
    previous_script: u32,
    previous_script_id: u8,
    /// What `analyze_edited` analysed around the edit, before it is joined to the kept lanes.
    window_breaks: Vec<LineBreak>,
    window_boundaries: Vec<u32>,
    window_items: Vec<ScriptItem>,
    /// Grapheme, word and sentence bits for editing, computed on first query, never by `analyze`.
    /// Boxed on first use, so an analysis nobody queries carries one null pointer.
    boundaries: Option<Box<BoundaryLanes>>,
    #[cfg(test)]
    analysis_count: usize,
    #[cfg(test)]
    windowed_count: usize,
}

impl UnicodeAnalysis {
    pub fn reserve(&mut self, utf16_capacity: usize) -> Result<(), UnicodeError> {
        reserve(
            &mut self.grapheme_boundaries,
            utf16_capacity.saturating_add(1),
        )?;
        reserve(&mut self.breaks, utf16_capacity.saturating_add(1))?;
        self.kernel
            .reserve(utf16_capacity)
            .map_err(|()| UnicodeError::ResultTooLarge)
    }

    /// Analyses `text`: the dense kernel decides every closure unit and the scalar analysis decides
    /// the windows around everything else. The result equals `analyze_scalar` for every text.
    pub fn analyze(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        #[cfg(test)]
        {
            self.analysis_count += 1;
        }
        self.clear();
        self.reserve(text.len())?;
        self.kernel.run(text);
        self.grapheme_boundaries.push(0);
        self.previous_script = COMMON_SCRIPT;
        self.previous_script_id = 0;
        let mut position = 0usize;
        for index in 0..self.kernel.windows.len() {
            let (start, end) = self.kernel.windows[index];
            let (start, end) = (start as usize, end as usize);
            self.emit_stretch(text, position, start)?;
            self.emit_window(text, start, end)?;
            position = end;
        }
        self.emit_stretch(text, position, text.len())?;
        let ends_in_window = self
            .kernel
            .windows
            .last()
            .is_some_and(|window| window.1 as usize == text.len());
        if !ends_in_window || text.is_empty() {
            self.breaks.push(LineBreak {
                position: u32::try_from(text.len()).map_err(|_| UnicodeError::ResultTooLarge)?,
                required: true,
            });
        }
        self.flush_deferred_scripts(COMMON_SCRIPT);
        Ok(())
    }

    fn swap_window_lanes(&mut self) {
        core::mem::swap(&mut self.breaks, &mut self.window_breaks);
        core::mem::swap(&mut self.grapheme_boundaries, &mut self.window_boundaries);
        core::mem::swap(&mut self.script_items, &mut self.window_items);
    }

    /// The conformance-tested scalar analysis of the whole text: the reference the kernel equals.
    pub fn analyze_scalar(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.clear();
        reserve(&mut self.grapheme_boundaries, text.len().saturating_add(1))?;
        reserve(&mut self.grapheme_scripts, text.len())?;
        reserve(&mut self.candidate_offsets, text.len().saturating_add(1))?;
        encode_utf16(text, &mut self.utf8)?;
        self.line_breaks.analyze(text)?;
        self.breaks.extend_from_slice(self.line_breaks.breaks());
        self.segment_graphemes()?;
        self.resolve_grapheme_scripts(text)?;
        self.resolve_neutral_scripts();
        self.itemize_scripts()?;
        Ok(())
    }

    /// Analyses `text`, which is the text `previous` analysed with units
    /// `[start, start + removed)` replaced by `inserted` units, by analysing only a window
    /// around the edit and keeping `previous`'s results outside it. Equal to `analyze(text)`.
    ///
    /// Line breaks and graphemes change only between two restart points that hold in both texts
    /// (`resync::restart`; the two units of margin keep every unit a restart predicate reads
    /// outside the edit). Scripts have no restart points: a neutral grapheme takes its script
    /// from the explicit scripts on either side, however far, and an explicit grapheme takes it
    /// from nothing. So the analysed window runs from the last grapheme with an explicit script
    /// that ends at or before the first restart to the first one that starts at or after the
    /// second; the script items inside it are those of the window alone, and the breaks and
    /// graphemes between the restarts are too, because the restarts hold inside the window.
    pub fn analyze_edited(
        &mut self,
        previous: &Self,
        text: &[u16],
        start: usize,
        removed: usize,
        inserted: usize,
    ) -> Result<(), UnicodeError> {
        let old_length = previous
            .grapheme_boundaries
            .last()
            .map_or(0, |end| *end as usize);
        let edited_end = start.saturating_add(inserted);
        if previous.grapheme_boundaries.is_empty()
            || start.saturating_add(removed) > old_length
            || old_length - removed + inserted != text.len()
            || text.is_empty()
        {
            return self.analyze(text);
        }
        let (from, to) = resync::resync_window(
            resync::Lane::LineBreak,
            text,
            start.saturating_sub(2),
            edited_end.saturating_add(2).min(text.len()),
        );
        // Old offsets at or after the edit's end are new offsets less `shift`, wrapping.
        let shift = (inserted as u32).wrapping_sub(removed as u32);
        let (from, to) = (from as u32, to as u32);
        let old_to = to.wrapping_sub(shift);
        let Some((window_from, window_to)) =
            self.script_window(previous, text, from, old_to, shift)?
        else {
            return self.analyze(text);
        };
        if window_from == 0 && window_to as usize == text.len() {
            return self.analyze(text);
        }

        #[cfg(test)]
        {
            self.windowed_count += 1;
        }
        // The window is analysed into the small scratch lanes, so the full-length lanes keep
        // their storage for the joined result.
        self.swap_window_lanes();
        let analysed = self.analyze(&text[window_from as usize..window_to as usize]);
        self.swap_window_lanes();
        analysed?;
        self.clear();
        reserve(&mut self.grapheme_boundaries, text.len().saturating_add(1))?;
        reserve(&mut self.breaks, text.len().saturating_add(1))?;

        let joint = |position: u32| LineBreak {
            position,
            required: resync::restart(resync::Lane::LineBreak, text, position as usize)
                == Some(resync::Joint::RequiredBreak),
        };
        let kept = previous
            .breaks
            .partition_point(|line_break| line_break.position < from);
        self.breaks.extend_from_slice(&previous.breaks[..kept]);
        if from > 0 {
            self.breaks.push(joint(from));
        }
        let (inner_from, inner_to) = (from - window_from, to - window_from);
        let first = self
            .window_breaks
            .partition_point(|line_break| line_break.position <= inner_from);
        let last = self
            .window_breaks
            .partition_point(|line_break| line_break.position < inner_to);
        self.breaks.extend(
            self.window_breaks[first..last]
                .iter()
                .map(|line_break| LineBreak {
                    position: line_break.position + window_from,
                    required: line_break.required,
                }),
        );
        if to as usize == text.len() {
            self.breaks.push(LineBreak {
                position: to,
                required: true,
            });
        } else {
            self.breaks.push(joint(to));
        }
        let resumed = previous
            .breaks
            .partition_point(|line_break| line_break.position <= old_to);
        self.breaks.extend(
            previous.breaks[resumed..]
                .iter()
                .map(|line_break| LineBreak {
                    position: line_break.position.wrapping_add(shift),
                    required: line_break.required,
                }),
        );

        let kept = previous
            .grapheme_boundaries
            .partition_point(|boundary| *boundary <= from);
        self.grapheme_boundaries
            .extend_from_slice(&previous.grapheme_boundaries[..kept]);
        let first = self
            .window_boundaries
            .partition_point(|boundary| *boundary <= inner_from);
        let last = self
            .window_boundaries
            .partition_point(|boundary| *boundary <= inner_to);
        self.grapheme_boundaries.extend(
            self.window_boundaries[first..last]
                .iter()
                .map(|boundary| boundary + window_from),
        );
        let resumed = previous
            .grapheme_boundaries
            .partition_point(|boundary| *boundary <= old_to);
        self.grapheme_boundaries.extend(
            previous.grapheme_boundaries[resumed..]
                .iter()
                .map(|boundary| boundary.wrapping_add(shift)),
        );

        // Script items are the maximal runs of the per-unit script, so clipping the kept items
        // at the window and merging equal neighbours at the two seams rebuilds them.
        for item in &previous.script_items {
            if item.text_start >= window_from {
                break;
            }
            self.push_script_item(item.text_start, item.text_end.min(window_from), item.script);
        }
        for index in 0..self.window_items.len() {
            let item = self.window_items[index];
            self.push_script_item(
                item.text_start + window_from,
                item.text_end + window_from,
                item.script,
            );
        }
        let old_window_to = window_to.wrapping_sub(shift);
        let resumed = previous
            .script_items
            .partition_point(|item| item.text_end <= old_window_to);
        for item in &previous.script_items[resumed..] {
            self.push_script_item(
                item.text_start.max(old_window_to).wrapping_add(shift),
                item.text_end.wrapping_add(shift),
                item.script,
            );
        }
        Ok(())
    }

    /// The window `analyze_edited` analyses, in offsets of `text`: from the start of the last
    /// explicit-script grapheme ending at or before `from` (or the text's start) to the end of
    /// the first one starting at or after the restart that was at `old_to` in `previous` (or
    /// the text's end). Graphemes outside the restarts are `previous`'s. `None` when `previous`
    /// has no boundary at a restart, which a consistent analysis always has.
    fn script_window(
        &mut self,
        previous: &Self,
        text: &[u16],
        from: u32,
        old_to: u32,
        shift: u32,
    ) -> Result<Option<(u32, u32)>, UnicodeError> {
        let boundaries = previous.grapheme_boundaries.as_slice();
        let (Ok(before), Ok(after)) = (
            boundaries.binary_search(&from),
            boundaries.binary_search(&old_to),
        ) else {
            return Ok(None);
        };
        let mut window_from = 0;
        for index in (1..=before).rev() {
            let (start, end) = (boundaries[index - 1], boundaries[index]);
            let (script, _) = grapheme_script_atom(
                text,
                start as usize,
                end as usize,
                &mut self.candidate_scratch,
            )?;
            if !is_neutral_script(script) {
                window_from = start;
                break;
            }
        }
        let mut window_to = text.len() as u32;
        for index in after..boundaries.len() - 1 {
            let start = boundaries[index].wrapping_add(shift);
            let end = boundaries[index + 1].wrapping_add(shift);
            let (script, _) = grapheme_script_atom(
                text,
                start as usize,
                end as usize,
                &mut self.candidate_scratch,
            )?;
            if !is_neutral_script(script) {
                window_to = end;
                break;
            }
        }
        Ok(Some((window_from, window_to)))
    }

    /// Analyses `text`, the previous text with units `[start, start + removed)` replaced by
    /// `inserted` units, and keeps the boundary lanes already computed outside the edit: they
    /// recompute only the window around it, and only when next queried.
    pub fn analyze_edit(
        &mut self,
        text: &[u16],
        start: usize,
        removed: usize,
        inserted: usize,
    ) -> Result<(), UnicodeError> {
        let mut lanes = self.boundaries.take();
        let analysed = self.analyze(text);
        if let Some(lanes) = &mut lanes {
            lanes.splice(start, removed, inserted);
            if analysed.is_err() {
                lanes.invalidate();
            }
        }
        self.boundaries = lanes;
        analysed
    }

    /// The boundary lane of `text`, which must be the text of the last `analyze`: one byte per
    /// UTF-16 offset, `text.len() + 1` entries, with every kind in `kinds` (`GRAPHEME_BOUNDARY`,
    /// `WORD_BOUNDARY`, `SENTENCE_BOUNDARY`) current. Word and sentence bits are computed here on
    /// first query, and after an `analyze_edit` only around the edit.
    pub fn boundary_lane(&mut self, text: &[u16], kinds: u8) -> Result<&[u8], UnicodeError> {
        debug_assert_eq!(
            self.grapheme_boundaries.last().copied(),
            Some(text.len() as u32),
            "boundary_lane asks about a text other than the analysed one"
        );
        self.boundaries
            .get_or_insert_default()
            .ensure(text, &self.grapheme_boundaries, kinds)
    }

    /// The boundary lane when every kind in `kinds` is already current for the analysed text, for
    /// a reader that must not compute: `None` until `boundary_lane` has filled those kinds.
    pub fn prepared_boundary_lane(&self, kinds: u8) -> Option<&[u8]> {
        let units = self.grapheme_boundaries.last().copied()? as usize;
        self.boundaries.as_ref()?.current(units, kinds)
    }

    /// Forgets the boundary lanes, for a caller that keeps this analysis for an edited text
    /// instead of running `analyze` again. Lanes never queried cost one branch here.
    pub fn invalidate_boundary_lanes(&mut self) {
        if let Some(lanes) = &mut self.boundaries {
            lanes.invalidate();
        }
    }

    /// Whether a word or sentence query has filled a lane that is still kept.
    pub fn has_computed_boundary_lanes(&self) -> bool {
        self.boundaries
            .as_ref()
            .is_some_and(|lanes| lanes.any_kept())
    }

    /// Takes the boundary lanes out when a query has filled one, to carry them to the analysis
    /// of an edited text. `None`, and nothing taken, when no lane is computed.
    pub fn take_computed_boundary_lanes(&mut self) -> Option<Box<BoundaryLanes>> {
        if self.has_computed_boundary_lanes() {
            self.boundaries.take()
        } else {
            None
        }
    }

    /// Installs lanes carried from the analysis of the text before an edit. The caller has told
    /// them about the edit with `BoundaryLanes::splice`.
    pub fn adopt_boundary_lanes(&mut self, lanes: Box<BoundaryLanes>) {
        self.boundaries = Some(lanes);
    }

    /// The paragraph's boundary lanes: to install another `BreakSource`, or to move computed lanes
    /// to the analysis of the edited text before `BoundaryLanes::splice`.
    pub fn boundary_lanes_mut(&mut self) -> &mut BoundaryLanes {
        self.boundaries.get_or_insert_default()
    }

    /// How much of the last `analyze` the kernel decided, for measurement. After
    /// `analyze_edited` the windows and residue are those of the analysed window.
    pub fn kernel_coverage(&self) -> KernelCoverage {
        self.kernel.coverage(
            self.grapheme_boundaries
                .last()
                .map_or(0, |end| *end as usize),
        )
    }

    pub fn grapheme_boundaries(&self) -> &[u32] {
        &self.grapheme_boundaries
    }

    pub fn script_items(&self) -> &[ScriptItem] {
        &self.script_items
    }

    #[cfg(test)]
    pub(crate) fn analysis_count(&self) -> usize {
        self.analysis_count
    }

    pub fn line_breaks(&self) -> &[LineBreak] {
        &self.breaks
    }

    pub(crate) fn clear(&mut self) {
        self.utf8.clear();
        self.line_breaks.clear();
        self.breaks.clear();
        self.grapheme_boundaries.clear();
        self.grapheme_scripts.clear();
        self.candidate_offsets.clear();
        self.candidate_tags.clear();
        self.candidate_scratch.clear();
        self.script_items.clear();
        self.deferred_scripts.clear();
        self.deferred_tags.clear();
        if let Some(lanes) = &mut self.boundaries {
            lanes.invalidate();
        }
    }

    /// Emits the kernel's results for closure units `[start, end)` and the boundary at `end`.
    fn emit_stretch(&mut self, text: &[u16], start: usize, end: usize) -> Result<(), UnicodeError> {
        self.kernel.append_breaks(start, end, &mut self.breaks);
        self.grapheme_boundaries
            .extend((start + 1..=end).map(|boundary| boundary as u32));
        self.emit_stretch_scripts(text, start, end)
    }

    /// Streams the script bytes of closure units `[start, end)` into the script items.
    fn emit_stretch_scripts(
        &mut self,
        text: &[u16],
        start: usize,
        end: usize,
    ) -> Result<(), UnicodeError> {
        let mut index = start;
        while index < end {
            let id = self.kernel.scripts[index];
            // The common case: the open item absorbs neutral units and units of its own script.
            if self.deferred_scripts.is_empty()
                && self.previous_script != COMMON_SCRIPT
                && (id == 0 || id == self.previous_script_id)
            {
                let run_end =
                    same_script_run(&self.kernel.scripts[..end], index, self.previous_script_id);
                if let Some(item) = self.script_items.last_mut() {
                    item.text_end = run_end as u32;
                }
                index = run_end;
                continue;
            }
            let (start, end) = (index as u32, index as u32 + 1);
            if id == 0 {
                self.feed_script(start, end, COMMON_SCRIPT, &[]);
            } else if id == kernel::KERNEL_SCRIPT_COMPLEX {
                let (preferred, has_candidates) =
                    grapheme_script_atom(text, index, index + 1, &mut self.candidate_scratch)?;
                self.feed_scratch_script(start, end, preferred, has_candidates);
            } else if id >= kernel::KERNEL_SCRIPT_SET_BASE {
                self.feed_script(start, end, COMMON_SCRIPT, kernel::script_set(id));
            } else {
                let script = kernel::KERNEL_SCRIPT_TAGS[usize::from(id)];
                if self.deferred_scripts.is_empty() {
                    // A script switch with nothing waiting: the new item starts here.
                    self.previous_script = script;
                    self.push_script_item(start, end, script);
                } else {
                    self.feed_script(start, end, script, &[]);
                }
                self.previous_script_id = id;
            }
            index += 1;
        }
        Ok(())
    }

    /// Runs the scalar analysis on `text[start..end)` as an independent string.
    fn emit_window(&mut self, text: &[u16], start: usize, end: usize) -> Result<(), UnicodeError> {
        let window = &text[start..end];
        self.line_breaks.analyze(window)?;
        for line_break in self.line_breaks.breaks() {
            // The window's own end-of-text break stands only when the window ends the text.
            if line_break.position as usize == window.len() && end != text.len() {
                continue;
            }
            self.breaks.push(LineBreak {
                position: line_break.position + start as u32,
                required: line_break.required,
            });
        }
        self.utf8.clear();
        encode_utf16(window, &mut self.utf8)?;
        let mut grapheme_start = start;
        let utf8 = core::mem::take(&mut self.utf8);
        for grapheme in utf8.graphemes(true) {
            let grapheme_end =
                grapheme_start + grapheme.chars().map(char::len_utf16).sum::<usize>();
            self.grapheme_boundaries.push(grapheme_end as u32);
            let (preferred, has_candidates) = grapheme_script_atom(
                text,
                grapheme_start,
                grapheme_end,
                &mut self.candidate_scratch,
            )?;
            self.feed_scratch_script(
                grapheme_start as u32,
                grapheme_end as u32,
                preferred,
                has_candidates,
            );
            grapheme_start = grapheme_end;
        }
        self.utf8 = utf8;
        Ok(())
    }

    /// `feed_script` with the candidates `grapheme_script_atom` left in the scratch buffer.
    fn feed_scratch_script(&mut self, text_start: u32, text_end: u32, preferred: u32, has: bool) {
        let scratch = core::mem::take(&mut self.candidate_scratch);
        let candidates = if has { scratch.as_slice() } else { &[] };
        self.feed_script(text_start, text_end, preferred, candidates);
        self.candidate_scratch = scratch;
    }

    /// Streams one grapheme into the script items; equal to the two-pass neutral resolution.
    ///
    /// `candidates` are the Script_Extensions a neutral grapheme accepts; empty accepts any.
    fn feed_script(&mut self, text_start: u32, text_end: u32, preferred: u32, candidates: &[u32]) {
        if !is_neutral_script(preferred) {
            self.flush_deferred_scripts(preferred);
            self.previous_script = preferred;
            self.previous_script_id = 0;
            self.push_script_item(text_start, text_end, preferred);
            return;
        }
        let accepts_previous = !is_neutral_script(self.previous_script)
            && (candidates.is_empty() || candidates.contains(&self.previous_script));
        if accepts_previous && self.deferred_scripts.is_empty() {
            self.push_script_item(text_start, text_end, self.previous_script);
            return;
        }
        let candidates_start = self.deferred_tags.len() as u32;
        self.deferred_tags.extend_from_slice(candidates);
        self.deferred_scripts.push(DeferredScript {
            text_start,
            text_end,
            forward: if accepts_previous {
                self.previous_script
            } else {
                COMMON_SCRIPT
            },
            candidates_start,
            candidates_end: self.deferred_tags.len() as u32,
        });
    }

    /// Resolves the waiting neutral graphemes against `next`, the explicit script that follows
    /// them (`COMMON_SCRIPT` at the end of the text), exactly as the backward pass does: a
    /// grapheme the forward pass resolved shadows `next` for the graphemes before it.
    fn flush_deferred_scripts(&mut self, next: u32) {
        let mut context = next;
        for index in (0..self.deferred_scripts.len()).rev() {
            let deferred = self.deferred_scripts[index];
            if !is_neutral_script(deferred.forward) {
                context = deferred.forward;
                continue;
            }
            let candidates = &self.deferred_tags
                [deferred.candidates_start as usize..deferred.candidates_end as usize];
            if !is_neutral_script(context)
                && (candidates.is_empty() || candidates.contains(&context))
            {
                self.deferred_scripts[index].forward = context;
            }
        }
        for index in 0..self.deferred_scripts.len() {
            let deferred = self.deferred_scripts[index];
            self.push_script_item(deferred.text_start, deferred.text_end, deferred.forward);
        }
        self.deferred_scripts.clear();
        self.deferred_tags.clear();
    }

    fn push_script_item(&mut self, text_start: u32, text_end: u32, script: u32) {
        if let Some(previous) = self.script_items.last_mut()
            && previous.text_end == text_start
            && previous.script == script
        {
            previous.text_end = text_end;
        } else {
            self.script_items.push(ScriptItem {
                text_start,
                text_end,
                script,
            });
        }
    }

    fn segment_graphemes(&mut self) -> Result<(), UnicodeError> {
        self.grapheme_boundaries.push(0);
        let mut utf16_end = 0usize;
        for grapheme in self.utf8.graphemes(true) {
            utf16_end = utf16_end
                .checked_add(grapheme.chars().map(char::len_utf16).sum::<usize>())
                .ok_or(UnicodeError::ResultTooLarge)?;
            self.grapheme_boundaries
                .push(u32::try_from(utf16_end).map_err(|_| UnicodeError::ResultTooLarge)?);
        }
        Ok(())
    }

    fn resolve_grapheme_scripts(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.candidate_offsets.push(0);
        for index in 0..self.grapheme_boundaries.len().saturating_sub(1) {
            let start = self.grapheme_boundaries[index] as usize;
            let end = self.grapheme_boundaries[index + 1] as usize;
            let (preferred, has_candidates) =
                grapheme_script_atom(text, start, end, &mut self.candidate_scratch)?;
            self.grapheme_scripts.push(preferred);
            if has_candidates {
                self.candidate_tags
                    .extend_from_slice(&self.candidate_scratch);
            }
            self.candidate_offsets.push(
                u32::try_from(self.candidate_tags.len())
                    .map_err(|_| UnicodeError::ResultTooLarge)?,
            );
        }
        Ok(())
    }

    fn resolve_neutral_scripts(&mut self) {
        let mut previous = COMMON_SCRIPT;
        for index in 0..self.grapheme_scripts.len() {
            let current = self.grapheme_scripts[index];
            if is_neutral_script(current) {
                if self.accepts_context(index, previous) {
                    self.grapheme_scripts[index] = previous;
                }
            } else {
                previous = current;
            }
        }
        let mut next = COMMON_SCRIPT;
        for index in (0..self.grapheme_scripts.len()).rev() {
            let current = self.grapheme_scripts[index];
            if is_neutral_script(current) {
                if self.accepts_context(index, next) {
                    self.grapheme_scripts[index] = next;
                }
            } else {
                next = current;
            }
        }
    }

    fn accepts_context(&self, index: usize, context: u32) -> bool {
        if is_neutral_script(context) {
            return false;
        }
        let start = self.candidate_offsets[index] as usize;
        let end = self.candidate_offsets[index + 1] as usize;
        start == end || self.candidate_tags[start..end].contains(&context)
    }

    fn itemize_scripts(&mut self) -> Result<(), UnicodeError> {
        for (index, boundaries) in self.grapheme_boundaries.windows(2).enumerate() {
            let item = ScriptItem {
                text_start: boundaries[0],
                text_end: boundaries[1],
                script: self.grapheme_scripts[index],
            };
            if let Some(previous) = self.script_items.last_mut()
                && previous.text_end == item.text_start
                && previous.script == item.script
            {
                previous.text_end = item.text_end;
            } else {
                self.script_items.push(item);
            }
        }
        if self.grapheme_scripts.len() + 1 != self.grapheme_boundaries.len() {
            return Err(UnicodeError::InvalidUtf16);
        }
        Ok(())
    }
}

/// The script a grapheme prefers and, in `scratch`, the Script_Extensions it accepts.
///
/// Returns `(preferred, has_candidates)`; candidates count only when they exclude `preferred`.
fn grapheme_script_atom(
    text: &[u16],
    start: usize,
    end: usize,
    scratch: &mut Vec<u32>,
) -> Result<(u32, bool), UnicodeError> {
    let mut preferred = COMMON_SCRIPT;
    let mut intersected = false;
    scratch.clear();
    let mut index = start;
    while index < end {
        let (character, consumed) = decode_scalar(text, index)?;
        index += consumed;
        let primary = script(character as u32).ok_or(UnicodeError::InvalidUtf16)?;
        if !is_neutral_script(primary) && preferred == COMMON_SCRIPT {
            preferred = primary;
        }
        let extensions = script_extensions(character as u32).ok_or(UnicodeError::InvalidUtf16)?;
        if !extensions
            .iter()
            .copied()
            .any(|tag| !is_neutral_script(tag))
        {
            continue;
        }
        if !intersected {
            intersected = true;
            scratch.extend(
                extensions
                    .iter()
                    .copied()
                    .filter(|tag| !is_neutral_script(*tag)),
            );
        } else {
            scratch.retain(|tag| extensions.contains(tag));
        }
    }
    Ok((
        preferred,
        intersected && !scratch.is_empty() && !scratch.contains(&preferred),
    ))
}

/// The end of the run from `start` whose script bytes are neutral or `script`.
fn same_script_run(scripts: &[u8], start: usize, script: u8) -> usize {
    let mut index = start;
    // Fold compare over sixteen bytes, then a scalar tail: no early exit inside the chunk.
    while let Some(chunk) = scripts.get(index..index + 16) {
        let mut other = 0u8;
        for byte in chunk {
            other |= u8::from(*byte != 0) & u8::from(*byte != script);
        }
        if other != 0 {
            break;
        }
        index += 16;
    }
    while index < scripts.len() && (scripts[index] == 0 || scripts[index] == script) {
        index += 1;
    }
    index
}

pub fn script(code_point: u32) -> Option<u32> {
    // A trie: three reads instead of a binary probe per call. `script` runs per character in the
    // scalar analysis. See D-341.
    script_index(code_point).map(|index| generated::SCRIPT_VALUES[index])
}

fn script_index(code_point: u32) -> Option<usize> {
    if code_point > 0x10_ffff {
        return None;
    }
    Some(usize::from(trie::lookup(
        generated::SCRIPT_ROOT,
        generated::SCRIPT_MIDDLE,
        generated::SCRIPT_LEAVES,
        generated::SCRIPT_LEAF_SHIFT,
        generated::SCRIPT_MIDDLE_SHIFT,
        code_point,
    )))
}

pub fn script_extensions(code_point: u32) -> Option<&'static [u32]> {
    let index = script_index(code_point)?;
    let set = usize::from(trie::lookup(
        generated::SCRIPT_EXTENSION_ROOT,
        generated::SCRIPT_EXTENSION_MIDDLE,
        generated::SCRIPT_EXTENSION_LEAVES,
        generated::SCRIPT_EXTENSION_LEAF_SHIFT,
        generated::SCRIPT_EXTENSION_MIDDLE_SHIFT,
        code_point,
    ));
    if set == 0 {
        // The extensions are the code point's own script alone.
        return Some(core::slice::from_ref(&generated::SCRIPT_VALUES[index]));
    }
    let start = usize::from(generated::SCRIPT_EXTENSION_OFFSETS[set - 1]);
    let end = usize::from(generated::SCRIPT_EXTENSION_OFFSETS[set]);
    Some(&generated::SCRIPT_EXTENSION_TAGS[start..end])
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), UnicodeError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact_cold(capacity.saturating_sub(values.len()))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
    }
    Ok(())
}

fn encode_utf16(text: &[u16], output: &mut String) -> Result<(), UnicodeError> {
    let mut index = 0;
    while index < text.len() {
        let (character, consumed) = decode_scalar(text, index)?;
        output.push(character);
        index += consumed;
    }
    Ok(())
}

fn decode_scalar(text: &[u16], index: usize) -> Result<(char, usize), UnicodeError> {
    let first = text[index];
    if (0xd800..=0xdbff).contains(&first) {
        let second = text
            .get(index + 1)
            .copied()
            .filter(|unit| (0xdc00..=0xdfff).contains(unit))
            .ok_or(UnicodeError::InvalidUtf16)?;
        let scalar =
            0x1_0000 + (((u32::from(first) - 0xd800) << 10) | (u32::from(second) - 0xdc00));
        return char::from_u32(scalar)
            .map(|character| (character, 2))
            .ok_or(UnicodeError::InvalidUtf16);
    }
    if (0xdc00..=0xdfff).contains(&first) {
        return Err(UnicodeError::InvalidUtf16);
    }
    char::from_u32(u32::from(first))
        .map(|character| (character, 1))
        .ok_or(UnicodeError::InvalidUtf16)
}

fn is_neutral_script(script: u32) -> bool {
    matches!(script, COMMON_SCRIPT | INHERITED_SCRIPT | UNKNOWN_SCRIPT)
}

fn is_ascii_letter(unit: u16) -> bool {
    matches!(unit, 0x41..=0x5a | 0x61..=0x7a)
}

/// Whether an edit replaces ASCII letters with as many ASCII letters. No break, grapheme
/// boundary or script item of the text depends on which letters they are, so the analysis of
/// `previous` is the analysis of `next`.
pub(crate) fn reusable_for_ascii_letter_edit(
    previous: &[u16],
    next: &[u16],
    start: usize,
    previous_end: usize,
    next_end: usize,
) -> bool {
    if previous.len() != next.len()
        || previous_end.saturating_sub(start) != next_end.saturating_sub(start)
    {
        return false;
    }
    let (Some(previous), Some(next)) =
        (previous.get(start..previous_end), next.get(start..next_end))
    else {
        return false;
    };
    !previous.is_empty()
        && previous
            .iter()
            .zip(next)
            .all(|(&before, &after)| is_ascii_letter(before) && is_ascii_letter(after))
}

#[cfg(test)]
#[path = "unicode_kernel_tests.rs"]
mod kernel_tests;

#[cfg(test)]
mod tests {
    use super::*;

    const fn tag(value: &[u8; 4]) -> u32 {
        u32::from_be_bytes(*value)
    }

    #[test]
    fn generated_tables_are_unicode_17_scalar_partitions() {
        assert_eq!(UNICODE_VERSION, "17.0.0");
        assert_eq!(script('A' as u32), Some(tag(b"Latn")));
        assert_eq!(script('\u{4e00}' as u32), Some(tag(b"Hani")));
        assert_eq!(script(0x10_ffff), Some(UNKNOWN_SCRIPT));
        assert_eq!(script(0x11_0000), None);
    }

    #[test]
    fn script_extensions_preserve_shared_marks() {
        let prolonged_sound_mark = script_extensions('\u{30fc}' as u32).expect("extensions");
        assert!(prolonged_sound_mark.contains(&tag(b"Hira")));
        assert!(prolonged_sound_mark.contains(&tag(b"Kana")));
    }

    #[test]
    fn analysis_resolves_contextual_script_extensions() {
        for (text, expected) in [
            ("漢、字", vec![(0, 3, tag(b"Hani"))]),
            ("あ、ア", vec![(0, 2, tag(b"Hira")), (2, 3, tag(b"Kana"))]),
            ("한、글", vec![(0, 3, tag(b"Hang"))]),
            ("「日本語」", vec![(0, 5, tag(b"Hani"))]),
            ("あーア", vec![(0, 2, tag(b"Hira")), (2, 3, tag(b"Kana"))]),
            ("漢\u{e0100}字", vec![(0, 4, tag(b"Hani"))]),
        ] {
            let utf16: Vec<u16> = text.encode_utf16().collect();
            let mut analysis = UnicodeAnalysis::default();
            analysis.analyze(&utf16).unwrap();
            let actual: Vec<(u32, u32, u32)> = analysis
                .script_items()
                .iter()
                .map(|item| (item.text_start, item.text_end, item.script))
                .collect();
            assert_eq!(actual, expected, "{text:?}");
        }
    }

    #[test]
    fn analysis_segments_emoji_and_resolves_neutral_scripts() {
        let text: Vec<u16> = "Latin, हिन्दी 👩‍🚀 カー".encode_utf16().collect();
        let mut analysis = UnicodeAnalysis::default();
        analysis.reserve(64).unwrap();
        analysis.analyze(&text).unwrap();
        assert_eq!(analysis.grapheme_boundaries().first(), Some(&0));
        assert_eq!(
            analysis.grapheme_boundaries().last(),
            Some(&(text.len() as u32))
        );
        assert!(
            analysis
                .grapheme_boundaries()
                .windows(2)
                .any(|range| range[1] - range[0] == 5)
        );
        assert!(
            analysis
                .script_items()
                .iter()
                .any(|item| item.script == tag(b"Deva"))
        );
        assert!(
            analysis
                .script_items()
                .iter()
                .any(|item| item.script == tag(b"Kana"))
        );
    }

    #[test]
    fn analysis_reuses_reserved_storage_and_rejects_unpaired_surrogates() {
        let mut analysis = UnicodeAnalysis::default();
        analysis.reserve(64).unwrap();
        analysis
            .analyze(&"abc".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        let boundary_capacity = analysis.grapheme_boundaries.capacity();
        analysis
            .analyze(&"def".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert_eq!(analysis.grapheme_boundaries.capacity(), boundary_capacity);
        assert_eq!(analysis.analyze(&[0xd800]), Err(UnicodeError::InvalidUtf16));
    }

    /// Chains of random single edits over the resync alphabet: the windowed analysis of each
    /// edited text equals its cold analysis, and fails exactly when the cold one does.
    #[test]
    fn windowed_analysis_of_an_edit_equals_the_cold_analysis() {
        use resync::tests::ALPHABET;
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = move || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state as usize
        };
        let mut random = |length: usize, plain: bool| -> Vec<u16> {
            let mut text = String::new();
            for _ in 0..length {
                let pick = next() >> 8;
                text.push_str(if plain && pick % 4 != 0 {
                    // Letters with restart points, residue scripts that have none, and
                    // neutrals whose Script_Extensions limit the scripts they join.
                    [
                        "a", "b", " ", " ", "c", ".", "1", "\n", "क", "\u{94d}", "ष", "ก",
                        "\u{e34}", " ", "\n", "한", "\u{964}", "\u{301}", "ー", "\u{a8f1}",
                    ][(pick >> 4) % if pick % 3 == 0 { 20 } else { 8 }]
                } else {
                    ALPHABET[pick % ALPHABET.len()]
                });
            }
            let mut units: Vec<u16> = text.encode_utf16().collect();
            units.push((pick_seed(&units) % 7) as u16 + 0x61);
            units
        };
        fn pick_seed(units: &[u16]) -> usize {
            units.iter().map(|unit| usize::from(*unit)).sum()
        }
        let rounds = if cfg!(debug_assertions) {
            3_000
        } else {
            60_000
        };
        let (mut windowed, mut failures) = (0usize, 0usize);
        for round in 0..rounds {
            let plain = round % 3 != 0;
            let mut text = random(4 + round % 60, plain);
            let mut previous = UnicodeAnalysis::default();
            previous.analyze(&text).unwrap();
            let mut edited = UnicodeAnalysis::default();
            for step in 0..12 {
                let insert = random((round + step) % 4, plain || step % 2 == 0);
                let insert = &insert[..insert.len() - usize::from(step % 3 != 0)];
                let start = (pick_seed(insert) * 31 + step * 7 + round) % (text.len() + 1);
                let removed = ((round >> 2) + step) % 4;
                let removed = removed.min(text.len() - start);
                let mut new = text[..start].to_vec();
                new.extend_from_slice(insert);
                new.extend_from_slice(&text[start + removed..]);
                let mut cold = UnicodeAnalysis::default();
                let expected = cold.analyze(&new);
                let count = edited.windowed_count;
                let actual = edited.analyze_edited(&previous, &new, start, removed, insert.len());
                let shown = || {
                    alloc::format!(
                        "{} -> {} at {start} -{removed} +{}",
                        String::from_utf16_lossy(&text).escape_unicode(),
                        String::from_utf16_lossy(&new).escape_unicode(),
                        insert.len()
                    )
                };
                assert_eq!(actual, expected, "{}", shown());
                if expected.is_err() {
                    failures += 1;
                    break;
                }
                windowed += edited.windowed_count - count;
                assert_eq!(edited.line_breaks(), cold.line_breaks(), "{}", shown());
                assert_eq!(
                    edited.grapheme_boundaries(),
                    cold.grapheme_boundaries(),
                    "{}",
                    shown()
                );
                assert_eq!(edited.script_items(), cold.script_items(), "{}", shown());
                core::mem::swap(&mut previous, &mut edited);
                text = new;
            }
        }
        assert!(windowed > rounds, "{windowed} windowed edits");
        assert!(failures > rounds / 200, "{failures} ill-formed edits");
    }

    #[test]
    fn only_equal_length_ascii_letter_edits_reuse_unicode_structure() {
        let previous: Vec<u16> = "alpha".encode_utf16().collect();
        let letters: Vec<u16> = "aloha".encode_utf16().collect();
        let digit: Vec<u16> = "al0ha".encode_utf16().collect();
        assert!(reusable_for_ascii_letter_edit(&previous, &letters, 2, 3, 3));
        assert!(!reusable_for_ascii_letter_edit(&previous, &digit, 2, 3, 3));
        assert!(!reusable_for_ascii_letter_edit(
            &previous, &letters, 2, 4, 3
        ));
        assert!(!reusable_for_ascii_letter_edit(
            &previous, &letters, 6, 7, 7
        ));
    }
}
