use crate::cold_growth::ColdGrowth as _;
// UAX #14 rule behavior is ported from @cto.af/linebreak 4.0.3. Its MIT license is retained in
// LICENSES/cto-af-linebreak-MIT.txt; the implementation is specialized to retained no_std Rust storage.
use alloc::vec::Vec;
use core::ops::ControlFlow::{self, Break, Continue};

use crate::unicode::UnicodeError;

#[allow(dead_code)]
mod generated {
    include!("generated/line_break_data.rs");
}

const SOT: i16 = -1;
const EOT: i16 = -2;

/// A rule decided that no break occurs here.
const KEEP: ControlFlow<Option<LineBreak>> = Break(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LineBreak {
    pub position: u32,
    pub required: bool,
}

#[derive(Clone, Copy, Debug)]
struct BreakChar {
    code_point: u32,
    class: i16,
    start: u32,
    end: u32,
    properties: u32,
    source_index: usize,
    ignored: bool,
}

impl BreakChar {
    const fn sentinel(class: i16, position: u32) -> Self {
        Self {
            code_point: 0,
            class,
            start: position,
            end: position,
            properties: 0,
            source_index: usize::MAX,
            ignored: false,
        }
    }

    fn has(self, property: u32) -> bool {
        self.properties & property != 0
    }
}

#[derive(Default)]
pub struct LineBreakAnalysis {
    characters: Vec<BreakChar>,
    breaks: Vec<LineBreak>,
}

impl LineBreakAnalysis {
    pub(crate) fn clear(&mut self) {
        self.characters.clear();
        self.breaks.clear();
    }

    pub fn reserve(&mut self, capacity: usize) -> Result<(), UnicodeError> {
        reserve(&mut self.characters, capacity)?;
        reserve(&mut self.breaks, capacity.saturating_add(1))
    }

    pub fn analyze(&mut self, text: &[u16]) -> Result<(), UnicodeError> {
        self.clear();
        self.reserve(text.len())?;
        let mut offset = 0usize;
        while offset < text.len() {
            let start = offset;
            let (code_point, consumed) = decode_scalar(text, offset)?;
            offset += consumed;
            let properties = properties(code_point).ok_or(UnicodeError::InvalidUtf16)?;
            self.characters.push(BreakChar {
                code_point,
                class: (properties & 0xff) as i16,
                start: u32::try_from(start).map_err(|_| UnicodeError::ResultTooLarge)?,
                end: u32::try_from(offset).map_err(|_| UnicodeError::ResultTooLarge)?,
                properties,
                source_index: self.characters.len(),
                ignored: false,
            });
        }
        let mut state = BreakState::new(&self.characters);
        for character in self.characters.iter().copied() {
            state.push(character);
            if let Some(line_break) = state.decide() {
                self.breaks.push(line_break);
            }
        }
        let end = u32::try_from(text.len()).map_err(|_| UnicodeError::ResultTooLarge)?;
        state.push(BreakChar::sentinel(EOT, end));
        if let Some(line_break) = state.decide() {
            self.breaks.push(line_break);
        }
        Ok(())
    }

    pub fn breaks(&self) -> &[LineBreak] {
        &self.breaks
    }
}

struct BreakState<'a> {
    source: &'a [BreakChar],
    previous: BreakChar,
    current: BreakChar,
    next: BreakChar,
    previous_chunk: u32,
    lb8: bool,
    spaces: bool,
    regional_indicators: u32,
}

impl<'a> BreakState<'a> {
    fn new(source: &'a [BreakChar]) -> Self {
        let start = BreakChar::sentinel(SOT, 0);
        Self {
            source,
            previous: start,
            current: start,
            next: start,
            previous_chunk: 0,
            lb8: false,
            spaces: false,
            regional_indicators: 0,
        }
    }

    fn push(&mut self, character: BreakChar) {
        if self.next.ignored {
            self.current.end = self.next.end;
        } else {
            self.previous = self.current;
            self.current = self.next;
        }
        self.next = character;
    }

    /// The UAX #14 decision between `current` and `next`, in rule order; LB31
    /// breaks everywhere no earlier rule decided.
    fn decide(&mut self) -> Option<LineBreak> {
        match self.decide_by_rule() {
            Break(decision) => decision,
            Continue(()) => self.emit(false),
        }
    }

    fn decide_by_rule(&mut self) -> ControlFlow<Option<LineBreak>> {
        self.mandatory_breaks()?;
        self.space_and_joiner_rules()?;
        self.opening_and_closing_rules()?;
        self.space_run_rules()?;
        self.quotation_rules()?;
        self.contingent_and_hyphen_rules()?;
        self.break_before_after_rules()?;
        self.numeric_rules()?;
        self.hangul_and_letter_rules()?;
        self.aksara_rules()?;
        self.letter_and_emoji_rules()
    }

    /// LB2-LB6: text boundaries and hard line breaks.
    fn mandatory_breaks(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == SOT && next != EOT {
            return KEEP;
        }
        if next == EOT && (self.current.end == 0 || self.current.end != self.previous_chunk) {
            return Break(self.emit(true));
        }
        if cur == i16::from(BK) {
            return Break(self.emit(true));
        }
        if cur == i16::from(CR) {
            return if next == i16::from(LF) {
                KEEP
            } else {
                Break(self.emit(true))
            };
        }
        if matches!(cur, value if value == i16::from(LF) || value == i16::from(NL)) {
            return Break(self.emit(true));
        }
        if matches!(next, value if value == i16::from(BK) || value == i16::from(CR) || value == i16::from(LF) || value == i16::from(NL))
        {
            return KEEP;
        }
        Continue(())
    }

    /// Shared `SP*` state, then LB7-LB10: spaces, ZW, ZWJ, and combining marks.
    /// Ends by folding combining marks into the class they attach to (LB10).
    fn space_and_joiner_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur != i16::from(RI) {
            self.regional_indicators = 0;
        }
        if self.spaces {
            if next != i16::from(SP) {
                self.spaces = false;
            }
            return KEEP;
        }

        // LB7-LB10.
        if next == i16::from(ZW) {
            return KEEP;
        }
        if next == i16::from(SP)
            && !matches!(cur, value if value == i16::from(ZW) || value == i16::from(OP) || value == i16::from(QU) || value == i16::from(CL) || value == i16::from(CP) || value == i16::from(B2))
        {
            return KEEP;
        }
        if self.lb8 {
            self.lb8 = false;
            return Break(self.emit(false));
        }
        if cur == i16::from(ZW) {
            if next == i16::from(SP) {
                self.lb8 = true;
                return KEEP;
            }
            return Break(self.emit(false));
        }
        if cur == i16::from(ZWJ) {
            return KEEP;
        }
        if !is_one_of(cur, &[BK, CR, LF, NL, SP, ZW])
            && matches!(next, value if value == i16::from(CM) || value == i16::from(ZWJ))
        {
            self.next.ignored = true;
            return KEEP;
        }
        if self.current.class == i16::from(CM) {
            self.current.class = i16::from(AL);
        }
        if self.next.class == i16::from(CM) {
            self.next.class = i16::from(AL);
        }
        Continue(())
    }

    /// LB11-LB15d: glue, closing punctuation, openers, and quotation marks.
    fn opening_and_closing_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == i16::from(WJ) || next == i16::from(WJ) || cur == i16::from(GL) {
            return KEEP;
        }
        if next == i16::from(GL) && !is_one_of(cur, &[SP, BA, HY, HH]) {
            return KEEP;
        }
        if is_one_of(next, &[CL, CP, EX, SY]) {
            return KEEP;
        }
        if cur == i16::from(OP) {
            self.spaces = next == i16::from(SP);
            return KEEP;
        }
        if (is_one_of(self.previous.class, &[BK, CR, LF, NL, OP, QU, GL, SP, ZW])
            || self.previous.class == SOT)
            && self.current.has(INITIAL_PUNCTUATION)
            && cur == i16::from(QU)
        {
            // LB15a forbids a break after the quote and after the spaces that follow it, and
            // nothing more: the flag is set only when a space run starts here.
            self.spaces = next == i16::from(SP);
            return KEEP;
        }
        if self.next.has(FINAL_PUNCTUATION) && next == i16::from(QU) {
            let after = self.after_next(1);
            if after.is_none_or(|character| {
                is_one_of(
                    character.class,
                    &[SP, GL, WJ, CL, QU, CP, EX, IS, SY, BK, CR, LF, NL, ZW],
                )
            }) {
                return KEEP;
            }
        }
        if cur == i16::from(SP)
            && next == i16::from(IS)
            && self
                .after_next(1)
                .is_some_and(|after| after.class == i16::from(NU))
        {
            return Break(self.emit(false));
        }
        if next == i16::from(IS) {
            return KEEP;
        }
        Continue(())
    }

    /// LB16-LB17: closers and B2 across spaces.
    fn space_run_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if is_one_of(cur, &[CL, CP]) {
            if self.class_after_spaces(self.current.end) == i16::from(NS) {
                self.spaces = next == i16::from(SP);
                return KEEP;
            }
            if next == i16::from(SP) {
                return KEEP;
            }
        }
        if cur == i16::from(B2) {
            if self.class_after_spaces(self.current.end) == i16::from(B2) {
                self.spaces = next == i16::from(SP);
                return KEEP;
            }
            if next == i16::from(SP) {
                return KEEP;
            }
        }
        Continue(())
    }

    /// LB18-LB19a: break after spaces, and quotation marks.
    fn quotation_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == i16::from(SP) {
            return Break(self.emit(false));
        }
        if next == i16::from(QU) && !self.next.has(INITIAL_PUNCTUATION) {
            return KEEP;
        }
        if cur == i16::from(QU) && !self.current.has(FINAL_PUNCTUATION) {
            return KEEP;
        }
        if !self.current.has(EAST_ASIAN) && next == i16::from(QU) {
            return KEEP;
        }
        if next == i16::from(QU)
            && self
                .after_next(1)
                .is_none_or(|after| !after.has(EAST_ASIAN))
        {
            return KEEP;
        }
        if cur == i16::from(QU) && !self.next.has(EAST_ASIAN) {
            return KEEP;
        }
        if cur == i16::from(QU) && (self.previous.class == SOT || !self.previous.has(EAST_ASIAN)) {
            return KEEP;
        }
        Continue(())
    }

    /// LB20-LB20a: contingent breaks and word-initial hyphens.
    fn contingent_and_hyphen_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == i16::from(CB) || next == i16::from(CB) {
            return Break(self.emit(false));
        }
        if (self.previous.class == SOT
            || is_one_of(self.previous.class, &[BK, CR, LF, NL, SP, ZW, CB, GL]))
            && is_one_of(cur, &[HY, HH])
            && is_one_of(next, &[AL, HL])
        {
            return KEEP;
        }
        Continue(())
    }

    /// LB21-LB24: BA/BB/HY/NS, Hebrew, inseparables, and letters with numbers or affixes.
    fn break_before_after_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == i16::from(BB) || is_one_of(next, &[BA, HH, HY, NS]) {
            return KEEP;
        }
        if self.previous.class == i16::from(HL)
            && is_one_of(cur, &[HY, HH])
            && next != i16::from(HL)
        {
            return KEEP;
        }
        if cur == i16::from(SY) && next == i16::from(HL) {
            return KEEP;
        }
        if next == i16::from(IN) {
            return KEEP;
        }
        if (is_one_of(cur, &[AL, HL]) && next == i16::from(NU))
            || (cur == i16::from(NU) && is_one_of(next, &[AL, HL]))
        {
            return KEEP;
        }
        if (cur == i16::from(PR) && is_one_of(next, &[ID, EB, EM]))
            || (next == i16::from(PO) && is_one_of(cur, &[ID, EB, EM]))
        {
            return KEEP;
        }
        if (is_one_of(cur, &[PR, PO]) && is_one_of(next, &[AL, HL]))
            || (is_one_of(cur, &[AL, HL]) && is_one_of(next, &[PR, PO]))
        {
            return KEEP;
        }
        Continue(())
    }

    /// LB25: numeric expressions.
    fn numeric_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if is_one_of(next, &[PO, PR, NU]) {
            let before = if is_one_of(next, &[PO, PR]) && is_one_of(cur, &[CL, CP]) {
                self.previous.end
            } else {
                self.current.end
            };
            if self.numeric_prefix_before(before) {
                return KEEP;
            }
        }
        if is_one_of(cur, &[PO, PR]) {
            if next == i16::from(OP) {
                if let Some(after) = self.after_next(1)
                    && (after.class == i16::from(NU)
                        || (after.class == i16::from(IS)
                            && self
                                .after_next(2)
                                .is_some_and(|value| value.class == i16::from(NU))))
                {
                    return KEEP;
                }
            } else if next == i16::from(NU) {
                return KEEP;
            }
        }
        if is_one_of(cur, &[HY, IS]) && next == i16::from(NU) {
            return KEEP;
        }
        Continue(())
    }

    /// LB26-LB28: Hangul syllables and letters.
    fn hangul_and_letter_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if (cur == i16::from(JL) && is_one_of(next, &[JL, JV, H2, H3]))
            || (is_one_of(cur, &[JV, H2]) && is_one_of(next, &[JV, JT]))
            || (is_one_of(cur, &[JT, H3]) && next == i16::from(JT))
        {
            return KEEP;
        }
        if (is_one_of(cur, &[JL, JV, JT, H2, H3]) && next == i16::from(PO))
            || (cur == i16::from(PR) && is_one_of(next, &[JL, JV, JT, H2, H3]))
        {
            return KEEP;
        }
        if is_one_of(cur, &[AL, HL]) && is_one_of(next, &[AL, HL]) {
            return KEEP;
        }
        Continue(())
    }

    /// LB28a: Brahmic orthographic syllables (Aksara).
    fn aksara_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        let dotted_circle = 0x25cc;
        let current_ak = is_one_of(cur, &[AK, AS]) || self.current.code_point == dotted_circle;
        let next_ak = is_one_of(next, &[AK, AS]) || self.next.code_point == dotted_circle;
        let previous_ak =
            is_one_of(self.previous.class, &[AK, AS]) || self.previous.code_point == dotted_circle;
        if (cur == i16::from(AP) && next_ak)
            || (current_ak && is_one_of(next, &[VF, VI]))
            || (previous_ak
                && cur == i16::from(VI)
                && (next == i16::from(AK) || self.next.code_point == dotted_circle))
            || (current_ak
                && next_ak
                && self
                    .after_next(1)
                    .is_some_and(|after| after.class == i16::from(VF)))
        {
            return KEEP;
        }
        Continue(())
    }

    /// LB29-LB30b: letters with openers and closers, regional indicators, and emoji modifiers.
    fn letter_and_emoji_rules(&mut self) -> ControlFlow<Option<LineBreak>> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;
        if cur == i16::from(IS) && is_one_of(next, &[AL, HL]) {
            return KEEP;
        }
        if is_one_of(cur, &[AL, HL, NU]) && next == i16::from(OP) && !self.next.has(EAST_ASIAN) {
            return KEEP;
        }
        if cur == i16::from(CP) && !self.current.has(EAST_ASIAN) && is_one_of(next, &[AL, HL, NU]) {
            return KEEP;
        }
        if cur == i16::from(RI) && next == i16::from(RI) {
            self.regional_indicators += 1;
            if !self.regional_indicators.is_multiple_of(2) {
                return KEEP;
            }
        } else if cur != i16::from(RI) {
            self.regional_indicators = 0;
        }
        if cur == i16::from(EB) && next == i16::from(EM) {
            return KEEP;
        }
        if next == i16::from(EM) && self.current.has(UNASSIGNED_EXTENDED_PICTOGRAPHIC) {
            return KEEP;
        }
        Continue(())
    }

    fn emit(&mut self, required: bool) -> Option<LineBreak> {
        if required {
            // LB4-LB6: a required break ends every `SP*` context (LB8, LB14-LB17), so neither
            // flag may reach the next line.
            self.spaces = false;
            self.lb8 = false;
        }
        let position = self.current.end;
        self.previous_chunk = position;
        Some(LineBreak { position, required })
    }

    fn after_next(&self, offset: usize) -> Option<BreakChar> {
        let index = self.next.source_index.checked_add(offset)?;
        self.source.get(index).copied()
    }

    fn class_after_spaces(&self, position: u32) -> i16 {
        // `source` is filled by one forward pass, so `start` increases strictly and every
        // character below the partition point fails `start >= position` by construction.
        // Scanning from index 0 instead cost O(i) per call, and LB16/LB17 consult this on
        // every CL/CP/B2 -- which in CJK is most punctuation -- making the analysis O(n^2).
        let first = self
            .source
            .partition_point(|character| character.start < position);
        self.source[first..]
            .iter()
            .find(|character| character.class != i16::from(generated::SP))
            .map_or(EOT, |character| character.class)
    }

    fn numeric_prefix_before(&self, mut position: u32) -> bool {
        while position > 0 {
            let character = if position == self.current.end {
                self.current
            } else if position == self.previous.end {
                self.previous
            } else if let Some(character) = self
                .source
                .partition_point(|character| character.end <= position)
                .checked_sub(1)
                .and_then(|index| self.source.get(index).copied())
            {
                character
            } else {
                return false;
            };
            if character.class == i16::from(generated::NU) {
                return true;
            }
            if !is_one_of(character.class, &[generated::SY, generated::IS]) {
                return false;
            }
            position = character.start;
        }
        false
    }
}

pub(crate) fn properties(code_point: u32) -> Option<u32> {
    // A trie: three reads instead of a binary probe per call. This is the hottest of the three
    // property lookups, running per character on every scalar line-break pass. See D-341.
    if code_point > 0x10_ffff {
        return None;
    }
    let index = crate::unicode::trie::lookup(
        generated::LINE_BREAK_ROOT,
        generated::LINE_BREAK_MIDDLE,
        generated::LINE_BREAK_LEAVES,
        generated::LINE_BREAK_LEAF_SHIFT,
        generated::LINE_BREAK_MIDDLE_SHIFT,
        code_point,
    );
    Some(u32::from(generated::LINE_BREAK_VALUES[usize::from(index)]))
}

pub(crate) use generated::ALPHANUMERIC;

/// `char::is_alphanumeric` at Unicode 17, from the line-break trie's `ALPHANUMERIC` bit, so the
/// module does not link `core`'s own Alphabetic and N tables.
pub(crate) fn is_alphanumeric(character: char) -> bool {
    properties(character as u32).is_some_and(|bits| bits & ALPHANUMERIC != 0)
}

fn is_one_of(class: i16, values: &[u8]) -> bool {
    values.iter().any(|value| class == i16::from(*value))
}

fn decode_scalar(text: &[u16], index: usize) -> Result<(u32, usize), UnicodeError> {
    let first = text[index];
    if (0xd800..=0xdbff).contains(&first) {
        let second = text
            .get(index + 1)
            .copied()
            .filter(|unit| (0xdc00..=0xdfff).contains(unit))
            .ok_or(UnicodeError::InvalidUtf16)?;
        return Ok((
            0x1_0000 + (((u32::from(first) - 0xd800) << 10) | (u32::from(second) - 0xdc00)),
            2,
        ));
    }
    if (0xdc00..=0xdfff).contains(&first) {
        return Err(UnicodeError::InvalidUtf16);
    }
    Ok((u32::from(first), 1))
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), UnicodeError> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact_cold(capacity.saturating_sub(values.len()))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bit replaces `char::is_alphanumeric` in word motion. Both are Unicode 17 today; when
    /// rustc moves on, this fails until the generator's UCD does too.
    #[test]
    fn alphanumeric_bit_equals_core_at_every_scalar() {
        assert_eq!(char::UNICODE_VERSION, (17, 0, 0));
        for character in (0..=0x10_ffff).filter_map(char::from_u32) {
            assert_eq!(
                is_alphanumeric(character),
                character.is_alphanumeric(),
                "U+{:04X}",
                character as u32
            );
        }
    }

    fn positions(text: &str) -> Vec<u32> {
        let mut analysis = LineBreakAnalysis::default();
        analysis
            .analyze(&text.encode_utf16().collect::<Vec<_>>())
            .unwrap();
        analysis
            .breaks()
            .iter()
            .map(|line_break| line_break.position)
            .collect()
    }

    /// UAX #14 LB15a is `(sot | BK | CR | LF | NL | OP | QU | GL | SP | ZW) [\p{Pi}&QU] SP* ×`:
    /// it suppresses the break after the quote and its spaces, not the next opportunity.
    #[test]
    fn lb15a_does_not_reach_past_the_unit_after_an_initial_quote() {
        // LB18 breaks after the space; LB15a ended at `a`.
        assert_eq!(positions("«a b"), [3, 4]);
        assert_eq!(positions("\u{201c}A dog"), [3, 6]);
        // LB31 breaks between ideographs; only `«` × `字` is forbidden.
        assert_eq!(positions("«字字字"), [2, 3, 4]);
        // The rule itself still holds, with and without spaces.
        assert_eq!(positions("« a b"), [4, 5]);
        assert_eq!(positions("a «b"), [2, 4]);
    }

    /// LB4-LB6 end the line, so LB14's `OP SP* ×` and LB8's `ZW SP* ÷` stop at a required break.
    #[test]
    fn space_run_contexts_do_not_survive_a_required_break() {
        assert_eq!(positions("( \n字字字"), [3, 4, 5, 6]);
        assert_eq!(positions("\u{201c} \nab cd"), [3, 6, 8]);
        // Without the reset LB8 forced a break between `a` and `b` on the next line.
        assert_eq!(positions("a\u{200b} \nab"), [4, 6]);
    }

    #[test]
    fn finds_required_and_allowed_utf16_breaks() {
        let mut analysis = LineBreakAnalysis::default();
        analysis
            .analyze(&"one two".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert_eq!(
            analysis.breaks(),
            &[
                LineBreak {
                    position: 4,
                    required: false,
                },
                LineBreak {
                    position: 7,
                    required: true,
                },
            ]
        );
        analysis
            .analyze(&"one\r\ntwo".encode_utf16().collect::<Vec<_>>())
            .unwrap();
        assert!(analysis.breaks().contains(&LineBreak {
            position: 5,
            required: true,
        }));
    }
}
