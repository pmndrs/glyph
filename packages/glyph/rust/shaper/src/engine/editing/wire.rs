//! The editing queries as the Wasm boundary answers them: numbers in, one fixed record out.
//!
//! Every query writes a [`TextQueryResult`] and returns a status. An offset crosses as the
//! `f64` the host was given, so the engine is the one place it is validated; a refused offset
//! fills the record's error block and returns `STATUS_TEXT_OFFSET_INVALID`.

use alloc::vec::Vec;

use crate::{
    STATUS_INVALID_REQUEST, STATUS_OK, STATUS_RESULT_TOO_LARGE, STATUS_TEXT_OFFSET_INVALID,
    STATUS_TEXT_QUERY_INVALID,
};

use super::{
    Affinity, Editing, EditingError, LayoutSource, OffsetArgument, OffsetError, OffsetReason, Rect,
    TextDirection, TextPosition, TextUnit,
};

/// The caret has a second half: `secondary_*` are set.
pub const TEXT_QUERY_SECONDARY: u32 = 1 << 0;
/// The position is in text layout did not draw.
pub const TEXT_QUERY_CLIPPED: u32 = 1 << 1;
/// The answered position's affinity is downstream.
pub const TEXT_QUERY_DOWNSTREAM: u32 = 1 << 2;

pub const TEXT_AFFINITY_UPSTREAM: u32 = 0;
pub const TEXT_AFFINITY_DOWNSTREAM: u32 = 1;
pub const TEXT_UNIT_GRAPHEME: u32 = 0;
pub const TEXT_UNIT_WORD: u32 = 1;
pub const TEXT_UNIT_SENTENCE: u32 = 2;
pub const TEXT_UNIT_LINE: u32 = 3;
pub const TEXT_DIRECTION_FORWARD: u32 = 0;
pub const TEXT_DIRECTION_BACKWARD: u32 = 1;
pub const TEXT_DIRECTION_LEFT: u32 = 2;
pub const TEXT_DIRECTION_RIGHT: u32 = 3;
pub const TEXT_DIRECTION_UP: u32 = 4;
pub const TEXT_DIRECTION_DOWN: u32 = 5;
pub const TEXT_REASON_NOT_INTEGER: u32 = 0;
pub const TEXT_REASON_OUT_OF_RANGE: u32 = 1;
pub const TEXT_REASON_REVERSED: u32 = 2;
pub const TEXT_REASON_INSIDE_GRAPHEME: u32 = 3;
pub const TEXT_ARGUMENT_OFFSET: u32 = 0;
pub const TEXT_ARGUMENT_START: u32 = 1;
pub const TEXT_ARGUMENT_END: u32 = 2;
/// `before` or `after` when there is no such boundary.
pub const TEXT_NO_BOUNDARY: i32 = -1;

/// The answer to one editing query. Which fields a query fills is its own contract; the rest
/// are zero.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct TextQueryResult {
    pub flags: u32,
    /// The answered position's offset, or a range's start.
    pub offset: u32,
    /// A range's end, or the number of rectangles a range query wrote.
    pub end: u32,
    pub line: u32,
    pub level: u32,
    pub reserved: u32,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    /// The caret's second half, or for a move the goal x.
    pub secondary_x: f64,
    pub secondary_y: f64,
    pub secondary_height: f64,
    /// The refused offset as given.
    pub error_offset: f64,
    /// `reason | argument << 8`.
    pub error_detail: u32,
    pub error_text_length: u32,
    pub error_before: i32,
    pub error_after: i32,
    pub reserved_tail: u64,
}

const _: () = assert!(core::mem::size_of::<TextQueryResult>() == 112);

impl TextQueryResult {
    fn refuse(&mut self, error: EditingError) -> u32 {
        match error {
            EditingError::Offset(error) => {
                self.error(error);
                STATUS_TEXT_OFFSET_INVALID
            }
            EditingError::NotFinite
            | EditingError::UnitNotSupported { .. }
            | EditingError::BoundariesNotPrepared(_) => STATUS_TEXT_QUERY_INVALID,
            EditingError::NotPrepared | EditingError::Layout => STATUS_INVALID_REQUEST,
            EditingError::ResultTooLarge => STATUS_RESULT_TOO_LARGE,
        }
    }

    fn error(&mut self, error: OffsetError) {
        let reason = match error.reason {
            OffsetReason::NotInteger => TEXT_REASON_NOT_INTEGER,
            OffsetReason::OutOfRange => TEXT_REASON_OUT_OF_RANGE,
            OffsetReason::Reversed => TEXT_REASON_REVERSED,
            OffsetReason::InsideGrapheme => TEXT_REASON_INSIDE_GRAPHEME,
        };
        let argument = match error.argument {
            OffsetArgument::Offset => TEXT_ARGUMENT_OFFSET,
            OffsetArgument::Start => TEXT_ARGUMENT_START,
            OffsetArgument::End => TEXT_ARGUMENT_END,
        };
        let boundary = |boundary: Option<u32>| {
            boundary
                .and_then(|boundary| i32::try_from(boundary).ok())
                .unwrap_or(TEXT_NO_BOUNDARY)
        };
        self.error_offset = error.offset;
        self.error_detail = reason | (argument << 8);
        self.error_text_length = error.text_length;
        self.error_before = boundary(error.before);
        self.error_after = boundary(error.after);
    }

    fn position(&mut self, position: TextPosition) {
        self.offset = position.offset;
        if position.affinity == Affinity::Downstream {
            self.flags |= TEXT_QUERY_DOWNSTREAM;
        }
    }
}

pub fn affinity_from_wire(affinity: u32) -> Option<Affinity> {
    match affinity {
        TEXT_AFFINITY_UPSTREAM => Some(Affinity::Upstream),
        TEXT_AFFINITY_DOWNSTREAM => Some(Affinity::Downstream),
        _ => None,
    }
}

pub fn unit_from_wire(unit: u32) -> Option<TextUnit> {
    match unit {
        TEXT_UNIT_GRAPHEME => Some(TextUnit::Grapheme),
        TEXT_UNIT_WORD => Some(TextUnit::Word),
        TEXT_UNIT_SENTENCE => Some(TextUnit::Sentence),
        TEXT_UNIT_LINE => Some(TextUnit::Line),
        _ => None,
    }
}

pub fn direction_from_wire(direction: u32) -> Option<TextDirection> {
    match direction {
        TEXT_DIRECTION_FORWARD => Some(TextDirection::Forward),
        TEXT_DIRECTION_BACKWARD => Some(TextDirection::Backward),
        TEXT_DIRECTION_LEFT => Some(TextDirection::Left),
        TEXT_DIRECTION_RIGHT => Some(TextDirection::Right),
        TEXT_DIRECTION_UP => Some(TextDirection::Up),
        TEXT_DIRECTION_DOWN => Some(TextDirection::Down),
        _ => None,
    }
}

impl<S: LayoutSource> Editing<S> {
    fn wire_position(&self, offset: f64, affinity: u32) -> Result<TextPosition, EditingError> {
        let affinity = affinity_from_wire(affinity).ok_or(EditingError::NotFinite)?;
        Ok(self.position(offset, affinity)?)
    }

    /// `caret`: fills the rectangle, the line, the level and the flags.
    pub fn caret_record(&self, offset: f64, affinity: u32, result: &mut TextQueryResult) -> u32 {
        *result = TextQueryResult::default();
        let caret = match self
            .wire_position(offset, affinity)
            .and_then(|position| self.caret(position))
        {
            Ok(caret) => caret,
            Err(error) => return result.refuse(error),
        };
        result.x = caret.rect.x;
        result.y = caret.rect.y;
        result.width = caret.rect.width;
        result.height = caret.rect.height;
        result.line = caret.line;
        result.level = u32::from(caret.level);
        if caret.clipped {
            result.flags |= TEXT_QUERY_CLIPPED;
        }
        if let Some(secondary) = caret.secondary {
            result.flags |= TEXT_QUERY_SECONDARY;
            result.secondary_x = secondary.x;
            result.secondary_y = secondary.y;
            result.secondary_height = secondary.height;
        }
        STATUS_OK
    }

    /// `hit_test`: fills the position.
    pub fn hit_test_record(&self, x: f64, y: f64, result: &mut TextQueryResult) -> u32 {
        *result = TextQueryResult::default();
        match self.hit_test(x, y) {
            Ok(position) => {
                result.position(position);
                STATUS_OK
            }
            Err(error) => result.refuse(error),
        }
    }

    /// `move`: fills the position and, in `secondary_x`, the goal x. A NaN goal is no goal.
    pub fn move_record(
        &self,
        offset: f64,
        affinity: u32,
        direction: u32,
        unit: u32,
        goal_x: f64,
        result: &mut TextQueryResult,
    ) -> u32 {
        *result = TextQueryResult::default();
        let (Some(direction), Some(unit)) = (direction_from_wire(direction), unit_from_wire(unit))
        else {
            return STATUS_TEXT_QUERY_INVALID;
        };
        let goal = (!goal_x.is_nan()).then_some(goal_x);
        match self
            .wire_position(offset, affinity)
            .and_then(|position| self.move_position(position, direction, unit, goal))
        {
            Ok(moved) => {
                result.position(moved.position);
                result.secondary_x = moved.goal_x;
                STATUS_OK
            }
            Err(error) => result.refuse(error),
        }
    }

    /// `boundary`: fills `offset` and `end` with the unit's range.
    pub fn boundary_record(
        &self,
        offset: f64,
        affinity: u32,
        unit: u32,
        result: &mut TextQueryResult,
    ) -> u32 {
        *result = TextQueryResult::default();
        let Some(unit) = unit_from_wire(unit) else {
            return STATUS_TEXT_QUERY_INVALID;
        };
        match self
            .wire_position(offset, affinity)
            .and_then(|position| self.boundary(position, unit))
        {
            Ok(range) => {
                result.offset = range.start;
                result.end = range.end;
                STATUS_OK
            }
            Err(error) => result.refuse(error),
        }
    }

    /// `range_rects`: replaces `rects` with the range's rectangles and fills `end` with how
    /// many there are.
    pub fn range_rects_record(
        &self,
        start: f64,
        end: f64,
        rects: &mut Vec<Rect>,
        result: &mut TextQueryResult,
    ) -> u32 {
        *result = TextQueryResult::default();
        rects.clear();
        match self
            .validate_range(start, end)
            .map_err(EditingError::from)
            .and_then(|range| self.range_rects(range.start, range.end))
        {
            Ok(found) => {
                result.end = found.len() as u32;
                *rects = found;
                STATUS_OK
            }
            Err(error) => result.refuse(error),
        }
    }

    /// Checks the range a replacement names against the prepared text and fills `offset` and
    /// `end` with it.
    pub fn check_range_record(&self, start: f64, end: f64, result: &mut TextQueryResult) -> u32 {
        *result = TextQueryResult::default();
        match self.validate_range(start, end) {
            Ok(range) => {
                result.offset = range.start;
                result.end = range.end;
                STATUS_OK
            }
            Err(error) => result.refuse(EditingError::Offset(error)),
        }
    }
}
