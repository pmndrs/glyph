use alloc::vec::Vec;

use pmndrs_glyph_raster_artifact::{
    KtxFormat, RasterCoverageV0, append_buffer_view, encode_glb, encode_ktx2,
};
use serde_json::{Value, json};

#[cfg(feature = "profiling")]
use crate::profile::{BakePhase, BakeProfiler, PhaseTimer};
use crate::{
    artifact::RasterizedMtsdf,
    error::MtsdfBakeError,
    model::{MSDF_EXTENSION, MSDF_GENERATOR_LABEL, MtsdfBakeSettingsV0},
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

pub(crate) fn build_mtsdf_glb(
    raster_key: &str,
    source_fingerprint: &str,
    shaping_fingerprint: &str,
    glyph_count: u16,
    settings: MtsdfBakeSettingsV0,
    coverage_descriptor: Option<&RasterCoverageV0>,
    rasterized: &RasterizedMtsdf,
    #[cfg(feature = "profiling")] profiler: &mut BakeProfiler,
) -> Result<BuiltRasterGlb, MtsdfBakeError> {
    // One value the core and this raster compare to decide they belong together; every
    // dimension that must agree is folded in, so a consumer never re-derives the list.
    let compatibility = pmndrs_glyph_raster_artifact::compatibility_fingerprint(
        source_fingerprint,
        shaping_fingerprint,
        raster_key,
        crate::model::MSDF_KIND,
        u32::from(crate::model::MSDF_FORMAT_VERSION),
        glyph_count,
        16,
    );
    #[cfg(feature = "profiling")]
    let container_timer = PhaseTimer::start();
    #[cfg(feature = "profiling")]
    let texture_encoding_before = profiler.duration(BakePhase::TextureEncoding);
    let mut binary = Vec::<u8>::new();
    let mut buffer_views = Vec::<Value>::new();
    let coverage_view = rasterized
        .coverage
        .as_deref()
        .map(|bits| append_buffer_view(&mut binary, &mut buffer_views, bits))
        .transpose()?;
    let record_view = append_buffer_view(&mut binary, &mut buffer_views, &rasterized.records)?;
    let mut pages = Vec::<Value>::new();
    pages
        .try_reserve_exact(rasterized.pages.len())
        .map_err(|_| crate::error::overflow())?;
    let mut page_artifacts = Vec::<BuiltPage>::new();
    page_artifacts
        .try_reserve_exact(rasterized.pages.len())
        .map_err(|_| crate::error::overflow())?;
    for page in &rasterized.pages {
        #[cfg(feature = "profiling")]
        let ktx2 = profiler.measure(BakePhase::TextureEncoding, || {
            encode_ktx2(KtxFormat::Rgba8Unorm, page.width, page.height, &page.texels)
        })?;
        #[cfg(not(feature = "profiling"))]
        let ktx2 = encode_ktx2(KtxFormat::Rgba8Unorm, page.width, page.height, &page.texels)?;
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
                "gpuFormat": "rgba8unorm",
                "quality": "lossless",
            }],
        }));
        page_artifacts.push(BuiltPage {
            bytes: ktx2,
            width: page.width,
            height: page.height,
        });
    }

    let logical_binary_length = binary.len();
    let mut extension = json!({
        "version": 0,
        "rasterKey": raster_key,
        "fingerprint": compatibility,
        "encoding": "mtsdf",
        "emSize": settings.em_size,
        "pixelRange": settings.pixel_range,
        "planeUnitsPerEm": settings.em_size,
        "recordBufferView": record_view,
        "recordStride": 20,
        "pages": pages,
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
            "generator": MSDF_GENERATOR_LABEL,
        },
        "extensionsUsed": [MSDF_EXTENSION],
        "extensionsRequired": [MSDF_EXTENSION],
        "extensions": {
            MSDF_EXTENSION: extension,
        },
        "buffers": [{ "byteLength": logical_binary_length }],
        "bufferViews": buffer_views,
    });
    let bytes = encode_glb(&root, binary)?;
    #[cfg(feature = "profiling")]
    profiler.finish_container(
        container_timer,
        #[cfg(feature = "profiling")]
        texture_encoding_before,
    );
    Ok(BuiltRasterGlb {
        bytes,
        pages: page_artifacts,
    })
}
