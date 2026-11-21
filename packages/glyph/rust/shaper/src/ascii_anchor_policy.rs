//! Conservative, optional ASCII-anchor font policy for the General raw producer.
//! Rejection keeps the existing whole-run path as the authoritative result.

#[cfg(test)]
use super::ShaperRegistry;
use super::{
    BufferClusterLevel, BufferFlags, BuiltinFontFuncs, Direction, FlatExtents, FontFuncs, FontRef,
    GlyphExtents, RegisteredFont, ShapeOptions, ShapePlan, Tag, UnicodeBuffer,
};
use alloc::{string::String, vec::Vec};
use core::convert::TryFrom;
use read_fonts::tables::{
    gpos::{PairPos, PositionSubtables, SinglePos},
    gsub::{SingleSubst, SubstitutionSubtables},
};
use read_fonts::{FontRef as ReadFontRef, TableProvider, types::GlyphId16};

const TABLE_VISITS_MAX: usize = 16_384;
const SUMMARY_BYTES_MAX: usize = 32 * 1024;
const GLYPH_BITMAP_BYTES: usize = 65_536 / 8;
const GS_LOOKUPS_MAX: usize = 16;
const MULTIPLE_PRODUCT_MAX: usize = 4;
const LIG_COMPONENTS_MAX: usize = 16;
pub(crate) const WHOLE_UNITS_MAX: usize = 8_192;
const ITEM_UNITS_MAX: usize = 256;
const ANCHOR_SIDE_UNITS_MAX: usize = 64;
pub(crate) const NOMINAL_PROBES_MAX: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Unsupported {
    Font,
    Lookup,
    Resource,
    Descriptor,
    Anchors,
}

pub(crate) type PolicyResult<T> = Result<T, Unsupported>;

struct Visits(usize);

impl Visits {
    fn add(&mut self, amount: usize) -> PolicyResult<()> {
        self.0 = self.0.checked_add(amount).ok_or(Unsupported::Resource)?;
        if self.0 > TABLE_VISITS_MAX {
            return Err(Unsupported::Resource);
        }
        Ok(())
    }
}

pub(crate) struct FontScreen {
    gsub_inputs: Vec<u8>,
    nominal: [Option<u16>; 95],
    pub(crate) lookup_count: usize,
    pub(crate) multiple_product: usize,
    pub(crate) table_visits: usize,
}

impl FontScreen {
    fn mark_input(&mut self, gid: u16, visits: &mut Visits) -> PolicyResult<()> {
        visits.add(1)?;
        let index = usize::from(gid);
        self.gsub_inputs[index >> 3] |= 1 << (index & 7);
        Ok(())
    }

    fn immutable(&self, gid: u16) -> bool {
        let index = usize::from(gid);
        self.gsub_inputs[index >> 3] & (1 << (index & 7)) == 0
    }

    fn nominal(&self, unit: u16) -> Option<u16> {
        let index = usize::from(unit.checked_sub(0x20)?);
        self.nominal
            .get(index)
            .copied()
            .flatten()
            .filter(|gid| *gid != 0)
    }

    pub(crate) fn covers(&self, used: &AsciiUse) -> bool {
        (0..95).all(|index| !used.has(index) || self.nominal[index].is_some_and(|gid| gid != 0))
    }
}

/// The existing whole-paragraph UTF-16 decoder and staged UnicodeAnalysis own
/// this fact. The test constructor is only a direct-kernel scan oracle.
#[derive(Clone, Copy)]
pub(crate) struct AsciiUse([u8; 12]);

impl AsciiUse {
    pub(crate) fn from_analysis(facts: crate::unicode::PrintableAsciiFacts) -> Option<Self> {
        facts.printable().then(|| Self(facts.used()))
    }

    #[cfg(test)]
    pub(crate) fn from_test_text(text: &[u16]) -> Option<Self> {
        let mut result = Self([0; 12]);
        for &unit in text {
            let index = usize::from(unit.checked_sub(0x20)?);
            if index >= 95 {
                return None;
            }
            result.0[index >> 3] |= 1 << (index & 7);
        }
        Some(result)
    }

    fn has(&self, index: usize) -> bool {
        self.0[index >> 3] & (1 << (index & 7)) != 0
    }
}

fn nonmark(gdef: &read_fonts::tables::gdef::ClassDef<'_>, gid: u16) -> bool {
    matches!(gdef.get(GlyphId16::new(gid)), 0 | 1 | 2 | 4)
}

fn supported_value_format(bits: u16) -> bool {
    // Scalar x/y placement and x/y advance only; device/variation fields reject.
    bits & !0x000f == 0
}

fn check_class_def(
    class: &read_fonts::tables::layout::ClassDef<'_>,
    visits: &mut Visits,
) -> PolicyResult<()> {
    use read_fonts::tables::layout::ClassDef;
    match class {
        ClassDef::Format1(table) => {
            let values = table.class_value_array();
            if values.len() != usize::from(table.glyph_count()) {
                return Err(Unsupported::Font);
            }
            visits.add(values.len())?;
        }
        ClassDef::Format2(table) => {
            let ranges = table.class_range_records();
            if ranges.len() != usize::from(table.class_range_count()) {
                return Err(Unsupported::Font);
            }
            visits.add(ranges.len())?;
            for range in ranges {
                if range.start_glyph_id.get() > range.end_glyph_id.get() {
                    return Err(Unsupported::Font);
                }
            }
        }
    }
    Ok(())
}

/// Bounded all-font overapproximation; it deliberately does not reproduce
/// private HarfRust feature/lookup selection. Every lazy read is checked.
pub(crate) fn screen_font(sfnt: &[u8]) -> PolicyResult<FontScreen> {
    let font = ReadFontRef::new(sfnt).map_err(|_| Unsupported::Font)?;
    if font.table_directory().table_records().iter().any(|record| {
        [b"morx", b"kerx", b"kern", b"trak", b"fvar"]
            .iter()
            .any(|tag| record.tag.get() == read_fonts::types::Tag::new(tag))
    }) {
        return Err(Unsupported::Font);
    }
    let gsub = font.gsub().map_err(|_| Unsupported::Font)?;
    let gpos = font.gpos().map_err(|_| Unsupported::Font)?;
    if gsub.feature_variations().is_some() || gpos.feature_variations().is_some() {
        return Err(Unsupported::Font);
    }
    let gdef = font.gdef().map_err(|_| Unsupported::Font)?;
    let classes = gdef
        .glyph_class_def()
        .ok_or(Unsupported::Font)?
        .map_err(|_| Unsupported::Font)?;
    let glyph_count = font.maxp().map_err(|_| Unsupported::Font)?.num_glyphs();
    if glyph_count == 0 {
        return Err(Unsupported::Font);
    }
    let mut inputs = Vec::new();
    inputs
        .try_reserve_exact(GLYPH_BITMAP_BYTES)
        .map_err(|_| Unsupported::Resource)?;
    inputs.resize(GLYPH_BITMAP_BYTES, 0);
    if inputs
        .capacity()
        .checked_add(core::mem::size_of::<FontScreen>())
        .ok_or(Unsupported::Resource)?
        > SUMMARY_BYTES_MAX
    {
        return Err(Unsupported::Resource);
    }
    let mut result = FontScreen {
        gsub_inputs: inputs,
        nominal: [None; 95],
        lookup_count: 0,
        multiple_product: 1,
        table_visits: 0,
    };
    let mut visits = Visits(0);
    check_class_def(&classes, &mut visits)?;
    let gsub_lookups = gsub.lookup_list().map_err(|_| Unsupported::Font)?.lookups();
    if gsub_lookups.len() > GS_LOOKUPS_MAX {
        return Err(Unsupported::Resource);
    }
    result.lookup_count = gsub_lookups.len();
    for lookup in gsub_lookups.iter() {
        visits.add(1)?;
        let lookup = lookup.map_err(|_| Unsupported::Font)?;
        if lookup.lookup_flag().to_bits() != 0
            || lookup.mark_filtering_set().is_some()
            || lookup.lookup_type() == 7
        {
            return Err(Unsupported::Lookup);
        }
        let mut largest_multiple = 1usize;
        match lookup.subtables().map_err(|_| Unsupported::Font)? {
            SubstitutionSubtables::Single(tables) => {
                for table in tables.iter() {
                    visits.add(1)?;
                    match table.map_err(|_| Unsupported::Font)? {
                        SingleSubst::Format1(table) => {
                            for glyph in table.coverage().map_err(|_| Unsupported::Font)?.iter() {
                                let input = glyph.to_u16();
                                let output = (i32::from(input) + i32::from(table.delta_glyph_id()))
                                    .rem_euclid(65_536)
                                    as u16;
                                if input >= glyph_count
                                    || output == 0
                                    || output >= glyph_count
                                    || !nonmark(&classes, output)
                                {
                                    return Err(Unsupported::Font);
                                }
                                result.mark_input(input, &mut visits)?;
                            }
                        }
                        SingleSubst::Format2(table) => {
                            let coverage = table.coverage().map_err(|_| Unsupported::Font)?;
                            let outputs = table.substitute_glyph_ids();
                            if outputs.len() > TABLE_VISITS_MAX {
                                return Err(Unsupported::Resource);
                            }
                            let mut covered = coverage.iter();
                            for output in outputs.iter() {
                                let input = covered.next().ok_or(Unsupported::Font)?;
                                let input = input.to_u16();
                                let output = output.get().to_u16();
                                if input >= glyph_count
                                    || output == 0
                                    || output >= glyph_count
                                    || !nonmark(&classes, output)
                                {
                                    return Err(Unsupported::Font);
                                }
                                result.mark_input(input, &mut visits)?;
                            }
                            if covered.next().is_some() {
                                return Err(Unsupported::Font);
                            }
                        }
                    }
                }
            }
            SubstitutionSubtables::Multiple(tables) => {
                for table in tables.iter() {
                    visits.add(1)?;
                    let table = table.map_err(|_| Unsupported::Font)?;
                    let coverage = table.coverage().map_err(|_| Unsupported::Font)?;
                    let sequences = table.sequences();
                    if sequences.len() > TABLE_VISITS_MAX {
                        return Err(Unsupported::Resource);
                    }
                    let mut covered = coverage.iter();
                    for sequence in sequences.iter() {
                        let input = covered.next().ok_or(Unsupported::Font)?;
                        let input = input.to_u16();
                        if input >= glyph_count {
                            return Err(Unsupported::Font);
                        }
                        result.mark_input(input, &mut visits)?;
                        let sequence = sequence.map_err(|_| Unsupported::Font)?;
                        let len = usize::from(sequence.glyph_count());
                        if !(1..=4).contains(&len) {
                            return Err(Unsupported::Resource);
                        }
                        largest_multiple = largest_multiple.max(len);
                        for output in sequence.substitute_glyph_ids() {
                            visits.add(1)?;
                            let output = output.get().to_u16();
                            if output == 0 || output >= glyph_count || !nonmark(&classes, output) {
                                return Err(Unsupported::Font);
                            }
                        }
                    }
                    if covered.next().is_some() {
                        return Err(Unsupported::Font);
                    }
                }
            }
            SubstitutionSubtables::Ligature(tables) => {
                for table in tables.iter() {
                    visits.add(1)?;
                    let table = table.map_err(|_| Unsupported::Font)?;
                    let coverage = table.coverage().map_err(|_| Unsupported::Font)?;
                    let sets = table.ligature_sets();
                    if sets.len() > TABLE_VISITS_MAX {
                        return Err(Unsupported::Resource);
                    }
                    let mut covered = coverage.iter();
                    for set in sets.iter() {
                        let input = covered.next().ok_or(Unsupported::Font)?;
                        let input = input.to_u16();
                        if input >= glyph_count {
                            return Err(Unsupported::Font);
                        }
                        result.mark_input(input, &mut visits)?;
                        let set = set.map_err(|_| Unsupported::Font)?;
                        for ligature in set.ligatures().iter() {
                            visits.add(1)?;
                            let ligature = ligature.map_err(|_| Unsupported::Font)?;
                            let count = usize::from(ligature.component_count());
                            if !(2..=LIG_COMPONENTS_MAX).contains(&count) {
                                return Err(Unsupported::Resource);
                            }
                            let output = ligature.ligature_glyph().to_u16();
                            if output == 0 || output >= glyph_count || !nonmark(&classes, output) {
                                return Err(Unsupported::Font);
                            }
                            for component in ligature.component_glyph_ids() {
                                let component = component.get().to_u16();
                                if component >= glyph_count {
                                    return Err(Unsupported::Font);
                                }
                                result.mark_input(component, &mut visits)?;
                            }
                        }
                    }
                    if covered.next().is_some() {
                        return Err(Unsupported::Font);
                    }
                }
            }
            _ => return Err(Unsupported::Lookup),
        }
        result.multiple_product = result
            .multiple_product
            .checked_mul(largest_multiple)
            .ok_or(Unsupported::Resource)?;
        if result.multiple_product > MULTIPLE_PRODUCT_MAX {
            return Err(Unsupported::Resource);
        }
    }
    for lookup in gpos
        .lookup_list()
        .map_err(|_| Unsupported::Font)?
        .lookups()
        .iter()
    {
        visits.add(1)?;
        let lookup = lookup.map_err(|_| Unsupported::Font)?;
        if !matches!(lookup.lookup_flag().to_bits(), 0 | 0x0008)
            || lookup.mark_filtering_set().is_some()
            || lookup.lookup_type() == 9
        {
            return Err(Unsupported::Lookup);
        }
        match lookup.subtables().map_err(|_| Unsupported::Font)? {
            PositionSubtables::Single(tables) => {
                for table in tables.iter() {
                    visits.add(1)?;
                    match table.map_err(|_| Unsupported::Font)? {
                        SinglePos::Format1(value) => {
                            if !supported_value_format(value.value_format().bits()) {
                                return Err(Unsupported::Lookup);
                            }
                            value
                                .offset_data()
                                .read_with_args::<read_fonts::tables::gpos::ValueRecord>(
                                    value.value_record_byte_range(),
                                    &value.value_format(),
                                )
                                .map_err(|_| Unsupported::Font)?;
                            for _ in value.coverage().map_err(|_| Unsupported::Font)?.iter() {
                                visits.add(1)?;
                            }
                        }
                        SinglePos::Format2(value) => {
                            if !supported_value_format(value.value_format().bits()) {
                                return Err(Unsupported::Lookup);
                            }
                            let coverage = value.coverage().map_err(|_| Unsupported::Font)?;
                            if value.value_records().len() != usize::from(value.value_count()) {
                                return Err(Unsupported::Font);
                            }
                            for index in 0..usize::from(value.value_count()) {
                                visits.add(1)?;
                                value
                                    .value_records()
                                    .get(index)
                                    .map_err(|_| Unsupported::Font)?;
                            }
                            let mut count = 0;
                            for _ in coverage.iter() {
                                visits.add(1)?;
                                count += 1;
                            }
                            if count != usize::from(value.value_count()) {
                                return Err(Unsupported::Font);
                            }
                        }
                    }
                }
            }
            PositionSubtables::Pair(tables) => {
                for table in tables.iter() {
                    visits.add(1)?;
                    let table = table.map_err(|_| Unsupported::Font)?;
                    if table.value_format2().bits() != 0
                        || !supported_value_format(table.value_format1().bits())
                    {
                        return Err(Unsupported::Lookup);
                    }
                    match table {
                        PairPos::Format1(value) => {
                            let coverage = value.coverage().map_err(|_| Unsupported::Font)?;
                            let mut count = 0;
                            for _ in coverage.iter() {
                                visits.add(1)?;
                                count += 1;
                            }
                            if count != usize::from(value.pair_set_count()) {
                                return Err(Unsupported::Font);
                            }
                            for set in value.pair_sets().iter() {
                                visits.add(1)?;
                                let set = set.map_err(|_| Unsupported::Font)?;
                                for record in set.pair_value_records().iter() {
                                    visits.add(1)?;
                                    record.map_err(|_| Unsupported::Font)?;
                                }
                            }
                        }
                        PairPos::Format2(value) => {
                            for _ in value.coverage().map_err(|_| Unsupported::Font)?.iter() {
                                visits.add(1)?;
                            }
                            check_class_def(
                                &value.class_def1().map_err(|_| Unsupported::Font)?,
                                &mut visits,
                            )?;
                            check_class_def(
                                &value.class_def2().map_err(|_| Unsupported::Font)?,
                                &mut visits,
                            )?;
                            let count = usize::from(value.class1_count())
                                .checked_mul(usize::from(value.class2_count()))
                                .ok_or(Unsupported::Resource)?;
                            visits.add(count)?;
                            if value.class1_records().len() != usize::from(value.class1_count()) {
                                return Err(Unsupported::Font);
                            }
                            for index in 0..usize::from(value.class1_count()) {
                                let row = value
                                    .class1_records()
                                    .get(index)
                                    .map_err(|_| Unsupported::Font)?;
                                if row.class2_records().len() != usize::from(value.class2_count()) {
                                    return Err(Unsupported::Font);
                                }
                                for column in 0..usize::from(value.class2_count()) {
                                    row.class2_records()
                                        .get(column)
                                        .map_err(|_| Unsupported::Font)?;
                                }
                            }
                        }
                    }
                }
            }
            _ => return Err(Unsupported::Lookup),
        }
    }
    result.table_visits = visits.0;
    Ok(result)
}

struct NominalBootstrap<'a> {
    extents: FlatExtents<'a>,
    mapped: &'a mut [Option<u16>; 95],
}

impl FontFuncs for NominalBootstrap<'_> {
    fn nominal_glyph(
        &mut self,
        builtin: &BuiltinFontFuncs,
        codepoint: u32,
    ) -> Option<read_fonts::types::GlyphId> {
        let actual = builtin.nominal_glyph(codepoint);
        if let Some(index) = codepoint.checked_sub(0x20).filter(|index| *index < 95) {
            self.mapped[index as usize] =
                actual.and_then(|glyph| u16::try_from(glyph.to_u32()).ok());
        }
        actual
    }

    fn extents(
        &mut self,
        builtin: &BuiltinFontFuncs,
        glyph: read_fonts::types::GlyphId,
    ) -> Option<GlyphExtents> {
        self.extents.extents(builtin, glyph)
    }
}

/// One extra, fixed-size HarfRust shape. The ordinary FlatExtents callback is
/// unchanged; this runs only on a first eligible font-screen use.
pub(crate) fn bootstrap_nominals(
    font: &RegisteredFont,
    screen: &mut FontScreen,
) -> PolicyResult<()> {
    let font_ref = FontRef::new(&font.sfnt).map_err(|_| Unsupported::Font)?;
    let shaper = font.data.shaper(&font_ref).build();
    let script = harfrust::Script::from_iso15924_tag(Tag::from_be_bytes(*b"Latn"))
        .ok_or(Unsupported::Descriptor)?;
    let plan = ShapePlan::new(&shaper, Direction::LeftToRight, Some(script), None, &[]);
    let mut ascii = String::new();
    ascii
        .try_reserve_exact(95)
        .map_err(|_| Unsupported::Resource)?;
    for codepoint in 0x20..=0x7e {
        ascii.push(char::from_u32(codepoint).ok_or(Unsupported::Descriptor)?);
    }
    let mut buffer = UnicodeBuffer::new();
    if !buffer.reserve(95) {
        return Err(Unsupported::Resource);
    }
    buffer.push_str(&ascii);
    buffer.set_direction(Direction::LeftToRight);
    buffer.set_script(script);
    buffer.set_cluster_level(BufferClusterLevel::MonotoneGraphemes);
    buffer.set_flags(BufferFlags::from_bits(0x40).ok_or(Unsupported::Descriptor)?);
    let mut callback = NominalBootstrap {
        extents: FlatExtents {
            records: &font.extents,
            availability: &font.availability,
        },
        mapped: &mut screen.nominal,
    };
    #[cfg(test)]
    super::engine::work_attribution::record(|work| {
        work.ascii_nominal_bootstrap_calls += 1;
        work.ascii_nominal_bootstrap_utf16_units += 95;
    });
    let _ = shaper.shape(
        buffer,
        ShapeOptions::new()
            .plan(Some(&plan))
            .font_funcs(Some(&mut callback)),
    );
    let read_font = ReadFontRef::new(&font.sfnt).map_err(|_| Unsupported::Font)?;
    let gdef = read_font.gdef().map_err(|_| Unsupported::Font)?;
    let classes = gdef
        .glyph_class_def()
        .ok_or(Unsupported::Font)?
        .map_err(|_| Unsupported::Font)?;
    for glyph in screen.nominal.iter().flatten().copied() {
        if glyph == 0 || !nonmark(&classes, glyph) {
            return Err(Unsupported::Font);
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn bootstrap_registered_nominals(
    shaper: &ShaperRegistry,
    handle: u32,
    screen: &mut FontScreen,
) -> PolicyResult<()> {
    let index = shaper.font_index(handle).ok_or(Unsupported::Descriptor)?;
    bootstrap_nominals(&shaper.fonts[index], screen)
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct Window {
    pub(crate) old_inner_left: usize,
    pub(crate) old_inner_right: usize,
    pub(crate) new_inner_left: usize,
    pub(crate) new_inner_right: usize,
    pub(crate) new_outer_left: usize,
    pub(crate) new_outer_end: usize,
    #[cfg(test)]
    pub(crate) probed_units: usize,
}

/// `edit` and `AsciiUse` are authoritative prepared producer facts. This
/// function reads bounded old/new units only at the proposed anchors.
// Scheduled for deletion with the ASCII-anchor path; not worth a parameter struct.
#[allow(clippy::too_many_arguments)]
pub(crate) fn fixed_window(
    screen: &FontScreen,
    old: &[u16],
    new: &[u16],
    old_start: usize,
    old_end: usize,
    new_end: usize,
    old_used: &AsciiUse,
    new_used: &AsciiUse,
) -> PolicyResult<Window> {
    if old.len() > WHOLE_UNITS_MAX
        || new.len() > WHOLE_UNITS_MAX
        || old_start > old_end
        || old_end > old.len()
        || new_end > new.len()
        || new_end < old_start
        || old.len() == new.len()
        || !screen.covers(old_used)
        || !screen.covers(new_used)
    {
        return Err(Unsupported::Descriptor);
    }
    let delta = isize::try_from(new.len()).map_err(|_| Unsupported::Resource)?
        - isize::try_from(old.len()).map_err(|_| Unsupported::Resource)?;
    if isize::try_from(new_end).map_err(|_| Unsupported::Resource)?
        - isize::try_from(old_end).map_err(|_| Unsupported::Resource)?
        != delta
    {
        return Err(Unsupported::Descriptor);
    }
    let translated = |old_index: usize| -> Option<usize> {
        usize::try_from(isize::try_from(old_index).ok()?.checked_add(delta)?).ok()
    };
    let mut probes = 0usize;
    let mut left = [None; 2];
    let mut left_found = 0;
    for old_index in (old_start.saturating_sub(ANCHOR_SIDE_UNITS_MAX)..old_start).rev() {
        probes += 2;
        if probes > NOMINAL_PROBES_MAX {
            return Err(Unsupported::Resource);
        }
        let unit = old[old_index];
        if new.get(old_index) != Some(&unit) {
            return Err(Unsupported::Descriptor);
        }
        if screen
            .nominal(unit)
            .is_some_and(|glyph| screen.immutable(glyph))
        {
            left[left_found] = Some(old_index);
            left_found += 1;
            if left_found == 2 {
                break;
            }
        }
    }
    if left_found != 2 {
        return Err(Unsupported::Anchors);
    }
    let mut right = [None; 2];
    let mut right_found = 0;
    // Scheduled for deletion with the ASCII-anchor path; the index also feeds `translated`.
    #[allow(clippy::needless_range_loop)]
    for old_index in old_end..old.len().min(old_end.saturating_add(ANCHOR_SIDE_UNITS_MAX)) {
        probes += 2;
        if probes > NOMINAL_PROBES_MAX {
            return Err(Unsupported::Resource);
        }
        let new_index = translated(old_index).ok_or(Unsupported::Descriptor)?;
        let unit = old[old_index];
        if new.get(new_index) != Some(&unit) {
            return Err(Unsupported::Descriptor);
        }
        if screen
            .nominal(unit)
            .is_some_and(|glyph| screen.immutable(glyph))
        {
            right[right_found] = Some(old_index);
            right_found += 1;
            if right_found == 2 {
                break;
            }
        }
    }
    if right_found != 2 {
        return Err(Unsupported::Anchors);
    }
    let inner_left = left[0].ok_or(Unsupported::Anchors)?;
    let outer_left = left[1].ok_or(Unsupported::Anchors)?;
    let inner_right = right[0].ok_or(Unsupported::Anchors)?;
    let outer_right = right[1].ok_or(Unsupported::Anchors)?;
    let new_inner_right = translated(inner_right).ok_or(Unsupported::Descriptor)?;
    let new_outer_end = translated(outer_right)
        .and_then(|value| value.checked_add(1))
        .ok_or(Unsupported::Descriptor)?;
    if outer_left == 0
        || new_outer_end >= new.len()
        || new_outer_end <= outer_left
        || new_outer_end - outer_left > ITEM_UNITS_MAX
        || new_outer_end - outer_left >= new.len()
    {
        return Err(Unsupported::Resource);
    }
    Ok(Window {
        old_inner_left: inner_left,
        old_inner_right: inner_right,
        new_inner_left: inner_left,
        new_inner_right,
        new_outer_left: outer_left,
        new_outer_end,
        #[cfg(test)]
        probed_units: probes,
    })
}

/// Build only a tentative raw owner. The caller may publish it after every
/// downstream stage succeeds; an append error leaves the previous owner alone.
#[cfg(test)]
pub(crate) fn splice_raw(
    old: &crate::engine::shaping_state::ShapeArena,
    fresh_guarded: &crate::engine::shaping_state::ShapeArena,
    window: Window,
    old_end: u32,
    new_end: u32,
) -> PolicyResult<crate::engine::shaping_state::ShapeArena> {
    use crate::engine::shaping_state::ShapeArena;
    let delta = i64::from(new_end) - i64::from(old_end);
    let as_u32 = |value: usize| u32::try_from(value).map_err(|_| Unsupported::Resource);
    let mut result = ShapeArena::default();
    result
        .append_text_range_from(old, 0, 0, 0, as_u32(window.old_inner_left)?, 0)
        .map_err(|_| Unsupported::Resource)?;
    result
        .append_text_range_from(
            fresh_guarded,
            0,
            0,
            as_u32(window.new_inner_left)?,
            as_u32(
                window
                    .new_inner_right
                    .checked_add(1)
                    .ok_or(Unsupported::Resource)?,
            )?,
            0,
        )
        .map_err(|_| Unsupported::Resource)?;
    result
        .append_text_range_from(
            old,
            0,
            0,
            as_u32(
                window
                    .old_inner_right
                    .checked_add(1)
                    .ok_or(Unsupported::Resource)?,
            )?,
            old_end,
            delta,
        )
        .map_err(|_| Unsupported::Resource)?;
    result
        .collapse_appended_runs(0, 0, new_end)
        .map_err(|_| Unsupported::Resource)?;
    Ok(result)
}

#[cfg(test)]
mod structural_tests {
    use super::*;

    #[test]
    fn budget_and_invalid_font_reject_without_panic() {
        let mut visits = Visits(TABLE_VISITS_MAX);
        assert_eq!(visits.add(1), Err(Unsupported::Resource));
        assert_eq!(visits.add(usize::MAX), Err(Unsupported::Resource));
        assert!(matches!(screen_font(&[]), Err(Unsupported::Font)));
    }
}
