//! Caret movement: logical, visual and by line.

use super::{
    Affinity, Editing, EditingError, LayoutSource, Movement, TextDirection, TextPosition, TextUnit,
    boundary::{lane_kind, segment_end, segment_start},
    hit::edge_positions,
    line::{LineBox, LineCache},
    place::Place,
};

impl<S: LayoutSource> Editing<S> {
    /// Moves a position one unit.
    ///
    /// - `Forward` and `Backward` are logical. By grapheme they step to the next caret stop.
    ///   By word, forward stops at the end of the next word and backward at the start of the
    ///   previous one, where a word is a segment of the word lane that holds a letter, a digit
    ///   or an emoji. By sentence they stop at the next sentence boundary. By line they go to
    ///   the end and the start of the position's line.
    /// - `Left` and `Right` are visual. By grapheme they step to the neighbouring stop on the
    ///   line, across bidi runs, and from a line's edge to the next line in that direction; the
    ///   position stays attached to the grapheme it just crossed. By any other unit they are
    ///   the logical move the paragraph's base direction maps them to.
    /// - `Up` and `Down` take `TextUnit::Line` and go to the stop nearest `goal_x` on the line
    ///   above or below. Above the first line they go to the start of the text and below the
    ///   last to its end. Pass the returned `goal_x` to the next vertical move to keep the
    ///   column; without one the starting caret's x is used.
    ///
    /// A soft wrap is one stop, not two: a move that arrives at one rests at the start of the
    /// later line. Every answer is in normal form ([`Editing::normalize`]).
    pub fn move_position(
        &self,
        position: TextPosition,
        direction: TextDirection,
        unit: TextUnit,
        goal_x: Option<f64>,
    ) -> Result<Movement, EditingError> {
        let offset = self.checked(position)?;
        if goal_x.is_some_and(|goal| !goal.is_finite()) {
            return Err(EditingError::NotFinite);
        }
        let position = TextPosition { offset, ..position };
        let mut cache = LineCache::default();
        let cache = &mut cache;
        let place = self.place(cache, position)?;
        let rtl = self.paragraph_rtl(cache, &place)?;
        let (moved, goal) = match direction {
            TextDirection::Forward => (self.logical(cache, position, &place, true, unit)?, None),
            TextDirection::Backward => (self.logical(cache, position, &place, false, unit)?, None),
            TextDirection::Left | TextDirection::Right => {
                let right = direction == TextDirection::Right;
                let moved = if unit == TextUnit::Grapheme {
                    self.visual(cache, position, place, right)?
                } else {
                    self.logical(cache, position, &place, right != rtl, unit)?
                };
                (moved, None)
            }
            TextDirection::Up | TextDirection::Down => {
                if unit != TextUnit::Line {
                    return Err(EditingError::UnitNotSupported { direction, unit });
                }
                let goal = goal_x.unwrap_or(place.x);
                let count = self.source.line_count();
                let target = if direction == TextDirection::Up {
                    place.line.checked_sub(1)
                } else {
                    Some(place.line + 1)
                };
                let moved = match target {
                    None => self.normalized(cache, TextPosition::downstream(0))?,
                    Some(line) if line >= count => {
                        self.normalized(cache, TextPosition::upstream(self.text_length()))?
                    }
                    Some(line) => self.hit_line(cache, line, goal)?,
                };
                (moved, Some(goal))
            }
        };
        let goal_x = match goal {
            Some(goal) => goal,
            None => self.place(cache, moved)?.x,
        };
        Ok(Movement {
            position: moved,
            goal_x,
        })
    }

    fn paragraph_rtl(&self, cache: &mut LineCache, place: &Place) -> Result<bool, EditingError> {
        if place.line >= self.source.line_count() {
            return Ok(place.level & 1 != 0);
        }
        let boxes = self.line_boxes(cache, place.line)?;
        Ok(boxes.get(place.box_index).is_some_and(LineBox::rtl))
    }

    fn logical(
        &self,
        cache: &mut LineCache,
        position: TextPosition,
        place: &Place,
        forward: bool,
        unit: TextUnit,
    ) -> Result<TextPosition, EditingError> {
        let offset = position.offset;
        let length = self.text_length();
        let target = match unit {
            TextUnit::Grapheme => self.next_stop(cache, offset, forward)?,
            TextUnit::Word | TextUnit::Sentence if length == 0 => 0,
            TextUnit::Word | TextUnit::Sentence => {
                let kind = lane_kind(unit);
                let lane = self
                    .source
                    .boundary_lane(kind)
                    .ok_or(EditingError::BoundariesNotPrepared(unit))?;
                let words = unit == TextUnit::Word;
                let mut cursor = offset;
                let found = if forward {
                    loop {
                        if cursor >= length {
                            break length;
                        }
                        let start = segment_start(lane, cursor, kind);
                        let end = segment_end(lane, cursor, kind);
                        if !words || self.is_word(start, end) {
                            break end;
                        }
                        cursor = end;
                    }
                } else {
                    loop {
                        if cursor == 0 {
                            break 0;
                        }
                        let start = segment_start(lane, cursor - 1, kind);
                        let end = segment_end(lane, cursor - 1, kind);
                        if !words || self.is_word(start, end) {
                            break start;
                        }
                        cursor = start;
                    }
                };
                self.snap_to_stop(cache, found, forward)?
            }
            TextUnit::Line => {
                if place.line >= self.source.line_count() {
                    return self.normalized(cache, position);
                }
                let boxes = self.line_boxes(cache, place.line)?;
                let edge = if forward {
                    boxes
                        .last()
                        .map(|last| TextPosition::upstream(last.content_end))
                } else {
                    boxes
                        .first()
                        .map(|first| TextPosition::downstream(first.text_start))
                };
                return self.normalized(cache, edge.ok_or(EditingError::Layout)?);
            }
        };
        self.normalized(cache, TextPosition::downstream(target))
    }

    /// The nearest caret stop strictly after or before `offset`; the text end or start when
    /// there is none.
    fn next_stop(
        &self,
        cache: &mut LineCache,
        offset: u32,
        forward: bool,
    ) -> Result<u32, EditingError> {
        let boundaries = self.boundaries();
        let mut index = self.grapheme_index(offset);
        loop {
            if forward {
                if index + 1 >= boundaries.len() {
                    return Ok(self.text_length());
                }
                index += 1;
            } else {
                if index == 0 {
                    return Ok(0);
                }
                index -= 1;
            }
            if self.is_stop(cache, boundaries[index])? {
                return Ok(boundaries[index]);
            }
        }
    }

    /// `offset` if it is a caret stop, else the next one in the direction of travel.
    fn snap_to_stop(
        &self,
        cache: &mut LineCache,
        offset: u32,
        forward: bool,
    ) -> Result<u32, EditingError> {
        let boundaries = self.boundaries();
        if boundaries.binary_search(&offset).is_ok() && self.is_stop(cache, offset)? {
            return Ok(offset);
        }
        if forward {
            // The grapheme holding the offset ends after it.
            self.next_stop(cache, boundaries[self.grapheme_index(offset)], true)
        } else {
            let start = boundaries[self.grapheme_index(offset)];
            if self.is_stop(cache, start)? {
                Ok(start)
            } else {
                self.next_stop(cache, start, false)
            }
        }
    }

    /// Whether a segment of the word lane is a word rather than the space or punctuation
    /// between words: it holds a letter, a digit or an emoji.
    fn is_word(&self, start: u32, end: u32) -> bool {
        let units = &self.source.text()[start as usize..end as usize];
        char::decode_utf16(units.iter().copied())
            .filter_map(Result::ok)
            .any(|character| {
                crate::line_break::is_alphanumeric(character) || is_pictograph(character as u32)
            })
    }

    /// One visual step from `place`.
    fn visual(
        &self,
        cache: &mut LineCache,
        position: TextPosition,
        place: Place,
        right: bool,
    ) -> Result<TextPosition, EditingError> {
        let count = self.source.line_count();
        if place.clipped || place.line >= count {
            // No drawn grapheme to step across: the logical step the base direction gives.
            let forward = right != (place.level & 1 != 0);
            let target = self.next_stop(cache, position.offset, forward)?;
            return self.normalized(cache, TextPosition::downstream(target));
        }
        let (mut line, mut box_index, mut edge) = (place.line, place.box_index, place.edge);
        let offset = position.offset;
        // At most two boxes are visited: the one the caret is in, and the one a soft wrap
        // continues into when the caret already rests on the shared stop.
        for _ in 0..3 {
            let boxes = self.line_boxes(cache, line)?;
            let line_box = boxes.get(box_index).ok_or(EditingError::Layout)?;
            let cells = line_box.cells.len();
            // The next stop that is somewhere else: a zero-width grapheme (a bidi control, a
            // zero-width space) takes no room, so a visual step passes it.
            let here = line_box.edge_x(edge);
            let elsewhere =
                |edge: &usize| line_box.edge_is_stop(*edge) && line_box.edge_x(*edge) != here;
            let next = if right {
                (edge + 1..=cells).find(elsewhere)
            } else {
                (0..edge).rev().find(elsewhere)
            };
            let toward_end = right != line_box.rtl();
            let entry = match self.neighbour_box(cache, line, box_index, right)? {
                Some((neighbour_line, neighbour_index, at_left)) => {
                    let boxes = self.line_boxes(cache, neighbour_line)?;
                    let neighbour_box = boxes.get(neighbour_index).ok_or(EditingError::Layout)?;
                    let entry_edge = if at_left {
                        0
                    } else {
                        neighbour_box.cells.len()
                    };
                    Some((
                        neighbour_line,
                        neighbour_index,
                        entry_edge,
                        outer_position(neighbour_box, entry_edge),
                    ))
                }
                None => None,
            };
            match next {
                Some(reached) => {
                    // Attached to the grapheme just crossed.
                    let (left, right_side) = edge_positions(line_box, reached);
                    let crossed = if right { left } else { right_side };
                    let crossed = crossed.ok_or(EditingError::Layout)?;
                    let at_box_edge = reached == 0 || reached == cells;
                    if at_box_edge
                        && let Some((_, _, _, entered)) = entry
                        && entered.offset == crossed.offset
                    {
                        // A soft wrap: one stop, resting at the start of the later box.
                        return self.normalized(cache, TextPosition::downstream(crossed.offset));
                    }
                    return self.normalized(cache, crossed);
                }
                None => {
                    let Some((neighbour_line, neighbour_index, entry_edge, entered)) = entry else {
                        // The visual end of the paragraph: text may continue unseen.
                        let target = self.next_stop(cache, offset, toward_end)?;
                        let hidden = if toward_end {
                            target > line_box.content_end
                        } else {
                            target < line_box.text_start
                        };
                        return self.normalized(
                            cache,
                            if hidden {
                                TextPosition::downstream(target)
                            } else {
                                position
                            },
                        );
                    };
                    if entered.offset != offset {
                        return self.normalized(cache, entered);
                    }
                    // Already on the stop the two boxes share: keep going inside the next.
                    line = neighbour_line;
                    box_index = neighbour_index;
                    edge = entry_edge;
                }
            }
        }
        self.normalized(cache, position)
    }

    /// The box a visual step enters when it leaves a box, and whether it enters at that box's
    /// left edge.
    ///
    /// On the same line it is the nearest box in the direction of travel, entered at its near
    /// edge: fragments are neighbours where they are drawn, whatever order they hold the text
    /// in. Past the line's last box the step leaves the line. Which line follows is the
    /// paragraph's direction: travelling toward the end of the text it is the next line, entered
    /// at the logical start of its first box; toward the start, the previous line, entered at
    /// the logical end of its last box.
    fn neighbour_box(
        &self,
        cache: &mut LineCache,
        line: usize,
        box_index: usize,
        right: bool,
    ) -> Result<Option<(usize, usize, bool)>, EditingError> {
        let boxes = self.line_boxes(cache, line)?;
        let current = boxes.get(box_index).ok_or(EditingError::Layout)?;
        let (left, right_edge) = current.extent();
        let beside = boxes
            .iter()
            .enumerate()
            .filter(|(index, _)| *index != box_index)
            .filter_map(|(index, other)| {
                let (other_left, other_right) = other.extent();
                let gap = if right {
                    other_left - right_edge
                } else {
                    left - other_right
                };
                (gap >= 0.0).then_some((index, gap))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((index, _)) = beside {
            return Ok(Some((line, index, right)));
        }
        let toward_end = right != current.rtl();
        let (target, index) = if toward_end {
            if line + 1 >= self.source.line_count() {
                return Ok(None);
            }
            (line + 1, 0)
        } else {
            let Some(previous) = line.checked_sub(1) else {
                return Ok(None);
            };
            (
                previous,
                self.line_boxes(cache, previous)?.len().saturating_sub(1),
            )
        };
        let boxes = self.line_boxes(cache, target)?;
        let entered = boxes.get(index).ok_or(EditingError::Layout)?;
        Ok(Some((target, index, toward_end != entered.rtl())))
    }
}

/// The position at a box's outermost edge, attached to the grapheme inside it.
fn outer_position(line_box: &LineBox, edge: usize) -> TextPosition {
    let (left, right) = edge_positions(line_box, edge);
    right
        .or(left)
        .unwrap_or(TextPosition::new(line_box.text_start, Affinity::Downstream))
}

/// Emoji and pictographs: the blocks whose characters are words to a reader though they are
/// neither letters nor digits.
fn is_pictograph(code_point: u32) -> bool {
    matches!(
        code_point,
        0x2600..=0x27bf | 0x1f000..=0x1faff
    )
}
