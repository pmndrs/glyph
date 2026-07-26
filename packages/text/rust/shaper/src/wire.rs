use alloc::vec::Vec;

use crate::{
    FeatureRecord, ReshapeRange, RunRequest, STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE,
    ShapeBatchOutput, ShapeBatchRequest,
    abi_contract::{
        BIDI_REQUEST_HEADER_SIZE, BIDI_RESULT_HEADER_SIZE, FEATURE_RECORD_SIZE,
        RESHAPE_RANGE_RECORD_SIZE, RESHAPE_REQUEST_HEADER_SIZE, RESULT_HEADER_SIZE,
        RUN_RECORD_SIZE, SHAPE_REQUEST_HEADER_SIZE,
    },
    bidi::BidiAnalysis,
};

const NO_LANGUAGE: u32 = u32::MAX;

pub fn parse_bidi_request(bytes: &[u8]) -> Result<(Vec<u16>, u8), u32> {
    if bytes.len() < BIDI_REQUEST_HEADER_SIZE as usize {
        return Err(STATUS_INVALID_REQUEST);
    }
    let text_offset = read_u32(bytes, 0)?;
    let text_length = read_u32(bytes, 4)?;
    let direction = *bytes.get(8).ok_or(STATUS_INVALID_REQUEST)?;
    if bytes.get(9..12) != Some(&[0, 0, 0]) {
        return Err(STATUS_INVALID_REQUEST);
    }
    let text_bytes = array(bytes, text_offset, text_length, 2, 2)?;
    let mut text =
        Vec::with_capacity(usize::try_from(text_length).map_err(|_| STATUS_INVALID_REQUEST)?);
    for unit in text_bytes.chunks_exact(2) {
        text.push(u16::from_le_bytes([unit[0], unit[1]]));
    }
    Ok((text, direction))
}

pub fn parse_shape_request(bytes: &[u8]) -> Result<ShapeBatchRequest, u32> {
    parse_request(bytes, false).map(|(request, _)| request)
}

pub fn parse_reshape_request(bytes: &[u8]) -> Result<(ShapeBatchRequest, Vec<ReshapeRange>), u32> {
    let (request, ranges) = parse_request(bytes, true)?;
    Ok((request, ranges.ok_or(STATUS_INVALID_REQUEST)?))
}

fn parse_request(
    bytes: &[u8],
    reshape: bool,
) -> Result<(ShapeBatchRequest, Option<Vec<ReshapeRange>>), u32> {
    let header_size = if reshape {
        RESHAPE_REQUEST_HEADER_SIZE
    } else {
        SHAPE_REQUEST_HEADER_SIZE
    } as usize;
    if bytes.len() < header_size {
        return Err(STATUS_INVALID_REQUEST);
    }
    let text_offset = read_u32(bytes, 0)?;
    let text_length = read_u32(bytes, 4)?;
    let runs_offset = read_u32(bytes, 8)?;
    let run_count = read_u32(bytes, 12)?;
    let features_offset = read_u32(bytes, 16)?;
    let feature_count = read_u32(bytes, 20)?;
    let languages_offset = read_u32(bytes, 24)?;
    let languages_length = read_u32(bytes, 28)?;

    let text_bytes = array(bytes, text_offset, text_length, 2, 2)?;
    let mut text =
        Vec::with_capacity(usize::try_from(text_length).map_err(|_| STATUS_INVALID_REQUEST)?);
    for unit in text_bytes.chunks_exact(2) {
        text.push(u16::from_le_bytes([unit[0], unit[1]]));
    }

    let feature_bytes = array(
        bytes,
        features_offset,
        feature_count,
        FEATURE_RECORD_SIZE,
        4,
    )?;
    let mut features =
        Vec::with_capacity(usize::try_from(feature_count).map_err(|_| STATUS_INVALID_REQUEST)?);
    for record in feature_bytes.chunks_exact(FEATURE_RECORD_SIZE as usize) {
        features.push(FeatureRecord {
            tag: read_u32(record, 0)?,
            value: read_u32(record, 4)?,
            start: read_u32(record, 8)?,
            end: read_u32(record, 12)?,
        });
    }

    let languages = array(bytes, languages_offset, languages_length, 1, 1)?;
    let run_bytes = array(bytes, runs_offset, run_count, RUN_RECORD_SIZE, 4)?;
    let mut runs =
        Vec::with_capacity(usize::try_from(run_count).map_err(|_| STATUS_INVALID_REQUEST)?);
    for record in run_bytes.chunks_exact(RUN_RECORD_SIZE as usize) {
        let feature_start =
            usize::try_from(read_u32(record, 20)?).map_err(|_| STATUS_INVALID_REQUEST)?;
        let feature_count = usize::from(read_u16(record, 24)?);
        let feature_end = feature_start
            .checked_add(feature_count)
            .ok_or(STATUS_INVALID_REQUEST)?;
        let selected_features = features
            .get(feature_start..feature_end)
            .ok_or(STATUS_INVALID_REQUEST)?
            .to_vec();
        let language_offset = read_u32(record, 16)?;
        let language = if language_offset == NO_LANGUAGE {
            None
        } else {
            let offset = usize::try_from(language_offset).map_err(|_| STATUS_INVALID_REQUEST)?;
            let length = usize::from(read_u16(languages, offset)?);
            let start = offset.checked_add(2).ok_or(STATUS_INVALID_REQUEST)?;
            let end = start.checked_add(length).ok_or(STATUS_INVALID_REQUEST)?;
            Some(
                languages
                    .get(start..end)
                    .ok_or(STATUS_INVALID_REQUEST)?
                    .to_vec(),
            )
        };
        runs.push(RunRequest {
            font_handle: read_u32(record, 0)?,
            text_start: read_u32(record, 4)?,
            text_end: read_u32(record, 8)?,
            script: read_u32(record, 12)?,
            language,
            features: selected_features,
            direction: *record.get(26).ok_or(STATUS_INVALID_REQUEST)?,
            cluster_level: *record.get(27).ok_or(STATUS_INVALID_REQUEST)?,
            flags: read_u32(record, 28)?,
        });
    }

    let ranges = if reshape {
        let ranges_offset = read_u32(bytes, 32)?;
        let range_count = read_u32(bytes, 36)?;
        let range_bytes = array(
            bytes,
            ranges_offset,
            range_count,
            RESHAPE_RANGE_RECORD_SIZE,
            4,
        )?;
        let mut ranges =
            Vec::with_capacity(usize::try_from(range_count).map_err(|_| STATUS_INVALID_REQUEST)?);
        for record in range_bytes.chunks_exact(RESHAPE_RANGE_RECORD_SIZE as usize) {
            ranges.push(ReshapeRange {
                run: read_u32(record, 0)?,
                item_start: read_u32(record, 4)?,
                item_end: read_u32(record, 8)?,
                context_start: read_u32(record, 12)?,
                context_end: read_u32(record, 16)?,
                flags: read_u32(record, 20)?,
            });
        }
        Some(ranges)
    } else {
        None
    };
    Ok((ShapeBatchRequest { text, runs }, ranges))
}

pub fn pack_result(output: &ShapeBatchOutput) -> Result<Vec<u8>, u32> {
    let run_count = output.run_font_slots.len();
    let glyph_count = output.glyph_ids.len();
    if output.run_glyph_starts.len() != run_count
        || output.run_glyph_counts.len() != run_count
        || output.clusters.len() != glyph_count
        || output.x_advances.len() != glyph_count
        || output.y_advances.len() != glyph_count
        || output.x_offsets.len() != glyph_count
        || output.y_offsets.len() != glyph_count
        || output.glyph_flags.len() != glyph_count
    {
        return Err(STATUS_RESULT_TOO_LARGE);
    }
    let mut bytes = result_bytes(
        RESULT_HEADER_SIZE as usize,
        &[
            (output.font_handles.len(), 4),
            (output.run_font_slots.len(), 2),
            (output.run_glyph_starts.len(), 4),
            (output.run_glyph_counts.len(), 4),
            (output.glyph_ids.len(), 2),
            (output.clusters.len(), 4),
            (output.x_advances.len(), 4),
            (output.y_advances.len(), 4),
            (output.x_offsets.len(), 4),
            (output.y_offsets.len(), 4),
            (output.glyph_flags.len(), 2),
        ],
    )?;
    let font_handles_offset = append_u32(&mut bytes, &output.font_handles)?;
    let run_font_slots_offset = append_u16(&mut bytes, &output.run_font_slots)?;
    let run_glyph_starts_offset = append_u32(&mut bytes, &output.run_glyph_starts)?;
    let run_glyph_counts_offset = append_u32(&mut bytes, &output.run_glyph_counts)?;
    let glyph_ids_offset = append_u16(&mut bytes, &output.glyph_ids)?;
    let clusters_offset = append_u32(&mut bytes, &output.clusters)?;
    let x_advances_offset = append_i32(&mut bytes, &output.x_advances)?;
    let y_advances_offset = append_i32(&mut bytes, &output.y_advances)?;
    let x_offsets_offset = append_i32(&mut bytes, &output.x_offsets)?;
    let y_offsets_offset = append_i32(&mut bytes, &output.y_offsets)?;
    let glyph_flags_offset = append_u16(&mut bytes, &output.glyph_flags)?;
    let byte_length = u32::try_from(bytes.len()).map_err(|_| STATUS_RESULT_TOO_LARGE)?;

    write_u32(&mut bytes, 0, byte_length);
    write_u32(&mut bytes, 4, font_handles_offset);
    write_u32(
        &mut bytes,
        8,
        u32::try_from(output.font_handles.len()).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    );
    write_u32(&mut bytes, 12, run_font_slots_offset);
    write_u32(&mut bytes, 16, run_glyph_starts_offset);
    write_u32(&mut bytes, 20, run_glyph_counts_offset);
    write_u32(
        &mut bytes,
        24,
        u32::try_from(run_count).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    );
    write_u32(&mut bytes, 28, glyph_ids_offset);
    write_u32(&mut bytes, 32, clusters_offset);
    write_u32(&mut bytes, 36, x_advances_offset);
    write_u32(&mut bytes, 40, y_advances_offset);
    write_u32(&mut bytes, 44, x_offsets_offset);
    write_u32(&mut bytes, 48, y_offsets_offset);
    write_u32(&mut bytes, 52, glyph_flags_offset);
    write_u32(
        &mut bytes,
        56,
        u32::try_from(glyph_count).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    );
    Ok(bytes)
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub fn pack_bidi_result(output: &BidiAnalysis) -> Result<Vec<u8>, u32> {
    let text_length = output.levels.len();
    let paragraph_count = output.paragraph_starts.len();
    if output.classes.len() != text_length
        || output.paragraph_ends.len() != paragraph_count
        || output.paragraph_levels.len() != paragraph_count
    {
        return Err(STATUS_RESULT_TOO_LARGE);
    }
    let mut bytes = result_bytes(
        BIDI_RESULT_HEADER_SIZE as usize,
        &[
            (output.levels.len(), 1),
            (output.classes.len(), 1),
            (output.paragraph_starts.len(), 4),
            (output.paragraph_ends.len(), 4),
            (output.paragraph_levels.len(), 1),
        ],
    )?;
    let levels_offset = append_u8(&mut bytes, &output.levels)?;
    let classes_offset = append_u8(&mut bytes, &output.classes)?;
    let paragraph_starts_offset = append_u32(&mut bytes, &output.paragraph_starts)?;
    let paragraph_ends_offset = append_u32(&mut bytes, &output.paragraph_ends)?;
    let paragraph_levels_offset = append_u8(&mut bytes, &output.paragraph_levels)?;
    let byte_length = u32::try_from(bytes.len()).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    write_u32(&mut bytes, 0, byte_length);
    write_u32(&mut bytes, 4, levels_offset);
    write_u32(&mut bytes, 8, classes_offset);
    write_u32(
        &mut bytes,
        12,
        u32::try_from(text_length).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    );
    write_u32(&mut bytes, 16, paragraph_starts_offset);
    write_u32(&mut bytes, 20, paragraph_ends_offset);
    write_u32(&mut bytes, 24, paragraph_levels_offset);
    write_u32(
        &mut bytes,
        28,
        u32::try_from(paragraph_count).map_err(|_| STATUS_RESULT_TOO_LARGE)?,
    );
    Ok(bytes)
}

fn array(bytes: &[u8], offset: u32, count: u32, stride: u32, alignment: u32) -> Result<&[u8], u32> {
    if !offset.is_multiple_of(alignment) {
        return Err(STATUS_INVALID_REQUEST);
    }
    let offset = usize::try_from(offset).map_err(|_| STATUS_INVALID_REQUEST)?;
    let length = count.checked_mul(stride).ok_or(STATUS_INVALID_REQUEST)?;
    let length = usize::try_from(length).map_err(|_| STATUS_INVALID_REQUEST)?;
    let end = offset.checked_add(length).ok_or(STATUS_INVALID_REQUEST)?;
    bytes.get(offset..end).ok_or(STATUS_INVALID_REQUEST)
}

fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, u32> {
    let value = bytes
        .get(offset..offset.checked_add(2).ok_or(STATUS_INVALID_REQUEST)?)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, u32> {
    let value = bytes
        .get(offset..offset.checked_add(4).ok_or(STATUS_INVALID_REQUEST)?)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[inline(never)]
fn result_bytes(header_length: usize, fields: &[(usize, usize)]) -> Result<Vec<u8>, u32> {
    let mut byte_length = header_length;
    for &(element_count, element_size) in fields {
        let padding = (element_size - byte_length % element_size) % element_size;
        byte_length = byte_length
            .checked_add(padding)
            .and_then(|length| element_count.checked_mul(element_size)?.checked_add(length))
            .ok_or(STATUS_RESULT_TOO_LARGE)?;
    }
    u32::try_from(byte_length).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(byte_length)
        .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    bytes.resize(header_length, 0);
    Ok(bytes)
}

fn align(bytes: &mut Vec<u8>, alignment: usize) -> Result<u32, u32> {
    let padding = (alignment - bytes.len() % alignment) % alignment;
    bytes.resize(
        bytes
            .len()
            .checked_add(padding)
            .ok_or(STATUS_RESULT_TOO_LARGE)?,
        0,
    );
    u32::try_from(bytes.len()).map_err(|_| STATUS_RESULT_TOO_LARGE)
}

fn append_u16(bytes: &mut Vec<u8>, values: &[u16]) -> Result<u32, u32> {
    let offset = align(bytes, 2)?;
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Ok(offset)
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn append_u8(bytes: &mut Vec<u8>, values: &[u8]) -> Result<u32, u32> {
    let offset = u32::try_from(bytes.len()).map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    bytes.extend_from_slice(values);
    Ok(offset)
}

fn append_u32(bytes: &mut Vec<u8>, values: &[u32]) -> Result<u32, u32> {
    let offset = align(bytes, 4)?;
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Ok(offset)
}

fn append_i32(bytes: &mut Vec<u8>, values: &[i32]) -> Result<u32, u32> {
    let offset = align(bytes, 4)?;
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Ok(offset)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_wire_ranges_fail_without_panicking() {
        assert!(matches!(
            parse_shape_request(&[]),
            Err(STATUS_INVALID_REQUEST)
        ));
        assert!(matches!(
            parse_reshape_request(&[]),
            Err(STATUS_INVALID_REQUEST)
        ));
        assert!(matches!(
            parse_bidi_request(&[]),
            Err(STATUS_INVALID_REQUEST)
        ));
        let mut bytes = vec![0; SHAPE_REQUEST_HEADER_SIZE as usize];
        write_u32(&mut bytes, 0, u32::MAX);
        write_u32(&mut bytes, 4, 1);
        assert!(matches!(
            parse_shape_request(&bytes),
            Err(STATUS_INVALID_REQUEST)
        ));
    }

    #[test]
    fn result_layout_overflow_returns_a_status_before_allocation() {
        assert_eq!(
            result_bytes(RESULT_HEADER_SIZE as usize, &[(usize::MAX, 4)]),
            Err(STATUS_RESULT_TOO_LARGE),
        );
    }

    #[test]
    fn result_header_points_to_exact_soa_arrays() {
        let output = ShapeBatchOutput {
            font_handles: vec![7],
            run_font_slots: vec![0],
            run_glyph_starts: vec![0],
            run_glyph_counts: vec![1],
            glyph_ids: vec![42],
            clusters: vec![3],
            x_advances: vec![100],
            y_advances: vec![0],
            x_offsets: vec![-2],
            y_offsets: vec![5],
            glyph_flags: vec![3],
        };
        let bytes = pack_result(&output).unwrap();
        assert_eq!(read_u32(&bytes, 0).unwrap() as usize, bytes.len());
        assert_eq!(read_u32(&bytes, 8).unwrap(), 1);
        assert_eq!(read_u32(&bytes, 24).unwrap(), 1);
        assert_eq!(read_u32(&bytes, 56).unwrap(), 1);
        let glyph_offset = read_u32(&bytes, 28).unwrap() as usize;
        assert_eq!(read_u16(&bytes, glyph_offset).unwrap(), 42);
    }
}
