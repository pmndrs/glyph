use crate::STATUS_INVALID_REQUEST;

pub(crate) fn array(
    bytes: &[u8],
    offset: u32,
    count: u32,
    stride: u32,
    alignment: u32,
) -> Result<&[u8], u32> {
    if !offset.is_multiple_of(alignment) {
        return Err(STATUS_INVALID_REQUEST);
    }
    let offset = usize::try_from(offset).map_err(|_| STATUS_INVALID_REQUEST)?;
    let length = count.checked_mul(stride).ok_or(STATUS_INVALID_REQUEST)?;
    let length = usize::try_from(length).map_err(|_| STATUS_INVALID_REQUEST)?;
    let end = offset.checked_add(length).ok_or(STATUS_INVALID_REQUEST)?;
    bytes.get(offset..end).ok_or(STATUS_INVALID_REQUEST)
}

pub(crate) fn read_u16(bytes: &[u8], offset: usize) -> Result<u16, u32> {
    let value = bytes
        .get(offset..offset.checked_add(2).ok_or(STATUS_INVALID_REQUEST)?)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok(u16::from_le_bytes([value[0], value[1]]))
}

pub(crate) fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, u32> {
    let value = bytes
        .get(offset..offset.checked_add(4).ok_or(STATUS_INVALID_REQUEST)?)
        .ok_or(STATUS_INVALID_REQUEST)?;
    Ok(u32::from_le_bytes([value[0], value[1], value[2], value[3]]))
}

pub(crate) fn read_f32(bytes: &[u8], offset: usize) -> Result<f32, u32> {
    Ok(f32::from_bits(read_u32(bytes, offset)?))
}

pub(crate) fn write_u32(bytes: &mut [u8], offset: usize, value: u32) {
    bytes[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}
