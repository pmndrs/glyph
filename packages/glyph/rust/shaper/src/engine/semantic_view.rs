//! Demand-shaped semantic records returned only when explicitly requested.
//!
//! Semantic views can share a publication with a render plan, but they are not commands and are
//! never part of `RenderPlanView`.

pub const SEMANTIC_LINE: u16 = 1;
pub const SEMANTIC_FRAGMENT: u16 = 2;
pub const SEMANTIC_RUN: u16 = 3;
pub const SEMANTIC_CLUSTER: u16 = 4;
pub const SEMANTIC_CARET: u16 = 5;
pub const SEMANTIC_SELECTION: u16 = 6;
pub const SEMANTIC_INSERTED_GLYPH: u16 = 7;
pub const SEMANTIC_PARAGRAPH_MEASUREMENT: u16 = 8;
pub const SEMANTIC_GLYPH: u16 = 9;

#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct SemanticRecord {
    pub id: u32,
    pub kind: u16,
    pub flags: u16,
    pub parent_id: u32,
    pub text_start: u32,
    pub text_end: u32,
    pub item_start: u32,
    pub item_count: u32,
    pub inline_start: f32,
    pub block_start: f32,
    pub inline_extent: f32,
    pub block_extent: f32,
    /// Inline advance of one item's layout box. Populated for `SEMANTIC_GLYPH`, where it is the
    /// shaped advance the pen moves by, which is neither the ink width nor the font size.
    pub inline_advance: f32,
    /// Ink box in the same positioned space as `inline_start`/`block_start`, in the block-axis
    /// direction the record's own `block_start` uses.
    ///
    /// Populated for `SEMANTIC_GLYPH` (a glyph the font gives no outline for — a space, an unmapped
    /// id — reports a zero-extent box at its own origin rather than a missing one), for
    /// `SEMANTIC_LINE` (the union over the line's glyphs), and for
    /// `SEMANTIC_PARAGRAPH_MEASUREMENT` (the union over the paragraph's glyphs, authoritative only
    /// when `MEASUREMENT_FLAG_INK_BOUNDS` is set).
    ///
    /// This is deliberately NOT the advance box. A glyph may overhang its advance — italics,
    /// accents, swashes — so a caller centring visually needs this box and a caller filling a flex
    /// slot needs `inline_extent`. Both ship so neither has to be guessed at.
    pub ink_inline_start: f32,
    pub ink_block_start: f32,
    pub ink_inline_extent: f32,
    pub ink_block_extent: f32,
    /// Distance from the top edge of the item's own box down to its baseline, half-leading
    /// included. Populated for `SEMANTIC_LINE` and `SEMANTIC_PARAGRAPH_MEASUREMENT`; the matching
    /// descent is `block_extent - ascent` exactly, and the box top is `block_start - ascent`.
    pub ascent: f32,
    /// Paragraph-measurement summaries only: the largest unbreakable run under the
    /// constraint's wrap codec. Line, glyph, and other records carry zero.
    pub min_content_width: f32,
    /// Paragraph-measurement summaries only: the widest hard-break-free run.
    pub max_content_width: f32,
}

const _: () = assert!(core::mem::size_of::<SemanticRecord>() == 76);
