use core::cmp;
use std::vec::Vec;

use crate::{RasterArtifactError, zeroed_bytes};

pub struct AtlasPage {
    limit: u16,
    bytes_per_texel: u8,
    texels: Vec<u8>,
    cursor_x: u16,
    cursor_y: u16,
    row_height: u16,
    used_width: u16,
    used_height: u16,
}

pub struct RasterizedPage {
    pub width: u16,
    pub height: u16,
    pub texels: Vec<u8>,
}

impl AtlasPage {
    pub fn new(limit: u16, bytes_per_texel: u8) -> Result<Self, RasterArtifactError> {
        if limit == 0 || bytes_per_texel == 0 {
            return Err(RasterArtifactError::InvalidTexture);
        }
        let byte_length = usize::from(limit)
            .checked_mul(usize::from(limit))
            .and_then(|value| value.checked_mul(usize::from(bytes_per_texel)))
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        Ok(Self {
            limit,
            bytes_per_texel,
            texels: zeroed_bytes(byte_length)?,
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            used_width: 0,
            used_height: 0,
        })
    }

    pub fn place(
        &mut self,
        width: u16,
        height: u16,
        texels: &[u8],
        padding: u16,
    ) -> Result<Option<[u16; 4]>, RasterArtifactError> {
        let expected = usize::from(width)
            .checked_mul(usize::from(height))
            .and_then(|value| value.checked_mul(usize::from(self.bytes_per_texel)))
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        if width == 0 || height == 0 || texels.len() != expected {
            return Err(RasterArtifactError::InvalidTexture);
        }
        let double_padding = padding
            .checked_mul(2)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        let padded_width = width
            .checked_add(double_padding)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        let padded_height = height
            .checked_add(double_padding)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        if padded_width > self.limit || padded_height > self.limit {
            return Ok(None);
        }
        if self
            .cursor_x
            .checked_add(padded_width)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?
            > self.limit
        {
            self.cursor_x = 0;
            self.cursor_y = self
                .cursor_y
                .checked_add(self.row_height)
                .ok_or(RasterArtifactError::ArithmeticOverflow)?;
            self.row_height = 0;
        }
        if self
            .cursor_y
            .checked_add(padded_height)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?
            > self.limit
        {
            return Ok(None);
        }

        let left = self.cursor_x + padding;
        let top = self.cursor_y + padding;
        let right = left + width;
        let bottom = top + height;
        let bytes_per_texel = usize::from(self.bytes_per_texel);
        let source_row_bytes = usize::from(width) * bytes_per_texel;
        for row in 0..height {
            let source = usize::from(row) * source_row_bytes;
            let destination = (usize::from(top + row) * usize::from(self.limit)
                + usize::from(left))
                * bytes_per_texel;
            self.texels[destination..destination + source_row_bytes]
                .copy_from_slice(&texels[source..source + source_row_bytes]);
        }
        self.cursor_x += padded_width;
        self.row_height = cmp::max(self.row_height, padded_height);
        self.used_width = cmp::max(self.used_width, self.cursor_x);
        self.used_height = cmp::max(self.used_height, self.cursor_y + padded_height);
        Ok(Some([left, top, right, bottom]))
    }

    pub fn finish(self) -> Result<RasterizedPage, RasterArtifactError> {
        let width = cmp::max(self.used_width, 1);
        let height = cmp::max(self.used_height, 1);
        let bytes_per_texel = usize::from(self.bytes_per_texel);
        let byte_length = usize::from(width)
            .checked_mul(usize::from(height))
            .and_then(|value| value.checked_mul(bytes_per_texel))
            .ok_or(RasterArtifactError::ArithmeticOverflow)?;
        let mut texels = zeroed_bytes(byte_length)?;
        let row_bytes = usize::from(width) * bytes_per_texel;
        for row in 0..height {
            let source = usize::from(row) * usize::from(self.limit) * bytes_per_texel;
            let destination = usize::from(row) * row_bytes;
            texels[destination..destination + row_bytes]
                .copy_from_slice(&self.texels[source..source + row_bytes]);
        }
        Ok(RasterizedPage {
            width,
            height,
            texels,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preserves_padding_and_row_major_texels() {
        let mut page = AtlasPage::new(8, 4).expect("page");
        let bounds = page
            .place(2, 1, &[1, 2, 3, 4, 5, 6, 7, 8], 1)
            .expect("place")
            .expect("fits");
        assert_eq!(bounds, [1, 1, 3, 2]);
        let page = page.finish().expect("finish");
        assert_eq!((page.width, page.height), (4, 3));
        let offset = (usize::from(page.width) + 1) * 4;
        assert_eq!(&page.texels[offset..offset + 8], &[1, 2, 3, 4, 5, 6, 7, 8]);
    }
}
