//! Compiler-mapped cold decoder for normalized per-font renderer data.

use alloc::vec::Vec;

use crate::{
    STATUS_INVALID_REQUEST, STATUS_RESULT_TOO_LARGE,
    abi_contract::{
        ABI_VERSION, FONT_BINDING_ABI_VERSION, FONT_BINDING_BYTE_LENGTH, FONT_BINDING_GLYPH_COUNT,
        FONT_BINDING_GLYPH_F32_FIELD_COUNT, FONT_BINDING_GLYPH_F32_OFFSET,
        FONT_BINDING_GLYPH_U32_FIELD_COUNT, FONT_BINDING_GLYPH_U32_OFFSET,
        FONT_BINDING_PROGRAM_VARIANT, FONT_BINDING_REQUEST_HEADER_SIZE, FONT_BINDING_RESERVED0,
        FONT_BINDING_RESERVED1, FONT_BINDING_RESERVED2, FONT_BINDING_RESOURCE_COUNT,
        FONT_BINDING_RESOURCE_F32_FIELD_COUNT, FONT_BINDING_RESOURCE_F32_OFFSET,
        FONT_BINDING_RESOURCE_GENERATION, FONT_BINDING_RESOURCE_ID,
        FONT_BINDING_RESOURCE_INDICES_OFFSET, FONT_BINDING_RESOURCE_KIND,
        FONT_BINDING_RESOURCE_RECORD_ALIGNMENT, FONT_BINDING_RESOURCE_RECORD_SIZE,
        FONT_BINDING_RESOURCE_REFERENCE, FONT_BINDING_RESOURCE_RESERVED,
        FONT_BINDING_RESOURCE_U32_FIELD_COUNT, FONT_BINDING_RESOURCE_U32_OFFSET,
        FONT_BINDING_RESOURCES_OFFSET, FONT_BINDING_STRIKE_COUNT,
        FONT_BINDING_STRIKE_F32_FIELD_COUNT, FONT_BINDING_STRIKE_F32_OFFSET,
        FONT_BINDING_STRIKE_PPEM, FONT_BINDING_STRIKE_RECORD_ALIGNMENT,
        FONT_BINDING_STRIKE_RECORD_SIZE, FONT_BINDING_STRIKE_RESERVED,
        FONT_BINDING_STRIKE_U32_FIELD_COUNT, FONT_BINDING_STRIKE_U32_OFFSET,
        FONT_BINDING_STRIKES_OFFSET, FONT_BINDING_TECHNIQUE_ID,
    },
    engine::{
        font_binding::{
            FieldTable, FontRenderBinding, FontResource, FontStrike, MAX_BINDING_FIELDS,
        },
        policy::TechniqueId,
    },
    wire::{array, read_u16, read_u32},
};

const MAX_GLYPHS: u32 = u16::MAX as u32;
const MAX_STRIKES: u32 = u16::MAX as u32;
const MAX_RESOURCES: u32 = u16::MAX as u32;

pub(crate) fn parse_font_binding(bytes: &[u8]) -> Result<FontRenderBinding, u32> {
    if bytes.len() < FONT_BINDING_REQUEST_HEADER_SIZE as usize
        || read_u32(bytes, FONT_BINDING_ABI_VERSION)? != ABI_VERSION
        || read_u32(bytes, FONT_BINDING_BYTE_LENGTH)?
            != u32::try_from(bytes.len()).map_err(|_| STATUS_INVALID_REQUEST)?
        || read_u16(bytes, FONT_BINDING_RESERVED0)? != 0
        || read_u16(bytes, FONT_BINDING_RESERVED1)? != 0
        || read_u32(bytes, FONT_BINDING_RESERVED2)? != 0
    {
        return Err(STATUS_INVALID_REQUEST);
    }
    let glyph_count = bounded_positive(bytes, FONT_BINDING_GLYPH_COUNT, MAX_GLYPHS)?;
    let strike_count = bounded_positive(bytes, FONT_BINDING_STRIKE_COUNT, MAX_STRIKES)?;
    let resource_count = bounded_positive(bytes, FONT_BINDING_RESOURCE_COUNT, MAX_RESOURCES)?;
    let strike_rows = glyph_count
        .checked_mul(strike_count)
        .ok_or(STATUS_INVALID_REQUEST)?;
    let field_counts = [
        byte(bytes, FONT_BINDING_GLYPH_F32_FIELD_COUNT)?,
        byte(bytes, FONT_BINDING_GLYPH_U32_FIELD_COUNT)?,
        byte(bytes, FONT_BINDING_STRIKE_F32_FIELD_COUNT)?,
        byte(bytes, FONT_BINDING_STRIKE_U32_FIELD_COUNT)?,
        byte(bytes, FONT_BINDING_RESOURCE_F32_FIELD_COUNT)?,
        byte(bytes, FONT_BINDING_RESOURCE_U32_FIELD_COUNT)?,
    ];
    if field_counts.iter().any(|&count| count > MAX_BINDING_FIELDS) {
        return Err(STATUS_INVALID_REQUEST);
    }

    let strikes = table(
        bytes,
        read_u32(bytes, FONT_BINDING_STRIKES_OFFSET)?,
        strike_count,
        FONT_BINDING_STRIKE_RECORD_SIZE,
        FONT_BINDING_STRIKE_RECORD_ALIGNMENT,
    )?;
    let resources = table(
        bytes,
        read_u32(bytes, FONT_BINDING_RESOURCES_OFFSET)?,
        resource_count,
        FONT_BINDING_RESOURCE_RECORD_SIZE,
        FONT_BINDING_RESOURCE_RECORD_ALIGNMENT,
    )?;
    let resource_indices = scalar_table(bytes, FONT_BINDING_RESOURCE_INDICES_OFFSET, strike_rows)?;
    let glyph_f32 = scalar_table(
        bytes,
        FONT_BINDING_GLYPH_F32_OFFSET,
        field_rows(glyph_count, field_counts[0])?,
    )?;
    let glyph_u32 = scalar_table(
        bytes,
        FONT_BINDING_GLYPH_U32_OFFSET,
        field_rows(glyph_count, field_counts[1])?,
    )?;
    let strike_f32 = scalar_table(
        bytes,
        FONT_BINDING_STRIKE_F32_OFFSET,
        field_rows(strike_rows, field_counts[2])?,
    )?;
    let strike_u32 = scalar_table(
        bytes,
        FONT_BINDING_STRIKE_U32_OFFSET,
        field_rows(strike_rows, field_counts[3])?,
    )?;
    let resource_f32 = scalar_table(
        bytes,
        FONT_BINDING_RESOURCE_F32_OFFSET,
        field_rows(resource_count, field_counts[4])?,
    )?;
    let resource_u32 = scalar_table(
        bytes,
        FONT_BINDING_RESOURCE_U32_OFFSET,
        field_rows(resource_count, field_counts[5])?,
    )?;
    reject_overlaps(
        bytes,
        &[
            strikes,
            resources,
            resource_indices,
            glyph_f32,
            glyph_u32,
            strike_f32,
            strike_u32,
            resource_f32,
            resource_u32,
        ],
    )?;

    FontRenderBinding::new(
        TechniqueId(read_u32(bytes, FONT_BINDING_TECHNIQUE_ID)?),
        read_u16(bytes, FONT_BINDING_PROGRAM_VARIANT)?,
        glyph_count,
        decode_strikes(strikes)?,
        decode_resources(resources)?,
        decode_u32(resource_indices)?,
        FieldTable::new(glyph_count, field_counts[0], decode_f32(glyph_f32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
        FieldTable::new(glyph_count, field_counts[1], decode_u32(glyph_u32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
        FieldTable::new(strike_rows, field_counts[2], decode_f32(strike_f32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
        FieldTable::new(strike_rows, field_counts[3], decode_u32(strike_u32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
        FieldTable::new(resource_count, field_counts[4], decode_f32(resource_f32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
        FieldTable::new(resource_count, field_counts[5], decode_u32(resource_u32)?)
            .map_err(|_| STATUS_INVALID_REQUEST)?,
    )
    .map_err(|_| STATUS_INVALID_REQUEST)
}

fn bounded_positive(bytes: &[u8], offset: usize, maximum: u32) -> Result<u32, u32> {
    let value = read_u32(bytes, offset)?;
    if value == 0 || value > maximum {
        return Err(STATUS_INVALID_REQUEST);
    }
    Ok(value)
}

fn field_rows(rows: u32, fields: u8) -> Result<u32, u32> {
    rows.checked_mul(u32::from(fields))
        .ok_or(STATUS_INVALID_REQUEST)
}

fn scalar_table(bytes: &[u8], offset_field: usize, count: u32) -> Result<&[u8], u32> {
    table(bytes, read_u32(bytes, offset_field)?, count, 4, 4)
}

fn table(bytes: &[u8], offset: u32, count: u32, stride: u32, alignment: u32) -> Result<&[u8], u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(&bytes[..0])
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < FONT_BINDING_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    array(bytes, offset, count, stride, alignment)
}

fn reject_overlaps(bytes: &[u8], tables: &[&[u8]]) -> Result<(), u32> {
    for (index, table) in tables.iter().enumerate() {
        if table.is_empty() {
            continue;
        }
        let current = relative_range(bytes, table)?;
        for previous in &tables[..index] {
            if previous.is_empty() {
                continue;
            }
            let previous = relative_range(bytes, previous)?;
            if current.0 < previous.1 && previous.0 < current.1 {
                return Err(STATUS_INVALID_REQUEST);
            }
        }
    }
    Ok(())
}

fn relative_range(container: &[u8], selected: &[u8]) -> Result<(usize, usize), u32> {
    let start = (selected.as_ptr() as usize)
        .checked_sub(container.as_ptr() as usize)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok((
        start,
        start
            .checked_add(selected.len())
            .ok_or(STATUS_INVALID_REQUEST)?,
    ))
}

fn decode_strikes(records: &[u8]) -> Result<Vec<FontStrike>, u32> {
    let mut decoded = reserved_vec(records.len() / FONT_BINDING_STRIKE_RECORD_SIZE as usize)?;
    for record in records.chunks_exact(FONT_BINDING_STRIKE_RECORD_SIZE as usize) {
        if read_u32(record, FONT_BINDING_STRIKE_RESERVED)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        decoded.push(FontStrike {
            ppem: read_u32(record, FONT_BINDING_STRIKE_PPEM)?,
        });
    }
    Ok(decoded)
}

fn decode_resources(records: &[u8]) -> Result<Vec<FontResource>, u32> {
    let mut decoded = reserved_vec(records.len() / FONT_BINDING_RESOURCE_RECORD_SIZE as usize)?;
    for record in records.chunks_exact(FONT_BINDING_RESOURCE_RECORD_SIZE as usize) {
        if read_u16(record, FONT_BINDING_RESOURCE_RESERVED)? != 0 {
            return Err(STATUS_INVALID_REQUEST);
        }
        decoded.push(FontResource {
            id: read_u32(record, FONT_BINDING_RESOURCE_ID)?,
            generation: read_u32(record, FONT_BINDING_RESOURCE_GENERATION)?,
            kind: read_u16(record, FONT_BINDING_RESOURCE_KIND)?,
            reference: read_u32(record, FONT_BINDING_RESOURCE_REFERENCE)?,
        });
    }
    Ok(decoded)
}

fn decode_u32(bytes: &[u8]) -> Result<Vec<u32>, u32> {
    let mut decoded = reserved_vec(bytes.len() / 4)?;
    for value in bytes.chunks_exact(4) {
        decoded.push(u32::from_le_bytes([value[0], value[1], value[2], value[3]]));
    }
    Ok(decoded)
}

fn decode_f32(bytes: &[u8]) -> Result<Vec<f32>, u32> {
    let mut decoded = reserved_vec(bytes.len() / 4)?;
    for value in bytes.chunks_exact(4) {
        let value = f32::from_bits(u32::from_le_bytes([value[0], value[1], value[2], value[3]]));
        if !value.is_finite() {
            return Err(STATUS_INVALID_REQUEST);
        }
        decoded.push(value);
    }
    Ok(decoded)
}

fn reserved_vec<T>(capacity: usize) -> Result<Vec<T>, u32> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(capacity)
        .map_err(|_| STATUS_RESULT_TOO_LARGE)?;
    Ok(values)
}

fn byte(bytes: &[u8], offset: usize) -> Result<u8, u32> {
    bytes.get(offset).copied().ok_or(STATUS_INVALID_REQUEST)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{STATUS_INVALID_REQUEST, wire::write_u32};

    #[test]
    fn decodes_exact_field_major_tables_and_dense_selection() {
        let bytes = valid_bytes();
        let binding = parse_font_binding(&bytes).unwrap();
        assert_eq!(binding.technique(), TechniqueId(7));
        assert_eq!(binding.program_variant(), 2);
        assert_eq!(binding.glyph_f32().field(0), Some(&[1.0, 2.0][..]));
        assert_eq!(binding.glyph_u32().field(0), Some(&[10, 20][..]));
        assert_eq!(binding.strike_f32().field(0), Some(&[3.0, 4.0][..]));
        assert_eq!(binding.strike_u32().field(0), Some(&[30, 40][..]));
        assert_eq!(binding.resource_f32().field(0), Some(&[5.0][..]));
        assert_eq!(binding.resource_u32().field(0), Some(&[50][..]));
        assert_eq!(binding.select(1, 12.0, 2.0).unwrap().resource, 0);
    }

    #[test]
    fn rejects_reserved_overlap_nonfinite_and_out_of_range_data() {
        let mut reserved = valid_bytes();
        write_u32(&mut reserved, FONT_BINDING_RESERVED2, 1);
        assert_eq!(parse_font_binding(&reserved), Err(STATUS_INVALID_REQUEST));

        let mut overlap = valid_bytes();
        let indices = read_u32(&overlap, FONT_BINDING_RESOURCE_INDICES_OFFSET).unwrap();
        write_u32(&mut overlap, FONT_BINDING_GLYPH_F32_OFFSET, indices);
        assert_eq!(parse_font_binding(&overlap), Err(STATUS_INVALID_REQUEST));

        let mut nonfinite = valid_bytes();
        let offset = read_u32(&nonfinite, FONT_BINDING_GLYPH_F32_OFFSET).unwrap() as usize;
        write_u32(&mut nonfinite, offset, f32::NAN.to_bits());
        assert_eq!(parse_font_binding(&nonfinite), Err(STATUS_INVALID_REQUEST));

        let mut bad_index = valid_bytes();
        let offset = read_u32(&bad_index, FONT_BINDING_RESOURCE_INDICES_OFFSET).unwrap() as usize;
        write_u32(&mut bad_index, offset, 1);
        assert_eq!(parse_font_binding(&bad_index), Err(STATUS_INVALID_REQUEST));

        let mut fields = valid_bytes();
        fields[FONT_BINDING_GLYPH_F32_FIELD_COUNT] = MAX_BINDING_FIELDS + 1;
        assert_eq!(parse_font_binding(&fields), Err(STATUS_INVALID_REQUEST));
    }

    fn valid_bytes() -> Vec<u8> {
        let mut bytes = vec![0; FONT_BINDING_REQUEST_HEADER_SIZE as usize];
        write_u32(&mut bytes, FONT_BINDING_ABI_VERSION, ABI_VERSION);
        write_u32(&mut bytes, FONT_BINDING_TECHNIQUE_ID, 7);
        bytes[FONT_BINDING_PROGRAM_VARIANT..FONT_BINDING_PROGRAM_VARIANT + 2]
            .copy_from_slice(&2_u16.to_le_bytes());
        write_u32(&mut bytes, FONT_BINDING_GLYPH_COUNT, 2);
        write_u32(&mut bytes, FONT_BINDING_STRIKE_COUNT, 1);
        write_u32(&mut bytes, FONT_BINDING_RESOURCE_COUNT, 1);
        for offset in [
            FONT_BINDING_GLYPH_F32_FIELD_COUNT,
            FONT_BINDING_GLYPH_U32_FIELD_COUNT,
            FONT_BINDING_STRIKE_F32_FIELD_COUNT,
            FONT_BINDING_STRIKE_U32_FIELD_COUNT,
            FONT_BINDING_RESOURCE_F32_FIELD_COUNT,
            FONT_BINDING_RESOURCE_U32_FIELD_COUNT,
        ] {
            bytes[offset] = 1;
        }

        let strikes = append(&mut bytes, &[0_u32, 0]);
        let resources = append(&mut bytes, &[11, 1, 2, 91]);
        let indices = append(&mut bytes, &[0, 0]);
        let glyph_f32 = append(&mut bytes, &[1.0_f32.to_bits(), 2.0_f32.to_bits()]);
        let glyph_u32 = append(&mut bytes, &[10, 20]);
        let strike_f32 = append(&mut bytes, &[3.0_f32.to_bits(), 4.0_f32.to_bits()]);
        let strike_u32 = append(&mut bytes, &[30, 40]);
        let resource_f32 = append(&mut bytes, &[5.0_f32.to_bits()]);
        let resource_u32 = append(&mut bytes, &[50]);
        for (field, value) in [
            (FONT_BINDING_STRIKES_OFFSET, strikes),
            (FONT_BINDING_RESOURCES_OFFSET, resources),
            (FONT_BINDING_RESOURCE_INDICES_OFFSET, indices),
            (FONT_BINDING_GLYPH_F32_OFFSET, glyph_f32),
            (FONT_BINDING_GLYPH_U32_OFFSET, glyph_u32),
            (FONT_BINDING_STRIKE_F32_OFFSET, strike_f32),
            (FONT_BINDING_STRIKE_U32_OFFSET, strike_u32),
            (FONT_BINDING_RESOURCE_F32_OFFSET, resource_f32),
            (FONT_BINDING_RESOURCE_U32_OFFSET, resource_u32),
        ] {
            write_u32(&mut bytes, field, value);
        }
        let length = bytes.len() as u32;
        write_u32(&mut bytes, FONT_BINDING_BYTE_LENGTH, length);
        bytes
    }

    fn append(bytes: &mut Vec<u8>, values: &[u32]) -> u32 {
        let offset = bytes.len() as u32;
        for value in values {
            bytes.extend_from_slice(&value.to_le_bytes());
        }
        offset
    }
}
