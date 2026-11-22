//! The places a position can be drawn at: attached to the grapheme that starts at its offset,
//! to the one that ends there, or to neither.

use super::{
    Affinity, Editing, EditingError, LayoutSource, Rect, TextPosition,
    line::{LineBox, LineCache},
};

/// One place a caret can be drawn.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Place {
    pub line: usize,
    /// Index of the box within its line.
    pub box_index: usize,
    /// Index of the visual edge within the box: `n` is the left edge of cell `n`.
    pub edge: usize,
    pub x: f64,
    pub top: f64,
    pub height: f64,
    pub level: u8,
    pub clipped: bool,
}

impl Place {
    fn on(line_box: &LineBox, box_index: usize, edge: usize, x: f64, level: u8) -> Self {
        Self {
            line: line_box.line,
            box_index,
            edge,
            x,
            top: line_box.top,
            height: line_box.height,
            level,
            clipped: false,
        }
    }

    pub fn rect(&self) -> Rect {
        Rect {
            x: self.x,
            y: self.top,
            width: 0.0,
            height: self.height,
        }
    }

    /// Whether two places are one spot on the page.
    pub fn same_spot(&self, other: &Self) -> bool {
        self.line == other.line && self.top == other.top && self.x == other.x
    }
}

impl<S: LayoutSource> Editing<S> {
    /// The place attached to the grapheme that starts at `offset`, when one is drawn.
    pub(super) fn place_downstream(
        &self,
        cache: &mut LineCache,
        offset: u32,
    ) -> Result<Option<Place>, EditingError> {
        if offset >= self.text_length() {
            return Ok(None);
        }
        let Some(line) = self.line_owning(offset)? else {
            return Ok(None);
        };
        let boxes = self.line_boxes(cache, line)?;
        Ok(boxes.iter().enumerate().find_map(|(box_index, line_box)| {
            if offset < line_box.text_start || offset >= line_box.content_end {
                return None;
            }
            let index = line_box.cell_starting_at(offset)?;
            let cell = &line_box.cells[index];
            let edge = if cell.rtl() { index + 1 } else { index };
            Some(Place::on(
                line_box,
                box_index,
                edge,
                cell.leading(),
                cell.level,
            ))
        }))
    }

    /// The place attached to the grapheme that ends at `offset`, when one is drawn.
    pub(super) fn place_upstream(
        &self,
        cache: &mut LineCache,
        offset: u32,
    ) -> Result<Option<Place>, EditingError> {
        let Some(before) = offset.checked_sub(1) else {
            return Ok(None);
        };
        let Some(line) = self.line_owning(before)? else {
            return Ok(None);
        };
        let boxes = self.line_boxes(cache, line)?;
        Ok(boxes.iter().enumerate().find_map(|(box_index, line_box)| {
            if offset <= line_box.text_start || offset > line_box.content_end {
                return None;
            }
            let index = line_box.cell_ending_at(offset)?;
            let cell = &line_box.cells[index];
            let edge = if cell.rtl() { index } else { index + 1 };
            Some(Place::on(
                line_box,
                box_index,
                edge,
                cell.trailing(),
                cell.level,
            ))
        }))
    }

    /// The place of an offset no drawn grapheme starts or ends at: an empty line, or clipped
    /// text.
    pub(super) fn place_detached(
        &self,
        cache: &mut LineCache,
        offset: u32,
    ) -> Result<Place, EditingError> {
        let length = self.text_length();
        let owning = if offset < length {
            self.line_owning(offset)?
        } else {
            None
        };
        let Some(line) = owning.or(self.line_at_or_before(offset)?) else {
            // Layout made no line -- a clipped box shorter than one line -- so nothing was drawn
            // and there is no line box to stand a caret in.
            return Ok(Place {
                line: 0,
                box_index: 0,
                edge: 0,
                x: 0.0,
                top: 0.0,
                height: 0.0,
                level: 0,
                clipped: true,
            });
        };
        let boxes = self.line_boxes(cache, line)?;
        let box_index = boxes
            .iter()
            .position(|line_box| line_box.text_start <= offset && offset < line_box.text_end)
            .or_else(|| {
                boxes
                    .iter()
                    .rposition(|line_box| line_box.text_start <= offset)
            })
            .unwrap_or(0);
        let line_box = boxes.get(box_index).ok_or(EditingError::Layout)?;
        if offset <= line_box.content_end {
            // An empty line: the box draws nothing and the offset is its start.
            return Ok(Place::on(
                line_box,
                box_index,
                0,
                line_box.edge_x(0),
                line_box.paragraph_level,
            ));
        }
        let mut place = Place::on(
            line_box,
            box_index,
            line_box.cells.len(),
            line_box.clipped_x(),
            line_box.paragraph_level,
        );
        place.clipped = true;
        Ok(place)
    }

    /// Both places of an offset: attached to the grapheme starting at it and to the one ending
    /// at it.
    pub(super) fn places(
        &self,
        cache: &mut LineCache,
        offset: u32,
    ) -> Result<(Option<Place>, Option<Place>), EditingError> {
        Ok((
            self.place_downstream(cache, offset)?,
            self.place_upstream(cache, offset)?,
        ))
    }

    /// The place a position is drawn at.
    pub(super) fn place(
        &self,
        cache: &mut LineCache,
        position: TextPosition,
    ) -> Result<Place, EditingError> {
        let (downstream, upstream) = self.places(cache, position.offset)?;
        let chosen = match position.affinity {
            Affinity::Downstream => downstream.or(upstream),
            Affinity::Upstream => upstream.or(downstream),
        };
        match chosen {
            Some(place) => Ok(place),
            None => self.place_detached(cache, position.offset),
        }
    }

    /// The same place under its canonical name. Where both affinities of an offset are one
    /// spot, or only one grapheme touches the offset, the affinity carries no information:
    /// it becomes `Downstream` when a drawn grapheme starts at the offset and `Upstream`
    /// otherwise. Where they are two places (a soft wrap, a bidi boundary) it is kept.
    pub fn normalize(&self, position: TextPosition) -> Result<TextPosition, EditingError> {
        let offset = self.checked(position)?;
        let mut cache = LineCache::default();
        self.normalized(&mut cache, TextPosition { offset, ..position })
    }

    pub(super) fn normalized(
        &self,
        cache: &mut LineCache,
        position: TextPosition,
    ) -> Result<TextPosition, EditingError> {
        let (downstream, upstream) = self.places(cache, position.offset)?;
        let affinity = match (downstream, upstream) {
            (Some(downstream), Some(upstream)) if !downstream.same_spot(&upstream) => {
                position.affinity
            }
            (None, Some(_)) => Affinity::Upstream,
            _ => Affinity::Downstream,
        };
        Ok(TextPosition {
            offset: position.offset,
            affinity,
        })
    }

    /// Whether a caret may rest at a grapheme boundary: false only inside a shaping cluster
    /// that is not a ligature.
    pub(super) fn is_stop(&self, cache: &mut LineCache, offset: u32) -> Result<bool, EditingError> {
        if offset == 0 || offset >= self.text_length() {
            return Ok(true);
        }
        let Some(line) = self.line_owning(offset)? else {
            return Ok(true);
        };
        let boxes = self.line_boxes(cache, line)?;
        Ok(boxes
            .iter()
            .find(|line_box| line_box.text_start < offset && offset < line_box.content_end)
            .and_then(|line_box| {
                line_box
                    .cell_starting_at(offset)
                    .map(|index| line_box.cells[index].stop_at_start)
            })
            .unwrap_or(true))
    }

    /// Whether a caret may rest at `offset`.
    pub fn is_caret_stop(&self, offset: u32) -> Result<bool, EditingError> {
        let offset = self.check_offset(super::OffsetArgument::Offset, offset)?;
        self.is_stop(&mut LineCache::default(), offset)
    }
}
