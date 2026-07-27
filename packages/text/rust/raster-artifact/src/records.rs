use std::vec::Vec;

use crate::{RasterArtifactError, zeroed_bytes};

pub const GLYPH_RECORD_STRIDE: usize = 20;
pub const ABSENT_PAGE: u16 = 0xffff;

pub struct GlyphRecordTable {
    bytes: Vec<u8>,
    glyph_count: u16,
}

impl GlyphRecordTable {
    pub fn new(glyph_count: u16) -> Result<Self, RasterArtifactError> {
        let byte_length = usize::from(glyph_count)
            .checked_mul(GLYPH_RECORD_STRIDE)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        Ok(Self {
            bytes: zeroed_bytes(byte_length)?,
            glyph_count,
        })
    }

    pub fn mark_absent(&mut self, glyph_id: u16) -> Result<(), RasterArtifactError> {
        let offset = self.record_offset(glyph_id)?;
        write_u16(&mut self.bytes, offset + 16, ABSENT_PAGE);
        Ok(())
    }

    pub fn write(
        &mut self,
        glyph_id: u16,
        plane_bounds: [i16; 4],
        atlas_bounds: [u16; 4],
        page: u16,
    ) -> Result<(), RasterArtifactError> {
        if page == ABSENT_PAGE {
            return Err(RasterArtifactError::ArithmeticOverflow);
        }
        let offset = self.record_offset(glyph_id)?;
        for (index, value) in plane_bounds.into_iter().enumerate() {
            write_i16(&mut self.bytes, offset + index * 2, value);
        }
        for (index, value) in atlas_bounds.into_iter().enumerate() {
            write_u16(&mut self.bytes, offset + 8 + index * 2, value);
        }
        write_u16(&mut self.bytes, offset + 16, page);
        Ok(())
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn into_bytes(self) -> Vec<u8> {
        self.bytes
    }

    fn record_offset(&self, glyph_id: u16) -> Result<usize, RasterArtifactError> {
        if glyph_id >= self.glyph_count {
            return Err(RasterArtifactError::ArithmeticOverflow);
        }
        Ok(usize::from(glyph_id) * GLYPH_RECORD_STRIDE)
    }
}

fn write_i16(output: &mut [u8], offset: usize, value: i16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u16(output: &mut [u8], offset: usize, value: u16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_canonical_dense_record() {
        let mut records = GlyphRecordTable::new(2).expect("records");
        records
            .write(0, [-1, -2, 3, 4], [5, 6, 7, 8], 9)
            .expect("record");
        records.mark_absent(1).expect("absent");
        let bytes = records.as_bytes();
        assert_eq!(bytes.len(), 40);
        assert_eq!(&bytes[0..2], &(-1_i16).to_le_bytes());
        assert_eq!(&bytes[16..18], &9_u16.to_le_bytes());
        assert_eq!(&bytes[36..38], &ABSENT_PAGE.to_le_bytes());
    }
}
