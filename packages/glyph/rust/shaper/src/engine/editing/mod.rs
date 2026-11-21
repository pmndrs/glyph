//! Editing queries over one paragraph's prepared layout: carets, hit testing, movement,
//! boundaries and selection rectangles.
//!
//! Every query is a read. Nothing here is computed when text is laid out or edited: a query finds
//! its line by search, derives that line's caret stops from the glyphs positioning already placed,
//! and answers. Word and sentence boundaries come from the paragraph's lazy boundary lanes
//! (`unicode_boundaries.rs`), which the caller asks the engine to fill before it queries them.
//!
//! Offsets are UTF-16 code units of the source text and nothing else. An offset that is not an
//! integer in range, a reversed range, or an offset inside a grapheme is an [`OffsetError`] naming
//! the offset as given and the nearest boundaries on both sides; nothing is snapped.
//!
//! Coordinates are paragraph-local with +Y down and no anchor applied.
//!
//! # Caret stops
//!
//! A caret may rest at every grapheme boundary (the engine's, Unicode 17) except the ones interior
//! to a shaping cluster that is not a typographic ligature: a conjunct of an Indic or South-East
//! Asian script moves as one unit. Inside a ligature of a script that writes them (Latin, Greek,
//! Cyrillic, Armenian, Hebrew, Arabic, and the punctuation and digits they share) each grapheme
//! boundary is a stop. Its x is the font's `GDEF` ligature caret when the font supplies exactly
//! one per interior boundary; else the boundary between two glyphs when the cluster draws each
//! grapheme with its own glyph; else an even division of the cluster's advance.
//!
//! A boundary inside a conjunct is still a valid offset: a caret or a range may name it and is
//! drawn by the same division, but no movement rests there and no hit lands there.
//!
//! # Affinity
//!
//! A position is `{offset, affinity}`. `Downstream` attaches the caret to the grapheme that
//! starts at the offset and `Upstream` to the one that ends there. The two differ at a soft wrap
//! (end of the earlier line against start of the later one) and at a bidi boundary (two different
//! x on one line); everywhere else they are one place and [`Editing::normalize`] names it
//! `Downstream`, or `Upstream` where no grapheme starts at the offset (the end of the text, the
//! end of a line that ends in a hard break).

mod boundary;
mod lig_caret;
mod line;
mod offset;
mod place;

pub use boundary::Location;
pub use lig_caret::{MAX_LIGATURE_CARETS, ligature_carets};
pub use line::is_hard_break_unit;
pub use offset::{OffsetArgument, OffsetError, OffsetReason};

use alloc::vec::Vec;

/// Which grapheme a caret at an offset attaches to.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Affinity {
    /// The grapheme that ends at the offset: the end of the earlier line at a soft wrap.
    Upstream,
    /// The grapheme that starts at the offset: the start of the later line at a soft wrap.
    Downstream,
}

impl Affinity {
    pub const fn other(self) -> Self {
        match self {
            Self::Upstream => Self::Downstream,
            Self::Downstream => Self::Upstream,
        }
    }
}

/// A caret position: a UTF-16 offset of the source text on a grapheme boundary, and a side.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct TextPosition {
    pub offset: u32,
    pub affinity: Affinity,
}

impl TextPosition {
    pub const fn new(offset: u32, affinity: Affinity) -> Self {
        Self { offset, affinity }
    }

    pub const fn downstream(offset: u32) -> Self {
        Self::new(offset, Affinity::Downstream)
    }

    pub const fn upstream(offset: u32) -> Self {
        Self::new(offset, Affinity::Upstream)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TextUnit {
    Grapheme,
    Word,
    Sentence,
    Line,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum TextDirection {
    /// Logical: toward the end of the text.
    Forward,
    /// Logical: toward the start of the text.
    Backward,
    /// Visual: toward smaller x, across bidi runs.
    Left,
    /// Visual: toward larger x, across bidi runs.
    Right,
    /// The line above, at the goal x. Takes `TextUnit::Line`.
    Up,
    /// The line below, at the goal x. Takes `TextUnit::Line`.
    Down,
}

/// A rectangle in paragraph-local coordinates, +Y down, unanchored.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where a caret is drawn.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Caret {
    /// Zero width, the line box's height, at the side the position's affinity names.
    pub rect: Rect,
    /// The other affinity's place when it is in the same line fragment at another x: the second
    /// half of a split caret at a bidi boundary.
    pub secondary: Option<Rect>,
    /// Index of the line the caret is on.
    pub line: u32,
    /// Bidi embedding level of the grapheme the caret attaches to, or of the paragraph on an
    /// empty line.
    pub level: u8,
    /// The offset is in text that layout did not draw (past an ellipsis, a line limit or a
    /// clipped height). The rectangle is then on the last line drawn before it, at the far edge of
    /// that line's truncation marker, or at the line's end when it has no marker.
    pub clipped: bool,
}

/// The answer to [`Editing::move_position`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Movement {
    pub position: TextPosition,
    /// The x to pass to the next vertical move: the goal a vertical move was given or took from
    /// its starting caret, and the new caret's x after any other move.
    pub goal_x: f64,
}

/// A half-open range of UTF-16 offsets.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum EditingError {
    /// An offset argument was not usable; see [`OffsetError`].
    Offset(OffsetError),
    /// A point coordinate or goal x was not finite.
    NotFinite,
    /// `Up` and `Down` move by line only.
    UnitNotSupported {
        direction: TextDirection,
        unit: TextUnit,
    },
    /// Word or sentence boundaries were asked for before the engine filled their lane.
    BoundariesNotPrepared(TextUnit),
    /// The root or paragraph does not exist or has no prepared layout.
    NotPrepared,
    /// The prepared layout contradicts itself: an engine fault, never the caller's.
    Layout,
    /// An answer could not be allocated.
    ResultTooLarge,
}

impl From<OffsetError> for EditingError {
    fn from(error: OffsetError) -> Self {
        Self::Offset(error)
    }
}

/// One line box.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LineFacts {
    /// Block offset of the line box's top edge.
    pub top: f64,
    pub height: f64,
    /// Index of the line's first fragment in the paragraph's fragment sequence.
    pub fragment_start: usize,
    pub fragment_count: usize,
}

/// One run of text on a line: a line has several where it flows around an exclusion.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct FragmentFacts {
    pub text_start: u32,
    /// End of the text the fragment owns. Text an ellipsis or a line limit cut away belongs to
    /// no fragment.
    pub text_end: u32,
    /// The x a caret takes when the fragment draws no grapheme: the pen origin positioning
    /// would start from, alignment and indent applied.
    pub origin: f64,
    /// Base embedding level of the bidi paragraph the fragment's text belongs to.
    pub paragraph_level: u8,
}

/// A drop cap: its own box beside the first lines of its flow thread.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct DropCapFacts {
    /// The line whose text the initial precedes.
    pub line: usize,
    pub top: f64,
    pub height: f64,
    pub fragment: FragmentFacts,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GlyphRole {
    /// Draws source text.
    Text,
    /// Part of a truncation marker.
    Ellipsis,
}

/// One placed glyph of a line, in the order the pen laid it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlyphFacts {
    /// UTF-16 offset of the glyph's cluster.
    pub text: u32,
    pub level: u8,
    /// Where the pen stood when it placed the glyph: the placed origin less the glyph's offset.
    pub pen: f64,
    pub advance: f64,
    pub font_handle: u32,
    pub glyph_id: u16,
    /// Layout units per font design unit.
    pub scale: f64,
    pub role: GlyphRole,
    pub drop_cap: bool,
}

/// What the editing queries read from a prepared paragraph. The engine implements it over its
/// own lanes without copying them; a query calls only what it needs.
pub trait LayoutSource {
    fn text(&self) -> &[u16];
    /// Stable text-unit ids, one per unit of `text`.
    fn unit_ids(&self) -> &[u32];
    /// Grapheme boundaries in ascending order, both text ends included.
    fn grapheme_boundaries(&self) -> &[u32];
    /// The boundary lane (one byte per offset, `text.len() + 1` entries) when every kind in
    /// `kinds` is current, else `None`.
    fn boundary_lane(&self, kinds: u8) -> Option<&[u8]>;
    fn line_count(&self) -> usize;
    fn line(&self, index: usize) -> Option<LineFacts>;
    fn fragment(&self, index: usize) -> Option<FragmentFacts>;
    /// The paragraph's drop caps in line order.
    fn drop_cap(&self, index: usize) -> Option<DropCapFacts>;
    /// Calls `sink` with every glyph of a line in pen order, its drop cap's included.
    fn line_glyphs(
        &self,
        line: usize,
        sink: &mut dyn FnMut(GlyphFacts),
    ) -> Result<(), EditingError>;
    /// Writes the glyph's `GDEF` ligature caret coordinates, ascending and in font design units
    /// from the glyph origin, and returns how many there are; `None` when the font has none for
    /// the glyph or any of them cannot be resolved without an outline.
    fn ligature_carets(
        &self,
        font_handle: u32,
        glyph_id: u16,
        carets: &mut [i32; MAX_LIGATURE_CARETS],
    ) -> Option<usize>;
}

/// The editing queries of one prepared paragraph.
pub struct Editing<S> {
    source: S,
}

impl<S: LayoutSource> Editing<S> {
    pub fn new(source: S) -> Self {
        Self { source }
    }

    pub fn source(&self) -> &S {
        &self.source
    }

    /// Length of the source text in UTF-16 code units.
    pub fn text_length(&self) -> u32 {
        self.source.text().len() as u32
    }

    /// Every caret stop in ascending order: the offsets a caret can rest at.
    pub fn caret_stops(&self) -> Result<Vec<u32>, EditingError> {
        let mut stops = Vec::new();
        let boundaries = self.boundaries();
        stops
            .try_reserve_exact(boundaries.len())
            .map_err(|_| EditingError::ResultTooLarge)?;
        let mut cache = line::LineCache::default();
        for &offset in boundaries {
            if self.is_stop(&mut cache, offset)? {
                stops.push(offset);
            }
        }
        Ok(stops)
    }
}
