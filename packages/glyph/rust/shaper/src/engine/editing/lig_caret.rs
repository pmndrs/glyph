//! `GDEF` ligature carets: where a font says a caret goes between the components of a ligature
//! glyph.
//!
//! The baker keeps `GDEF` byte for byte, so the list a font ships is the list read here. The three
//! caret value formats resolve as far as an unhinted layout can take them:
//!
//! - format 1 is a design-unit coordinate and is used as is;
//! - format 2 names a contour point of the ligature glyph. It resolves when the font data still
//!   has `glyf` outlines and the glyph is a simple one; the shaping payload a baked font
//!   registers has no outlines, so there it does not resolve and the ligature divides evenly
//!   (the plan resolves format 2 to a coordinate at bake time);
//! - format 3 is a coordinate plus a device or variation-index table. Device tables are hinting
//!   adjustments at whole pixel sizes and are ignored; a baked font is a static instance, so a
//!   variation index has nothing to apply. The coordinate is used.

#[cfg(feature = "std")]
use read_fonts::tables::glyf::Glyph;
use read_fonts::{FontRef, TableProvider, tables::gdef::CaretValue, types::GlyphId};

/// The most interior stops a ligature takes from its font: a ligature of more components
/// divides evenly.
pub const MAX_LIGATURE_CARETS: usize = 7;

/// Writes the caret coordinates `GDEF` gives `glyph_id`, ascending, in font design units from the
/// glyph origin, and returns how many there are. `None` when the font has no usable list for the
/// glyph: no `GDEF`, no `LigCaretList`, the glyph not covered, more carets than
/// [`MAX_LIGATURE_CARETS`], or a caret that cannot be resolved.
pub fn ligature_carets(
    sfnt: &[u8],
    glyph_id: u16,
    carets: &mut [i32; MAX_LIGATURE_CARETS],
) -> Option<usize> {
    let font = FontRef::new(sfnt).ok()?;
    let list = font.gdef().ok()?.lig_caret_list()?.ok()?;
    let glyph = GlyphId::new(u32::from(glyph_id));
    let index = list.coverage().ok()?.get(glyph)?;
    let ligature = list.lig_glyphs().get(usize::from(index)).ok()?;
    let count = usize::from(ligature.caret_count());
    if count == 0 || count > MAX_LIGATURE_CARETS {
        return None;
    }
    for (slot, caret) in carets.iter_mut().zip(ligature.caret_values().iter()) {
        *slot = match caret.ok()? {
            CaretValue::Format1(value) => i32::from(value.coordinate()),
            CaretValue::Format2(value) => {
                contour_point_x(&font, glyph, value.caret_value_point_index())?
            }
            CaretValue::Format3(value) => i32::from(value.coordinate()),
        };
    }
    carets[..count].sort_unstable();
    Some(count)
}

/// The x of one contour point of a simple `glyf` glyph.
#[cfg(feature = "std")]
fn contour_point_x(font: &FontRef<'_>, glyph: GlyphId, point: u16) -> Option<i32> {
    let glyf = font.glyf().ok()?;
    let outline = font.loca(None).ok()?.get_glyf(glyph, &glyf).ok()??;
    match outline {
        Glyph::Simple(simple) => simple
            .points()
            .nth(usize::from(point))
            .map(|point| i32::from(point.x)),
        Glyph::Composite(_) => None,
    }
}

/// The shipped module registers shaping payloads, which have no outlines to read a point from.
#[cfg(not(feature = "std"))]
fn contour_point_x(_font: &FontRef<'_>, _glyph: GlyphId, _point: u16) -> Option<i32> {
    None
}
