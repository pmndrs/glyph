use read_fonts::{
    FontRef, TableProvider,
    tables::os2::SelectionFlags,
    types::{GlyphId, Tag},
};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
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
const OPTIONAL_TABLES: [Tag; 8] = [
    Tag::new(b"BASE"),
    Tag::new(b"GDEF"),
    Tag::new(b"GSUB"),
    Tag::new(b"GPOS"),
    Tag::new(b"VORG"),
    Tag::new(b"kern"),
    Tag::new(b"vhea"),
    Tag::new(b"vmtx"),
];
const VARIABLE_TABLES: [Tag; 7] = [
    Tag::new(b"fvar"),
    Tag::new(b"avar"),
    Tag::new(b"gvar"),
    Tag::new(b"cvar"),
    Tag::new(b"HVAR"),
    Tag::new(b"VVAR"),
    Tag::new(b"MVAR"),
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
    pub shaping_fingerprint: String,
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
    // Decoration metrics: underline from `post`, strikeout from `OS/2`. `post` is not a
    // required shaping table, so a font without one falls back to a conservative derived
    // rule (thickness em/14, position -em/10) instead of baking invisible zero values.
    let (underline_position, underline_thickness) = match font.post() {
        Ok(post) => (
            post.underline_position().to_i16(),
            post.underline_thickness().to_i16(),
        ),
        Err(_) => (
            -(i16::try_from(units_per_em / 10).unwrap_or(i16::MAX)),
            i16::try_from(units_per_em / 14).unwrap_or(i16::MAX).max(1),
        ),
    };
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
        underline_position,
        underline_thickness,
        strikeout_position: os2.y_strikeout_position(),
        strikeout_size: os2.y_strikeout_size(),
    };

    let (sfnt, tables) = rebuild_sfnt(&font)?;
    let (extents, extents_availability) = collect_extents(&font, glyph_count)?;
    let shaping_fingerprint = shaping_fingerprint(&sfnt, &extents, &extents_availability)?;
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
        shaping_fingerprint,
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
    let glyph_metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    for glyph_id in 0..glyph_count {
        let Some(bounds) = glyph_metrics.bounds(GlyphId::new(u32::from(glyph_id))) else {
            continue;
        };
        let bounds = encode_bounds([bounds.x_min, bounds.y_min, bounds.x_max, bounds.y_max])?;
        let offset = usize::from(glyph_id) * 8;
        for (index, value) in bounds.into_iter().enumerate() {
            extents[offset + index * 2..offset + index * 2 + 2]
                .copy_from_slice(&value.to_le_bytes());
        }
        availability[usize::from(glyph_id) >> 3] |= 1 << (glyph_id & 7);
    }
    Ok((extents, availability))
}

fn encode_bounds(bounds: [f32; 4]) -> Result<[i16; 4], BakeError> {
    let values = [
        bounds[0].floor(),
        bounds[1].floor(),
        bounds[2].ceil(),
        bounds[3].ceil(),
    ];
    if values.iter().any(|value| {
        !value.is_finite() || *value < f32::from(i16::MIN) || *value > f32::from(i16::MAX)
    }) {
        return Err(BakeError::new(
            BakeErrorCode::InvalidGlyphExtents,
            "glyph extent is outside the V0 i16 range",
        ));
    }
    Ok([
        values[0] as i16,
        values[1] as i16,
        values[2] as i16,
        values[3] as i16,
    ])
}

fn shaping_fingerprint(sfnt: &[u8], extents: &[u8], availability: &[u8]) -> Result<String, BakeError> {
    let mut bytes = b"PMNDRS_font\0v0\0".to_vec();
    for value in [sfnt, extents, availability] {
        bytes.extend_from_slice(
            &u32::try_from(value.len())
                .map_err(|_| overflow())?
                .to_le_bytes(),
        );
        bytes.extend_from_slice(value);
    }
    Ok(pmndrs_glyph_raster_artifact::fingerprint128(
        &bytes,
        pmndrs_glyph_raster_artifact::SHAPING_FINGERPRINT_V0,
    ))
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

    const INTER: &[u8] = include_bytes!(
        "../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf"
    );

    #[test]
    fn checksum_pads_partial_words() {
        assert_eq!(checksum(&[1, 2, 3]), 0x0102_0300);
    }

    #[test]
    fn bounds_are_rounded_outward() {
        assert_eq!(
            encode_bounds([-1.25, -2.5, 3.25, 4.5]).unwrap(),
            [-2, -3, 4, 5]
        );
    }

    #[test]
    fn optional_cjk_layout_tables_are_absent_when_the_source_omits_them() {
        let payload = build_shaping_payload(INTER, 0).unwrap();
        let retained_tags = payload
            .report
            .tables
            .iter()
            .map(|table| table.tag.as_str())
            .collect::<Vec<_>>();

        for tag in ["BASE", "VORG", "vhea", "vmtx"] {
            assert!(!retained_tags.contains(&tag));
        }
    }

    #[test]
    fn optional_cjk_layout_tables_survive_as_exact_bounded_views() {
        let mut source = INTER.to_vec();
        let substitutions = [
            (*b"cvt ", *b"BASE"),
            (*b"fpgm", *b"vhea"),
            (*b"gasp", *b"vmtx"),
            (*b"name", *b"VORG"),
        ];
        let expected = substitutions
            .map(|(source_tag, retained_tag)| {
                let record = table_record(&source, source_tag);
                let offset = read_u32(&source[record + 8..record + 12]) as usize;
                let length = read_u32(&source[record + 12..record + 16]) as usize;
                let bytes = source[offset..offset + length].to_vec();
                source[record..record + 4].copy_from_slice(&retained_tag);
                (Tag::new(&retained_tag), bytes)
            })
            .to_vec();

        let payload = build_shaping_payload(&source, 0).unwrap();
        let reduced = FontRef::new(&payload.sfnt).unwrap();
        for (tag, expected_bytes) in expected {
            assert_eq!(
                reduced.table_data(tag).unwrap().as_bytes(),
                expected_bytes,
                "{tag} bytes must survive without interpretation"
            );
        }
        assert_eq!(
            payload.report.sfnt_directory_bytes,
            12 + payload.report.tables.len() * 16
        );
        assert_eq!(
            payload
                .report
                .tables
                .iter()
                .map(|table| table.tag.as_str())
                .collect::<Vec<_>>(),
            [
                "BASE", "GDEF", "GPOS", "GSUB", "OS/2", "VORG", "cmap", "head", "hhea", "hmtx",
                "maxp", "vhea", "vmtx"
            ]
        );
    }

    #[test]
    fn stat_alone_does_not_make_a_static_font_variable() {
        let mut source = INTER.to_vec();
        let record = table_record(&source, *b"name");
        source[record..record + 4].copy_from_slice(b"STAT");

        build_shaping_payload(&source, 0).unwrap();
    }

    #[test]
    fn variation_axis_tables_still_reject_variable_input() {
        let mut source = INTER.to_vec();
        let record = table_record(&source, *b"name");
        source[record..record + 4].copy_from_slice(b"fvar");

        let error = build_shaping_payload(&source, 0).err().unwrap();
        assert_eq!(error.code, BakeErrorCode::UnsupportedVariableFont);
    }

    fn table_record(font: &[u8], wanted: [u8; 4]) -> usize {
        let count = u16::from_be_bytes(font[4..6].try_into().unwrap());
        (0..usize::from(count))
            .map(|index| 12 + index * 16)
            .find(|record| font[*record..*record + 4] == wanted)
            .unwrap()
    }

    fn read_u32(bytes: &[u8]) -> u32 {
        u32::from_be_bytes(bytes.try_into().unwrap())
    }
}
