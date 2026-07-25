use read_fonts::{
    FontRef, TableProvider,
    tables::os2::SelectionFlags,
    types::{GlyphId, Tag},
};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use std::{
    borrow::ToOwned,
    string::{String, ToString},
    vec::Vec,
};

#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;

use crate::{
    error::{BakeError, BakeErrorCode},
    hex_sha256,
    report::{FontMetricsV0, ShapingPayloadReportV0, TablePayloadReport, compressed_lengths},
};

const REQUIRED_TABLES: [Tag; 6] = [
    Tag::new(b"head"),
    Tag::new(b"maxp"),
    Tag::new(b"cmap"),
    Tag::new(b"hhea"),
    Tag::new(b"hmtx"),
    Tag::new(b"OS/2"),
];
const OPTIONAL_TABLES: [Tag; 4] = [
    Tag::new(b"GDEF"),
    Tag::new(b"GSUB"),
    Tag::new(b"GPOS"),
    Tag::new(b"kern"),
];
const VARIABLE_TABLES: [Tag; 8] = [
    Tag::new(b"fvar"),
    Tag::new(b"avar"),
    Tag::new(b"gvar"),
    Tag::new(b"cvar"),
    Tag::new(b"HVAR"),
    Tag::new(b"VVAR"),
    Tag::new(b"MVAR"),
    Tag::new(b"STAT"),
];
const UNSUPPORTED_SHAPING_TABLES: [Tag; 9] = [
    Tag::new(b"morx"),
    Tag::new(b"kerx"),
    Tag::new(b"ankr"),
    Tag::new(b"trak"),
    Tag::new(b"feat"),
    Tag::new(b"mort"),
    Tag::new(b"Silf"),
    Tag::new(b"Glat"),
    Tag::new(b"Gloc"),
];

pub(crate) struct ShapingPayload {
    pub sfnt: Vec<u8>,
    pub extents: Vec<u8>,
    pub extents_availability: Vec<u8>,
    pub shaping_hash: String,
    pub metrics: FontMetricsV0,
    pub report: ShapingPayloadReportV0,
}

pub(crate) fn build_shaping_payload(
    source: &[u8],
    face_index: u32,
) -> Result<ShapingPayload, BakeError> {
    reject_envelope(source)?;
    let font = FontRef::from_index(source, face_index).map_err(|error| {
        BakeError::new(
            BakeErrorCode::InvalidFont,
            format!("failed to read font face {face_index}: {error}"),
        )
    })?;

    reject_tables(
        &font,
        &VARIABLE_TABLES,
        BakeErrorCode::UnsupportedVariableFont,
    )?;
    reject_tables(
        &font,
        &UNSUPPORTED_SHAPING_TABLES,
        BakeErrorCode::UnsupportedShapingSystem,
    )?;

    let head = font.head().map_err(|_| missing("head"))?;
    let maxp = font.maxp().map_err(|_| missing("maxp"))?;
    let hhea = font.hhea().map_err(|_| missing("hhea"))?;
    let os2 = font.os2().map_err(|_| missing("OS/2"))?;
    for tag in REQUIRED_TABLES {
        if font.table_data(tag).is_none() {
            return Err(missing(&tag.to_string()));
        }
    }

    let glyph_count = maxp.num_glyphs();
    if glyph_count == 0 {
        return Err(BakeError::new(
            BakeErrorCode::InvalidTable,
            "maxp.numGlyphs must be nonzero",
        ));
    }
    let units_per_em = head.units_per_em();
    if !(16..=16_384).contains(&units_per_em) {
        return Err(BakeError::new(
            BakeErrorCode::InvalidTable,
            format!("head.unitsPerEm {units_per_em} is outside 16..=16384"),
        ));
    }

    let use_typo = os2
        .fs_selection()
        .contains(SelectionFlags::USE_TYPO_METRICS);
    let metrics = FontMetricsV0 {
        glyph_count,
        glyph_id_width: 16,
        units_per_em,
        ascender: if use_typo {
            os2.s_typo_ascender()
        } else {
            hhea.ascender().to_i16()
        },
        descender: if use_typo {
            os2.s_typo_descender()
        } else {
            hhea.descender().to_i16()
        },
        line_gap: if use_typo {
            os2.s_typo_line_gap()
        } else {
            hhea.line_gap().to_i16()
        },
    };

    let (sfnt, tables) = rebuild_sfnt(&font)?;
    let (extents, extents_availability) = collect_extents(&font, glyph_count)?;
    let shaping_hash = shaping_hash(&sfnt, &extents, &extents_availability)?;
    let compressed = compressed_lengths(&sfnt)?;
    let total_raw_bytes = sfnt
        .len()
        .checked_add(extents.len())
        .and_then(|value| value.checked_add(extents_availability.len()))
        .ok_or_else(overflow)?;

    Ok(ShapingPayload {
        sfnt,
        extents,
        extents_availability,
        shaping_hash,
        metrics,
        report: ShapingPayloadReportV0 {
            format: "opentype-sfnt-harfrust-v0".to_owned(),
            sfnt_directory_bytes: 12 + 16 * tables.len(),
            tables,
            extents_bytes: usize::from(glyph_count) * 8,
            extents_availability_bytes: usize::from(glyph_count).div_ceil(8),
            total_raw_bytes,
            gzip_bytes: compressed.map(|value| value.0),
            brotli_bytes: compressed.map(|value| value.1),
        },
    })
}

fn reject_envelope(source: &[u8]) -> Result<(), BakeError> {
    let signature = source.get(..4).ok_or_else(|| {
        BakeError::new(
            BakeErrorCode::InvalidFont,
            "font is shorter than its signature",
        )
    })?;
    if matches!(signature, b"wOFF" | b"wOF2") {
        return Err(BakeError::new(
            BakeErrorCode::UnsupportedContainer,
            "WOFF and WOFF2 must be decoded before baking",
        ));
    }
    Ok(())
}

fn reject_tables(font: &FontRef<'_>, tags: &[Tag], code: BakeErrorCode) -> Result<(), BakeError> {
    if let Some(tag) = tags.iter().find(|tag| font.table_data(**tag).is_some()) {
        return Err(BakeError::new(
            code,
            format!("font contains unsupported table {tag}"),
        ));
    }
    Ok(())
}

fn rebuild_sfnt(font: &FontRef<'_>) -> Result<(Vec<u8>, Vec<TablePayloadReport>), BakeError> {
    let mut tables = REQUIRED_TABLES
        .into_iter()
        .chain(OPTIONAL_TABLES)
        .filter_map(|tag| font.table_data(tag).map(|data| (tag, data.as_bytes())))
        .collect::<Vec<_>>();
    tables.sort_unstable_by_key(|(tag, _)| tag.to_be_bytes());

    let count = u16::try_from(tables.len()).map_err(|_| overflow())?;
    let directory_len = 12usize
        .checked_add(tables.len().checked_mul(16).ok_or_else(overflow)?)
        .ok_or_else(overflow)?;
    let total_len = tables.iter().try_fold(directory_len, |length, (_, data)| {
        length.checked_add(align4(data.len())).ok_or_else(overflow)
    })?;
    let mut output = vec![0_u8; total_len];
    let flavor = font.table_directory().sfnt_version().to_be_bytes();
    output[0..4].copy_from_slice(&flavor);
    output[4..6].copy_from_slice(&count.to_be_bytes());
    let entry_selector = 15 - count.leading_zeros() as u16;
    let search_range = 16_u16
        .checked_shl(u32::from(entry_selector))
        .ok_or_else(overflow)?;
    output[6..8].copy_from_slice(&search_range.to_be_bytes());
    output[8..10].copy_from_slice(&entry_selector.to_be_bytes());
    output[10..12].copy_from_slice(&(count * 16 - search_range).to_be_bytes());

    let mut offset = directory_len;
    let mut head_offset = None;
    let mut reports = Vec::with_capacity(tables.len());
    for (index, (tag, data)) in tables.iter().enumerate() {
        let mut table = data.to_vec();
        if *tag == Tag::new(b"head") {
            if table.len() < 12 {
                return Err(BakeError::new(
                    BakeErrorCode::InvalidTable,
                    "head table is shorter than 12 bytes",
                ));
            }
            table[8..12].fill(0);
            head_offset = Some(offset);
        }
        let record = 12 + index * 16;
        output[record..record + 4].copy_from_slice(&tag.to_be_bytes());
        output[record + 4..record + 8].copy_from_slice(&checksum(&table).to_be_bytes());
        output[record + 8..record + 12]
            .copy_from_slice(&u32::try_from(offset).map_err(|_| overflow())?.to_be_bytes());
        output[record + 12..record + 16].copy_from_slice(
            &u32::try_from(table.len())
                .map_err(|_| overflow())?
                .to_be_bytes(),
        );
        output[offset..offset + table.len()].copy_from_slice(&table);
        let padded = align4(table.len());
        reports.push(TablePayloadReport {
            tag: tag.to_string(),
            raw_bytes: table.len(),
            padded_bytes: padded,
        });
        offset += padded;
    }
    let head_offset = head_offset.ok_or_else(|| missing("head"))?;
    let adjustment = 0xB1B0_AFBA_u32.wrapping_sub(checksum(&output));
    output[head_offset + 8..head_offset + 12].copy_from_slice(&adjustment.to_be_bytes());
    Ok((output, reports))
}

fn collect_extents(font: &FontRef<'_>, glyph_count: u16) -> Result<(Vec<u8>, Vec<u8>), BakeError> {
    let extents_len = usize::from(glyph_count)
        .checked_mul(8)
        .ok_or_else(overflow)?;
    let mut extents = vec![0_u8; extents_len];
    let mut availability = vec![0_u8; usize::from(glyph_count).div_ceil(8)];
    let outlines = font.outline_glyphs();
    for glyph_id in 0..glyph_count {
        let Some(outline) = outlines.get(GlyphId::new(u32::from(glyph_id))) else {
            continue;
        };
        let mut pen = ExtentsPen::default();
        outline
            .draw(
                DrawSettings::unhinted(Size::unscaled(), LocationRef::default()),
                &mut pen,
            )
            .map_err(|error| {
                BakeError::new(
                    BakeErrorCode::InvalidGlyphExtents,
                    format!("failed to read glyph {glyph_id} outline: {error}"),
                )
            })?;
        let Some(bounds) = pen.finish()? else {
            continue;
        };
        let offset = usize::from(glyph_id) * 8;
        for (index, value) in bounds.into_iter().enumerate() {
            extents[offset + index * 2..offset + index * 2 + 2]
                .copy_from_slice(&value.to_le_bytes());
        }
        availability[usize::from(glyph_id) >> 3] |= 1 << (glyph_id & 7);
    }
    Ok((extents, availability))
}

#[derive(Default)]
struct ExtentsPen {
    current: Option<(f64, f64)>,
    bounds: Option<[f64; 4]>,
}

impl ExtentsPen {
    fn point(&mut self, x: f64, y: f64) {
        if let Some([x_min, y_min, x_max, y_max]) = &mut self.bounds {
            *x_min = x_min.min(x);
            *y_min = y_min.min(y);
            *x_max = x_max.max(x);
            *y_max = y_max.max(y);
        } else {
            self.bounds = Some([x, y, x, y]);
        }
    }

    fn finish(self) -> Result<Option<[i16; 4]>, BakeError> {
        let Some([x_min, y_min, x_max, y_max]) = self.bounds else {
            return Ok(None);
        };
        let values = [x_min.floor(), y_min.floor(), x_max.ceil(), y_max.ceil()];
        if values.iter().any(|value| {
            !value.is_finite() || *value < f64::from(i16::MIN) || *value > f64::from(i16::MAX)
        }) {
            return Err(BakeError::new(
                BakeErrorCode::InvalidGlyphExtents,
                "glyph extent is outside the V0 i16 range",
            ));
        }
        Ok(Some([
            values[0] as i16,
            values[1] as i16,
            values[2] as i16,
            values[3] as i16,
        ]))
    }
}

impl OutlinePen for ExtentsPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.current = Some((x.into(), y.into()));
        self.point(x.into(), y.into());
    }
    fn line_to(&mut self, x: f32, y: f32) {
        self.current = Some((x.into(), y.into()));
        self.point(x.into(), y.into());
    }
    fn quad_to(&mut self, cx: f32, cy: f32, x: f32, y: f32) {
        let (x0, y0) = self.current.unwrap_or((x.into(), y.into()));
        let (cx, cy, x, y) = (f64::from(cx), f64::from(cy), f64::from(x), f64::from(y));
        self.point(x, y);
        for t in quadratic_extrema(x0, cx, x)
            .into_iter()
            .chain(quadratic_extrema(y0, cy, y))
        {
            if (0.0..1.0).contains(&t) {
                self.point(quadratic(x0, cx, x, t), quadratic(y0, cy, y, t));
            }
        }
        self.current = Some((x, y));
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (x0, y0) = self.current.unwrap_or((x.into(), y.into()));
        let (cx0, cy0, cx1, cy1, x, y) = (
            f64::from(cx0),
            f64::from(cy0),
            f64::from(cx1),
            f64::from(cy1),
            f64::from(x),
            f64::from(y),
        );
        self.point(x, y);
        for t in cubic_extrema(x0, cx0, cx1, x)
            .into_iter()
            .chain(cubic_extrema(y0, cy0, cy1, y))
        {
            if (0.0..1.0).contains(&t) {
                self.point(cubic(x0, cx0, cx1, x, t), cubic(y0, cy0, cy1, y, t));
            }
        }
        self.current = Some((x, y));
    }
    fn close(&mut self) {}
}

fn quadratic_extrema(p0: f64, p1: f64, p2: f64) -> Vec<f64> {
    let denominator = p0 - 2.0 * p1 + p2;
    if denominator.abs() < f64::EPSILON {
        Vec::new()
    } else {
        vec![(p0 - p1) / denominator]
    }
}
fn quadratic(p0: f64, p1: f64, p2: f64, t: f64) -> f64 {
    let u = 1.0 - t;
    u * u * p0 + 2.0 * u * t * p1 + t * t * p2
}
fn cubic_extrema(p0: f64, p1: f64, p2: f64, p3: f64) -> Vec<f64> {
    let a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    let b = 2.0 * (p0 - 2.0 * p1 + p2);
    let c = p1 - p0;
    if a.abs() < f64::EPSILON {
        return if b.abs() < f64::EPSILON {
            Vec::new()
        } else {
            vec![-c / b]
        };
    }
    let discriminant = b * b - 4.0 * a * c;
    if discriminant < 0.0 {
        Vec::new()
    } else {
        let root = discriminant.sqrt();
        vec![(-b + root) / (2.0 * a), (-b - root) / (2.0 * a)]
    }
}
fn cubic(p0: f64, p1: f64, p2: f64, p3: f64, t: f64) -> f64 {
    let u = 1.0 - t;
    u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3
}

fn shaping_hash(sfnt: &[u8], extents: &[u8], availability: &[u8]) -> Result<String, BakeError> {
    let mut bytes = b"PMNDRS_font\0v0\0".to_vec();
    for value in [sfnt, extents, availability] {
        bytes.extend_from_slice(
            &u32::try_from(value.len())
                .map_err(|_| overflow())?
                .to_le_bytes(),
        );
        bytes.extend_from_slice(value);
    }
    Ok(hex_sha256(&bytes))
}

fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0_u32, |sum, chunk| {
        let mut word = [0_u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}
fn align4(value: usize) -> usize {
    (value + 3) & !3
}
fn missing(table: &str) -> BakeError {
    BakeError::new(
        BakeErrorCode::MissingTable,
        format!("font is missing required {table} table"),
    )
}
fn overflow() -> BakeError {
    BakeError::new(
        BakeErrorCode::IntegerOverflow,
        "font data exceeds V0 addressable limits",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checksum_pads_partial_words() {
        assert_eq!(checksum(&[1, 2, 3]), 0x0102_0300);
    }

    #[test]
    fn curve_extrema_include_internal_turns() {
        let roots = quadratic_extrema(0.0, 10.0, 0.0);
        assert_eq!(roots, vec![0.5]);
        assert_eq!(quadratic(0.0, 10.0, 0.0, roots[0]), 5.0);
    }
}
