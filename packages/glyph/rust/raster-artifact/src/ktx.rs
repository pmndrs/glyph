use std::vec::Vec;

use crate::{RasterArtifactError, zeroed_bytes};

const MAGIC: [u8; 12] = [
    0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
];
const HEADER_LENGTH: usize = 80;
const LEVEL_INDEX_LENGTH: usize = 24;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum KtxFormat {
    R8Unorm,
    Rgba8Unorm,
    Rgba16Sfloat,
}

impl KtxFormat {
    fn vk_format(self) -> u32 {
        match self {
            Self::R8Unorm => 9,
            Self::Rgba8Unorm => 37,
            Self::Rgba16Sfloat => 97,
        }
    }

    fn bytes_per_texel(self) -> usize {
        match self {
            Self::R8Unorm => 1,
            Self::Rgba8Unorm => 4,
            Self::Rgba16Sfloat => 8,
        }
    }

    fn dfd(self) -> &'static [u8] {
        match self {
            Self::R8Unorm => include_bytes!(concat!(env!("OUT_DIR"), "/r8-dfd.bin")),
            Self::Rgba8Unorm => include_bytes!(concat!(env!("OUT_DIR"), "/rgba8-dfd.bin")),
            Self::Rgba16Sfloat => include_bytes!(concat!(env!("OUT_DIR"), "/rgba16f-dfd.bin")),
        }
    }

    fn type_size(self) -> u32 {
        match self {
            Self::R8Unorm | Self::Rgba8Unorm => 1,
            Self::Rgba16Sfloat => 2,
        }
    }
}

pub fn encode_ktx2(
    format: KtxFormat,
    width: u16,
    height: u16,
    texels: &[u8],
) -> Result<Vec<u8>, RasterArtifactError> {
    let expected = usize::from(width)
        .checked_mul(usize::from(height))
        .and_then(|value| value.checked_mul(format.bytes_per_texel()))
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    if width == 0 || height == 0 || texels.len() != expected {
        return Err(RasterArtifactError::InvalidTexture);
    }

    let dfd = format.dfd();
    let dfd_length = 4_usize
        .checked_add(dfd.len())
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    let dfd_offset = HEADER_LENGTH
        .checked_add(LEVEL_INDEX_LENGTH)
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    let level_offset = align4(
        dfd_offset
            .checked_add(dfd_length)
            .ok_or(RasterArtifactError::ArithmeticOverflow)?,
    );
    let total = level_offset
        .checked_add(texels.len())
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    let mut bytes = zeroed_bytes(total)?;

    bytes[..MAGIC.len()].copy_from_slice(&MAGIC);
    write_u32(&mut bytes, 12, format.vk_format());
    write_u32(&mut bytes, 16, format.type_size());
    write_u32(&mut bytes, 20, u32::from(width));
    write_u32(&mut bytes, 24, u32::from(height));
    write_u32(&mut bytes, 36, 1);
    write_u32(&mut bytes, 40, 1);
    write_u32(
        &mut bytes,
        48,
        u32::try_from(dfd_offset).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    write_u32(
        &mut bytes,
        52,
        u32::try_from(dfd_length).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    write_u64(
        &mut bytes,
        HEADER_LENGTH,
        u64::try_from(level_offset).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    write_u64(
        &mut bytes,
        HEADER_LENGTH + 8,
        u64::try_from(texels.len()).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    write_u64(
        &mut bytes,
        HEADER_LENGTH + 16,
        u64::try_from(texels.len()).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    write_u32(
        &mut bytes,
        dfd_offset,
        u32::try_from(dfd_length).map_err(|_| RasterArtifactError::ArithmeticOverflow)?,
    );
    bytes[dfd_offset + 4..dfd_offset + dfd_length].copy_from_slice(dfd);
    bytes[level_offset..].copy_from_slice(texels);

    #[cfg(feature = "std")]
    validate(&bytes, format, width, height)?;
    Ok(bytes)
}

#[cfg(feature = "std")]
fn validate(
    bytes: &[u8],
    format: KtxFormat,
    expected_width: u16,
    expected_height: u16,
) -> Result<(), RasterArtifactError> {
    let reader = ktx2::Reader::new(bytes).map_err(|_| RasterArtifactError::Serialization)?;
    let header = reader.header();
    let expected_format = match format {
        KtxFormat::R8Unorm => ktx2::Format::R8_UNORM,
        KtxFormat::Rgba8Unorm => ktx2::Format::R8G8B8A8_UNORM,
        KtxFormat::Rgba16Sfloat => ktx2::Format::R16G16B16A16_SFLOAT,
    };
    if header.format != Some(expected_format)
        || header.type_size != format.type_size()
        || header.pixel_width != u32::from(expected_width)
        || header.pixel_height != u32::from(expected_height)
        || header.pixel_depth != 0
        || header.layer_count != 0
        || header.face_count != 1
        || header.level_count != 1
        || header.supercompression_scheme.is_some()
    {
        return Err(RasterArtifactError::Serialization);
    }
    let mut levels = reader.levels();
    let level = levels.next().ok_or(RasterArtifactError::Serialization)?;
    let expected = usize::from(expected_width)
        .checked_mul(usize::from(expected_height))
        .and_then(|value| value.checked_mul(format.bytes_per_texel()))
        .ok_or(RasterArtifactError::ArithmeticOverflow)?;
    if level.data.len() != expected
        || level.uncompressed_byte_length != expected as u64
        || levels.next().is_some()
    {
        return Err(RasterArtifactError::Serialization);
    }
    Ok(())
}

fn write_u32(output: &mut [u8], offset: usize, value: u32) {
    output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64(output: &mut [u8], offset: usize, value: u64) {
    output[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn align4(value: usize) -> usize {
    (value + 3) & !3
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn emits_lossless_native_formats() {
        let r8 = encode_ktx2(KtxFormat::R8Unorm, 2, 1, &[1, 2]).expect("R8");
        let rgba =
            encode_ktx2(KtxFormat::Rgba8Unorm, 2, 1, &[1, 2, 3, 4, 5, 6, 7, 8]).expect("RGBA8");
        let rgba16 = encode_ktx2(KtxFormat::Rgba16Sfloat, 1, 1, &[0; 8]).expect("RGBA16F");
        assert_eq!(u32::from_le_bytes(r8[12..16].try_into().unwrap()), 9);
        assert_eq!(u32::from_le_bytes(rgba[12..16].try_into().unwrap()), 37);
        assert_eq!(u32::from_le_bytes(rgba16[12..16].try_into().unwrap()), 97);
        assert_eq!(u32::from_le_bytes(rgba16[16..20].try_into().unwrap()), 2);
    }
}
