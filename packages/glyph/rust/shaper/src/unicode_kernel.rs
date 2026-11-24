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
//! The kernel never guesses. Every unit outside the closure is covered by a window that runs
//! from the nearest safe cut before it to the nearest safe cut after it, and `unicode.rs` hands
//! each window to the conformance-tested scalar analysis as an independent string. A safe cut is
//! a position where that is exact:
//!
//! - `I | I`, between two closure letters or ideographs,
//! - `I SP | I`, after a single space between two of them, or
//! - directly after a required break.
//!
//! The exhaustive and fuzz tests in `unicode_kernel_tests.rs` are the proof of both the rules
//! and the cuts.

use crate::cold_growth::ColdGrowth as _;

use alloc::vec::Vec;

#[allow(clippy::unreadable_literal, dead_code)]
mod generated {
    include!("generated/kernel_data.rs");
}

pub(crate) use generated::{
    K_AL, K_B2, K_BA, K_BB, K_CL, K_CP, K_EX, K_GL, K_H23, K_HARD, K_HH, K_HL, K_HY, K_ID, K_IN,
    K_IS, K_NS, K_NU, K_OP, K_PF, K_PI, K_PO, K_PR, K_QU, K_SP, K_SY, KERNEL_SCRIPT_COMPLEX,
    KERNEL_SCRIPT_SET_BASE, KERNEL_SCRIPT_TAGS,
};
pub(crate) use generated::{KERNEL_CLASS_MASK, KERNEL_RESYNC_LETTER};
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

/// The kernel class byte of a unit: class id in the low five bits, East Asian width in bit 5,
/// the resync-letter property in bit 6.
#[inline]
pub(crate) fn unit_class(unit: u16) -> u8 {
    (unit_value(unit) & 0xff) as u8
}

/// The script byte of a unit: 0 neutral, an index into `KERNEL_SCRIPT_TAGS`, a candidate-set id,
/// or the complex mark.
#[inline]
pub(crate) fn unit_script(unit: u16) -> u8 {
    (unit_value(unit) >> 8) as u8
}

/// The candidate scripts of a neutral unit whose script byte is a set id.
#[inline]
pub(crate) fn script_set(id: u8) -> &'static [u32] {
    let index = usize::from(id - KERNEL_SCRIPT_SET_BASE);
    let start = usize::from(generated::KERNEL_SCRIPT_SET_OFFSETS[index]);
    let end = usize::from(generated::KERNEL_SCRIPT_SET_OFFSETS[index + 1]);
    &generated::KERNEL_SCRIPT_SET_TAGS[start..end]
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
}

#[derive(Default)]
struct Carry {
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
    safe: u64,
}

impl Kernel {
    pub(crate) fn reserve(&mut self, units: usize) -> Result<(), ()> {
        let blocks = units / BLOCK + 1;
        reserve(&mut self.classes, blocks * BLOCK)?;
        reserve(&mut self.scripts, units)?;
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

    pub(crate) fn classify(&mut self, text: &[u16]) {
        let blocks = text.len() / BLOCK + 1;
        self.classes.clear();
        self.classes.resize(blocks * BLOCK, 0);
        self.scripts.clear();
        self.scripts.resize(text.len(), 0);
        let tables = lanes::AsciiTables::new();
        let mut start = 0;
        while start < text.len() {
            let end = (start + lanes::LANE).min(text.len());
            let units = &text[start..end];
            let classes = &mut self.classes[start..end];
            let scripts = &mut self.scripts[start..end];
            if !lanes::classify_ascii(units, &tables, classes, scripts) {
                for ((unit, class), script) in units.iter().zip(classes).zip(scripts) {
                    let value = unit_value(*unit);
                    *class = (value & 0xff) as u8;
                    *script = (value >> 8) as u8;
                }
            }
            start = end;
        }
    }

    pub(crate) fn decide(&mut self, units: usize) {
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
            self.allowed.push(decision.allowed & boundary_mask);
            self.required.push(decision.required & boundary_mask);
            self.safe.push(decision.safe & boundary_mask);
            self.dirty.push(current[RESIDUE] & unit_mask);
            previous = current;
            current = next;
        }
    }

    pub(crate) fn find_windows(&mut self, units: usize) {
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

    /// Appends every break the kernel decided in `[from, to]`, ascending. Each block's breaks
    /// are counted first and written into slots already in the lane, so the loop over a block's
    /// bits neither grows the lane nor checks its capacity.
    pub(crate) fn append_breaks(
        &self,
        from: usize,
        to: usize,
        breaks: &mut Vec<crate::line_break::LineBreak>,
    ) {
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
            let at = breaks.len();
            breaks.resize(
                at + bits.count_ones() as usize,
                crate::line_break::LineBreak {
                    position: 0,
                    required: false,
                },
            );
            for slot in &mut breaks[at..] {
                let bit = bits.trailing_zeros();
                bits &= bits - 1;
                *slot = crate::line_break::LineBreak {
                    position: (block * BLOCK) as u32 + bit,
                    required: required >> bit & 1 != 0,
                };
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

/// Turns 64 class bytes into one bitmap per class id plus the East Asian plane: six bit planes,
/// then the five id planes decoded into one-hot class masks.
fn decode(classes: &[u8]) -> [u64; MASKS] {
    let [b0, b1, b2, b3, b4, east_asian] = lanes::planes(classes);
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

/// The class stage's two data-parallel steps, each with a scalar twin: classifying a lane of
/// ASCII units, and lifting the six low bit planes of 64 class bytes. On simd128 builds the lane
/// is two table swizzles per sixteen units and a plane is one byte-shift and bitmask per sixteen
/// bytes; elsewhere both are the scalar forms, which the oracle's `kernels` command checks the
/// simd128 forms against on random and adversarial input.
pub(crate) mod lanes {
    /// Units per lane.
    pub(crate) const LANE: usize = 16;

    /// The class and script bytes of every ASCII unit, split from the generated table.
    pub(crate) struct AsciiTables {
        pub(crate) classes: [u8; 128],
        pub(crate) scripts: [u8; 128],
    }

    impl AsciiTables {
        pub(crate) fn new() -> Self {
            let mut tables = Self {
                classes: [0; 128],
                scripts: [0; 128],
            };
            for (unit, value) in super::generated::KERNEL_ASCII.iter().enumerate() {
                tables.classes[unit] = (*value & 0xff) as u8;
                tables.scripts[unit] = (*value >> 8) as u8;
            }
            tables
        }
    }

    /// Writes the class and script bytes of a lane of up to `LANE` units when every unit is
    /// ASCII, and returns whether it did; otherwise writes nothing.
    pub(crate) fn classify_ascii(
        units: &[u16],
        tables: &AsciiTables,
        classes: &mut [u8],
        scripts: &mut [u8],
    ) -> bool {
        #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
        if units.len() == LANE {
            return classify_ascii_simd(units, tables, classes, scripts);
        }
        classify_ascii_scalar(units, tables, classes, scripts)
    }

    pub(crate) fn classify_ascii_scalar(
        units: &[u16],
        tables: &AsciiTables,
        classes: &mut [u8],
        scripts: &mut [u8],
    ) -> bool {
        if units.iter().fold(0u16, |all, unit| all | unit) >= 0x80 {
            return false;
        }
        for ((unit, class), script) in units.iter().zip(classes).zip(scripts) {
            *class = tables.classes[usize::from(*unit)];
            *script = tables.scripts[usize::from(*unit)];
        }
        true
    }

    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    pub(crate) fn classify_ascii_simd(
        units: &[u16],
        tables: &AsciiTables,
        classes: &mut [u8],
        scripts: &mut [u8],
    ) -> bool {
        use core::arch::wasm32::{
            i8x16_splat, i8x16_sub, i8x16_swizzle, u8x16_narrow_i16x8, u16x8_splat, v128, v128_and,
            v128_any_true, v128_load, v128_or, v128_store,
        };
        assert!(units.len() == LANE && classes.len() == LANE && scripts.len() == LANE);
        // SAFETY: the assertion above makes every load and store 16 bytes inside its slice;
        // wasm loads and stores carry no alignment requirement.
        unsafe {
            let low = v128_load(units.as_ptr().cast::<v128>());
            let high = v128_load(units.as_ptr().add(8).cast::<v128>());
            if v128_any_true(v128_and(v128_or(low, high), u16x8_splat(0xff80))) {
                return false;
            }
            // Every unit is below 0x80, so narrowing is exact.
            let index = u8x16_narrow_i16x8(low, high);
            // A swizzle reads zero for an index of 16 or more, so the eight 16-entry slices of a
            // 128-entry table each answer only the units in their own slice.
            let lookup = |table: &[u8; 128]| {
                let mut found = i8x16_splat(0);
                for slice in 0..8 {
                    let entries = v128_load(table.as_ptr().add(slice * 16).cast::<v128>());
                    let local = i8x16_sub(index, i8x16_splat((slice * 16) as i8));
                    found = v128_or(found, i8x16_swizzle(entries, local));
                }
                found
            };
            v128_store(classes.as_mut_ptr().cast::<v128>(), lookup(&tables.classes));
            v128_store(scripts.as_mut_ptr().cast::<v128>(), lookup(&tables.scripts));
        }
        true
    }

    /// The low six bit planes of 64 class bytes: bit `i` of plane `b` is bit `b` of byte `i`.
    pub(crate) fn planes(classes: &[u8]) -> [u64; 6] {
        #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
        {
            planes_simd(classes)
        }
        #[cfg(not(all(target_arch = "wasm32", feature = "simd128")))]
        {
            planes_scalar(classes)
        }
    }

    /// Eight bytes per step with the SWAR multiply.
    #[cfg(any(
        not(all(target_arch = "wasm32", feature = "simd128")),
        feature = "oracle"
    ))]
    pub(crate) fn planes_scalar(classes: &[u8]) -> [u64; 6] {
        const ONES: u64 = 0x0101_0101_0101_0101;
        const GATHER: u64 = 0x0102_0408_1020_4080;
        let mut planes = [0u64; 6];
        for (group, bytes) in classes[..64].chunks_exact(8).enumerate() {
            let mut word = [0u8; 8];
            word.copy_from_slice(bytes);
            let word = u64::from_le_bytes(word);
            for (bit, plane) in planes.iter_mut().enumerate() {
                *plane |= (((word >> bit) & ONES).wrapping_mul(GATHER) >> 56) << (group * 8);
            }
        }
        planes
    }

    #[cfg(all(target_arch = "wasm32", feature = "simd128"))]
    pub(crate) fn planes_simd(classes: &[u8]) -> [u64; 6] {
        use core::arch::wasm32::{i8x16_bitmask, i8x16_shl, v128, v128_load};
        let classes = &classes[..64];
        let mut planes = [0u64; 6];
        for quarter in 0..4 {
            // SAFETY: `classes` holds 64 bytes, so each 16-byte load is inside it.
            let bytes = unsafe { v128_load(classes.as_ptr().add(quarter * 16).cast::<v128>()) };
            for (bit, plane) in planes.iter_mut().enumerate() {
                // Bit `bit` of each byte moves to its sign, which the bitmask gathers.
                let signs = i8x16_bitmask(i8x16_shl(bytes, (7 - bit) as u32));
                *plane |= u64::from(signs) << (quarter * 16);
            }
        }
        planes
    }
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
    // `was(x)`: the unit before is in x. `was2`: two units before.
    // `then(x)`: the unit after is in x. `then2`: two units after.
    let was = |classes: &[u8]| (union(current, classes) << 1) | (union(previous, classes) >> 63);
    let was2 = |classes: &[u8]| (union(current, classes) << 2) | (union(previous, classes) >> 62);
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

    // LB14 and LB15a: `OP SP* ×` and `(sot | BK | LF | NL | OP | QU | GL | SP) Pi SP* ×`. The
    // boundary after a space run that follows such a base is not a break.
    let flag_base =
        is(&[K_OP]) | (is(&[K_PI]) & (was(&[K_HARD, K_OP, K_QU, K_PI, K_PF, K_GL, K_SP]) | start));
    let flagged_spaces = runs_after(
        (flag_base << 1) | carry.base_high,
        space,
        &mut carry.flag_run,
    );
    carry.base_high = flag_base >> 63;
    let flagged = (flagged_spaces << 1) | carry.flagged_high;
    carry.flagged_high = flagged_spaces >> 63;

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

    // A safe cut: a letter or ideograph after another, or after one and a single space, or
    // any unit after a required break. No rule's context crosses these.
    let inert = is(&[K_AL, K_HL, K_ID, K_H23]);
    let safe = (inert
        & (was(&[K_AL, K_HL, K_ID, K_H23]) | (was2(&[K_AL, K_HL, K_ID, K_H23]) & was_space)))
        | required;

    Decision {
        allowed: !no_break & !required,
        required,
        safe,
    }
}

fn reserve<T>(values: &mut Vec<T>, capacity: usize) -> Result<(), ()> {
    if values.capacity() < capacity {
        values
            .try_reserve_exact_cold(capacity.saturating_sub(values.len()))
            .map_err(|_| ())?;
    }
    Ok(())
}

/// The oracle's check of the class stage's data-parallel forms against their scalar twins:
/// every ASCII unit at every lane position, lanes with one non-ASCII unit anywhere (units whose
/// low byte is ASCII among them, which narrowing must not mistake for ASCII), short lanes, and
/// seeded random lanes; the plane lift on random and adversarial bytes. On a build without
/// simd128 the forms are the twins themselves and the check is trivially equal.
#[cfg(feature = "oracle")]
pub(crate) fn twin_report(rounds: usize) -> Result<alloc::string::String, alloc::string::String> {
    use lanes::{AsciiTables, LANE, classify_ascii, classify_ascii_scalar, planes, planes_scalar};
    let tables = AsciiTables::new();
    let checked = core::cell::Cell::new(0usize);
    let check_lane = |units: &[u16]| -> Result<(), alloc::string::String> {
        let (mut classes, mut scripts) = ([0xaa_u8; LANE], [0xaa_u8; LANE]);
        let (mut twin_classes, mut twin_scripts) = ([0xaa_u8; LANE], [0xaa_u8; LANE]);
        let n = units.len();
        let fast = classify_ascii(units, &tables, &mut classes[..n], &mut scripts[..n]);
        let slow = classify_ascii_scalar(
            units,
            &tables,
            &mut twin_classes[..n],
            &mut twin_scripts[..n],
        );
        checked.set(checked.get() + 1);
        if fast != slow || (fast && (classes != twin_classes || scripts != twin_scripts)) {
            return Err(alloc::format!(
                "lane {units:04x?}: {fast} {classes:?} {scripts:?} against {slow} {twin_classes:?} {twin_scripts:?}"
            ));
        }
        Ok(())
    };
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for unit in 0..0x80u16 {
        for position in 0..LANE {
            let mut lane = [0x61u16; LANE];
            lane[position] = unit;
            check_lane(&lane)?;
        }
    }
    for odd in [
        0x80u16, 0xff, 0x100, 0x141, 0x7f00, 0x8061, 0xd800, 0xdc41, 0xfeff, 0xffff,
    ] {
        for position in 0..LANE {
            let mut lane = [0x20u16; LANE];
            lane[position] = odd;
            check_lane(&lane)?;
        }
    }
    for length in 0..LANE {
        let lane: alloc::vec::Vec<u16> = (0..length).map(|_| (next() % 0x80) as u16).collect();
        check_lane(&lane)?;
    }
    for _ in 0..rounds {
        let mut lane = [0u16; LANE];
        let wide = next() % 4 == 0;
        for unit in &mut lane {
            let value = next();
            *unit = if wide && value % 16 == 0 {
                (value >> 8) as u16
            } else {
                (value % 0x80) as u16
            };
        }
        check_lane(&lane)?;
        let mut bytes = [0u8; 64];
        for byte in &mut bytes {
            *byte = next() as u8;
        }
        for adversarial in [[0u8; 64], [0xff; 64], [0x80; 64], [0x7f; 64]] {
            if planes(&adversarial) != planes_scalar(&adversarial) {
                return Err(alloc::format!("planes of {adversarial:?}"));
            }
        }
        if planes(&bytes) != planes_scalar(&bytes) {
            return Err(alloc::format!("planes of {bytes:?}"));
        }
        checked.set(checked.get() + 1);
    }
    Ok(alloc::format!(
        "kernel twins: {} lanes and plane lifts equal\n",
        checked.get()
    ))
}
