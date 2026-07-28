//! Exact serialization of Slug V0 curve, header, reference, and glyph data.

use alloc::vec::Vec;

use crate::{Band, GlyphGeometry, Point};

pub const ABSENT_PAGE: u16 = 0xffff;
pub const DEFAULT_CURVE_WIDTH: u16 = 4096;
pub const DEFAULT_PAGE_CURVE_ROWS: u16 = 2048;
pub const SLUG_GLYPH_RECORD_STRIDE: usize = 40;
const HALF_FLOAT_MAX: f32 = 65_504.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PackerConfig {
    pub curve_width: u16,
    pub page_curve_rows: u16,
    pub header_width: u16,
    pub reference_width: u16,
}

impl Default for PackerConfig {
    fn default() -> Self {
        Self {
            curve_width: DEFAULT_CURVE_WIDTH,
            page_curve_rows: DEFAULT_PAGE_CURVE_ROWS,
            header_width: DEFAULT_CURVE_WIDTH,
            reference_width: DEFAULT_CURVE_WIDTH,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum GlyphForPacking<'a> {
    Missing,
    Present {
        plane_bounds: [i16; 4],
        geometry: &'a GlyphGeometry,
    },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PackError {
    Allocation,
    ArithmeticOverflow,
    CoordinateOutOfRange,
    InvalidConfiguration,
    InvalidContour,
    InvalidCurveReference,
    GlyphTooLarge,
    TooManyPages,
    U16Overflow,
    U32Overflow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(C)]
pub struct SlugGlyphRecord {
    pub plane_left: i16,
    pub plane_bottom: i16,
    pub plane_right: i16,
    pub plane_top: i16,
    pub page: u16,
    pub horizontal_band_count: u16,
    pub vertical_band_count: u16,
    pub flags: u16,
    pub curve_base_texel: u32,
    pub curve_span_texels: u32,
    pub horizontal_header_base: u32,
    pub vertical_header_base: u32,
    pub curve_reference_base: u32,
    pub curve_reference_count: u32,
}

impl SlugGlyphRecord {
    pub const ABSENT: Self = Self {
        plane_left: 0,
        plane_bottom: 0,
        plane_right: 0,
        plane_top: 0,
        page: ABSENT_PAGE,
        horizontal_band_count: 0,
        vertical_band_count: 0,
        flags: 0,
        curve_base_texel: 0,
        curve_span_texels: 0,
        horizontal_header_base: 0,
        vertical_header_base: 0,
        curve_reference_base: 0,
        curve_reference_count: 0,
    };

    fn write_le(self, output: &mut [u8]) {
        write_i16(output, 0, self.plane_left);
        write_i16(output, 2, self.plane_bottom);
        write_i16(output, 4, self.plane_right);
        write_i16(output, 6, self.plane_top);
        write_u16(output, 8, self.page);
        write_u16(output, 10, self.horizontal_band_count);
        write_u16(output, 12, self.vertical_band_count);
        write_u16(output, 14, self.flags);
        write_u32(output, 16, self.curve_base_texel);
        write_u32(output, 20, self.curve_span_texels);
        write_u32(output, 24, self.horizontal_header_base);
        write_u32(output, 28, self.vertical_header_base);
        write_u32(output, 32, self.curve_reference_base);
        write_u32(output, 36, self.curve_reference_count);
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SlugPageMetadata {
    pub curve_width: u16,
    pub curve_height: u16,
    pub header_count: u32,
    pub header_width: u16,
    pub header_height: u16,
    pub reference_count: u32,
    pub reference_width: u16,
    pub reference_height: u16,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SlugPage {
    pub metadata: SlugPageMetadata,
    /// RGBA16F texels in little-endian channel order.
    pub curve_bytes: Vec<u8>,
    /// R32UI texels in little-endian order, including zero grid padding.
    pub header_bytes: Vec<u8>,
    /// R16UI V0 or experimental packed-hull R32UI texels in little-endian
    /// order, including zero grid padding.
    pub reference_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PackedSlug {
    pub records: Vec<SlugGlyphRecord>,
    pub record_bytes: Vec<u8>,
    pub pages: Vec<SlugPage>,
}

struct BandPlan {
    offsets: Vec<u16>,
    emit: Vec<bool>,
    reference_count: usize,
}

/// Pack dense font-local glyph slots into glyph-safe Slug V0 pages.
pub fn pack_glyphs(
    glyphs: &[GlyphForPacking<'_>],
    config: PackerConfig,
) -> Result<PackedSlug, PackError> {
    validate_config(config)?;
    let mut records = Vec::new();
    records
        .try_reserve_exact(glyphs.len())
        .map_err(|_| PackError::Allocation)?;
    records.resize(glyphs.len(), SlugGlyphRecord::ABSENT);

    let mut groups = Vec::<Vec<usize>>::new();
    groups
        .try_reserve(glyphs.len().min(16))
        .map_err(|_| PackError::Allocation)?;
    let mut current = Vec::new();
    current
        .try_reserve(glyphs.len())
        .map_err(|_| PackError::Allocation)?;
    let mut current_texels = 0_usize;
    let page_capacity = usize::from(config.curve_width)
        .checked_mul(usize::from(config.page_curve_rows))
        .ok_or(PackError::ArithmeticOverflow)?;

    for (glyph_index, glyph) in glyphs.iter().enumerate() {
        let GlyphForPacking::Present { geometry, .. } = glyph else {
            continue;
        };
        let estimate = estimate_curve_texels(geometry)?;
        if estimate > page_capacity {
            return Err(PackError::GlyphTooLarge);
        }
        let next = current_texels
            .checked_add(estimate)
            .ok_or(PackError::ArithmeticOverflow)?;
        if !current.is_empty() && next > page_capacity {
            groups.try_reserve(1).map_err(|_| PackError::Allocation)?;
            groups.push(current);
            current = Vec::new();
            current
                .try_reserve(glyphs.len().saturating_sub(glyph_index))
                .map_err(|_| PackError::Allocation)?;
            current_texels = 0;
        }
        current.try_reserve(1).map_err(|_| PackError::Allocation)?;
        current.push(glyph_index);
        current_texels = current_texels
            .checked_add(estimate)
            .ok_or(PackError::ArithmeticOverflow)?;
    }
    if !current.is_empty() || groups.is_empty() {
        groups.try_reserve(1).map_err(|_| PackError::Allocation)?;
        groups.push(current);
    }
    if groups.len() >= usize::from(ABSENT_PAGE) {
        return Err(PackError::TooManyPages);
    }

    let mut pages = Vec::new();
    pages
        .try_reserve_exact(groups.len())
        .map_err(|_| PackError::Allocation)?;
    for (page_index, group) in groups.iter().enumerate() {
        pages.push(pack_page(
            glyphs,
            group,
            u16::try_from(page_index).map_err(|_| PackError::TooManyPages)?,
            config,
            &mut records,
        )?);
    }

    let record_byte_len = records
        .len()
        .checked_mul(SLUG_GLYPH_RECORD_STRIDE)
        .ok_or(PackError::ArithmeticOverflow)?;
    let mut record_bytes = zeroed_bytes(record_byte_len)?;
    for (index, record) in records.iter().copied().enumerate() {
        let offset = index * SLUG_GLYPH_RECORD_STRIDE;
        record.write_le(&mut record_bytes[offset..offset + SLUG_GLYPH_RECORD_STRIDE]);
    }
    Ok(PackedSlug {
        records,
        record_bytes,
        pages,
    })
}

fn validate_config(config: PackerConfig) -> Result<(), PackError> {
    if config.curve_width < 2
        || config.page_curve_rows == 0
        || config.header_width == 0
        || config.reference_width == 0
        || !config.page_curve_rows.is_power_of_two()
    {
        return Err(PackError::InvalidConfiguration);
    }
    Ok(())
}

fn estimate_curve_texels(glyph: &GlyphGeometry) -> Result<usize, PackError> {
    validate_contours(glyph)?;
    glyph
        .curves
        .len()
        .checked_mul(2)
        .and_then(|value| value.checked_add(glyph.contour_starts.len()))
        .ok_or(PackError::ArithmeticOverflow)
}

fn validate_contours(glyph: &GlyphGeometry) -> Result<(), PackError> {
    if glyph.curves.is_empty() || glyph.contour_starts.first().copied() != Some(0) {
        return Err(PackError::InvalidContour);
    }
    let mut previous = None;
    for start in &glyph.contour_starts {
        let start = usize::from(*start);
        if start >= glyph.curves.len() || previous.is_some_and(|value| start <= value) {
            return Err(PackError::InvalidContour);
        }
        previous = Some(start);
    }
    Ok(())
}

fn pack_page(
    glyphs: &[GlyphForPacking<'_>],
    group: &[usize],
    page_index: u16,
    config: PackerConfig,
    records: &mut [SlugGlyphRecord],
) -> Result<SlugPage, PackError> {
    let mut plans = Vec::new();
    plans
        .try_reserve_exact(group.len())
        .map_err(|_| PackError::Allocation)?;
    let mut estimated_curve_texels = 0_usize;
    let mut header_count = 0_usize;
    let mut reference_count = 0_usize;
    for glyph_index in group {
        let GlyphForPacking::Present { geometry, .. } = glyphs[*glyph_index] else {
            return Err(PackError::InvalidContour);
        };
        estimated_curve_texels = estimated_curve_texels
            .checked_add(estimate_curve_texels(geometry)?)
            .ok_or(PackError::ArithmeticOverflow)?;
        header_count = header_count
            .checked_add(geometry.bands.horizontal.len())
            .and_then(|value| value.checked_add(geometry.bands.vertical.len()))
            .ok_or(PackError::ArithmeticOverflow)?;
        let plan = plan_bands(geometry)?;
        reference_count = reference_count
            .checked_add(plan.reference_count)
            .ok_or(PackError::ArithmeticOverflow)?;
        plans.push(plan);
    }

    let used_curve_rows = div_ceil(
        estimated_curve_texels.max(1),
        usize::from(config.curve_width),
    )?;
    let curve_height = used_curve_rows
        .checked_next_power_of_two()
        .ok_or(PackError::ArithmeticOverflow)?;
    if curve_height > usize::from(config.page_curve_rows) {
        return Err(PackError::GlyphTooLarge);
    }
    let curve_texels = usize::from(config.curve_width)
        .checked_mul(curve_height)
        .ok_or(PackError::ArithmeticOverflow)?;
    let curve_byte_len = curve_texels
        .checked_mul(8)
        .ok_or(PackError::ArithmeticOverflow)?;
    let mut curve_bytes = zeroed_bytes(curve_byte_len)?;

    let (header_width, header_height, header_capacity) = grid(header_count, config.header_width)?;
    let (reference_width, reference_height, reference_capacity) =
        grid(reference_count, config.reference_width)?;
    let mut headers = zeroed_u32(header_capacity)?;
    #[cfg(feature = "autoresearch-hull-bands")]
    let mut references = zeroed_u32(reference_capacity)?;
    #[cfg(not(feature = "autoresearch-hull-bands"))]
    let mut references = zeroed_u16(reference_capacity)?;
    let mut curve_cursor = 0_usize;
    let mut header_cursor = 0_usize;
    let mut reference_cursor = 0_usize;

    for (group_index, glyph_index) in group.iter().copied().enumerate() {
        let GlyphForPacking::Present {
            plane_bounds,
            geometry,
        } = glyphs[glyph_index]
        else {
            return Err(PackError::InvalidContour);
        };
        let curve_base = curve_cursor;
        let curve_map = write_curves(
            geometry,
            config.curve_width,
            &mut curve_cursor,
            &mut curve_bytes,
        )?;
        let curve_span = curve_cursor
            .checked_sub(curve_base)
            .ok_or(PackError::ArithmeticOverflow)?;
        if curve_span > usize::from(u16::MAX) {
            return Err(PackError::U16Overflow);
        }

        let plan = &plans[group_index];
        let horizontal_header_base = header_cursor;
        let horizontal_count = geometry.bands.horizontal.len();
        let vertical_header_base = horizontal_header_base
            .checked_add(horizontal_count)
            .ok_or(PackError::ArithmeticOverflow)?;
        for band_index in 0..plan.offsets.len() {
            let band = flattened_band(geometry, band_index);
            let count =
                u16::try_from(band.curve_indices.len()).map_err(|_| PackError::U16Overflow)?;
            headers[header_cursor] = (u32::from(count) << 16) | u32::from(plan.offsets[band_index]);
            header_cursor += 1;
        }

        let glyph_reference_base = reference_cursor;
        for band_index in 0..plan.emit.len() {
            if !plan.emit[band_index] {
                continue;
            }
            for curve_index in &flattened_band(geometry, band_index).curve_indices {
                let local = curve_map
                    .get(usize::from(*curve_index))
                    .copied()
                    .ok_or(PackError::InvalidCurveReference)?;
                #[cfg(feature = "autoresearch-hull-bands")]
                {
                    let axis = band_axis(geometry, band_index);
                    references[reference_cursor] = pack_hull_reference(
                        local,
                        curve_base,
                        axis,
                        &curve_bytes,
                    )?;
                }
                #[cfg(not(feature = "autoresearch-hull-bands"))]
                {
                    references[reference_cursor] = local;
                }
                reference_cursor += 1;
            }
        }
        let glyph_reference_count = reference_cursor
            .checked_sub(glyph_reference_base)
            .ok_or(PackError::ArithmeticOverflow)?;
        records[glyph_index] = SlugGlyphRecord {
            plane_left: plane_bounds[0],
            plane_bottom: plane_bounds[1],
            plane_right: plane_bounds[2],
            plane_top: plane_bounds[3],
            page: page_index,
            horizontal_band_count: u16::try_from(horizontal_count)
                .map_err(|_| PackError::U16Overflow)?,
            vertical_band_count: u16::try_from(geometry.bands.vertical.len())
                .map_err(|_| PackError::U16Overflow)?,
            flags: 0,
            curve_base_texel: to_u32(curve_base)?,
            curve_span_texels: to_u32(curve_span)?,
            horizontal_header_base: to_u32(horizontal_header_base)?,
            vertical_header_base: to_u32(vertical_header_base)?,
            curve_reference_base: to_u32(glyph_reference_base)?,
            curve_reference_count: to_u32(glyph_reference_count)?,
        };
    }
    debug_assert_eq!(header_cursor, header_count);
    debug_assert_eq!(reference_cursor, reference_count);

    Ok(SlugPage {
        metadata: SlugPageMetadata {
            curve_width: config.curve_width,
            curve_height: u16::try_from(curve_height).map_err(|_| PackError::U16Overflow)?,
            header_count: to_u32(header_count)?,
            header_width,
            header_height,
            reference_count: to_u32(reference_count)?,
            reference_width,
            reference_height,
        },
        curve_bytes,
        header_bytes: u32_bytes(&headers)?,
        #[cfg(feature = "autoresearch-hull-bands")]
        reference_bytes: u32_bytes(&references)?,
        #[cfg(not(feature = "autoresearch-hull-bands"))]
        reference_bytes: u16_bytes(&references)?,
    })
}

fn plan_bands(glyph: &GlyphGeometry) -> Result<BandPlan, PackError> {
    let band_count = glyph
        .bands
        .horizontal
        .len()
        .checked_add(glyph.bands.vertical.len())
        .ok_or(PackError::ArithmeticOverflow)?;
    if glyph.bands.horizontal.len() > usize::from(u16::MAX)
        || glyph.bands.vertical.len() > usize::from(u16::MAX)
    {
        return Err(PackError::U16Overflow);
    }
    let mut offsets = Vec::new();
    offsets
        .try_reserve_exact(band_count)
        .map_err(|_| PackError::Allocation)?;
    let mut emit = Vec::new();
    emit.try_reserve_exact(band_count)
        .map_err(|_| PackError::Allocation)?;
    let mut cursor = 0_usize;
    for band_index in 0..band_count {
        let band = flattened_band(glyph, band_index);
        if band.curve_indices.len() > usize::from(u16::MAX) {
            return Err(PackError::U16Overflow);
        }
        #[cfg(feature = "autoresearch-hull-bands")]
        let shared = (0..band_index).find(|prior| {
            flattened_band(glyph, *prior).curve_indices == band.curve_indices
                && band_axis(glyph, *prior) == band_axis(glyph, band_index)
        });
        #[cfg(not(feature = "autoresearch-hull-bands"))]
        let shared = (0..band_index)
            .find(|prior| flattened_band(glyph, *prior).curve_indices == band.curve_indices);
        if let Some(prior) = shared {
            offsets.push(offsets[prior]);
            emit.push(false);
            continue;
        }
        let offset = u16::try_from(cursor).map_err(|_| PackError::U16Overflow)?;
        offsets.push(offset);
        emit.push(true);
        cursor = cursor
            .checked_add(band.curve_indices.len())
            .ok_or(PackError::ArithmeticOverflow)?;
    }
    Ok(BandPlan {
        offsets,
        emit,
        reference_count: cursor,
    })
}

#[cfg(feature = "autoresearch-hull-bands")]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum BandAxis {
    Horizontal,
    Vertical,
}

#[cfg(feature = "autoresearch-hull-bands")]
fn band_axis(glyph: &GlyphGeometry, index: usize) -> BandAxis {
    if index < glyph.bands.horizontal.len() {
        BandAxis::Horizontal
    } else {
        BandAxis::Vertical
    }
}

/// Pack one experimental R32UI reference from curve texels already written in
/// RGBA16F form. Its lower half is the glyph-local curve texel; its upper half
/// is the axis maximum after decoding precisely those binary16 coordinates.
#[cfg(feature = "autoresearch-hull-bands")]
fn pack_hull_reference(
    local_curve_texel: u16,
    glyph_curve_base: usize,
    axis: BandAxis,
    curve_bytes: &[u8],
) -> Result<u32, PackError> {
    let first_texel = glyph_curve_base
        .checked_add(usize::from(local_curve_texel))
        .ok_or(PackError::ArithmeticOverflow)?;
    let channels = match axis {
        BandAxis::Horizontal => [0, 2, 0],
        BandAxis::Vertical => [1, 3, 1],
    };
    let first = half_channel_bits(curve_bytes, first_texel, channels[0])?;
    let control = half_channel_bits(curve_bytes, first_texel, channels[1])?;
    let end_texel = first_texel
        .checked_add(1)
        .ok_or(PackError::ArithmeticOverflow)?;
    let end = half_channel_bits(curve_bytes, end_texel, channels[2])?;
    let hull = half_max_bits(first, control, end);
    Ok((u32::from(hull) << 16) | u32::from(local_curve_texel))
}

#[cfg(feature = "autoresearch-hull-bands")]
fn half_channel_bits(curve_bytes: &[u8], texel: usize, channel: usize) -> Result<u16, PackError> {
    let texel_offset = texel.checked_mul(8).ok_or(PackError::ArithmeticOverflow)?;
    let channel_offset = channel.checked_mul(2).ok_or(PackError::ArithmeticOverflow)?;
    let offset = texel_offset
        .checked_add(channel_offset)
        .ok_or(PackError::ArithmeticOverflow)?;
    let bytes = curve_bytes
        .get(offset..offset + 2)
        .ok_or(PackError::ArithmeticOverflow)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

#[cfg(feature = "autoresearch-hull-bands")]
fn half_max_bits(first: u16, control: u16, end: u16) -> u16 {
    half_max_pair(half_max_pair(first, control), end)
}

#[cfg(feature = "autoresearch-hull-bands")]
fn half_max_pair(left: u16, right: u16) -> u16 {
    let left_value = f16_bits_to_f32(left);
    let right_value = f16_bits_to_f32(right);
    if right_value > left_value {
        return right;
    }
    if left_value > right_value {
        return left;
    }
    // A binary16 coordinate has one representation for every finite non-zero
    // value. Preserve that exact payload; for zero, match maximumNumber's
    // outward-facing +0 result when either input is +0.
    if left_value == 0.0 && (left == 0 || right == 0) {
        return 0;
    }
    left
}

fn flattened_band(glyph: &GlyphGeometry, index: usize) -> &Band {
    glyph
        .bands
        .horizontal
        .get(index)
        .unwrap_or_else(|| &glyph.bands.vertical[index - glyph.bands.horizontal.len()])
}

fn write_curves(
    glyph: &GlyphGeometry,
    width: u16,
    cursor: &mut usize,
    output: &mut [u8],
) -> Result<Vec<u16>, PackError> {
    let glyph_base = *cursor;
    let mut map = Vec::new();
    map.try_reserve_exact(glyph.curves.len())
        .map_err(|_| PackError::Allocation)?;
    map.resize(glyph.curves.len(), 0);
    for (contour_index, contour_start) in glyph.contour_starts.iter().enumerate() {
        let start = usize::from(*contour_start);
        let end = glyph
            .contour_starts
            .get(contour_index + 1)
            .map_or(glyph.curves.len(), |value| usize::from(*value));
        for curve_index in start..end {
            if *cursor % usize::from(width) == usize::from(width) - 1 {
                *cursor = cursor.checked_add(1).ok_or(PackError::ArithmeticOverflow)?;
            }
            let local = cursor
                .checked_sub(glyph_base)
                .ok_or(PackError::ArithmeticOverflow)?;
            map[curve_index] = u16::try_from(local).map_err(|_| PackError::U16Overflow)?;
            write_curve_texel(
                output,
                *cursor,
                glyph.curves[curve_index].p0,
                glyph.curves[curve_index].p1,
            )?;
            *cursor = cursor.checked_add(1).ok_or(PackError::ArithmeticOverflow)?;
        }
        let last = glyph.curves.get(end - 1).ok_or(PackError::InvalidContour)?;
        write_endpoint_texel(output, *cursor, last.p2)?;
        *cursor = cursor.checked_add(1).ok_or(PackError::ArithmeticOverflow)?;
    }
    Ok(map)
}

fn write_curve_texel(
    output: &mut [u8],
    texel: usize,
    start: Point,
    control: Point,
) -> Result<(), PackError> {
    let values = [start.x, start.y, control.x, control.y];
    write_half_texel(output, texel, values)
}

fn write_endpoint_texel(output: &mut [u8], texel: usize, end: Point) -> Result<(), PackError> {
    write_half_texel(output, texel, [end.x, end.y, 0.0, 0.0])
}

fn write_half_texel(output: &mut [u8], texel: usize, values: [f32; 4]) -> Result<(), PackError> {
    let offset = texel.checked_mul(8).ok_or(PackError::ArithmeticOverflow)?;
    let target = output
        .get_mut(offset..offset + 8)
        .ok_or(PackError::ArithmeticOverflow)?;
    for (channel, value) in values.into_iter().enumerate() {
        let bits = f32_to_f16_bits(value)?;
        target[channel * 2..channel * 2 + 2].copy_from_slice(&bits.to_le_bytes());
    }
    Ok(())
}

/// Round one coordinate through the exact binary16 representation written to
/// the curve texture. Generator geometry that controls band assignment and
/// early-exit ordering must use these decoded values so the acceleration data
/// describes what the shader actually reads.
pub fn quantize_f16(value: f32) -> Result<f32, PackError> {
    Ok(f16_bits_to_f32(f32_to_f16_bits(value)?))
}

fn f32_to_f16_bits(value: f32) -> Result<u16, PackError> {
    if !value.is_finite() || value.abs() > HALF_FLOAT_MAX {
        return Err(PackError::CoordinateOutOfRange);
    }
    let bits = value.to_bits();
    let sign = ((bits >> 16) & 0x8000) as u16;
    let exponent = ((bits >> 23) & 0xff) as i32 - 127 + 15;
    let mantissa = bits & 0x7f_ffff;
    if exponent <= 0 {
        if exponent < -10 {
            return Ok(sign);
        }
        let normalized = mantissa | 0x80_0000;
        let shift = u32::try_from(14 - exponent).map_err(|_| PackError::ArithmeticOverflow)?;
        let mut half = normalized >> shift;
        let remainder_mask = (1_u32 << shift) - 1;
        let remainder = normalized & remainder_mask;
        let halfway = 1_u32 << (shift - 1);
        if remainder > halfway || (remainder == halfway && half & 1 != 0) {
            half += 1;
        }
        return Ok(sign | u16::try_from(half).map_err(|_| PackError::U16Overflow)?);
    }
    let mut half_exponent = exponent as u32;
    let mut half_mantissa = mantissa >> 13;
    let remainder = mantissa & 0x1fff;
    if remainder > 0x1000 || (remainder == 0x1000 && half_mantissa & 1 != 0) {
        half_mantissa += 1;
        if half_mantissa == 0x400 {
            half_mantissa = 0;
            half_exponent += 1;
        }
    }
    if half_exponent >= 31 {
        return Err(PackError::CoordinateOutOfRange);
    }
    Ok(sign | ((half_exponent as u16) << 10) | half_mantissa as u16)
}

fn f16_bits_to_f32(bits: u16) -> f32 {
    let sign = u32::from(bits & 0x8000) << 16;
    let exponent = u32::from((bits >> 10) & 0x1f);
    let mut mantissa = u32::from(bits & 0x03ff);
    let decoded = if exponent == 0 {
        if mantissa == 0 {
            sign
        } else {
            let mut normalized_exponent = 113_u32;
            while mantissa & 0x0400 == 0 {
                mantissa <<= 1;
                normalized_exponent -= 1;
            }
            sign | (normalized_exponent << 23) | ((mantissa & 0x03ff) << 13)
        }
    } else {
        sign | ((exponent + 112) << 23) | (mantissa << 13)
    };
    f32::from_bits(decoded)
}

fn grid(count: usize, requested_width: u16) -> Result<(u16, u16, usize), PackError> {
    let width = if count == 0 {
        1
    } else {
        usize::from(requested_width).min(count)
    };
    let height = div_ceil(count.max(1), width)?;
    let width = u16::try_from(width).map_err(|_| PackError::U16Overflow)?;
    let height = u16::try_from(height).map_err(|_| PackError::U16Overflow)?;
    let capacity = usize::from(width)
        .checked_mul(usize::from(height))
        .ok_or(PackError::ArithmeticOverflow)?;
    Ok((width, height, capacity))
}

fn div_ceil(value: usize, divisor: usize) -> Result<usize, PackError> {
    value
        .checked_add(divisor - 1)
        .map(|sum| sum / divisor)
        .ok_or(PackError::ArithmeticOverflow)
}

fn to_u32(value: usize) -> Result<u32, PackError> {
    u32::try_from(value).map_err(|_| PackError::U32Overflow)
}

fn zeroed_bytes(length: usize) -> Result<Vec<u8>, PackError> {
    let mut output = Vec::new();
    output
        .try_reserve_exact(length)
        .map_err(|_| PackError::Allocation)?;
    output.resize(length, 0);
    Ok(output)
}

#[cfg(not(feature = "autoresearch-hull-bands"))]
fn zeroed_u16(length: usize) -> Result<Vec<u16>, PackError> {
    let mut output = Vec::new();
    output
        .try_reserve_exact(length)
        .map_err(|_| PackError::Allocation)?;
    output.resize(length, 0);
    Ok(output)
}

fn zeroed_u32(length: usize) -> Result<Vec<u32>, PackError> {
    let mut output = Vec::new();
    output
        .try_reserve_exact(length)
        .map_err(|_| PackError::Allocation)?;
    output.resize(length, 0);
    Ok(output)
}

#[cfg(not(feature = "autoresearch-hull-bands"))]
fn u16_bytes(values: &[u16]) -> Result<Vec<u8>, PackError> {
    let length = values
        .len()
        .checked_mul(2)
        .ok_or(PackError::ArithmeticOverflow)?;
    let mut output = zeroed_bytes(length)?;
    for (index, value) in values.iter().enumerate() {
        output[index * 2..index * 2 + 2].copy_from_slice(&value.to_le_bytes());
    }
    Ok(output)
}

fn u32_bytes(values: &[u32]) -> Result<Vec<u8>, PackError> {
    let length = values
        .len()
        .checked_mul(4)
        .ok_or(PackError::ArithmeticOverflow)?;
    let mut output = zeroed_bytes(length)?;
    for (index, value) in values.iter().enumerate() {
        output[index * 4..index * 4 + 4].copy_from_slice(&value.to_le_bytes());
    }
    Ok(output)
}

fn write_i16(output: &mut [u8], offset: usize, value: i16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u16(output: &mut [u8], offset: usize, value: u16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut [u8], offset: usize, value: u32) {
    output[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use alloc::vec;
    use core::mem::{align_of, size_of};

    use super::*;
    use crate::{Bounds, GlyphBands, Quadratic};

    fn curve(x: f32) -> Quadratic {
        Quadratic {
            p0: Point::new(x, 0.0),
            p1: Point::new(x + 0.25, 0.5),
            p2: Point::new(x + 0.5, 0.0),
        }
    }

    fn geometry(
        curves: Vec<Quadratic>,
        starts: Vec<u16>,
        horizontal: Vec<Band>,
        vertical: Vec<Band>,
    ) -> GlyphGeometry {
        GlyphGeometry {
            curves,
            contour_starts: starts,
            bounds: Bounds::ZERO,
            bands: GlyphBands {
                horizontal,
                vertical,
            },
        }
    }

    fn u16_at(bytes: &[u8], offset: usize) -> u16 {
        u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
    }

    fn u32_at(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    #[test]
    fn record_layout_and_bytes_are_exactly_v0() {
        assert_eq!(size_of::<SlugGlyphRecord>(), SLUG_GLYPH_RECORD_STRIDE);
        assert_eq!(align_of::<SlugGlyphRecord>(), 4);
        let glyph = geometry(
            vec![curve(0.0)],
            vec![0],
            vec![Band {
                curve_indices: vec![0],
            }],
            vec![],
        );
        let packed = pack_glyphs(
            &[
                GlyphForPacking::Present {
                    plane_bounds: [-1, -2, 3, 4],
                    geometry: &glyph,
                },
                GlyphForPacking::Missing,
            ],
            PackerConfig {
                curve_width: 4,
                page_curve_rows: 4,
                header_width: 4,
                reference_width: 4,
            },
        )
        .unwrap();
        assert_eq!(packed.record_bytes.len(), 80);
        assert_eq!(u16_at(&packed.record_bytes, 0), (-1_i16) as u16);
        assert_eq!(u16_at(&packed.record_bytes, 8), 0);
        assert_eq!(u32_at(&packed.record_bytes, 20), 2);
        assert_eq!(u16_at(&packed.record_bytes, 40 + 8), ABSENT_PAGE);
        assert!(packed.record_bytes[40..48].iter().all(|value| *value == 0));
    }

    #[test]
    fn shares_endpoints_and_pads_before_a_row_boundary_pair() {
        let glyph = geometry(
            vec![curve(0.0), curve(0.5), curve(1.0), curve(1.5)],
            vec![0],
            vec![Band {
                curve_indices: vec![0, 1, 2, 3],
            }],
            vec![],
        );
        let packed = pack_glyphs(
            &[GlyphForPacking::Present {
                plane_bounds: [0; 4],
                geometry: &glyph,
            }],
            PackerConfig {
                curve_width: 4,
                page_curve_rows: 4,
                header_width: 4,
                reference_width: 4,
            },
        )
        .unwrap();
        let record = packed.records[0];
        assert_eq!(record.curve_span_texels, 6);
        let refs = &packed.pages[0].reference_bytes;
        #[cfg(not(feature = "autoresearch-hull-bands"))]
        assert_eq!(
            [
                u16_at(refs, 0),
                u16_at(refs, 2),
                u16_at(refs, 4),
                u16_at(refs, 6),
            ],
            [0, 1, 2, 4]
        );
        #[cfg(feature = "autoresearch-hull-bands")]
        assert_eq!(
            [
                u32_at(refs, 0) & 0xffff,
                u32_at(refs, 4) & 0xffff,
                u32_at(refs, 8) & 0xffff,
                u32_at(refs, 12) & 0xffff,
            ],
            [0, 1, 2, 4]
        );
        assert!(
            packed.pages[0].curve_bytes[3 * 8..4 * 8]
                .iter()
                .all(|value| *value == 0)
        );
    }

    #[cfg(not(feature = "autoresearch-hull-bands"))]
    #[test]
    fn v0_deduplicates_equal_lists_across_horizontal_and_vertical_bands() {
        let repeated = Band {
            curve_indices: vec![1, 0],
        };
        let glyph = geometry(
            vec![curve(0.0), curve(0.5)],
            vec![0],
            vec![
                repeated.clone(),
                Band {
                    curve_indices: vec![0],
                },
            ],
            vec![repeated],
        );
        let packed = pack_glyphs(
            &[GlyphForPacking::Present {
                plane_bounds: [0; 4],
                geometry: &glyph,
            }],
            PackerConfig {
                curve_width: 8,
                page_curve_rows: 4,
                header_width: 8,
                reference_width: 8,
            },
        )
        .unwrap();
        let page = &packed.pages[0];
        assert_eq!(page.metadata.header_count, 3);
        assert_eq!(page.metadata.reference_count, 3);
        assert_eq!(u32_at(&page.header_bytes, 0), (2_u32 << 16));
        assert_eq!(u32_at(&page.header_bytes, 4), (1_u32 << 16) | 2);
        assert_eq!(u32_at(&page.header_bytes, 8), (2_u32 << 16));
    }

    #[cfg(not(feature = "autoresearch-hull-bands"))]
    #[test]
    fn v0_reference_grid_bytes_remain_exact() {
        let glyph = geometry(
            vec![curve(0.0), curve(0.5)],
            vec![0],
            vec![Band {
                curve_indices: vec![0, 1],
            }],
            vec![Band {
                curve_indices: vec![1],
            }],
        );
        let packed = pack_glyphs(
            &[GlyphForPacking::Present {
                plane_bounds: [0; 4],
                geometry: &glyph,
            }],
            PackerConfig {
                curve_width: 8,
                page_curve_rows: 4,
                header_width: 8,
                reference_width: 8,
            },
        )
        .unwrap();
        let page = &packed.pages[0];
        assert_eq!(page.metadata.reference_count, 3);
        assert_eq!(page.reference_bytes, [0, 0, 1, 0, 1, 0]);
    }

    #[cfg(feature = "autoresearch-hull-bands")]
    #[test]
    fn hull_references_use_written_half_texels_and_only_share_within_an_axis() {
        let glyph = geometry(
            vec![Quadratic {
                p0: Point::new(0.125, 0.25),
                p1: Point::new(0.75, 0.375),
                p2: Point::new(0.5, 0.625),
            }],
            vec![0],
            vec![
                Band {
                    curve_indices: vec![0],
                },
                Band {
                    curve_indices: vec![0],
                },
            ],
            vec![Band {
                curve_indices: vec![0],
            }],
        );
        let packed = pack_glyphs(
            &[GlyphForPacking::Present {
                plane_bounds: [0; 4],
                geometry: &glyph,
            }],
            PackerConfig {
                curve_width: 4,
                page_curve_rows: 4,
                header_width: 4,
                reference_width: 4,
            },
        )
        .unwrap();
        let page = &packed.pages[0];
        assert_eq!(page.metadata.reference_count, 2);
        assert_eq!(page.reference_bytes.len(), 8);

        // The second horizontal band reuses offset zero; the vertical band must
        // use offset one because its stored max-Y hull differs from max-X.
        assert_eq!(u32_at(&page.header_bytes, 0), 1_u32 << 16);
        assert_eq!(u32_at(&page.header_bytes, 4), 1_u32 << 16);
        assert_eq!(u32_at(&page.header_bytes, 8), (1_u32 << 16) | 1);

        let horizontal = u32_at(&page.reference_bytes, 0);
        let vertical = u32_at(&page.reference_bytes, 4);
        assert_eq!(horizontal & 0xffff, 0);
        assert_eq!(vertical & 0xffff, 0);

        // Both maxima are copied from the binary16 coordinates already stored
        // in curve texels: x=max(0.125, 0.75, 0.5), y=max(0.25, 0.375, 0.625).
        assert_eq!(u16_at(&page.curve_bytes, 0), 0x3000);
        assert_eq!(u16_at(&page.curve_bytes, 4), 0x3a00);
        assert_eq!(u16_at(&page.curve_bytes, 8), 0x3800);
        assert_eq!(u16_at(&page.curve_bytes, 2), 0x3400);
        assert_eq!(u16_at(&page.curve_bytes, 6), 0x3600);
        assert_eq!(u16_at(&page.curve_bytes, 10), 0x3900);
        assert_eq!(horizontal >> 16, 0x3a00);
        assert_eq!(vertical >> 16, 0x3900);
    }

    #[test]
    fn paging_never_splits_a_glyph_and_resets_page_local_offsets() {
        let first = geometry(vec![curve(0.0), curve(0.5)], vec![0], vec![], vec![]);
        let second = geometry(vec![curve(1.0), curve(1.5)], vec![0], vec![], vec![]);
        let packed = pack_glyphs(
            &[
                GlyphForPacking::Present {
                    plane_bounds: [0; 4],
                    geometry: &first,
                },
                GlyphForPacking::Present {
                    plane_bounds: [0; 4],
                    geometry: &second,
                },
            ],
            PackerConfig {
                curve_width: 4,
                page_curve_rows: 2,
                header_width: 4,
                reference_width: 4,
            },
        )
        .unwrap();
        assert_eq!(packed.pages.len(), 2);
        assert_eq!(packed.records[0].page, 0);
        assert_eq!(packed.records[1].page, 1);
        assert_eq!(packed.records[0].curve_base_texel, 0);
        assert_eq!(packed.records[1].curve_base_texel, 0);
    }

    #[test]
    fn rejects_a_glyph_local_reference_offset_that_does_not_fit_u16() {
        let mut bands = Vec::new();
        bands.try_reserve_exact(257).unwrap();
        for index in 0..257_u16 {
            let mut indices = Vec::new();
            indices.try_reserve_exact(256).unwrap();
            indices.resize(256, index % 2);
            indices[255] = index;
            bands.push(Band {
                curve_indices: indices,
            });
        }
        let glyph = geometry(vec![curve(0.0); 258], vec![0], bands, vec![]);
        assert_eq!(
            pack_glyphs(
                &[GlyphForPacking::Present {
                    plane_bounds: [0; 4],
                    geometry: &glyph
                }],
                PackerConfig {
                    curve_width: 512,
                    page_curve_rows: 4,
                    header_width: 512,
                    reference_width: 512
                },
            ),
            Err(PackError::U16Overflow)
        );
    }

    #[test]
    fn half_float_encoding_is_finite_and_rounds_ties_even() {
        assert_eq!(f32_to_f16_bits(0.0).unwrap(), 0x0000);
        assert_eq!(f32_to_f16_bits(-0.0).unwrap(), 0x8000);
        assert_eq!(f32_to_f16_bits(1.0).unwrap(), 0x3c00);
        assert_eq!(f32_to_f16_bits(65_504.0).unwrap(), 0x7bff);
        assert_eq!(
            f32_to_f16_bits(f32::INFINITY),
            Err(PackError::CoordinateOutOfRange)
        );
        assert_eq!(quantize_f16(1.0).unwrap(), 1.0);
        assert_eq!(quantize_f16(-0.0).unwrap().to_bits(), (-0.0_f32).to_bits());
        assert_eq!(
            quantize_f16(0.000_061_035_156_25).unwrap(),
            0.000_061_035_156_25
        );
    }
}
