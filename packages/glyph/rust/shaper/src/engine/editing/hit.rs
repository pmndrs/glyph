//! The caret stop nearest a point.

use super::{
    Affinity, Editing, EditingError, LayoutSource, TextPosition,
    line::{LineBox, LineCache},
};

impl<S: LayoutSource> Editing<S> {
    /// The caret stop nearest a point, which may be anywhere: between lines, beside them or
    /// outside the paragraph.
    ///
    /// The line is the one whose box holds the point's y, else the nearest. On the line the
    /// stop is the nearest in x, and the position is attached to the grapheme the point is on:
    /// its leading edge names the offset where it starts, `Downstream`; its trailing edge the
    /// offset where it ends, `Upstream`. A point exactly on an edge two graphemes of different
    /// direction share takes the one of lower embedding level. Past the end of a line the
    /// answer is that line's end, `Upstream`. The answer is in normal form
    /// ([`Editing::normalize`]) and is never inside clipped text.
    pub fn hit_test(&self, x: f64, y: f64) -> Result<TextPosition, EditingError> {
        if !x.is_finite() || !y.is_finite() {
            return Err(EditingError::NotFinite);
        }
        let mut cache = LineCache::default();
        let count = self.source.line_count();
        if count == 0 {
            return Ok(TextPosition::downstream(0));
        }
        // A drop cap stands beside several lines, so its box is tested before any line's.
        for cap in (0..).map_while(|index| self.source.drop_cap(index)) {
            if y < cap.top || y >= cap.top + cap.height {
                continue;
            }
            let boxes = self.line_boxes(&mut cache, cap.line)?;
            if let Some(cap_box) = boxes.first() {
                let (left, right) = cap_box.extent();
                // Its edges are shared with the lines beside it and go to them.
                if x > left && x < right {
                    return self.hit_box(&mut cache, cap_box, x);
                }
            }
        }
        // The nearest line by y. Lines of side-by-side columns share a y: among those equally
        // near, the one nearest in x.
        let vertical = |line: usize| -> Result<f64, EditingError> {
            let facts = self.source.line(line).ok_or(EditingError::Layout)?;
            Ok(if y < facts.top {
                facts.top - y
            } else if y >= facts.top + facts.height {
                y - (facts.top + facts.height)
            } else {
                0.0
            })
        };
        let mut nearest = f64::INFINITY;
        for line in 0..count {
            nearest = nearest.min(vertical(line)?);
        }
        let mut chosen: Option<(usize, f64)> = None;
        let mut tied = 0;
        for line in 0..count {
            if vertical(line)? != nearest {
                continue;
            }
            tied += 1;
            if tied == 1 {
                chosen = Some((line, f64::INFINITY));
                continue;
            }
            // Only a tie pays for the lines' extents.
            if let Some((first, distance)) = chosen
                && distance == f64::INFINITY
            {
                chosen = Some((first, self.horizontal_distance(&mut cache, first, x)?));
            }
            let distance = self.horizontal_distance(&mut cache, line, x)?;
            if chosen.is_none_or(|(_, best)| distance < best) {
                chosen = Some((line, distance));
            }
        }
        let (line, _) = chosen.ok_or(EditingError::Layout)?;
        self.hit_line(&mut cache, line, x)
    }

    /// How far `x` is from everything a line draws.
    fn horizontal_distance(
        &self,
        cache: &mut LineCache,
        line: usize,
        x: f64,
    ) -> Result<f64, EditingError> {
        let boxes = self.line_boxes(cache, line)?;
        Ok(boxes
            .iter()
            .map(|line_box| {
                let (left, right) = line_box.extent();
                if x < left {
                    left - x
                } else if x > right {
                    x - right
                } else {
                    0.0
                }
            })
            .fold(f64::INFINITY, f64::min))
    }

    /// The stop of one line nearest `x`.
    pub(super) fn hit_line(
        &self,
        cache: &mut LineCache,
        line: usize,
        x: f64,
    ) -> Result<TextPosition, EditingError> {
        let boxes = self.line_boxes(cache, line)?;
        let mut nearest: Option<(&LineBox, f64)> = None;
        for line_box in boxes.iter() {
            let (left, right) = line_box.extent();
            let distance = if x < left {
                left - x
            } else if x > right {
                x - right
            } else {
                0.0
            };
            // An x two boxes share goes to the later one, where a soft wrap rests.
            if nearest.is_none_or(|(_, best)| distance <= best) {
                nearest = Some((line_box, distance));
            }
        }
        let (line_box, _) = nearest.ok_or(EditingError::Layout)?;
        self.hit_box(cache, line_box, x)
    }

    fn hit_box(
        &self,
        cache: &mut LineCache,
        line_box: &LineBox,
        x: f64,
    ) -> Result<TextPosition, EditingError> {
        let count = line_box.cells.len();
        // A point beside the box is as near as its edge, however far away it is.
        let (box_left, box_right) = line_box.extent();
        let x = x.clamp(box_left.min(box_right), box_right.max(box_left));
        let mut nearest = (0, f64::INFINITY);
        for edge in 0..=count {
            if !line_box.edge_is_stop(edge) {
                continue;
            }
            let distance = (x - line_box.edge_x(edge)).abs();
            if distance < nearest.1 {
                nearest = (edge, distance);
            }
        }
        let edge = nearest.0;
        let (left, right) = edge_positions(line_box, edge);
        let position = match (left, right) {
            (Some(left), Some(right)) if left.offset != right.offset => {
                let stop = line_box.edge_x(edge);
                let left_level = line_box.cells[edge - 1].level;
                let right_level = line_box.cells[edge].level;
                if x < stop || (x == stop && left_level <= right_level) {
                    left
                } else {
                    right
                }
            }
            (_, Some(right)) => right,
            (Some(left), None) => left,
            (None, None) => TextPosition::downstream(line_box.text_start),
        };
        self.normalized(cache, position)
    }
}

/// The positions attached to the cells on either side of a visual edge: the one left of it by
/// its right edge, the one right of it by its left edge.
pub(super) fn edge_positions(
    line_box: &LineBox,
    edge: usize,
) -> (Option<TextPosition>, Option<TextPosition>) {
    let left = edge
        .checked_sub(1)
        .and_then(|index| line_box.cells.get(index))
        .map(|cell| {
            if cell.rtl() {
                TextPosition::new(cell.start, Affinity::Downstream)
            } else {
                TextPosition::new(cell.end, Affinity::Upstream)
            }
        });
    let right = line_box.cells.get(edge).map(|cell| {
        if cell.rtl() {
            TextPosition::new(cell.end, Affinity::Upstream)
        } else {
            TextPosition::new(cell.start, Affinity::Downstream)
        }
    });
    (left, right)
}
