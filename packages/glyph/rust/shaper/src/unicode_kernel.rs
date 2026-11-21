//! Dense stage one of the Unicode analysis: per-class bitmaps and UAX #14 as boolean algebra.
//!
//! Every UTF-16 unit maps to a kernel class generated from the UCD as a property closure
//! (`scripts/generate-unicode-kernel-data.mjs`). Class 0 is the residue: anything whose rules the
//! kernel does not implement (combining marks, joiners, surrogates, Brahmic and Thai-like scripts,
//! conjoining jamo, emoji modifiers, CR, ZW, WJ). The classes become one `u64` per 64 units per
//! class, and the line-break rules of `line_break.rs` are evaluated on those words with shifts for
//! the neighbouring units and add-carry propagation for the starred rules (`OP SP*`, `CL SP* NS`,
//! `B2 SP* B2`, `NU (SY|IS)*`).
//!
//! The kernel never guesses. A boundary it cannot decide marks its units dirty, and every dirty
//! unit is covered by a window that runs from the nearest safe cut before it to the nearest safe
//! cut after it. `unicode.rs` hands each window to the conformance-tested scalar analysis as an
//! independent string. A safe cut is a position where that is exact:
//!
//! - `I I | I`, three closure letters or ideographs in a row, or
//! - `(I | SP | start) I SP | I`, a single space between letters with a letter or space before.
//!
//! Two units before the cut are required because the scalar machine carries its `spaces` flag one
//! unit past an initial quotation mark (`«a b` has no break after the space). The exhaustive and
//! fuzz tests in `unicode.rs` are the proof of both the rules and the cuts.

use alloc::vec::Vec;

#[allow(clippy::unreadable_literal)]
mod generated {
    include!("generated/kernel_data.rs");
}

pub(crate) use generated::{
    K_AL, K_B2, K_BA, K_BB, K_CL, K_CP, K_EX, K_GL, K_H23, K_HARD, K_HH, K_HL, K_HY, K_ID, K_IN,
    K_IS, K_NS, K_NU, K_OP, K_PF, K_PI, K_PO, K_PR, K_QU, K_SP, K_SY, KERNEL_CLASS_MASK,
    KERNEL_SCRIPT_COMPLEX, KERNEL_SCRIPT_TAGS,
};
#[cfg(test)]
pub(crate) use generated::{KERNEL_TEST_REPRESENTATIVES, SEGMENTATION_TEST_REPRESENTATIVES};

const BLOCK: usize = 64;
const MASKS: usize = 32;
/// Slot of the East Asian plane in a decoded block; class ids stop at 26.
const EAST_ASIAN: usize = 31;
/// Slot of the "outside the closure" mask; class id 0.
const RESIDUE: usize = 0;

/// `class | script << 8` for one UTF-16 unit.
#[inline]
pub(crate) fn unit_value(unit: u16) -> u16 {
    let unit = usize::from(unit);
    if unit < 0x80 {
        return generated::KERNEL_ASCII[unit];
    }
    let middle = usize::from(generated::KERNEL_ROOT[unit >> 8]);
    let leaf = usize::from(generated::KERNEL_MIDDLE[(middle << 4) | ((unit >> 4) & 15)]);
    generated::KERNEL_VALUES[usize::from(generated::KERNEL_LEAVES[(leaf << 4) | (unit & 15)])]
}

/// The kernel class byte of a unit: class id in the low five bits, East Asian width in bit 5.
#[inline]
pub(crate) fn unit_class(unit: u16) -> u8 {
    (unit_value(unit) & 0xff) as u8
}

/// The script byte of a unit: 0 neutral, an index into `KERNEL_SCRIPT_TAGS`, or the complex mark.
#[inline]
pub(crate) fn unit_script(unit: u16) -> u8 {
    (unit_value(unit) >> 8) as u8
}

/// True for closure letters and ideographs: the units a safe cut may sit between.
#[inline]
pub(crate) fn is_inert_class(class: u8) -> bool {
    matches!(class & KERNEL_CLASS_MASK, K_AL | K_HL | K_ID | K_H23)
}

/// How much of a text the kernel decided and how much went to the scalar residue.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct KernelCoverage {
    pub units: u32,
    pub residue_units: u32,
    pub blocks: u32,
    pub residue_blocks: u32,
    pub windows: u32,
}

#[derive(Default)]
pub(crate) struct Kernel {
    /// One class byte per unit, zero-padded to whole blocks plus one.
    pub(crate) classes: Vec<u8>,
    /// One script byte per unit.
    pub(crate) scripts: Vec<u8>,
    allowed: Vec<u64>,
    required: Vec<u64>,
    dirty: Vec<u64>,
    safe: Vec<u64>,
    /// Half-open unit ranges handed to the scalar analysis, ascending and disjoint.
    pub(crate) windows: Vec<(u32, u32)>,
    /// One byte per ASCII unit seen, indexed by `unit & 0x7f`.
    pub(crate) ascii_seen: Vec<u8>,
    pub(crate) non_ascii: bool,
}

#[derive(Default)]
struct Carry {
    setter_high: u64,
    base_high: u64,
    flagged_high: u64,
    flag_run: bool,
    close_run: bool,
    close_high: u64,
    dash_run: bool,
    dash_high: u64,
    numeric_run: bool,
    numeric_previous: u64,
}

struct Decision {
    allowed: u64,
    required: u64,
    dirty_boundaries: u64,
    safe: u64,
}

impl Kernel {
    pub(crate) fn reserve(&mut self, units: usize) -> Result<(), ()> {
        let blocks = units / BLOCK + 1;
        reserve(&mut self.classes, blocks * BLOCK)?;
        reserve(&mut self.scripts, units)?;
        reserve(&mut self.ascii_seen, 128)?;
        reserve(&mut self.allowed, blocks)?;
        reserve(&mut self.required, blocks)?;
        reserve(&mut self.dirty, blocks)?;
        reserve(&mut self.safe, blocks)
    }

    /// Classifies `text`, decides every boundary it can, and lists the scalar windows.
    pub(crate) fn run(&mut self, text: &[u16]) {
        self.classify(text);
        self.decide(text.len());
        self.find_windows(text.len());
    }

    fn classify(&mut self, text: &[u16]) {
        let blocks = text.len() / BLOCK + 1;
        self.classes.clear();
        self.classes.resize(blocks * BLOCK, 0);
        self.scripts.clear();
        self.scripts.resize(text.len(), 0);
        self.ascii_seen.clear();
        self.ascii_seen.resize(128, 0);
        let mut non_ascii = 0u16;
        for ((unit, class), script) in text
            .iter()
            .zip(self.classes.iter_mut())
            .zip(self.scripts.iter_mut())
        {
            let value = unit_value(*unit);
            *class = (value & 0xff) as u8;
            *script = (value >> 8) as u8;
            self.ascii_seen[usize::from(*unit & 0x7f)] = 1;
            non_ascii |= *unit;
        }
        // `ascii_seen` aliases units modulo 128, which only matters when a unit is above 0x7f, and
        // then the paragraph is not printable ASCII and the mask is unused.
        self.non_ascii = non_ascii >= 0x80;
    }

    fn decide(&mut self, units: usize) {
        let blocks = units / BLOCK + 1;
        self.allowed.clear();
        self.required.clear();
        self.dirty.clear();
        self.safe.clear();
        let mut carry = Carry::default();
        let mut previous = [0u64; MASKS];
        let mut current = decode(&self.classes[..BLOCK]);
        for block in 0..blocks {
            let next = if block + 1 < blocks {
                decode(&self.classes[(block + 1) * BLOCK..(block + 2) * BLOCK])
            } else {
                [0u64; MASKS]
            };
            let base = block * BLOCK;
            // Units of this block that exist, and boundaries 1..units-1 that the rules decide.
            let unit_mask = low_bits(units.saturating_sub(base));
            let mut boundary_mask = low_bits(units.saturating_sub(base));
            if block == 0 {
                boundary_mask &= !1;
            }
            let last_unit = if units > base && units - base <= BLOCK {
                1u64 << (units - base - 1)
            } else {
                0
            };
            let decision = decide_block(
                &previous,
                &current,
                &next,
                &mut carry,
                block == 0,
                last_unit,
            );
            let dirty_boundaries = decision.dirty_boundaries & boundary_mask;
            self.allowed.push(decision.allowed & boundary_mask);
            self.required.push(decision.required & boundary_mask);
            self.safe
                .push(decision.safe & boundary_mask & !dirty_boundaries);
            // A dirty boundary dirties the unit on each side of it.
            self.dirty
                .push((current[RESIDUE] & unit_mask) | dirty_boundaries | (dirty_boundaries >> 1));
            if dirty_boundaries & 1 != 0 && block > 0 {
                self.dirty[block - 1] |= 1 << 63;
            }
            previous = current;
            current = next;
        }
    }

    fn find_windows(&mut self, units: usize) {
        self.windows.clear();
        let mut covered = 0usize;
        for block in 0..self.dirty.len() {
            let mut bits = self.dirty[block];
            while bits != 0 {
                let unit = block * BLOCK + bits.trailing_zeros() as usize;
                bits &= bits - 1;
                if unit < covered {
                    continue;
                }
                let start = last_set_at_or_before(&self.safe, unit).unwrap_or(0);
                let end = first_set_after(&self.safe, unit).unwrap_or(units);
                self.windows.push((start as u32, end as u32));
                covered = end;
            }
        }
    }

    /// Calls `emit(position, required)` for every break the kernel decided in `[from, to]`.
    pub(crate) fn for_each_break(&self, from: usize, to: usize, mut emit: impl FnMut(u32, bool)) {
        if from > to {
            return;
        }
        let first = from / BLOCK;
        let last = (to / BLOCK).min(self.allowed.len().saturating_sub(1));
        for block in first..=last {
            let mut bits = self.allowed[block] | self.required[block];
            if block == first {
                bits &= !low_bits(from - first * BLOCK);
            }
            if block == to / BLOCK {
                bits &= low_bits(to - block * BLOCK + 1);
            }
            let required = self.required[block];
            while bits != 0 {
                let bit = bits.trailing_zeros();
                bits &= bits - 1;
                emit((block * BLOCK) as u32 + bit, required >> bit & 1 != 0);
            }
        }
    }

    pub(crate) fn coverage(&self, units: usize) -> KernelCoverage {
        let mut coverage = KernelCoverage {
            units: units as u32,
            blocks: units.div_ceil(BLOCK) as u32,
            windows: self.windows.len() as u32,
            ..KernelCoverage::default()
        };
        let mut block_end = 0u32;
        for &(start, end) in &self.windows {
            coverage.residue_units += end - start;
            if end == start {
                continue;
            }
            let first = (start / BLOCK as u32).max(block_end);
            let last = (end - 1) / BLOCK as u32 + 1;
            if last > first {
                coverage.residue_blocks += last - first;
                block_end = last;
            }
        }
        coverage
    }

    /// True when `position` is a safe cut of the last analysed text.
    pub(crate) fn is_safe_cut(&self, position: usize) -> bool {
        self.safe
            .get(position / BLOCK)
            .is_some_and(|word| word >> (position % BLOCK) & 1 != 0)
    }
}

/// Ones in the low `count` bits, saturating at a full word.
#[inline]
fn low_bits(count: usize) -> u64 {
    if count >= BLOCK {
        u64::MAX
    } else {
        (1u64 << count) - 1
    }
}

fn last_set_at_or_before(words: &[u64], position: usize) -> Option<usize> {
    let mut block = position / BLOCK;
    let mut bits = words[block] & low_bits(position % BLOCK + 1);
    loop {
        if bits != 0 {
            return Some(block * BLOCK + 63 - bits.leading_zeros() as usize);
        }
        block = block.checked_sub(1)?;
        bits = words[block];
    }
}

fn first_set_after(words: &[u64], position: usize) -> Option<usize> {
    let mut block = position / BLOCK;
    let mut bits = words[block] & !low_bits(position % BLOCK + 1);
    loop {
        if bits != 0 {
            return Some(block * BLOCK + bits.trailing_zeros() as usize);
        }
        block += 1;
        bits = *words.get(block)?;
    }
}

/// Turns 64 class bytes into one bitmap per class id plus the East Asian plane.
///
/// Six bit planes are lifted with the SWAR multiply (eight bytes per step), then the five id planes
/// are decoded into one-hot class masks. simd128 has no gather and gains nothing on 64-bit lanes,
/// so this scalar form is also the Wasm form.
fn decode(classes: &[u8]) -> [u64; MASKS] {
    const ONES: u64 = 0x0101_0101_0101_0101;
    const GATHER: u64 = 0x0102_0408_1020_4080;
    let mut planes = [0u64; 6];
    for (group, bytes) in classes.chunks_exact(8).enumerate() {
        let mut word = [0u8; 8];
        word.copy_from_slice(bytes);
        let word = u64::from_le_bytes(word);
        for (bit, plane) in planes.iter_mut().enumerate() {
            *plane |= (((word >> bit) & ONES).wrapping_mul(GATHER) >> 56) << (group * 8);
        }
    }
    let [b0, b1, b2, b3, b4, east_asian] = planes;
    let low = [
        !b0 & !b1 & !b2,
        b0 & !b1 & !b2,
        !b0 & b1 & !b2,
        b0 & b1 & !b2,
        !b0 & !b1 & b2,
        b0 & !b1 & b2,
        !b0 & b1 & b2,
        b0 & b1 & b2,
    ];
    let high = [!b3 & !b4, b3 & !b4, !b3 & b4, b3 & b4];
    let mut masks = [0u64; MASKS];
    for (id, mask) in masks.iter_mut().enumerate().take(27) {
        *mask = low[id & 7] & high[id >> 3];
    }
    masks[EAST_ASIAN] = east_asian;
    masks
}

/// The union of several class masks of one block.
#[inline]
fn union(block: &[u64; MASKS], classes: &[u8]) -> u64 {
    let mut mask = 0;
    for class in classes {
        mask |= block[usize::from(*class)];
    }
    mask
}

/// Spaces (or any run class) in runs that directly follow a base.
///
/// `after_base` has a bit where the unit before is a base. The add carries through each run that
/// starts at such a bit; `carry` continues a run across the block edge.
#[inline]
fn runs_after(after_base: u64, run: u64, carry: &mut bool) -> u64 {
    let start = (after_base | u64::from(*carry)) & run;
    let (sum, overflow) = run.overflowing_add(start);
    *carry = overflow;
    (sum ^ run) & run
}

/// Decides the boundaries of one block. Bit `i` is the boundary before unit `i`.
///
/// Rule numbers follow `line_break.rs::decide`, whose order this reproduces: required breaks, the
/// no-break rules up to LB15b, LB15c's break, LB15d, LB18's break after spaces, then LB19 to LB30.
#[allow(clippy::too_many_lines)]
fn decide_block(
    previous: &[u64; MASKS],
    current: &[u64; MASKS],
    next: &[u64; MASKS],
    carry: &mut Carry,
    first: bool,
    last_unit: u64,
) -> Decision {
    // `was(x)`: the unit before is in x. `was2`, `was3`: two and three units before.
    // `then(x)`: the unit after is in x. `then2`: two units after.
    let was = |classes: &[u8]| (union(current, classes) << 1) | (union(previous, classes) >> 63);
    let was2 = |classes: &[u8]| (union(current, classes) << 2) | (union(previous, classes) >> 62);
    let was3 = |classes: &[u8]| (union(current, classes) << 3) | (union(previous, classes) >> 61);
    let then = |classes: &[u8]| (union(current, classes) >> 1) | (union(next, classes) << 63);
    let then2 = |classes: &[u8]| (union(current, classes) >> 2) | (union(next, classes) << 62);
    let is = |classes: &[u8]| union(current, classes);
    let start = u64::from(first);

    let east_asian = current[EAST_ASIAN];
    let was_east_asian = (east_asian << 1) | (previous[EAST_ASIAN] >> 63);
    let was2_east_asian = (east_asian << 2) | (previous[EAST_ASIAN] >> 62);
    let then_east_asian = (east_asian >> 1) | (next[EAST_ASIAN] << 63);
    let space = is(&[K_SP]);
    let letter = is(&[K_AL, K_HL]);
    let was_letter = was(&[K_AL, K_HL]);
    let was_space = was(&[K_SP]);
    let hard = is(&[K_HARD]);

    // LB15a. An initial quote after one of these sets the scalar machine's `spaces` flag unless
    // an earlier rule returned first. The flag suppresses the next boundary and any space run
    // that follows it, so the unit after the quote behaves as a second flag base.
    let quote_start = is(&[K_PI])
        & (was(&[K_HARD, K_OP, K_QU, K_PF, K_GL, K_SP]) | start)
        & !then(&[K_HARD, K_GL, K_CL, K_CP, K_EX, K_SY])
        & !was(&[K_PI]);
    let after_quote = ((quote_start << 1) | carry.setter_high) & !space;
    carry.setter_high = quote_start >> 63;
    let flag_base = is(&[K_OP]) | quote_start | after_quote;
    let flagged_spaces = runs_after(
        (flag_base << 1) | carry.base_high,
        space,
        &mut carry.flag_run,
    );
    carry.base_high = flag_base >> 63;
    let flag_source = flagged_spaces | after_quote;
    let flagged = (flag_source << 1) | carry.flagged_high;
    carry.flagged_high = flag_source >> 63;

    // LB16 and LB17 look past a space run for NS or B2.
    let close_spaces = runs_after(was(&[K_CL, K_CP]), space, &mut carry.close_run);
    let after_close = (close_spaces << 1) | carry.close_high;
    carry.close_high = close_spaces >> 63;
    let dash_spaces = runs_after(was(&[K_B2]), space, &mut carry.dash_run);
    let after_dash = (dash_spaces << 1) | carry.dash_high;
    carry.dash_high = dash_spaces >> 63;

    // LB25: a unit has a numeric prefix when it is NU or sits in an (SY | IS) run after NU.
    let numeric = is(&[K_NU]) | runs_after(was(&[K_NU]), is(&[K_SY, K_IS]), &mut carry.numeric_run);
    let was_numeric = (numeric << 1) | (carry.numeric_previous >> 63);
    let was2_numeric = (numeric << 2) | (carry.numeric_previous >> 62);
    carry.numeric_previous = numeric;

    let required = was(&[K_HARD]);

    // LB6, the flag, LB7, LB12, LB12a, LB13, LB14, LB15b, and the flagged forms of LB16/LB17.
    let early = hard
        | flagged
        | space
        | was(&[K_GL])
        | (is(&[K_GL]) & !was(&[K_SP, K_BA, K_HY, K_HH]))
        | is(&[K_CL, K_CP, K_EX, K_SY])
        | was(&[K_OP])
        | (is(&[K_PF])
            & (then(&[
                K_SP, K_GL, K_CL, K_QU, K_PI, K_PF, K_CP, K_EX, K_IS, K_SY, K_HARD,
            ]) | last_unit))
        | (after_close & is(&[K_NS]))
        | ((after_dash | was(&[K_B2])) & is(&[K_B2]));
    let space_before_number = was_space & is(&[K_IS]) & then(&[K_NU]);
    let before_spaces = is(&[K_IS]);

    let post_prefix = is(&[K_PO, K_PR]);
    let after_closing = was(&[K_CL, K_CP]);
    let numeric_context = (is(&[K_PO, K_PR, K_NU]))
        & ((was_numeric & !(post_prefix & after_closing))
            | (post_prefix & after_closing & was2_numeric));

    let late = is(&[K_QU, K_PF])
        | was(&[K_QU, K_PI])
        | (is(&[K_PI]) & !was_east_asian)
        | (is(&[K_PI]) & !then_east_asian)
        | (was(&[K_PF]) & !east_asian)
        | (was(&[K_PF]) & !was2_east_asian)
        | ((was2(&[K_HARD, K_SP, K_GL]) | (start << 1)) & was(&[K_HY, K_HH]) & letter)
        | was(&[K_BB])
        | is(&[K_BA, K_HH, K_HY, K_NS])
        | (was2(&[K_HL]) & was(&[K_HY, K_HH]) & !is(&[K_HL]))
        | (was(&[K_SY]) & is(&[K_HL]))
        | is(&[K_IN])
        | (was_letter & is(&[K_NU]))
        | (was(&[K_NU]) & letter)
        | (was(&[K_PR]) & is(&[K_ID]))
        | (was(&[K_ID]) & is(&[K_PO]))
        | (was(&[K_PR, K_PO]) & letter)
        | (was_letter & post_prefix)
        | numeric_context
        | (was(&[K_PR, K_PO])
            & ((is(&[K_OP]) & (then(&[K_NU]) | (then(&[K_IS]) & then2(&[K_NU])))) | is(&[K_NU])))
        | (was(&[K_HY, K_IS]) & is(&[K_NU]))
        | (was(&[K_H23]) & is(&[K_PO]))
        | (was(&[K_PR]) & is(&[K_H23]))
        | (was_letter & letter)
        | (was(&[K_IS]) & letter)
        | (was(&[K_AL, K_HL, K_NU]) & is(&[K_OP]) & !east_asian)
        | (was(&[K_CP]) & is(&[K_AL, K_HL, K_NU]));

    let no_break = early | (!space_before_number & (before_spaces | (!was_space & late)));

    // The scalar flag survives a required break (`( ` then a newline suppresses a later
    // boundary), and two adjacent initial quotes alternate. Both go to the scalar residue.
    let dirty_boundaries = (flagged & hard) | (is(&[K_PI]) & was(&[K_PI]));

    let inert = is(&[K_AL, K_HL, K_ID, K_H23]);
    let was_inert = was(&[K_AL, K_HL, K_ID, K_H23]);
    let was2_inert = was2(&[K_AL, K_HL, K_ID, K_H23]);
    let safe = inert
        & !flagged
        & ((was2_inert & was_inert)
            | ((was3(&[K_AL, K_HL, K_ID, K_H23, K_SP]) | (start << 2)) & was2_inert & was_space));

    Decision {
        allowed: !no_break & !required,
        required,
        dirty_boundaries,
        safe,
    }
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), ()> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact(capacity.saturating_sub(values.len()))
            .map_err(|_| ())?;
    }
    Ok(())
}
