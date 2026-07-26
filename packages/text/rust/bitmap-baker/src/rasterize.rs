use core::cmp;
use std::vec::Vec;

use read_fonts::{FontRef, TableProvider, types::GlyphId};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use zeno::{Command, Mask, Placement};

use crate::{
    error::{BitmapBakeError, BitmapBakeErrorCode, overflow},
    model::GLYPH_RECORD_STRIDE,
};

const ATLAS_LIMIT: u16 = 1024;
const GLYPH_PADDING: u16 = 1;
const ABSENT_PAGE: u16 = 0xffff;
pub(crate) const MAX_ATLAS_PAGES: usize = 60;

pub(crate) struct RasterizedStrike {
    pub ppem: u16,
    pub plane_units_per_em: u16,
    pub records: Vec<u8>,
    pub pages: Vec<RasterizedPage>,
}

pub(crate) struct RasterizedPage {
    pub width: u16,
    pub height: u16,
    pub texels: Vec<u8>,
}

struct GlyphBitmap {
    plane_bounds: [i16; 4],
    width: u16,
    height: u16,
    texels: Vec<u8>,
}

#[derive(Default)]
struct ZenoPen {
    commands: Vec<Command>,
}

impl OutlinePen for ZenoPen {
    fn move_to(&mut self, x: f32, y: f32) {
        self.commands.push(Command::MoveTo([x, -y].into()));
    }

    fn line_to(&mut self, x: f32, y: f32) {
        self.commands.push(Command::LineTo([x, -y].into()));
    }

    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        self.commands
            .push(Command::QuadTo([cx0, -cy0].into(), [x, -y].into()));
    }

    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        self.commands.push(Command::CurveTo(
            [cx0, -cy0].into(),
            [cx1, -cy1].into(),
            [x, -y].into(),
        ));
    }

    fn close(&mut self) {
        self.commands.push(Command::Close);
    }
}

struct AtlasPage {
    texels: Vec<u8>,
    cursor_x: u16,
    cursor_y: u16,
    row_height: u16,
    used_width: u16,
    used_height: u16,
}

impl AtlasPage {
    fn new() -> Result<Self, BitmapBakeError> {
        Ok(Self {
            texels: zeroed_bytes(usize::from(ATLAS_LIMIT) * usize::from(ATLAS_LIMIT))?,
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            used_width: 0,
            used_height: 0,
        })
    }

    fn place(&mut self, glyph: &GlyphBitmap) -> Option<[u16; 4]> {
        let padded_width = glyph.width.checked_add(GLYPH_PADDING * 2)?;
        let padded_height = glyph.height.checked_add(GLYPH_PADDING * 2)?;
        if padded_width > ATLAS_LIMIT || padded_height > ATLAS_LIMIT {
            return None;
        }
        if self.cursor_x.checked_add(padded_width)? > ATLAS_LIMIT {
            self.cursor_x = 0;
            self.cursor_y = self.cursor_y.checked_add(self.row_height)?;
            self.row_height = 0;
        }
        if self.cursor_y.checked_add(padded_height)? > ATLAS_LIMIT {
            return None;
        }

        let left = self.cursor_x + GLYPH_PADDING;
        let top = self.cursor_y + GLYPH_PADDING;
        let right = left + glyph.width;
        let bottom = top + glyph.height;
        for row in 0..glyph.height {
            let source = usize::from(row) * usize::from(glyph.width);
            let destination = usize::from(top + row) * usize::from(ATLAS_LIMIT) + usize::from(left);
            self.texels[destination..destination + usize::from(glyph.width)]
                .copy_from_slice(&glyph.texels[source..source + usize::from(glyph.width)]);
        }
        self.cursor_x += padded_width;
        self.row_height = cmp::max(self.row_height, padded_height);
        self.used_width = cmp::max(self.used_width, self.cursor_x);
        self.used_height = cmp::max(self.used_height, self.cursor_y + padded_height);
        Some([left, top, right, bottom])
    }

    fn finish(self) -> Result<RasterizedPage, BitmapBakeError> {
        let width = cmp::max(self.used_width, 1);
        let height = cmp::max(self.used_height, 1);
        let byte_length = usize::from(width)
            .checked_mul(usize::from(height))
            .ok_or_else(overflow)?;
        let mut texels = zeroed_bytes(byte_length)?;
        for row in 0..height {
            let source = usize::from(row) * usize::from(ATLAS_LIMIT);
            let destination = usize::from(row) * usize::from(width);
            texels[destination..destination + usize::from(width)]
                .copy_from_slice(&self.texels[source..source + usize::from(width)]);
        }
        Ok(RasterizedPage {
            width,
            height,
            texels,
        })
    }
}

pub(crate) fn rasterize_strike(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
    ppem: u16,
) -> Result<RasterizedStrike, BitmapBakeError> {
    let font = FontRef::from_index(source, face_index).map_err(|error| {
        BitmapBakeError::new(BitmapBakeErrorCode::InvalidFontFace, error).at("/fontFaceIndex")
    })?;
    let glyph_count = font
        .maxp()
        .map_err(|error| BitmapBakeError::new(BitmapBakeErrorCode::InvalidFont, error))?
        .num_glyphs();
    if glyph_count != expected_glyph_count {
        return Err(BitmapBakeError::new(
            BitmapBakeErrorCode::InvalidGlyphCount,
            "source font glyph count does not match the shaping context",
        )
        .at("/glyphCount"));
    }
    let units_per_em = font
        .head()
        .map_err(|error| BitmapBakeError::new(BitmapBakeErrorCode::InvalidFont, error))?
        .units_per_em();
    if units_per_em == 0 || units_per_em > i16::MAX as u16 {
        return Err(BitmapBakeError::new(
            BitmapBakeErrorCode::InvalidFont,
            "font units per em is outside the bitmap V0 plane range",
        ));
    }

    let record_len = usize::from(glyph_count)
        .checked_mul(GLYPH_RECORD_STRIDE)
        .ok_or_else(overflow)?;
    let mut records = zeroed_bytes(record_len)?;
    let mut pages = Vec::with_capacity(MAX_ATLAS_PAGES);
    pages.push(AtlasPage::new()?);

    let outlines = font.outline_glyphs();
    for raw_glyph_id in 0..glyph_count {
        let record = usize::from(raw_glyph_id) * GLYPH_RECORD_STRIDE;
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(outline) = outlines.get(glyph_id) else {
            write_u16(&mut records, record + 16, ABSENT_PAGE);
            continue;
        };
        let mut pen = ZenoPen::default();
        outline
            .draw(
                DrawSettings::unhinted(Size::new(f32::from(ppem)), LocationRef::default()),
                &mut pen,
            )
            .map_err(|error| {
                BitmapBakeError::new(BitmapBakeErrorCode::InvalidGlyphOutline, error)
                    .at(format!("/glyphs/{raw_glyph_id}"))
            })?;
        if pen.commands.is_empty() {
            write_u16(&mut records, record + 16, ABSENT_PAGE);
            continue;
        }
        let (texels, placement) = Mask::new(&pen.commands).render();
        if placement.width == 0 || placement.height == 0 {
            write_u16(&mut records, record + 16, ABSENT_PAGE);
            continue;
        }
        let bitmap = GlyphBitmap {
            plane_bounds: encode_pixel_plane_bounds(placement)?,
            width: u16::try_from(placement.width).map_err(|_| glyph_too_large(raw_glyph_id))?,
            height: u16::try_from(placement.height).map_err(|_| glyph_too_large(raw_glyph_id))?,
            texels,
        };
        let mut page_index = pages.len() - 1;
        let atlas = if let Some(atlas) = pages[page_index].place(&bitmap) {
            atlas
        } else {
            if pages.len() == MAX_ATLAS_PAGES {
                return Err(overflow());
            }
            pages.push(AtlasPage::new()?);
            page_index += 1;
            pages[page_index]
                .place(&bitmap)
                .ok_or_else(|| glyph_too_large(raw_glyph_id))?
        };
        if page_index >= usize::from(ABSENT_PAGE) {
            return Err(overflow());
        }
        for (index, value) in bitmap.plane_bounds.into_iter().enumerate() {
            write_i16(&mut records, record + index * 2, value);
        }
        for (index, value) in atlas.into_iter().enumerate() {
            write_u16(&mut records, record + 8 + index * 2, value);
        }
        write_u16(
            &mut records,
            record + 16,
            u16::try_from(page_index).map_err(|_| overflow())?,
        );
    }

    let mut finished_pages = Vec::with_capacity(pages.len());
    for page in pages {
        finished_pages.push(page.finish()?);
    }

    Ok(RasterizedStrike {
        ppem,
        plane_units_per_em: ppem,
        records,
        pages: finished_pages,
    })
}

#[inline(never)]
fn zeroed_bytes(byte_length: usize) -> Result<Vec<u8>, BitmapBakeError> {
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(byte_length).is_err() {
        return Err(overflow());
    }
    bytes.resize(byte_length, 0);
    Ok(bytes)
}

fn encode_pixel_plane_bounds(placement: Placement) -> Result<[i16; 4], BitmapBakeError> {
    let left = i64::from(placement.left);
    let top = -i64::from(placement.top);
    let right = left + i64::from(placement.width);
    let bottom = top - i64::from(placement.height);
    let bounds = [left, bottom, right, top];
    if bounds
        .iter()
        .any(|value| *value < i64::from(i16::MIN) || *value > i64::from(i16::MAX))
    {
        return Err(BitmapBakeError::new(
            BitmapBakeErrorCode::InvalidGlyphOutline,
            "glyph plane bounds exceed the bitmap V0 i16 range",
        ));
    }
    Ok(bounds.map(|value| value as i16))
}

fn glyph_too_large(glyph_id: u16) -> BitmapBakeError {
    BitmapBakeError::new(
        BitmapBakeErrorCode::GlyphTooLarge,
        "glyph bitmap does not fit the fixed bitmap V0 atlas limit",
    )
    .at(format!("/glyphs/{glyph_id}"))
}

fn write_i16(output: &mut [u8], offset: usize, value: i16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}

fn write_u16(output: &mut [u8], offset: usize, value: u16) {
    output[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
}
