//! Offset validation: an offset is a UTF-16 code unit index of the source text on a grapheme
//! boundary, or it is an error that says why and names the boundaries around it.

use super::{Affinity, Editing, LayoutSource, TextPosition, TextRange};

/// Which argument of a query an [`OffsetError`] is about.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OffsetArgument {
    Offset,
    Start,
    End,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OffsetReason {
    /// Not a finite whole number.
    NotInteger,
    /// Below zero or above the text length.
    OutOfRange,
    /// The end of a range is before its start.
    Reversed,
    /// Inside an extended grapheme cluster, a surrogate pair included.
    InsideGrapheme,
}

/// An offset a query could not use. Nothing is snapped: the caller gets the offset back as it
/// gave it, why it was refused, and the nearest grapheme boundaries on both sides.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct OffsetError {
    pub argument: OffsetArgument,
    /// The offset as given.
    pub offset: f64,
    pub reason: OffsetReason,
    /// Length of the source text in UTF-16 code units.
    pub text_length: u32,
    /// The nearest grapheme boundary at or before the offset, when there is one.
    pub before: Option<u32>,
    /// The nearest grapheme boundary at or after the offset, when there is one.
    pub after: Option<u32>,
}

impl<S: LayoutSource> Editing<S> {
    /// Checks an offset as a host passes it: any number.
    pub fn validate_offset(
        &self,
        argument: OffsetArgument,
        offset: f64,
    ) -> Result<u32, OffsetError> {
        let boundaries = self.boundaries();
        let text_length = self.text_length();
        let error = |reason| {
            let (before, after) = if offset.is_nan() {
                (None, None)
            } else {
                // The boundaries are whole numbers, so comparing as f64 is exact.
                let after = boundaries.partition_point(|boundary| f64::from(*boundary) < offset);
                let before = boundaries.partition_point(|boundary| f64::from(*boundary) <= offset);
                (
                    before.checked_sub(1).map(|index| boundaries[index]),
                    boundaries.get(after).copied(),
                )
            };
            OffsetError {
                argument,
                offset,
                reason,
                text_length,
                before,
                after,
            }
        };
        if !offset.is_finite() || offset != libm_trunc(offset) {
            return Err(error(OffsetReason::NotInteger));
        }
        if offset < 0.0 || offset > f64::from(text_length) {
            return Err(error(OffsetReason::OutOfRange));
        }
        let whole = offset as u32;
        if boundaries.binary_search(&whole).is_err() {
            return Err(error(OffsetReason::InsideGrapheme));
        }
        Ok(whole)
    }

    /// Checks an offset already known to be a whole number.
    pub fn check_offset(&self, argument: OffsetArgument, offset: u32) -> Result<u32, OffsetError> {
        self.validate_offset(argument, f64::from(offset))
    }

    /// Checks both ends of a range and their order. A reversed range is an error about its end.
    pub fn validate_range(&self, start: f64, end: f64) -> Result<TextRange, OffsetError> {
        let checked_start = self.validate_offset(OffsetArgument::Start, start)?;
        let checked_end = self.validate_offset(OffsetArgument::End, end)?;
        if checked_end < checked_start {
            return Err(OffsetError {
                argument: OffsetArgument::End,
                offset: end,
                reason: OffsetReason::Reversed,
                text_length: self.text_length(),
                before: Some(checked_end),
                after: Some(checked_end),
            });
        }
        Ok(TextRange {
            start: checked_start,
            end: checked_end,
        })
    }

    /// A position from an offset as a host passes it.
    pub fn position(&self, offset: f64, affinity: Affinity) -> Result<TextPosition, OffsetError> {
        Ok(TextPosition {
            offset: self.validate_offset(OffsetArgument::Offset, offset)?,
            affinity,
        })
    }

    pub(super) fn checked(&self, position: TextPosition) -> Result<u32, OffsetError> {
        self.check_offset(OffsetArgument::Offset, position.offset)
    }
}

/// `f64::trunc` without `std`.
fn libm_trunc(value: f64) -> f64 {
    // Every f64 at or above 2^52 in magnitude is already whole.
    if value.abs() >= 4_503_599_627_370_496.0 {
        value
    } else {
        (value as i64) as f64
    }
}

#[cfg(test)]
mod tests {
    use super::libm_trunc;

    #[test]
    fn truncation_matches_std() {
        for value in [0.0, 0.5, -0.5, 1.0, 3.9, -3.9, 1e15 + 0.5, 1e300, -1e300] {
            assert_eq!(libm_trunc(value), f64::trunc(value), "{value}");
        }
    }
}
