use std::vec::Vec;

use pmndrs_glyph_raster_artifact::{
    ABSENT_PAGE, AtlasPage, GlyphRecordTable, RasterCoverageV0, RasterizedPage,
    ResolvedRasterCoverage, resolve_raster_coverage,
};
use read_fonts::{FontRef, TableProvider, types::GlyphId};
use skrifa::{
    MetadataProvider,
    instance::{LocationRef, Size},
    outline::{DrawSettings, OutlinePen},
};
use zeno::{Command, Mask, Placement};

use crate::error::{BitmapBakeError, BitmapBakeErrorCode, overflow};

const ATLAS_LIMIT: u16 = 1024;
const GLYPH_PADDING: u16 = 1;
pub(crate) const MAX_ATLAS_PAGES: usize = 60;

pub(crate) fn resolve_coverage(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
    coverage: Option<&RasterCoverageV0>,
) -> Result<Option<ResolvedRasterCoverage>, BitmapBakeError> {
    let Some(coverage) = coverage else {
        return Ok(None);
    };
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
    let charmap = font.charmap();
    resolve_raster_coverage(coverage, glyph_count, |character| {
        charmap
            .map(character)
            .and_then(|glyph_id| u16::try_from(glyph_id.to_u32()).ok())
    })
    .map(Some)
    .map_err(|error| {
        BitmapBakeError::new(BitmapBakeErrorCode::InvalidDescriptor, error)
            .at("/descriptor/coverage")
    })
}

pub(crate) struct RasterizedStrike {
    pub ppem: u16,
    pub plane_units_per_em: u16,
    pub records: Vec<u8>,
    pub pages: Vec<RasterizedPage>,
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

pub(crate) fn rasterize_strike(
    source: &[u8],
    face_index: u32,
    expected_glyph_count: u16,
    ppem: u16,
    coverage: Option<&ResolvedRasterCoverage>,
    progress_offset: u32,
    progress_total: u32,
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

    let mut records = GlyphRecordTable::new(glyph_count)?;
    let mut pages = Vec::with_capacity(MAX_ATLAS_PAGES);
    pages.push(AtlasPage::new(ATLAS_LIMIT, 1)?);

    let outlines = font.outline_glyphs();
    // Once, before the loop. A font carrying no outline table at all draws an
    // empty raster for every glyph, and `mark_absent` records that identically
    // to a glyph the coverage set never selected — so the artifact looks whole
    // and renders blank. Refuse it here instead, where the cause is still known.
    if outlines.format().is_none() {
        return Err(BitmapBakeError::new(
            BitmapBakeErrorCode::InvalidFont,
            "font has no glyf, CFF, or CFF2 outline table to rasterize",
        ));
    }
    crate::progress::report(progress_offset, progress_total);
    let mut selected_index = 0_u32;
    for raw_glyph_id in 0..glyph_count {
        if coverage.is_some_and(|selection| !selection.contains(raw_glyph_id)) {
            records.mark_absent(raw_glyph_id)?;
            continue;
        }
        crate::progress::report(
            progress_offset.saturating_add(selected_index),
            progress_total,
        );
        selected_index = selected_index.saturating_add(1);
        let glyph_id = GlyphId::new(u32::from(raw_glyph_id));
        let Some(outline) = outlines.get(glyph_id) else {
            records.mark_absent(raw_glyph_id)?;
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
            records.mark_absent(raw_glyph_id)?;
            continue;
        }
        let (texels, placement) = Mask::new(&pen.commands).render();
        if placement.width == 0 || placement.height == 0 {
            records.mark_absent(raw_glyph_id)?;
            continue;
        }
        let bitmap = GlyphBitmap {
            plane_bounds: encode_pixel_plane_bounds(placement)?,
            width: u16::try_from(placement.width).map_err(|_| glyph_too_large(raw_glyph_id))?,
            height: u16::try_from(placement.height).map_err(|_| glyph_too_large(raw_glyph_id))?,
            texels,
        };
        let mut page_index = pages.len() - 1;
        let atlas = if let Some(atlas) =
            pages[page_index].place(bitmap.width, bitmap.height, &bitmap.texels, GLYPH_PADDING)?
        {
            atlas
        } else {
            if pages.len() == MAX_ATLAS_PAGES {
                return Err(overflow());
            }
            pages.push(AtlasPage::new(ATLAS_LIMIT, 1)?);
            page_index += 1;
            pages[page_index]
                .place(bitmap.width, bitmap.height, &bitmap.texels, GLYPH_PADDING)?
                .ok_or_else(|| glyph_too_large(raw_glyph_id))?
        };
        if page_index >= usize::from(ABSENT_PAGE) {
            return Err(overflow());
        }
        records.write(
            raw_glyph_id,
            bitmap.plane_bounds,
            atlas,
            u16::try_from(page_index).map_err(|_| overflow())?,
        )?;
    }

    let mut finished_pages = Vec::with_capacity(pages.len());
    for page in pages {
        finished_pages.push(page.finish()?);
    }

    Ok(RasterizedStrike {
        ppem,
        plane_units_per_em: ppem,
        records: records.into_bytes(),
        pages: finished_pages,
    })
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
