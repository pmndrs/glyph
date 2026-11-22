//! pmndrs/glyph fork addition (see GLYPH-FORK.md): shaping text no rule of the font can touch
//! without running the shaper.
//!
//! [`SimpleTextPlan`] is derived once from a [`ShapePlan`](crate::ShapePlan). It holds every glyph
//! some lookup of the plan could start a match on. A buffer whose characters all map to glyphs
//! outside that set, and that the Unicode stages of [`shape_internal`] leave alone, shapes to its
//! nominal glyphs at their font advances; [`SimpleTextPlan::shape`] produces exactly that buffer
//! and hands every other buffer back unchanged for the shaper.
//!
//! Why the result is the shaper's, stage by stage of `OtShapeContext::shape_internal` for a plan
//! and a character this module accepts:
//!
//! - `set_unicode_props`, `insert_dotted_circle`, `form_clusters`: no accepted character is a
//!   mark, a format character, a default ignorable, U+FF9E/U+FF9F or the fraction slash, and
//!   every one is in the BMP, so none is a continuation and no scratch flag but "non-ASCII" is set.
//! - `ensure_native_direction`, `rotate_chars`: the plan is left-to-right and its script is not
//!   natively right-to-left.
//! - normalisation: the default shaper composes with short-circuit, so a character the font maps
//!   keeps its nominal glyph, and one it lacks becomes `.notdef` unless it decomposes, is a
//!   space or is U+2011; later rounds visit marks only.
//! - `setup_masks`: masks only select lookups, and no lookup can match (below).
//! - GSUB and GPOS: every subtable `apply` first looks the current glyph up in its primary
//!   coverage and returns before any side effect when it is absent. No accepted glyph is in the
//!   primary coverage of any subtable of any lookup of the plan, so no lookup substitutes, moves
//!   or flags anything, whatever surrounds the glyph.
//! - legacy `kern`: a plan that applies it is not eligible.
//! - mark zeroing and fallback mark positioning: no accepted glyph has the GDEF mark class and no
//!   accepted character is a mark.
//! - space fallback and default-ignorable hiding: need scratch flags that are never set here.
//! - `propagate_flags`: every cluster is one glyph, so its flags are the global mask's defined
//!   bits.
//!
//! The caller's `FontFuncs` must leave `nominal_glyph` and the advance callbacks at their
//! defaults and shape without a scale, as pmndrs/glyph does.

use alloc::boxed::Box;
use alloc::vec::Vec;

use super::buffer::{GlyphFlags, GlyphPosition};
use super::common::Direction;
use super::font_funcs::BuiltinFontFuncs;
use super::ot_layout::TableIndex;
use super::ot_shape_normalize::HB_OT_SHAPE_NORMALIZATION_MODE_AUTO;
use super::ot_shape_plan::hb_ot_shape_plan_t;
use super::unicode::{CharExt, GeneralCategory};
use super::{hb_font_t, hb_mask_t};
use crate::{BufferFlags, GlyphBuffer, GlyphId, UnicodeBuffer};

const PAGE: usize = 256;
const GLYPH_WORDS: usize = 65_536 / 64;

#[derive(Clone, Copy)]
struct Entry {
    /// 0: not looked up yet; 1: not simple; otherwise `SIMPLE | glyph id`.
    state: u32,
    advance: i32,
}

const UNKNOWN: u32 = 0;
const REJECTED: u32 = 1;
const SIMPLE: u32 = 1 << 31;

/// The characters of one shape plan that shape to their nominal glyph regardless of context.
pub struct SimpleTextPlan {
    /// One bit per glyph some lookup of the plan can start a match on.
    triggers: Box<[u64; GLYPH_WORDS]>,
    global_mask: hb_mask_t,
    pages: Vec<Option<Box<[Entry; PAGE]>>>,
}

impl SimpleTextPlan {
    /// The simple-text view of `plan`, or `None` when the plan runs a stage this module does not
    /// model: a complex shaper, right-to-left or vertical text, legacy `kern`, or AAT.
    pub fn new(shaper: &hb_font_t<'_>, plan: &hb_ot_shape_plan_t) -> Option<Self> {
        let s = plan.shaper;
        let default_shaper = s.create_data.is_none()
            && s.preprocess_text.is_none()
            && s.postprocess_glyphs.is_none()
            && s.decompose.is_none()
            && s.compose.is_none()
            && s.setup_masks.is_none()
            && s.reorder_marks.is_none()
            && s.normalization_preference == HB_OT_SHAPE_NORMALIZATION_MODE_AUTO;
        let native = plan
            .script
            .and_then(Direction::from_script)
            .unwrap_or_default();
        if !default_shaper
            || plan.direction != Direction::LeftToRight
            || native == Direction::RightToLeft
            || plan.apply_kern
            || plan.apply_kerx
            || plan.apply_morx
            || plan.apply_trak
        {
            return None;
        }
        let mut triggers: Box<[u64; GLYPH_WORDS]> = Box::new([0; GLYPH_WORDS]);
        for table_index in TableIndex::iter() {
            let Some(table_data) = shaper.ot_tables.table_data(table_index) else {
                continue;
            };
            for stage in 0..plan.ot_map.stages(table_index).len() {
                for lookup_map in plan.ot_map.stage_lookups(table_index, stage) {
                    // A lookup the shaper cannot read is one it skips as well.
                    let Some((_, lookup)) = shaper
                        .ot_tables
                        .table_data_and_lookup(table_index, lookup_map.index)
                    else {
                        continue;
                    };
                    for subtable in &lookup.subtables {
                        let coverage = subtable.primary_coverage(table_data)?;
                        for glyph in coverage.iter() {
                            let glyph = usize::from(glyph.to_u16());
                            triggers[glyph >> 6] |= 1 << (glyph & 63);
                        }
                    }
                }
            }
        }
        Some(Self {
            triggers,
            global_mask: plan.ot_map.get_global_mask(),
            pages: Vec::new(),
        })
    }

    fn lookup(&mut self, shaper: &hb_font_t<'_>, c: u32) -> Entry {
        const REJECT: Entry = Entry {
            state: REJECTED,
            advance: 0,
        };
        // Supplementary planes hold the emoji and tag sequences `set_unicode_props` joins.
        if c > 0xFFFF {
            return REJECT;
        }
        let (page, slot) = ((c >> 8) as usize, (c & 0xFF) as usize);
        if self.pages.is_empty() {
            self.pages.resize_with(PAGE, || None);
        }
        let entries = self.pages[page].get_or_insert_with(|| {
            Box::new(
                [Entry {
                    state: UNKNOWN,
                    advance: 0,
                }; PAGE],
            )
        });
        if entries[slot].state == UNKNOWN {
            entries[slot] = classify(shaper, &self.triggers, c).unwrap_or(REJECT);
        }
        entries[slot]
    }

    /// Shapes `buffer` when every character in it is simple under `plan`; otherwise returns it
    /// untouched. `plan` must be the plan this value was built from, and `shaper` its font.
    pub fn shape(
        &mut self,
        shaper: &hb_font_t<'_>,
        plan: &hb_ot_shape_plan_t,
        buffer: UnicodeBuffer,
    ) -> Result<GlyphBuffer, UnicodeBuffer> {
        let mut buffer = buffer.0;
        let len = buffer.len;
        if len == 0 || buffer.direction != plan.direction || buffer.pos.len() < len {
            return Err(UnicodeBuffer(buffer));
        }
        for index in 0..len {
            if self.lookup(shaper, buffer.info[index].glyph_id).state & SIMPLE == 0 {
                return Err(UnicodeBuffer(buffer));
            }
        }
        let mut flags = GlyphFlags::DEFINED_BITS;
        if !buffer.flags.contains(BufferFlags::PRODUCE_UNSAFE_TO_CONCAT) {
            flags &= !GlyphFlags::UNSAFE_TO_CONCAT.to_bits();
        }
        let mask = self.global_mask & flags;
        buffer.enter();
        buffer.clear_positions();
        for index in 0..len {
            let entry = self.lookup(shaper, buffer.info[index].glyph_id);
            let info = &mut buffer.info[index];
            info.glyph_id = entry.state & !SIMPLE;
            info.mask = mask;
            buffer.pos[index] = GlyphPosition {
                x_advance: entry.advance,
                ..GlyphPosition::default()
            };
        }
        buffer.leave();
        Ok(GlyphBuffer(buffer))
    }
}

fn classify(shaper: &hb_font_t<'_>, triggers: &[u64; GLYPH_WORDS], c: u32) -> Option<Entry> {
    let category = c.general_category();
    if category.is_mark()
        || category == GeneralCategory::FORMAT
        || category == GeneralCategory::SURROGATE
        || c.is_default_ignorable()
        || c == 0x2044
        || matches!(c, 0xFF9E..=0xFF9F)
    {
        return None;
    }
    let funcs = BuiltinFontFuncs::new(shaper);
    let glyph = match funcs.nominal_glyph(c) {
        Some(glyph) => glyph,
        // A character the font lacks becomes `.notdef` once the normaliser has found nothing to
        // decompose it into and no space or U+2010 to stand in for it.
        None if super::unicode::decompose(c).is_none()
            && category != GeneralCategory::SPACE_SEPARATOR
            && c != 0x2011 =>
        {
            GlyphId::NOTDEF
        }
        None => return None,
    };
    let id = u16::try_from(glyph.to_u32()).ok()?;
    let index = usize::from(id);
    let trigger = triggers[index >> 6] & (1 << (index & 63)) != 0;
    // `zero_mark_widths_by_gdef` zeroes a GDEF mark glyph whatever character produced it.
    if trigger || shaper.ot_tables.glyph_class(u32::from(id)) == 3 {
        return None;
    }
    Some(Entry {
        state: SIMPLE | u32::from(id),
        advance: funcs.advance_width(glyph),
    })
}
