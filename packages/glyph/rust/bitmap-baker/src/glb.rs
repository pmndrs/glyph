use std::vec::Vec;

use pmndrs_glyph_raster_artifact::{
    KtxFormat, RasterCoverageV0, append_buffer_view, encode_glb, encode_ktx2,
};
use serde_json::{Value, json};

use crate::{
    error::BitmapBakeError,
    model::{BITMAP_EXTENSION, BITMAP_GENERATOR_LABEL},
    rasterize::RasterizedStrike,
};

pub(crate) struct BuiltRasterGlb {
    pub bytes: Vec<u8>,
    pub pages: Vec<BuiltPage>,
}

pub(crate) struct BuiltPage {
    pub bytes: Vec<u8>,
    pub width: u16,
    pub height: u16,
}

pub(crate) fn build_bitmap_glb(
    raster_key: &str,
    shaping_fingerprint: &str,
    glyph_count: u16,
    strikes: &[RasterizedStrike],
    coverage_descriptor: Option<&RasterCoverageV0>,
    coverage: Option<&[u8]>,
) -> Result<BuiltRasterGlb, BitmapBakeError> {
    // One value the core and this raster compare to decide they belong together; every
    // dimension that must agree is folded in, so a consumer never re-derives the list.
    let compatibility = pmndrs_glyph_raster_artifact::compatibility_fingerprint(
        shaping_fingerprint,
        raster_key,
        crate::model::BITMAP_KIND,
        u32::from(crate::model::BITMAP_FORMAT_VERSION),
        glyph_count,
        16,
    );
    let mut binary = Vec::<u8>::new();
    let mut buffer_views = Vec::<Value>::new();
    let mut page_artifacts = Vec::<BuiltPage>::new();
    let mut strike_values = Vec::<Value>::with_capacity(strikes.len());
    let coverage_view = coverage
        .map(|bits| append_buffer_view(&mut binary, &mut buffer_views, bits))
        .transpose()?;

    for strike in strikes {
        let record_view = append_buffer_view(&mut binary, &mut buffer_views, &strike.records)?;
        let mut pages = Vec::<Value>::with_capacity(strike.pages.len());
        for page in &strike.pages {
            let ktx2 = encode_ktx2(KtxFormat::R8Unorm, page.width, page.height, &page.texels)?;
            let view = append_buffer_view(&mut binary, &mut buffer_views, &ktx2)?;
            let source = json!({ "type": "bufferView", "bufferView": view });
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
                bytes: ktx2,
                width: page.width,
                height: page.height,
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
    let mut extension = json!({
        "version": 0,
        "rasterKey": raster_key,
        "fingerprint": compatibility,
        "strikes": strike_values,
    });
    if let Some(coverage_view) = coverage_view {
        let extension = extension.as_object_mut().expect("extension is an object");
        extension.insert(
            "coverage".into(),
            pmndrs_glyph_raster_artifact::raster_coverage_json_value(
                coverage_descriptor.expect("coverage descriptor accompanies bits"),
            ),
        );
        extension.insert("coverageBufferView".into(), coverage_view.into());
    }
    let root = json!({
        "asset": {
            "version": "2.0",
            "generator": BITMAP_GENERATOR_LABEL,
        },
        "extensionsUsed": [BITMAP_EXTENSION],
        "extensionsRequired": [BITMAP_EXTENSION],
        "extensions": {
            BITMAP_EXTENSION: extension,
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
