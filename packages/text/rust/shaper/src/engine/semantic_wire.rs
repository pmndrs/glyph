//! Borrowed semantic update records decoded from the compiler-mapped frame ABI.

use crate::{
    STATUS_INVALID_REQUEST,
    abi_contract::{
        ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
        ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
        ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
        ENGINE_TEXT_MUTATION_RECORD_SIZE, ENGINE_TEXT_MUTATION_RESERVED0,
        ENGINE_TEXT_MUTATION_RESERVED1, ENGINE_TEXT_MUTATION_TEXT_START,
        ENGINE_UPDATE_REQUEST_HEADER_SIZE,
    },
    engine::frame::{TEXT_ENCODING_UTF16_LE, TEXT_MUTATION_REPLACE_UTF16},
    wire::{array, read_u16, read_u32},
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutationBatch<'a> {
    request: &'a [u8],
    records: &'a [u8],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct TextMutation<'a> {
    pub text_start: u32,
    pub delete_count: u32,
    pub insert_utf16_le: &'a [u8],
}

impl<'a> TextMutationBatch<'a> {
    pub(crate) const fn empty() -> Self {
        Self {
            request: &[],
            records: &[],
        }
    }

    pub(crate) fn len(self) -> usize {
        self.records.len() / ENGINE_TEXT_MUTATION_RECORD_SIZE as usize
    }

    pub(crate) fn get(self, index: usize) -> Option<TextMutation<'a>> {
        let stride = ENGINE_TEXT_MUTATION_RECORD_SIZE as usize;
        let start = index.checked_mul(stride)?;
        let record = self.records.get(start..start.checked_add(stride)?)?;
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT).ok()?;
        let insert_utf16_le = if insert_count == 0 {
            &[]
        } else {
            array(
                self.request,
                read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET).ok()?,
                insert_count,
                2,
                2,
            )
            .ok()?
        };
        Some(TextMutation {
            text_start: read_u32(record, ENGINE_TEXT_MUTATION_TEXT_START).ok()?,
            delete_count: read_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT).ok()?,
            insert_utf16_le,
        })
    }
}

pub(crate) fn parse_text_mutations(
    request: &[u8],
    offset: u32,
    count: u32,
) -> Result<TextMutationBatch<'_>, u32> {
    if count == 0 {
        return if offset == 0 {
            Ok(TextMutationBatch::empty())
        } else {
            Err(STATUS_INVALID_REQUEST)
        };
    }
    if offset < ENGINE_UPDATE_REQUEST_HEADER_SIZE {
        return Err(STATUS_INVALID_REQUEST);
    }
    let records = array(
        request,
        offset,
        count,
        ENGINE_TEXT_MUTATION_RECORD_SIZE,
        ENGINE_TEXT_MUTATION_RECORD_ALIGNMENT,
    )?;
    let record_start = offset as usize;
    let record_end = record_start
        .checked_add(records.len())
        .ok_or(STATUS_INVALID_REQUEST)?;
    for record in records.chunks_exact(ENGINE_TEXT_MUTATION_RECORD_SIZE as usize) {
        if record[ENGINE_TEXT_MUTATION_OPCODE] != TEXT_MUTATION_REPLACE_UTF16
            || record[ENGINE_TEXT_MUTATION_ENCODING] != TEXT_ENCODING_UTF16_LE
            || read_u16(record, ENGINE_TEXT_MUTATION_RESERVED0)? != 0
            || read_u32(record, ENGINE_TEXT_MUTATION_RESERVED1)? != 0
        {
            return Err(STATUS_INVALID_REQUEST);
        }
        let insert_count = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT)?;
        let insert_offset = read_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET)?;
        if insert_count == 0 {
            if insert_offset != 0 {
                return Err(STATUS_INVALID_REQUEST);
            }
            continue;
        }
        let payload = array(request, insert_offset, insert_count, 2, 2)?;
        let payload_start = insert_offset as usize;
        let payload_end = payload_start
            .checked_add(payload.len())
            .ok_or(STATUS_INVALID_REQUEST)?;
        if payload_start < record_end && record_start < payload_end {
            return Err(STATUS_INVALID_REQUEST);
        }
    }
    Ok(TextMutationBatch { request, records })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        abi_contract::{
            ENGINE_TEXT_MUTATION_DELETE_COUNT, ENGINE_TEXT_MUTATION_ENCODING,
            ENGINE_TEXT_MUTATION_INSERT_COUNT, ENGINE_TEXT_MUTATION_INSERT_OFFSET,
            ENGINE_TEXT_MUTATION_OPCODE, ENGINE_TEXT_MUTATION_TEXT_START,
        },
        wire::write_u32,
    };
    use alloc::vec;

    #[test]
    fn validates_and_borrows_utf16_replacements_without_decoding_objects() {
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let payload_offset = record_offset + ENGINE_TEXT_MUTATION_RECORD_SIZE;
        let mut bytes = vec![0; payload_offset as usize + 4];
        let record = &mut bytes[record_offset as usize..payload_offset as usize];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_TEXT_START, 2);
        write_u32(record, ENGINE_TEXT_MUTATION_DELETE_COUNT, 1);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, payload_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 2);
        bytes[payload_offset as usize..payload_offset as usize + 2]
            .copy_from_slice(&0x0061_u16.to_le_bytes());
        bytes[payload_offset as usize + 2..payload_offset as usize + 4]
            .copy_from_slice(&0xd83d_u16.to_le_bytes());

        let batch = parse_text_mutations(&bytes, record_offset, 1).unwrap();
        assert_eq!(batch.len(), 1);
        assert_eq!(
            batch.get(0),
            Some(TextMutation {
                text_start: 2,
                delete_count: 1,
                insert_utf16_le: &[0x61, 0x00, 0x3d, 0xd8],
            })
        );
    }

    #[test]
    fn rejects_noncanonical_empty_and_overlapping_payloads() {
        assert!(parse_text_mutations(&[], 4, 0).is_err());
        let record_offset = ENGINE_UPDATE_REQUEST_HEADER_SIZE;
        let mut bytes = vec![0; record_offset as usize + ENGINE_TEXT_MUTATION_RECORD_SIZE as usize];
        let record = &mut bytes[record_offset as usize..];
        record[ENGINE_TEXT_MUTATION_OPCODE] = TEXT_MUTATION_REPLACE_UTF16;
        record[ENGINE_TEXT_MUTATION_ENCODING] = TEXT_ENCODING_UTF16_LE;
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_OFFSET, record_offset);
        write_u32(record, ENGINE_TEXT_MUTATION_INSERT_COUNT, 1);
        assert!(parse_text_mutations(&bytes, record_offset, 1).is_err());
    }
}
