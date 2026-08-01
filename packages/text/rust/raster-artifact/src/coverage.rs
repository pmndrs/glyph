use core::fmt;
use serde::{Deserialize, Serialize};
use std::{string::String, vec::Vec};

pub const MAX_RASTER_COVERAGE_RANGES: usize = 1_024;
pub const MAX_RASTER_COVERAGE_SCALARS: usize = 65_536;
pub const MAX_RASTER_COVERAGE_TEXT_CODE_POINTS: usize = 65_536;
pub const MAX_RASTER_COVERAGE_GLYPH_IDS: usize = 65_535;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterUnicodeRangeV0 {
    pub start: u32,
    pub end: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RasterCoverageV0 {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unicode_ranges: Option<Vec<RasterUnicodeRangeV0>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glyph_ids: Option<Vec<u16>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RasterCoverageError {
    Empty,
    TooManyRanges,
    InvalidRange(usize),
    OverlappingRanges(usize),
    TooManyScalars,
    EmptyText,
    TooMuchText,
    EmptyGlyphIds,
    TooManyGlyphIds,
    UnsortedGlyphIds(usize),
    GlyphIdOutOfRange(u16),
    UnmappedTextScalar(u32),
    NoSelectedGlyphs,
    Allocation,
}

impl fmt::Display for RasterCoverageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Empty => formatter.write_str("raster coverage requires at least one non-empty seed"),
            Self::TooManyRanges => formatter.write_str("raster coverage has too many Unicode ranges"),
            Self::InvalidRange(index) => write!(formatter, "raster coverage Unicode range {index} is invalid"),
            Self::OverlappingRanges(index) => {
                write!(formatter, "raster coverage Unicode range {index} overlaps or repeats a scalar")
            }
            Self::TooManyScalars => formatter.write_str("raster coverage Unicode ranges select too many scalars"),
            Self::EmptyText => formatter.write_str("raster coverage text must not be empty"),
            Self::TooMuchText => formatter.write_str("raster coverage text contains too many code points"),
            Self::EmptyGlyphIds => formatter.write_str("raster coverage glyph IDs must not be empty"),
            Self::TooManyGlyphIds => formatter.write_str("raster coverage has too many glyph IDs"),
            Self::UnsortedGlyphIds(index) => {
                write!(formatter, "raster coverage glyph ID {index} is duplicated or out of order")
            }
            Self::GlyphIdOutOfRange(glyph_id) => {
                write!(formatter, "raster coverage glyph ID {glyph_id} is outside the selected face")
            }
            Self::UnmappedTextScalar(scalar) => {
                write!(formatter, "raster coverage text scalar U+{scalar:04X} is not mapped by the selected face")
            }
            Self::NoSelectedGlyphs => formatter.write_str("raster coverage selects no glyphs in the selected face"),
            Self::Allocation => formatter.write_str("raster coverage allocation failed"),
        }
    }
}

impl RasterCoverageV0 {
    pub fn validate(&self) -> Result<(), RasterCoverageError> {
        if self.unicode_ranges.is_none() && self.text.is_none() && self.glyph_ids.is_none() {
            return Err(RasterCoverageError::Empty);
        }
        if let Some(ranges) = &self.unicode_ranges {
            validate_ranges(ranges)?;
        }
        if let Some(text) = &self.text {
            if text.is_empty() {
                return Err(RasterCoverageError::EmptyText);
            }
            if text.chars().count() > MAX_RASTER_COVERAGE_TEXT_CODE_POINTS {
                return Err(RasterCoverageError::TooMuchText);
            }
        }
        if let Some(glyph_ids) = &self.glyph_ids {
            if glyph_ids.is_empty() {
                return Err(RasterCoverageError::EmptyGlyphIds);
            }
            if glyph_ids.len() > MAX_RASTER_COVERAGE_GLYPH_IDS {
                return Err(RasterCoverageError::TooManyGlyphIds);
            }
            for index in 1..glyph_ids.len() {
                if glyph_ids[index] <= glyph_ids[index - 1] {
                    return Err(RasterCoverageError::UnsortedGlyphIds(index));
                }
            }
        }
        Ok(())
    }
}

#[derive(Debug)]
pub struct ResolvedRasterCoverage {
    bits: Vec<u8>,
    selected_glyphs: u16,
}

impl ResolvedRasterCoverage {
    pub fn contains(&self, glyph_id: u16) -> bool {
        let byte = usize::from(glyph_id) / 8;
        let bit = glyph_id % 8;
        self.bits.get(byte).is_some_and(|value| value & (1 << bit) != 0)
    }

    pub fn selected_glyphs(&self) -> u16 {
        self.selected_glyphs
    }

    /// A little-endian bitset: glyph `n` is bit `n % 8` of byte `n / 8`.
    pub fn bits(&self) -> &[u8] {
        &self.bits
    }
}

pub fn resolve_raster_coverage(
    coverage: &RasterCoverageV0,
    glyph_count: u16,
    mut map_scalar: impl FnMut(char) -> Option<u16>,
) -> Result<ResolvedRasterCoverage, RasterCoverageError> {
    coverage.validate()?;
    let byte_length = usize::from(glyph_count).div_ceil(8);
    let mut bits = Vec::new();
    bits.try_reserve_exact(byte_length)
        .map_err(|_| RasterCoverageError::Allocation)?;
    bits.resize(byte_length, 0);
    let mut selected = 0_u16;

    if let Some(ranges) = &coverage.unicode_ranges {
        for range in ranges {
            for scalar in range.start..=range.end {
                let character = char::from_u32(scalar).expect("validated Unicode scalar range");
                if let Some(glyph_id) = map_scalar(character) {
                    select_glyph(&mut bits, &mut selected, glyph_count, glyph_id)?;
                }
            }
        }
    }
    if let Some(text) = &coverage.text {
        for character in text.chars() {
            let glyph_id = map_scalar(character)
                .ok_or(RasterCoverageError::UnmappedTextScalar(u32::from(character)))?;
            select_glyph(&mut bits, &mut selected, glyph_count, glyph_id)?;
        }
    }
    if let Some(glyph_ids) = &coverage.glyph_ids {
        for &glyph_id in glyph_ids {
            select_glyph(&mut bits, &mut selected, glyph_count, glyph_id)?;
        }
    }
    if selected == 0 {
        return Err(RasterCoverageError::NoSelectedGlyphs);
    }
    Ok(ResolvedRasterCoverage {
        bits,
        selected_glyphs: selected,
    })
}

/// RFC 8785 property ordering for the bounded descriptor fragment.
pub fn canonical_raster_coverage_json(coverage: &RasterCoverageV0) -> String {
    use core::fmt::Write;

    let mut output = String::from("{");
    let mut needs_comma = false;
    if let Some(glyph_ids) = &coverage.glyph_ids {
        output.push_str("\"glyphIds\":[");
        for (index, glyph_id) in glyph_ids.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            let _ = write!(output, "{glyph_id}");
        }
        output.push(']');
        needs_comma = true;
    }
    if let Some(text) = &coverage.text {
        if needs_comma {
            output.push(',');
        }
        output.push_str("\"text\":");
        output.push_str(&serde_json::to_string(text).expect("strings always serialize to JSON"));
        needs_comma = true;
    }
    if let Some(ranges) = &coverage.unicode_ranges {
        if needs_comma {
            output.push(',');
        }
        output.push_str("\"unicodeRanges\":[");
        for (index, range) in ranges.iter().enumerate() {
            if index != 0 {
                output.push(',');
            }
            let _ = write!(output, "{{\"end\":{},\"start\":{}}}", range.end, range.start);
        }
        output.push(']');
    }
    output.push('}');
    output
}

fn validate_ranges(ranges: &[RasterUnicodeRangeV0]) -> Result<(), RasterCoverageError> {
    if ranges.is_empty() {
        return Err(RasterCoverageError::Empty);
    }
    if ranges.len() > MAX_RASTER_COVERAGE_RANGES {
        return Err(RasterCoverageError::TooManyRanges);
    }
    let mut scalar_count = 0_usize;
    for (index, range) in ranges.iter().enumerate() {
        if range.start > range.end
            || char::from_u32(range.start).is_none()
            || char::from_u32(range.end).is_none()
            || (range.start <= 0xdfff && range.end >= 0xd800)
        {
            return Err(RasterCoverageError::InvalidRange(index));
        }
        if index != 0 && range.start <= ranges[index - 1].end {
            return Err(RasterCoverageError::OverlappingRanges(index));
        }
        scalar_count = scalar_count
            .checked_add((range.end - range.start + 1) as usize)
            .ok_or(RasterCoverageError::TooManyScalars)?;
        if scalar_count > MAX_RASTER_COVERAGE_SCALARS {
            return Err(RasterCoverageError::TooManyScalars);
        }
    }
    Ok(())
}

fn select_glyph(
    bits: &mut [u8],
    selected: &mut u16,
    glyph_count: u16,
    glyph_id: u16,
) -> Result<(), RasterCoverageError> {
    if glyph_id >= glyph_count {
        return Err(RasterCoverageError::GlyphIdOutOfRange(glyph_id));
    }
    let byte = usize::from(glyph_id) / 8;
    let mask = 1_u8 << (glyph_id % 8);
    if bits[byte] & mask == 0 {
        bits[byte] |= mask;
        *selected += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_the_union_without_adding_implicit_glyphs() {
        let coverage = RasterCoverageV0 {
            unicode_ranges: Some(vec![RasterUnicodeRangeV0 { start: 65, end: 66 }]),
            text: Some("BA".into()),
            glyph_ids: Some(vec![7]),
        };
        let resolved = resolve_raster_coverage(&coverage, 10, |character| match character {
            'A' => Some(3),
            'B' => Some(5),
            _ => None,
        })
        .unwrap();
        assert_eq!(resolved.selected_glyphs(), 3);
        assert!(!resolved.contains(0));
        assert!(resolved.contains(3));
        assert!(resolved.contains(5));
        assert!(resolved.contains(7));
        assert_eq!(resolved.bits(), &[0b1010_1000, 0]);
    }

    #[test]
    fn rejects_unmapped_authored_text_but_skips_unmapped_range_scalars() {
        let range = RasterCoverageV0 {
            unicode_ranges: Some(vec![RasterUnicodeRangeV0 { start: 65, end: 66 }]),
            text: None,
            glyph_ids: None,
        };
        let resolved = resolve_raster_coverage(&range, 4, |character| (character == 'A').then_some(1)).unwrap();
        assert_eq!(resolved.selected_glyphs(), 1);

        let text = RasterCoverageV0 {
            unicode_ranges: None,
            text: Some("AB".into()),
            glyph_ids: None,
        };
        assert_eq!(
            resolve_raster_coverage(&text, 4, |character| (character == 'A').then_some(1))
                .unwrap_err(),
            RasterCoverageError::UnmappedTextScalar(u32::from('B')),
        );
    }
}
