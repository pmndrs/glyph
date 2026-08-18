// UAX #14 rule behavior is ported from @cto.af/linebreak 4.0.3. Its MIT license is retained in
// LICENSES/cto-af-linebreak-MIT.txt; the implementation is specialized to retained no_std Rust storage.
use alloc::vec::Vec;

use crate::unicode::UnicodeError;

#[allow(dead_code)]
mod generated {
    include!("generated/line_break_data.rs");
}

const SOT: i16 = -1;
const EOT: i16 = -2;

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

    #[allow(clippy::too_many_lines)]
    fn decide(&mut self) -> Option<LineBreak> {
        use generated::*;
        let cur = self.current.class;
        let next = self.next.class;

        // LB2-LB6.
        if cur == SOT && next != EOT {
            return None;
        }
        if next == EOT && (self.current.end == 0 || self.current.end != self.previous_chunk) {
            return self.emit(true);
        }
        if cur == i16::from(BK) {
            return self.emit(true);
        }
        if cur == i16::from(CR) {
            return if next == i16::from(LF) {
                None
            } else {
                self.emit(true)
            };
        }
        if matches!(cur, value if value == i16::from(LF) || value == i16::from(NL)) {
            return self.emit(true);
        }
        if matches!(next, value if value == i16::from(BK) || value == i16::from(CR) || value == i16::from(LF) || value == i16::from(NL))
        {
            return None;
        }

        // Shared state before LB7.
        if cur != i16::from(RI) {
            self.regional_indicators = 0;
        }
        if self.spaces {
            if next != i16::from(SP) {
                self.spaces = false;
            }
            return None;
        }

        // LB7-LB10.
        if next == i16::from(ZW) {
            return None;
        }
        if next == i16::from(SP)
            && !matches!(cur, value if value == i16::from(ZW) || value == i16::from(OP) || value == i16::from(QU) || value == i16::from(CL) || value == i16::from(CP) || value == i16::from(B2))
        {
            return None;
        }
        if self.lb8 {
            self.lb8 = false;
            return self.emit(false);
        }
        if cur == i16::from(ZW) {
            if next == i16::from(SP) {
                self.lb8 = true;
                return None;
            }
            return self.emit(false);
        }
        if cur == i16::from(ZWJ) {
            return None;
        }
        if !is_one_of(cur, &[BK, CR, LF, NL, SP, ZW])
            && matches!(next, value if value == i16::from(CM) || value == i16::from(ZWJ))
        {
            self.next.ignored = true;
            return None;
        }
        if self.current.class == i16::from(CM) {
            self.current.class = i16::from(AL);
        }
        if self.next.class == i16::from(CM) {
            self.next.class = i16::from(AL);
        }
        let cur = self.current.class;
        let next = self.next.class;

        // LB11-LB15d.
        if cur == i16::from(WJ) || next == i16::from(WJ) || cur == i16::from(GL) {
            return None;
        }
        if next == i16::from(GL) && !is_one_of(cur, &[SP, BA, HY, HH]) {
            return None;
        }
        if is_one_of(next, &[CL, CP, EX, SY]) {
            return None;
        }
        if cur == i16::from(OP) {
            self.spaces = next == i16::from(SP);
            return None;
        }
        if (is_one_of(self.previous.class, &[BK, CR, LF, NL, OP, QU, GL, SP, ZW])
            || self.previous.class == SOT)
            && self.current.has(INITIAL_PUNCTUATION)
            && cur == i16::from(QU)
        {
            self.spaces = true;
            return None;
        }
        if self.next.has(FINAL_PUNCTUATION) && next == i16::from(QU) {
            let after = self.after_next(1);
            if after.is_none_or(|character| {
                is_one_of(
                    character.class,
                    &[SP, GL, WJ, CL, QU, CP, EX, IS, SY, BK, CR, LF, NL, ZW],
                )
            }) {
                return None;
            }
        }
        if cur == i16::from(SP)
            && next == i16::from(IS)
            && self
                .after_next(1)
                .is_some_and(|after| after.class == i16::from(NU))
        {
            return self.emit(false);
        }
        if next == i16::from(IS) {
            return None;
        }

        // LB16-LB20a.
        if is_one_of(cur, &[CL, CP]) {
            if self.class_after_spaces(self.current.end) == i16::from(NS) {
                self.spaces = next == i16::from(SP);
                return None;
            }
            if next == i16::from(SP) {
                return None;
            }
        }
        if cur == i16::from(B2) {
            if self.class_after_spaces(self.current.end) == i16::from(B2) {
                self.spaces = next == i16::from(SP);
                return None;
            }
            if next == i16::from(SP) {
                return None;
            }
        }
        if cur == i16::from(SP) {
            return self.emit(false);
        }
        if next == i16::from(QU) && !self.next.has(INITIAL_PUNCTUATION) {
            return None;
        }
        if cur == i16::from(QU) && !self.current.has(FINAL_PUNCTUATION) {
            return None;
        }
        if !self.current.has(EAST_ASIAN) && next == i16::from(QU) {
            return None;
        }
        if next == i16::from(QU)
            && self
                .after_next(1)
                .is_none_or(|after| !after.has(EAST_ASIAN))
        {
            return None;
        }
        if cur == i16::from(QU) && !self.next.has(EAST_ASIAN) {
            return None;
        }
        if cur == i16::from(QU) && (self.previous.class == SOT || !self.previous.has(EAST_ASIAN)) {
            return None;
        }
        if cur == i16::from(CB) || next == i16::from(CB) {
            return self.emit(false);
        }
        if (self.previous.class == SOT
            || is_one_of(self.previous.class, &[BK, CR, LF, NL, SP, ZW, CB, GL]))
            && is_one_of(cur, &[HY, HH])
            && is_one_of(next, &[AL, HL])
        {
            return None;
        }

        // LB21-LB24.
        if cur == i16::from(BB) || is_one_of(next, &[BA, HH, HY, NS]) {
            return None;
        }
        if self.previous.class == i16::from(HL)
            && is_one_of(cur, &[HY, HH])
            && next != i16::from(HL)
        {
            return None;
        }
        if cur == i16::from(SY) && next == i16::from(HL) {
            return None;
        }
        if next == i16::from(IN) {
            return None;
        }
        if (is_one_of(cur, &[AL, HL]) && next == i16::from(NU))
            || (cur == i16::from(NU) && is_one_of(next, &[AL, HL]))
        {
            return None;
        }
        if (cur == i16::from(PR) && is_one_of(next, &[ID, EB, EM]))
            || (next == i16::from(PO) && is_one_of(cur, &[ID, EB, EM]))
        {
            return None;
        }
        if (is_one_of(cur, &[PR, PO]) && is_one_of(next, &[AL, HL]))
            || (is_one_of(cur, &[AL, HL]) && is_one_of(next, &[PR, PO]))
        {
            return None;
        }

        // LB25.
        if is_one_of(next, &[PO, PR, NU]) {
            let before = if is_one_of(next, &[PO, PR]) && is_one_of(cur, &[CL, CP]) {
                self.previous.end
            } else {
                self.current.end
            };
            if self.numeric_prefix_before(before) {
                return None;
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
                    return None;
                }
            } else if next == i16::from(NU) {
                return None;
            }
        }
        if is_one_of(cur, &[HY, IS]) && next == i16::from(NU) {
            return None;
        }

        // LB26-LB30b.
        if (cur == i16::from(JL) && is_one_of(next, &[JL, JV, H2, H3]))
            || (is_one_of(cur, &[JV, H2]) && is_one_of(next, &[JV, JT]))
            || (is_one_of(cur, &[JT, H3]) && next == i16::from(JT))
        {
            return None;
        }
        if (is_one_of(cur, &[JL, JV, JT, H2, H3]) && next == i16::from(PO))
            || (cur == i16::from(PR) && is_one_of(next, &[JL, JV, JT, H2, H3]))
        {
            return None;
        }
        if is_one_of(cur, &[AL, HL]) && is_one_of(next, &[AL, HL]) {
            return None;
        }
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
            return None;
        }
        if cur == i16::from(IS) && is_one_of(next, &[AL, HL]) {
            return None;
        }
        if is_one_of(cur, &[AL, HL, NU]) && next == i16::from(OP) && !self.next.has(EAST_ASIAN) {
            return None;
        }
        if cur == i16::from(CP) && !self.current.has(EAST_ASIAN) && is_one_of(next, &[AL, HL, NU]) {
            return None;
        }
        if cur == i16::from(RI) && next == i16::from(RI) {
            self.regional_indicators += 1;
            if !self.regional_indicators.is_multiple_of(2) {
                return None;
            }
        } else if cur != i16::from(RI) {
            self.regional_indicators = 0;
        }
        if cur == i16::from(EB) && next == i16::from(EM) {
            return None;
        }
        if next == i16::from(EM) && self.current.has(UNASSIGNED_EXTENDED_PICTOGRAPHIC) {
            return None;
        }

        // LB31.
        self.emit(false)
    }

    fn emit(&mut self, required: bool) -> Option<LineBreak> {
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

fn properties(code_point: u32) -> Option<u32> {
    if code_point > 0x10_ffff {
        return None;
    }
    let values = generated::LINE_BREAK_END_VALUES;
    let mut low = 0usize;
    let mut high = values.len() / 2;
    while low < high {
        let middle = low + (high - low) / 2;
        if code_point >= values[middle * 2] {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    values.get(low.checked_mul(2)?.checked_add(1)?).copied()
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
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| UnicodeError::ResultTooLarge)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
