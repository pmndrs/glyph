use alloc::{string::String, vec::Vec};
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

/// Derived while the accepted paragraph is decoded; the mask may conservatively
/// retain characters from prior same-length reuse, but never omit current ones.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PrintableAsciiFacts {
    printable: bool,
    used: [u8; 12],
}

impl Default for PrintableAsciiFacts {
    fn default() -> Self {
        Self {
            printable: true,
            used: [0; 12],
        }
    }
}

impl PrintableAsciiFacts {
    pub(crate) fn printable(self) -> bool {
        self.printable
    }
    pub(crate) fn used(self) -> [u8; 12] {
        self.used
    }

    pub(crate) fn include_unit(&mut self, unit: u16) {
        if !(0x20..=0x7e).contains(&unit) {
            self.printable = false;
            return;
        }
        let index = usize::from(unit - 0x20);
        self.used[index / 8] |= 1 << (index % 8);
    }
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
    printable_ascii: PrintableAsciiFacts,
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
    /// Grapheme, word and sentence bits for editing, computed on first query, never by `analyze`.
    boundaries: BoundaryLanes,
    #[cfg(test)]
    analysis_count: usize,
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
        self.printable_ascii = self.kernel_ascii_facts();
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

    /// The conformance-tested scalar analysis of the whole text: the reference the kernel equals.
    pub fn analyze_scalar(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.clear();
        reserve(&mut self.grapheme_boundaries, text.len().saturating_add(1))?;
        reserve(&mut self.grapheme_scripts, text.len())?;
        reserve(&mut self.candidate_offsets, text.len().saturating_add(1))?;
        encode_utf16(text, &mut self.utf8, &mut self.printable_ascii)?;
        self.line_breaks.analyze(text)?;
        self.breaks.extend_from_slice(self.line_breaks.breaks());
        self.segment_graphemes()?;
        self.resolve_grapheme_scripts(text)?;
        self.resolve_neutral_scripts();
        self.itemize_scripts()?;
        Ok(())
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
        let mut lanes = core::mem::take(&mut self.boundaries);
        let analysed = self.analyze(text);
        lanes.splice(start, removed, inserted);
        self.boundaries = lanes;
        if analysed.is_err() {
            self.boundaries.invalidate();
        }
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
            .ensure(text, &self.grapheme_boundaries, kinds)
    }

    /// The paragraph's boundary lanes: to install another `BreakSource`, or to move computed lanes
    /// to the analysis of the edited text before `BoundaryLanes::splice`.
    pub fn boundary_lanes_mut(&mut self) -> &mut BoundaryLanes {
        &mut self.boundaries
    }

    /// How much of the last `analyze` the kernel decided, for measurement.
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

    pub(crate) fn printable_ascii_facts(&self) -> PrintableAsciiFacts {
        self.printable_ascii
    }

    pub(crate) fn accept_reused_ascii_facts(&mut self, facts: PrintableAsciiFacts) {
        self.printable_ascii = facts;
    }

    #[cfg(test)]
    pub(crate) fn analysis_count(&self) -> usize {
        self.analysis_count
    }

    pub fn line_breaks(&self) -> &[LineBreak] {
        &self.breaks
    }

    #[cfg(test)]
    pub(crate) fn reusable_for_ascii_letter_edit(
        &self,
        previous: &[u16],
        next: &[u16],
        start: usize,
        previous_end: usize,
        next_end: usize,
    ) -> bool {
        self.reusable_ascii_facts_for_letter_edit(
            previous,
            next,
            start,
            previous_end,
            next_end,
            self.printable_ascii,
        )
        .is_some()
    }

    /// Preflight's existing changed-unit validation also accumulates the
    /// candidate mask, so reused Unicode storage needs no second edit walk.
    pub(crate) fn reusable_ascii_facts_for_letter_edit(
        &self,
        previous: &[u16],
        next: &[u16],
        start: usize,
        previous_end: usize,
        next_end: usize,
        mut facts: PrintableAsciiFacts,
    ) -> Option<PrintableAsciiFacts> {
        if previous.len() != next.len()
            || previous_end.saturating_sub(start) != next_end.saturating_sub(start)
        {
            return None;
        }
        let previous = previous.get(start..previous_end)?;
        let next = next.get(start..next_end)?;
        if previous.is_empty() {
            return None;
        }
        for (&before, &after) in previous.iter().zip(next) {
            if !is_ascii_letter(before) || !is_ascii_letter(after) {
                return None;
            }
            facts.include_unit(after);
        }
        Some(facts)
    }

    pub(crate) fn clear(&mut self) {
        self.utf8.clear();
        self.printable_ascii = PrintableAsciiFacts::default();
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
        self.boundaries.invalidate();
    }

    fn kernel_ascii_facts(&self) -> PrintableAsciiFacts {
        let seen = &self.kernel.ascii_seen;
        let mut facts = PrintableAsciiFacts::default();
        let control = seen[..0x20].iter().fold(seen[0x7f], |any, unit| any | unit);
        facts.printable = !self.kernel.non_ascii && control == 0;
        for (index, unit) in seen[0x20..0x7f].iter().enumerate() {
            facts.used[index / 8] |= unit << (index % 8);
        }
        facts
    }

    /// Emits the kernel's results for closure units `[start, end)` and the boundary at `end`.
    fn emit_stretch(&mut self, text: &[u16], start: usize, end: usize) -> Result<(), UnicodeError> {
        let breaks = &mut self.breaks;
        self.kernel
            .for_each_break(start, end, |position, required| {
                breaks.push(LineBreak { position, required });
            });
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
        encode_utf16(window, &mut self.utf8, &mut PrintableAsciiFacts::default())?;
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
    // Two-stage trie: two reads instead of a binary probe per call. `script` runs per character on
    // every analysis, and the tables are deliberately larger raw for it. See D-341.
    if code_point > 0x10_ffff {
        return None;
    }
    const SHIFT: usize = generated::SCRIPT_BLOCK_SHIFT;
    let code_point = code_point as usize;
    let block = usize::from(generated::SCRIPT_STAGE1[code_point >> SHIFT]);
    let slot = (block << SHIFT) | (code_point & ((1 << SHIFT) - 1));
    Some(generated::SCRIPT_VALUES[usize::from(generated::SCRIPT_STAGE2[slot])])
}

pub fn script_extensions(code_point: u32) -> Option<&'static [u32]> {
    let set = usize::try_from(lookup_partition(
        generated::SCRIPT_EXTENSION_END_VALUES,
        code_point,
    )?)
    .ok()?;
    let start = usize::try_from(*generated::SCRIPT_EXTENSION_OFFSETS.get(set)?).ok()?;
    let end = usize::try_from(*generated::SCRIPT_EXTENSION_OFFSETS.get(set + 1)?).ok()?;
    generated::SCRIPT_EXTENSION_TAGS.get(start..end)
}

fn lookup_partition(end_values: &[u32], code_point: u32) -> Option<u32> {
    if code_point > 0x10_ffff {
        return None;
    }
    let mut low = 0;
    let mut high = end_values.len() / 2;
    while low < high {
        let middle = low + (high - low) / 2;
        let offset = middle * 2;
        let end = end_values[offset];
        if code_point >= end {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    end_values.get(low.checked_mul(2)?.checked_add(1)?).copied()
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), UnicodeError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
    }
    Ok(())
}

fn encode_utf16(
    text: &[u16],
    output: &mut String,
    printable_ascii: &mut PrintableAsciiFacts,
) -> Result<(), UnicodeError> {
    let mut index = 0;
    while index < text.len() {
        let (character, consumed) = decode_scalar(text, index)?;
        output.push(character);
        if consumed == 1 {
            printable_ascii.include_unit(text[index]);
        } else {
            printable_ascii.printable = false;
        }
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

    #[test]
    fn only_equal_length_ascii_letter_edits_reuse_unicode_structure() {
        let analysis = UnicodeAnalysis::default();
        let previous: Vec<u16> = "alpha".encode_utf16().collect();
        let letters: Vec<u16> = "aloha".encode_utf16().collect();
        let digit: Vec<u16> = "al0ha".encode_utf16().collect();
        assert!(analysis.reusable_for_ascii_letter_edit(&previous, &letters, 2, 3, 3));
        assert!(!analysis.reusable_for_ascii_letter_edit(&previous, &digit, 2, 3, 3));
        assert!(!analysis.reusable_for_ascii_letter_edit(&previous, &letters, 2, 4, 3));
        assert!(!analysis.reusable_for_ascii_letter_edit(&previous, &letters, 6, 7, 7));
    }

    #[test]
    fn printable_ascii_fact_is_whole_paragraph_and_reused_mask_is_conservative() {
        let mut analysis = UnicodeAnalysis::default();
        analysis
            .analyze(&"Alpha 0!".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        let old = analysis.printable_ascii_facts();
        assert!(old.printable());
        let mut changed = old;
        changed.include_unit('z' as u16);
        assert_ne!(old.used(), changed.used());
        analysis.accept_reused_ascii_facts(changed);
        assert_eq!(analysis.printable_ascii_facts(), changed);
        analysis
            .analyze(&"Alpha λ".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert!(!analysis.printable_ascii_facts().printable());
        analysis
            .analyze(&"Bravo 1".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert!(analysis.printable_ascii_facts().printable());
        assert_ne!(analysis.printable_ascii_facts().used(), changed.used());
    }
}
