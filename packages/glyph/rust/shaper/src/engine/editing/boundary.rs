//! The offset map (text unit, grapheme, shaping cluster, line) and the unit that contains a
//! position.

use crate::unicode::{GRAPHEME_BOUNDARY, SENTENCE_BOUNDARY, WORD_BOUNDARY};

use super::{
    Affinity, Editing, EditingError, LayoutSource, TextPosition, TextRange, TextUnit,
    line::LineCache,
};

/// Where an offset sits in the paragraph's layers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Location {
    /// Index of the grapheme that starts at the offset, which is also the engine's cluster
    /// index; the grapheme count at the end of the text.
    pub grapheme: u32,
    /// Stable id of the text unit at the offset; `None` at the end of the text.
    pub unit_id: Option<u32>,
    /// The shaping cluster that holds the offset: the grapheme itself, or the whole ligature or
    /// conjunct it is part of. Empty at the end of the text and for text layout did not draw.
    pub cluster: TextRange,
    /// The line the position's caret is on.
    pub line: u32,
    /// The text that line owns.
    pub line_range: TextRange,
}

impl<S: LayoutSource> Editing<S> {
    /// Where a position sits: its grapheme, its shaping cluster and its line.
    pub fn locate(&self, position: TextPosition) -> Result<Location, EditingError> {
        let offset = self.checked(position)?;
        let mut cache = LineCache::default();
        let place = self.place(&mut cache, TextPosition { offset, ..position })?;
        let mut cluster = TextRange {
            start: offset,
            end: offset,
        };
        if let Some(line) = self.line_owning(offset)? {
            let boxes = self.line_boxes(&mut cache, line)?;
            if let Some(cell) = boxes
                .iter()
                .flat_map(|line_box| line_box.cells.iter())
                .find(|cell| cell.start == offset)
            {
                cluster = TextRange {
                    start: cell.cluster_start,
                    end: cell.cluster_end,
                };
            }
        }
        Ok(Location {
            grapheme: self.grapheme_index(offset) as u32,
            unit_id: self.source.unit_ids().get(offset as usize).copied(),
            cluster,
            line: place.line as u32,
            line_range: self.line_range(place.line)?,
        })
    }

    /// The offset of the text unit with a stable id, when the text still has it.
    pub fn offset_of_unit(&self, unit_id: u32) -> Option<u32> {
        self.source
            .unit_ids()
            .iter()
            .position(|id| *id == unit_id)
            .map(|offset| offset as u32)
    }

    /// The text a line owns. Line ranges tile the text: a line owns the hard break that ends
    /// it, and the last line owns whatever layout clipped after it.
    pub fn line_range(&self, line: usize) -> Result<TextRange, EditingError> {
        let count = self.source.line_count();
        let length = self.text_length();
        if line >= count {
            return Ok(if count == 0 {
                TextRange {
                    start: 0,
                    end: length,
                }
            } else {
                TextRange {
                    start: length,
                    end: length,
                }
            });
        }
        let (start, mut end) = self.line_text(line)?;
        // Text no line owns belongs to the line before it.
        let next_start = if line + 1 < count {
            self.line_text(line + 1)?.0
        } else {
            length
        };
        end = end.max(next_start);
        Ok(TextRange {
            start: if line == 0 { 0 } else { start },
            end,
        })
    }

    /// The unit that contains a position. A position between two units belongs to the one its
    /// affinity names: `Downstream` the unit that starts there, `Upstream` the one that ends
    /// there. Word and sentence units are the segments of the paragraph's boundary lanes
    /// (UAX #29 unless another break source is installed), so a word unit may be a run of
    /// spaces or a punctuation mark.
    pub fn boundary(
        &self,
        position: TextPosition,
        unit: TextUnit,
    ) -> Result<TextRange, EditingError> {
        let offset = self.checked(position)?;
        let length = self.text_length();
        let upstream = position.affinity == Affinity::Upstream;
        match unit {
            TextUnit::Grapheme => {
                let boundaries = self.boundaries();
                let count = boundaries.len() - 1;
                if count == 0 {
                    return Ok(TextRange { start: 0, end: 0 });
                }
                // The grapheme starting at the offset; `count` at the end of the text.
                let starting = self.grapheme_index(offset);
                let index = if upstream || starting == count {
                    starting.saturating_sub(1)
                } else {
                    starting
                };
                Ok(TextRange {
                    start: boundaries[index],
                    end: boundaries[index + 1],
                })
            }
            TextUnit::Word | TextUnit::Sentence => {
                if length == 0 {
                    return Ok(TextRange { start: 0, end: 0 });
                }
                let kind = lane_kind(unit);
                let lane = self
                    .source
                    .boundary_lane(kind)
                    .ok_or(EditingError::BoundariesNotPrepared(unit))?;
                // The unit holding the code unit after the offset, or before it.
                let inside = if (upstream && offset != 0) || offset == length {
                    offset - 1
                } else {
                    offset
                };
                Ok(TextRange {
                    start: segment_start(lane, inside, kind),
                    end: segment_end(lane, inside, kind),
                })
            }
            TextUnit::Line => {
                let mut cache = LineCache::default();
                let place = self.place(&mut cache, TextPosition { offset, ..position })?;
                self.line_range(place.line)
            }
        }
    }
}

/// The lane bits a word or sentence boundary must carry. UAX #29 can put a word or sentence
/// boundary inside an extended grapheme cluster; an offset there is not one a caret or a range
/// may name, so a unit boundary counts only where a grapheme boundary coincides with it.
pub(super) const fn lane_kind(unit: TextUnit) -> u8 {
    GRAPHEME_BOUNDARY
        | match unit {
            TextUnit::Sentence => SENTENCE_BOUNDARY,
            _ => WORD_BOUNDARY,
        }
}

/// The last offset at or before unit `inside` whose lane entry has every bit of `kind`.
pub(super) fn segment_start(lane: &[u8], inside: u32, kind: u8) -> u32 {
    (1..=inside as usize)
        .rev()
        .find(|offset| lane[*offset] & kind == kind)
        .unwrap_or(0) as u32
}

/// The first offset after unit `inside` whose lane entry has every bit of `kind`.
pub(super) fn segment_end(lane: &[u8], inside: u32, kind: u8) -> u32 {
    let last = lane.len() - 1;
    (inside as usize + 1..last)
        .find(|offset| lane[*offset] & kind == kind)
        .unwrap_or(last) as u32
}
