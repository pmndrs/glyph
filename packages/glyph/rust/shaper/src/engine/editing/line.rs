//! One line's caret geometry, derived from the glyphs positioning placed on it.
//!
//! A line is a sequence of boxes in text order: its drop cap, when it has one, then one box per
//! fragment. A box holds one cell per drawn grapheme, in visual order, tiling the box from its
//! first glyph's pen position to the pen after its last. Cells of one shaping cluster share its
//! advance: by the font's ligature carets when it has them, evenly otherwise.

use crate::cold_growth::ColdGrowth as _;

use alloc::{rc::Rc, vec::Vec};

use crate::unicode;

use super::{
    Editing, EditingError, FragmentFacts, GlyphFacts, GlyphRole, LayoutSource, MAX_LIGATURE_CARETS,
};

/// Whether a UTF-16 unit starts a hard line break, as the cluster build decides it.
pub const fn is_hard_break_unit(unit: u16) -> bool {
    (unit.wrapping_sub(0x0a) < 4) | (unit == 0x85) | (unit.wrapping_sub(0x2028) < 2)
}

/// One drawn grapheme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Cell {
    pub start: u32,
    pub end: u32,
    pub left: f64,
    pub right: f64,
    pub level: u8,
    /// Whether a caret may rest at `start`. False inside a cluster that is not a ligature.
    pub stop_at_start: bool,
    /// The shaping cluster the grapheme belongs to.
    pub cluster_start: u32,
    pub cluster_end: u32,
}

impl Cell {
    pub fn rtl(&self) -> bool {
        self.level & 1 != 0
    }

    /// The x of the cell's logical start.
    pub fn leading(&self) -> f64 {
        if self.rtl() { self.right } else { self.left }
    }

    /// The x of the cell's logical end.
    pub fn trailing(&self) -> f64 {
        if self.rtl() { self.left } else { self.right }
    }
}

/// A drop cap or one fragment of a line.
#[derive(Clone, Debug, PartialEq)]
pub(super) struct LineBox {
    pub line: usize,
    pub top: f64,
    pub height: f64,
    pub text_start: u32,
    /// End of the text the box owns, a terminating hard break included.
    pub text_end: u32,
    /// End of the graphemes the box draws: `text_end`, less a terminating hard break when the
    /// fragment owns one. `text_start` when it draws none.
    pub content_end: u32,
    pub paragraph_level: u8,
    /// Caret x when the box has no cell.
    pub origin: f64,
    /// Cells in visual order, left to right.
    pub cells: Vec<Cell>,
    /// Horizontal extent of the truncation marker, when the box draws one.
    pub marker: Option<(f64, f64)>,
}

impl LineBox {
    pub fn rtl(&self) -> bool {
        self.paragraph_level & 1 != 0
    }

    /// Visual extent of everything a caret can attach to.
    pub fn extent(&self) -> (f64, f64) {
        match (self.cells.first(), self.cells.last()) {
            (Some(first), Some(last)) => (first.left, last.right),
            _ => (self.origin, self.origin),
        }
    }

    pub fn cell_starting_at(&self, offset: u32) -> Option<usize> {
        self.cells.iter().position(|cell| cell.start == offset)
    }

    pub fn cell_ending_at(&self, offset: u32) -> Option<usize> {
        self.cells.iter().position(|cell| cell.end == offset)
    }

    /// Whether the visual edge before cell `edge` (or after the last cell) is a caret stop.
    pub fn edge_is_stop(&self, edge: usize) -> bool {
        if edge == 0 || edge >= self.cells.len() {
            return true;
        }
        let (left, right) = (&self.cells[edge - 1], &self.cells[edge]);
        if left.cluster_start != right.cluster_start {
            return true;
        }
        // Inside one cluster the two cells are logical neighbours; the edge between them is the
        // start of whichever is later.
        if left.start < right.start {
            right.stop_at_start
        } else {
            left.stop_at_start
        }
    }

    /// The x of a visual edge.
    pub fn edge_x(&self, edge: usize) -> f64 {
        match self.cells.get(edge) {
            Some(cell) => cell.left,
            None => self.cells.last().map_or(self.origin, |cell| cell.right),
        }
    }

    /// Where a caret past everything the box draws rests: the far edge of its marker, or of its
    /// last grapheme.
    pub fn clipped_x(&self) -> f64 {
        let (left, right) = self.extent();
        match self.marker {
            Some((marker_left, marker_right)) => {
                if marker_left + marker_right >= left + right {
                    marker_right
                } else {
                    marker_left
                }
            }
            None => {
                if self.rtl() {
                    left
                } else {
                    right
                }
            }
        }
    }
}

/// The boxes of the few lines one query touches, so a line is derived once per query.
#[derive(Default)]
pub(super) struct LineCache {
    lines: Vec<(usize, Rc<[LineBox]>)>,
}

/// Lines kept per query: the line in hand and its neighbours.
const CACHED_LINES: usize = 4;

/// A group of glyphs drawing one grapheme, while a box is assembled.
struct Owner {
    grapheme: usize,
    left: f64,
    advance: f64,
    level: u8,
    glyph_start: usize,
    glyph_end: usize,
    marker: bool,
}

impl<S: LayoutSource> Editing<S> {
    pub(super) fn boundaries(&self) -> &[u32] {
        const EMPTY: &[u32] = &[0];
        let boundaries = self.source.grapheme_boundaries();
        if boundaries.is_empty() {
            EMPTY
        } else {
            boundaries
        }
    }

    /// Index of the grapheme that contains unit `offset`; the grapheme count at the text end.
    pub(super) fn grapheme_index(&self, offset: u32) -> usize {
        self.boundaries()
            .partition_point(|boundary| *boundary <= offset)
            .saturating_sub(1)
    }

    /// The text a line owns: its drop cap's and every fragment's.
    pub(super) fn line_text(&self, line: usize) -> Result<(u32, u32), EditingError> {
        let facts = self.source.line(line).ok_or(EditingError::Layout)?;
        if facts.fragment_count == 0 {
            return Err(EditingError::Layout);
        }
        let first = self
            .source
            .fragment(facts.fragment_start)
            .ok_or(EditingError::Layout)?;
        let last = self
            .source
            .fragment(facts.fragment_start + facts.fragment_count - 1)
            .ok_or(EditingError::Layout)?;
        let start = self
            .cap_of(line)
            .map_or(first.text_start, |cap| cap.fragment.text_start);
        Ok((start, last.text_end))
    }

    fn cap_of(&self, line: usize) -> Option<super::DropCapFacts> {
        (0..)
            .map_while(|index| self.source.drop_cap(index))
            .find(|cap| cap.line == line)
    }

    /// The line that owns unit `offset`, or `None` when no line does (clipped text, or the
    /// empty line after a final hard break).
    pub(super) fn line_owning(&self, offset: u32) -> Result<Option<usize>, EditingError> {
        let (mut low, mut high) = (0, self.source.line_count());
        while low < high {
            let middle = low + (high - low) / 2;
            let (start, end) = self.line_text(middle)?;
            if offset < start {
                high = middle;
            } else if offset >= end {
                low = middle + 1;
            } else {
                return Ok(Some(middle));
            }
        }
        Ok(None)
    }

    /// The last line whose text starts at or before `offset`.
    pub(super) fn line_at_or_before(&self, offset: u32) -> Result<Option<usize>, EditingError> {
        let (mut low, mut high) = (0, self.source.line_count());
        while low < high {
            let middle = low + (high - low) / 2;
            if self.line_text(middle)?.0 <= offset {
                low = middle + 1;
            } else {
                high = middle;
            }
        }
        Ok(low.checked_sub(1))
    }

    pub(super) fn line_boxes(
        &self,
        cache: &mut LineCache,
        line: usize,
    ) -> Result<Rc<[LineBox]>, EditingError> {
        if let Some((_, boxes)) = cache.lines.iter().find(|(index, _)| *index == line) {
            return Ok(boxes.clone());
        }
        let boxes: Rc<[LineBox]> = self.build_line(line)?.into();
        if cache.lines.len() == CACHED_LINES {
            cache.lines.remove(0);
        }
        cache.lines.push((line, boxes.clone()));
        Ok(boxes)
    }

    fn build_line(&self, line: usize) -> Result<Vec<LineBox>, EditingError> {
        let facts = self.source.line(line).ok_or(EditingError::Layout)?;
        let mut glyphs: Vec<GlyphFacts> = Vec::new();
        self.source
            .line_glyphs(line, &mut |glyph| glyphs.push(glyph))?;
        let mut boxes = Vec::new();
        boxes
            .try_reserve_exact_cold(facts.fragment_count + 1)
            .map_err(|_| EditingError::ResultTooLarge)?;
        if let Some(cap) = self.cap_of(line) {
            boxes.push(self.build_box(line, cap.top, cap.height, cap.fragment, &glyphs, true)?);
        }
        for index in 0..facts.fragment_count {
            let fragment = self
                .source
                .fragment(facts.fragment_start + index)
                .ok_or(EditingError::Layout)?;
            boxes.push(self.build_box(line, facts.top, facts.height, fragment, &glyphs, false)?);
        }
        Ok(boxes)
    }

    fn build_box(
        &self,
        line: usize,
        top: f64,
        height: f64,
        fragment: FragmentFacts,
        glyphs: &[GlyphFacts],
        drop_cap: bool,
    ) -> Result<LineBox, EditingError> {
        let text = self.source.text();
        let boundaries = self.boundaries();
        // A terminating hard break is owned, not drawn.
        let mut content_end = fragment.text_end;
        if content_end > fragment.text_start {
            let last = self.grapheme_index(content_end - 1);
            let start = boundaries[last];
            if start >= fragment.text_start
                && text
                    .get(start as usize)
                    .is_some_and(|unit| is_hard_break_unit(*unit))
            {
                content_end = start;
            }
        }
        let mut owners: Vec<Owner> = Vec::new();
        for (index, glyph) in glyphs.iter().enumerate() {
            if glyph.drop_cap != drop_cap {
                continue;
            }
            let marker = glyph.role == GlyphRole::Ellipsis;
            if marker {
                // A marker's cluster names where the text was cut: the end of its fragment.
                let cut_here = glyph.text == fragment.text_end
                    || (glyph.text > fragment.text_start && glyph.text < fragment.text_end);
                if !cut_here {
                    continue;
                }
            } else if glyph.text < fragment.text_start || glyph.text >= content_end {
                continue;
            }
            let grapheme = self.grapheme_index(glyph.text);
            match owners.last_mut() {
                Some(owner)
                    if owner.marker == marker
                        && (marker || owner.grapheme == grapheme)
                        && owner.glyph_end == index =>
                {
                    owner.advance += glyph.advance;
                    owner.glyph_end = index + 1;
                }
                _ => owners.push(Owner {
                    grapheme,
                    left: glyph.pen,
                    advance: glyph.advance,
                    level: glyph.level,
                    glyph_start: index,
                    glyph_end: index + 1,
                    marker,
                }),
            }
        }
        // The pen only moves forward, so each owner starts where the pen stood or where the one
        // before it started, whichever is further, and ends where the next one starts: a
        // justification gap or letter spacing goes to the grapheme before it, and neighbours
        // share one edge bit for bit. The last owner ends where its own glyphs do.
        let mut lefts: Vec<f64> = Vec::with_capacity(owners.len());
        for owner in &owners {
            let left = lefts
                .last()
                .map_or(owner.left, |previous: &f64| previous.max(owner.left));
            lefts.push(left);
        }
        let rights: Vec<f64> = (0..owners.len())
            .map(|index| match lefts.get(index + 1) {
                Some(next) => *next,
                None => lefts[index].max(owners[index].left + owners[index].advance.max(0.0)),
            })
            .collect();
        for (owner, left) in owners.iter_mut().zip(&lefts) {
            owner.left = *left;
        }
        let marker = owners
            .iter()
            .zip(&rights)
            .filter(|(owner, _)| owner.marker)
            .fold(None, |extent: Option<(f64, f64)>, (owner, right)| {
                Some(extent.map_or((owner.left, *right), |(left, end)| {
                    (left.min(owner.left), end.max(*right))
                }))
            });

        // The graphemes each owner draws: its own and every glyphless one up to the next owner
        // in text order, since a ligature reports its glyphs at its first grapheme.
        let first_grapheme = self.grapheme_index(fragment.text_start);
        let end_grapheme = boundaries.partition_point(|boundary| *boundary < content_end);
        let mut drawn: Vec<usize> = owners
            .iter()
            .filter(|owner| !owner.marker)
            .map(|owner| owner.grapheme)
            .collect();
        drawn.sort_unstable();
        drawn.dedup();
        let mut cells = Vec::new();
        cells
            .try_reserve_exact_cold(end_grapheme.saturating_sub(first_grapheme))
            .map_err(|_| EditingError::ResultTooLarge)?;
        for (index, owner) in owners.iter().enumerate() {
            if owner.marker {
                continue;
            }
            let rank = drawn
                .binary_search(&owner.grapheme)
                .map_err(|_| EditingError::Layout)?;
            // A grapheme drawn twice on one line (never by this engine) keeps its first cells.
            if owners[..index]
                .iter()
                .any(|earlier| !earlier.marker && earlier.grapheme == owner.grapheme)
            {
                continue;
            }
            let group_start = if rank == 0 {
                first_grapheme.min(owner.grapheme)
            } else {
                owner.grapheme
            };
            let group_end = drawn.get(rank + 1).copied().unwrap_or(end_grapheme);
            if group_end <= group_start {
                return Err(EditingError::Layout);
            }
            self.push_cells(
                &mut cells,
                owner,
                rights[index],
                (group_start, group_end),
                &glyphs[owner.glyph_start..owner.glyph_end],
            );
        }
        Ok(LineBox {
            line,
            top,
            height,
            text_start: fragment.text_start,
            text_end: fragment.text_end,
            content_end: if cells.is_empty() {
                fragment.text_start
            } else {
                content_end
            },
            paragraph_level: fragment.paragraph_level,
            origin: fragment.origin,
            cells,
            marker,
        })
    }

    /// Splits one shaping cluster's extent among its graphemes and appends their cells in
    /// visual order.
    fn push_cells(
        &self,
        cells: &mut Vec<Cell>,
        owner: &Owner,
        right: f64,
        (group_start, group_end): (usize, usize),
        glyphs: &[GlyphFacts],
    ) {
        let boundaries = self.boundaries();
        let count = group_end - group_start;
        let cluster_start = boundaries[group_start];
        let cluster_end = boundaries[group_end];
        let rtl = owner.level & 1 != 0;
        let ligature = count > 1 && self.is_ligature(group_start, group_end);
        let left = owner.left;
        let width = right - left;
        // Interior stops as distances from the cluster's logical start edge: the font's
        // ligature carets, else the boundaries between the cluster's own glyphs when it has one
        // per grapheme, else an even division.
        let mut interior = [0.0_f64; MAX_LIGATURE_CARETS];
        let measured = count - 1 <= MAX_LIGATURE_CARETS
            && ((ligature
                && self.font_carets(glyphs, count - 1, (left, right), rtl, &mut interior))
                || glyph_boundaries(glyphs, count, (left, right), rtl, &mut interior));
        // The x of the logical edge before grapheme `index`. The outer two are the cluster's own
        // edges exactly, so neighbouring clusters share them bit for bit.
        let edge = |index: usize| -> f64 {
            let distance = if measured {
                interior[index.saturating_sub(1).min(MAX_LIGATURE_CARETS - 1)]
            } else {
                width * index as f64 / count as f64
            };
            match (index, rtl) {
                (0, false) => left,
                (0, true) => right,
                (index, false) if index == count => right,
                (index, true) if index == count => left,
                (_, false) => left + distance,
                (_, true) => right - distance,
            }
        };
        let cell = |index: usize| -> Cell {
            let (near, far) = (edge(index), edge(index + 1));
            let (cell_left, cell_right) = if rtl { (far, near) } else { (near, far) };
            Cell {
                start: boundaries[group_start + index],
                end: boundaries[group_start + index + 1],
                left: cell_left,
                right: cell_right,
                level: owner.level,
                stop_at_start: index == 0 || ligature,
                cluster_start,
                cluster_end,
            }
        };
        if rtl {
            cells.extend((0..count).rev().map(cell));
        } else {
            cells.extend((0..count).map(cell));
        }
    }

    /// The font's ligature carets for a cluster, as ascending distances from its logical start
    /// edge. They are used only when one glyph of the cluster carries exactly `wanted` carets
    /// and they fall in order strictly inside the cluster.
    fn font_carets(
        &self,
        glyphs: &[GlyphFacts],
        wanted: usize,
        (left, right): (f64, f64),
        rtl: bool,
        interior: &mut [f64; MAX_LIGATURE_CARETS],
    ) -> bool {
        let mut units = [0_i32; MAX_LIGATURE_CARETS];
        for glyph in glyphs {
            let Some(count) =
                self.source
                    .ligature_carets(glyph.font_handle, glyph.glyph_id, &mut units)
            else {
                continue;
            };
            if count != wanted {
                continue;
            }
            // The font lists carets left to right; a right-to-left cluster starts at its right
            // edge.
            let ordered = fill_stops(interior, wanted, right - left, |index| {
                let unit = if rtl {
                    units[wanted - 1 - index]
                } else {
                    units[index]
                };
                let x = glyph.pen + f64::from(unit) * glyph.scale;
                Some(if rtl { right - x } else { x - left })
            });
            if ordered {
                return true;
            }
        }
        false
    }

    /// Whether the graphemes of one shaping cluster are components of a typographic ligature:
    /// every one starts with a character of a script that writes ligatures rather than
    /// conjuncts.
    fn is_ligature(&self, group_start: usize, group_end: usize) -> bool {
        let text = self.source.text();
        let boundaries = self.boundaries();
        (group_start..group_end).all(|grapheme| {
            let start = boundaries[grapheme] as usize;
            let end = boundaries[grapheme + 1] as usize;
            text.get(start..end)
                .and_then(|units| char::decode_utf16(units.iter().copied()).next())
                .and_then(Result::ok)
                .is_some_and(|character| ligature_script(character as u32))
        })
    }
}

/// The boundaries between the glyphs of a cluster that draws each of its graphemes with one
/// glyph (a contextual pair the shaper merged, such as `f` and a dotless `i`), as ascending
/// distances from the cluster's logical start edge. Glyphs with no advance are marks and do not
/// count. False when the glyphs do not pair off with the graphemes.
fn glyph_boundaries(
    glyphs: &[GlyphFacts],
    count: usize,
    (left, right): (f64, f64),
    rtl: bool,
    interior: &mut [f64; MAX_LIGATURE_CARETS],
) -> bool {
    let advancing = || glyphs.iter().filter(|glyph| glyph.advance > 0.0);
    if count < 2 || advancing().count() != count {
        return false;
    }
    // The pen stood at each boundary when it placed the glyph after it, left to right.
    fill_stops(interior, count - 1, right - left, |index| {
        let visual = if rtl { count - 1 - index } else { index + 1 };
        let glyph = advancing().nth(visual)?;
        Some(if rtl {
            right - glyph.pen
        } else {
            glyph.pen - left
        })
    })
}

/// Writes `wanted` interior stops, each a distance from the cluster's logical start edge, and
/// says whether they are usable: all present, ascending, and strictly inside `width`.
fn fill_stops(
    interior: &mut [f64; MAX_LIGATURE_CARETS],
    wanted: usize,
    width: f64,
    distance: impl Fn(usize) -> Option<f64>,
) -> bool {
    let mut previous = 0.0;
    for (index, stop) in interior.iter_mut().enumerate().take(wanted) {
        let Some(distance) = distance(index) else {
            return false;
        };
        if distance <= previous || distance >= width {
            return false;
        }
        previous = distance;
        *stop = distance;
    }
    true
}

/// Scripts whose multi-grapheme shaping clusters are ligatures with caret stops inside. Every
/// other script's are conjuncts or stacks that move as one unit.
fn ligature_script(code_point: u32) -> bool {
    const SAMPLES: [u32; 6] = [
        0x61,  // Latin
        0x3b1, // Greek
        0x430, // Cyrillic
        0x561, // Armenian
        0x5d0, // Hebrew
        0x627, // Arabic
    ];
    let Some(script) = unicode::script(code_point) else {
        return false;
    };
    script == unicode::COMMON_SCRIPT
        || SAMPLES
            .iter()
            .any(|sample| unicode::script(*sample) == Some(script))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ligature_scripts_exclude_conjunct_scripts() {
        for (character, expected) in [
            ('f', true),
            ('ﬁ', true),
            ('λ', true),
            ('ж', true),
            ('ե', true),
            ('ל', true),
            ('ل', true),
            ('-', true),
            ('1', true),
            ('क', false),
            ('க', false),
            ('ಕ', false),
            ('ක', false),
            ('ក', false),
            ('က', false),
            ('ก', false),
            ('한', false),
            ('漢', false),
        ] {
            assert_eq!(ligature_script(character as u32), expected, "{character}");
        }
    }

    #[test]
    fn hard_break_units_match_the_cluster_build() {
        for unit in [0x0a, 0x0b, 0x0c, 0x0d, 0x85, 0x2028, 0x2029] {
            assert!(is_hard_break_unit(unit));
        }
        for unit in [0x09, 0x20, 0x0e, 0x84, 0x2027, 0x202a] {
            assert!(!is_hard_break_unit(unit));
        }
    }
}
