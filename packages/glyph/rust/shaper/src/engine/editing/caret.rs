//! Where a caret is drawn, and the rectangles a range covers.

use crate::cold_growth::ColdGrowth as _;

use alloc::vec::Vec;

use super::{
    Affinity, Caret, Editing, EditingError, LayoutSource, Rect, TextPosition, line::LineCache,
};

impl<S: LayoutSource> Editing<S> {
    /// Where the caret of a position is drawn.
    pub fn caret(&self, position: TextPosition) -> Result<Caret, EditingError> {
        let offset = self.checked(position)?;
        let mut cache = LineCache::default();
        let (downstream, upstream) = self.places(&mut cache, offset)?;
        let (chosen, other) = match position.affinity {
            Affinity::Downstream => (downstream.or(upstream), upstream),
            Affinity::Upstream => (upstream.or(downstream), downstream),
        };
        let place = match chosen {
            Some(place) => place,
            None => self.place_detached(&mut cache, offset)?,
        };
        // The other side of a wrap, between lines or between a line's fragments, is another
        // place for the same offset but not the other half of this caret.
        let secondary = other
            .filter(|other| {
                other.line == place.line
                    && other.box_index == place.box_index
                    && !other.same_spot(&place)
            })
            .map(|other| other.rect());
        Ok(Caret {
            rect: place.rect(),
            secondary,
            line: place.line as u32,
            level: place.level,
            clipped: place.clipped,
        })
    }

    /// The rectangles covering the graphemes of `[start, end)`: one per run of selected
    /// graphemes that is contiguous on its line. Unidirectional text gives one per line
    /// fragment; a bidi line gives one per visual run the range covers. A hard break and
    /// clipped text have no rectangle.
    pub fn range_rects(&self, start: u32, end: u32) -> Result<Vec<Rect>, EditingError> {
        let range = self.validate_range(f64::from(start), f64::from(end))?;
        let mut rects = Vec::new();
        if range.start == range.end {
            return Ok(rects);
        }
        let mut cache = LineCache::default();
        let Some(first) = self.line_at_or_before(range.start)? else {
            return Ok(rects);
        };
        let last = self
            .line_at_or_before(range.end - 1)?
            .ok_or(EditingError::Layout)?;
        for line in first..=last {
            let boxes = self.line_boxes(&mut cache, line)?;
            for line_box in boxes.iter() {
                let mut run: Option<(f64, f64)> = None;
                let mut flush = |run: &mut Option<(f64, f64)>| -> Result<(), EditingError> {
                    if let Some((left, right)) = run.take()
                        && right > left
                    {
                        rects
                            .try_reserve_cold(1)
                            .map_err(|_| EditingError::ResultTooLarge)?;
                        rects.push(Rect {
                            x: left,
                            y: line_box.top,
                            width: right - left,
                            height: line_box.height,
                        });
                    }
                    Ok(())
                };
                for cell in &line_box.cells {
                    if range.start <= cell.start && cell.end <= range.end {
                        run = Some(
                            run.map_or((cell.left, cell.right), |(left, _)| (left, cell.right)),
                        );
                    } else {
                        flush(&mut run)?;
                    }
                }
                flush(&mut run)?;
            }
        }
        Ok(rects)
    }
}
