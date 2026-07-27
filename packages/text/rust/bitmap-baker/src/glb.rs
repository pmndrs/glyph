use std::{string::String, vec::Vec};

use pmndrs_text_raster_artifact::{KtxFormat, append_buffer_view, encode_glb, encode_ktx2};
use serde_json::{Value, json};

use crate::{
    error::BitmapBakeError,
    hex_sha256,
    model::{BITMAP_EXTENSION, BITMAP_GENERATOR_LABEL, PagePackaging},
    rasterize::RasterizedStrike,
};

pub(crate) struct BuiltRasterGlb {
    pub bytes: Vec<u8>,
    pub pages: Vec<BuiltPage>,
}

pub(crate) struct BuiltPage {
    pub id: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub width: u16,
    pub height: u16,
    pub embedded: bool,
}

pub(crate) fn build_bitmap_glb(
    raster_key: &str,
    shaping_hash: &str,
    glyph_count: u16,
    page_packaging: PagePackaging,
    strikes: &[RasterizedStrike],
) -> Result<BuiltRasterGlb, BitmapBakeError> {
    let mut binary = Vec::<u8>::new();
    let mut buffer_views = Vec::<Value>::new();
    let mut page_artifacts = Vec::<BuiltPage>::new();
    let mut strike_values = Vec::<Value>::with_capacity(strikes.len());

    for strike in strikes {
        let record_view = append_buffer_view(&mut binary, &mut buffer_views, &strike.records)?;
        let mut pages = Vec::<Value>::with_capacity(strike.pages.len());
        for (page_index, page) in strike.pages.iter().enumerate() {
            let ktx2 = encode_ktx2(KtxFormat::R8Unorm, page.width, page.height, &page.texels)?;
            let sha256 = hex_sha256(&ktx2);
            let id = format!(
                "bitmap-{shaping_hash}-{raster_key}-s{}-p{page_index}.ktx2",
                strike.ppem
            );
            let source = match page_packaging {
                PagePackaging::Embedded => {
                    let view = append_buffer_view(&mut binary, &mut buffer_views, &ktx2)?;
                    json!({ "type": "bufferView", "bufferView": view })
                }
                PagePackaging::External => json!({
                    "type": "external",
                    "uri": id,
                    "byteLength": ktx2.len(),
                    "artifactHash": sha256,
                }),
            };
            pages.push(json!({
                "width": page.width,
                "height": page.height,
                "mipLevelCount": 1,
                "colorSpace": "linear",
                "variants": [{
                    "source": source,
                    "container": "ktx2",
                    "gpuFormat": "r8unorm",
                    "quality": "lossless",
                }],
            }));
            page_artifacts.push(BuiltPage {
                id,
                bytes: ktx2,
                sha256,
                width: page.width,
                height: page.height,
                embedded: page_packaging == PagePackaging::Embedded,
            });
        }
        strike_values.push(json!({
            "ppemX": strike.ppem,
            "ppemY": strike.ppem,
            "planeUnitsPerEm": strike.plane_units_per_em,
            "recordBufferView": record_view,
            "recordStride": 20,
            "pages": pages,
        }));
    }

    let logical_binary_length = binary.len();
    let root = json!({
        "asset": {
            "version": "2.0",
            "generator": BITMAP_GENERATOR_LABEL,
        },
        "extensionsUsed": [BITMAP_EXTENSION],
        "extensionsRequired": [BITMAP_EXTENSION],
        "extensions": {
            BITMAP_EXTENSION: {
                "version": 0,
                "rasterKey": raster_key,
                "shapingHash": shaping_hash,
                "glyphCount": glyph_count,
                "glyphIdWidth": 16,
                "strikes": strike_values,
            },
        },
        "buffers": [{ "byteLength": logical_binary_length }],
        "bufferViews": buffer_views,
    });
    let bytes = encode_glb(&root, binary)?;

    Ok(BuiltRasterGlb {
        bytes,
        pages: page_artifacts,
    })
}
