use core::cmp;
#[cfg(not(feature = "std"))]
use core_maths::CoreFloat;
use std::vec::Vec;

use read_fonts::{FontRef, TableProvider, types::GlyphId};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use zeno::{Command, Mask};

use crate::{
    error::{BitmapBakeError, BitmapBakeErrorCode, overflow},
    model::GLYPH_RECORD_STRIDE,
};

const ATLAS_LIMIT: u16 = 1024;
const GLYPH_PADDING: u16 = 1;
const ABSENT_PAGE: u16 = 0xffff;

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
    fn new() -> Self {
        Self {
            texels: vec![0; usize::from(ATLAS_LIMIT) * usize::from(ATLAS_LIMIT)],
            cursor_x: 0,
            cursor_y: 0,
            row_height: 0,
            used_width: 0,
            used_height: 0,
        }
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

    fn finish(self) -> RasterizedPage {
        let width = cmp::max(self.used_width, 1);
        let height = cmp::max(self.used_height, 1);
        let mut texels = vec![0; usize::from(width) * usize::from(height)];
        for row in 0..height {
            let source = usize::from(row) * usize::from(ATLAS_LIMIT);
            let destination = usize::from(row) * usize::from(width);
            texels[destination..destination + usize::from(width)]
                .copy_from_slice(&self.texels[source..source + usize::from(width)]);
        }
        RasterizedPage {
            width,
            height,
            texels,
        }
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

    let outlines = font.outline_glyphs();
    let metrics = font.glyph_metrics(Size::unscaled(), LocationRef::default());
    let mut bitmaps = Vec::with_capacity(usize::from(glyph_count));
    for raw_glyph_id in 0..glyph_count {
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(outline) = outlines.get(glyph_id) else {
            bitmaps.push(None);
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
            bitmaps.push(None);
            continue;
        }
        let (texels, placement) = Mask::new(&pen.commands).render();
        if placement.width == 0 || placement.height == 0 {
            bitmaps.push(None);
            continue;
        }
        let bounds = metrics.bounds(glyph_id).ok_or_else(|| {
            BitmapBakeError::new(
                BitmapBakeErrorCode::InvalidGlyphOutline,
                "outlined glyph is missing maintained Fontations bounds",
            )
            .at(format!("/glyphs/{raw_glyph_id}"))
        })?;
        bitmaps.push(Some(GlyphBitmap {
            plane_bounds: encode_plane_bounds([
                bounds.x_min,
                bounds.y_min,
                bounds.x_max,
                bounds.y_max,
            ])?,
            width: u16::try_from(placement.width).map_err(|_| glyph_too_large(raw_glyph_id))?,
            height: u16::try_from(placement.height).map_err(|_| glyph_too_large(raw_glyph_id))?,
            texels,
        }));
    }

    let record_len = usize::from(glyph_count)
        .checked_mul(GLYPH_RECORD_STRIDE)
        .ok_or_else(overflow)?;
    let mut records = vec![0_u8; record_len];
    let mut pages = vec![AtlasPage::new()];
    for (raw_glyph_id, bitmap) in bitmaps.iter().enumerate() {
        let record = raw_glyph_id * GLYPH_RECORD_STRIDE;
        let Some(bitmap) = bitmap else {
            write_u16(&mut records, record + 16, ABSENT_PAGE);
            continue;
        };
        let mut page_index = pages.len() - 1;
        let atlas = if let Some(atlas) = pages[page_index].place(bitmap) {
            atlas
        } else {
            pages.push(AtlasPage::new());
            page_index += 1;
            pages[page_index]
                .place(bitmap)
                .ok_or_else(|| glyph_too_large(raw_glyph_id as u16))?
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

    Ok(RasterizedStrike {
        ppem,
        plane_units_per_em: units_per_em,
        records,
        pages: pages.into_iter().map(AtlasPage::finish).collect(),
    })
}

fn encode_plane_bounds(bounds: [f32; 4]) -> Result<[i16; 4], BitmapBakeError> {
    let rounded = [
        bounds[0].floor(),
        bounds[1].floor(),
        bounds[2].ceil(),
        bounds[3].ceil(),
    ];
    if rounded.iter().any(|value| {
        !value.is_finite() || *value < f32::from(i16::MIN) || *value > f32::from(i16::MAX)
    }) {
        return Err(BitmapBakeError::new(
            BitmapBakeErrorCode::InvalidGlyphOutline,
            "glyph plane bounds exceed the bitmap V0 i16 range",
        ));
    }
    Ok([
        rounded[0] as i16,
        rounded[1] as i16,
        rounded[2] as i16,
        rounded[3] as i16,
    ])
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
