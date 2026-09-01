use alloc::vec::Vec;

use pmndrs_glyph_raster_artifact::{KtxFormat, append_buffer_view, encode_glb, encode_ktx2};
use pmndrs_glyph_slug_core::PackedSlug;
use serde_json::{Value, json};

use crate::{
    error::{SlugBakeError, overflow},
    model::{SLUG_EXTENSION, SLUG_GENERATOR_LABEL, SLUG_PLANE_UNITS_PER_EM},
};

pub(crate) struct BuiltRasterGlb {
    pub bytes: Vec<u8>,
    pub page_reports: Vec<BuiltPageReport>,
}

pub(crate) struct BuiltResource {
    pub bytes: Vec<u8>,
}

pub(crate) struct BuiltPageReport {
    pub width: u16,
    pub height: u16,
    pub gpu_bytes: usize,
    pub encoded_bytes: usize,
}

pub(crate) fn build_slug_glb(
    raster_key: &str,
    shaping_fingerprint: &str,
    glyph_count: u16,
    packed: &PackedSlug,
) -> Result<BuiltRasterGlb, SlugBakeError> {
    // One value the core and this raster compare to decide they belong together; every
    // dimension that must agree is folded in, so a consumer never re-derives the list.
    let compatibility = pmndrs_glyph_raster_artifact::compatibility_fingerprint(
        shaping_fingerprint,
        raster_key,
        crate::model::SLUG_KIND,
        u32::from(crate::model::SLUG_FORMAT_VERSION),
        glyph_count,
        16,
    );
    let mut binary = Vec::<u8>::new();
    let mut buffer_views = Vec::<Value>::new();
    let record_view = append_buffer_view(&mut binary, &mut buffer_views, &packed.record_bytes)?;
    let mut pages = Vec::<Value>::new();
    pages
        .try_reserve_exact(packed.pages.len())
        .map_err(|_| overflow())?;
    let resource_count = packed.pages.len().checked_mul(3).ok_or_else(overflow)?;
    let mut resources = Vec::<BuiltResource>::new();
    resources
        .try_reserve_exact(resource_count)
        .map_err(|_| overflow())?;
    let mut page_reports = Vec::<BuiltPageReport>::new();
    page_reports
        .try_reserve_exact(packed.pages.len())
        .map_err(|_| overflow())?;

    for page in &packed.pages {
        let metadata = page.metadata;
        let curve = encode_ktx2(
            KtxFormat::Rgba16Sfloat,
            metadata.curve_width,
            metadata.curve_height,
            &page.curve_bytes,
        )?;
        let curve_source = append_resource(&mut binary, &mut buffer_views, &mut resources, curve)?;
        let header_source = append_resource(
            &mut binary,
            &mut buffer_views,
            &mut resources,
            page.header_bytes.clone(),
        )?;
        let reference_source = append_resource(
            &mut binary,
            &mut buffer_views,
            &mut resources,
            page.reference_bytes.clone(),
        )?;
        pages.push(json!({
            "curve": {
                "width": metadata.curve_width,
                "height": metadata.curve_height,
                "mipLevelCount": 1,
                "colorSpace": "linear",
                "variants": [{
                    "source": curve_source,
                    "container": "ktx2",
                    "gpuFormat": "rgba16float",
                    "quality": "lossless",
                }],
            },
            "headerCount": metadata.header_count,
            "headerWidth": metadata.header_width,
            "headerHeight": metadata.header_height,
            "headerResource": { "source": header_source },
            "referenceCount": metadata.reference_count,
            "referenceWidth": metadata.reference_width,
            "referenceHeight": metadata.reference_height,
            "referenceResource": { "source": reference_source },
        }));

        let curve_gpu_bytes = usize::from(metadata.curve_width)
            .checked_mul(usize::from(metadata.curve_height))
            .and_then(|texels| texels.checked_mul(8))
            .ok_or_else(overflow)?;
        let gpu_bytes = curve_gpu_bytes
            .checked_add(page.header_bytes.len())
            .and_then(|bytes| bytes.checked_add(page.reference_bytes.len()))
            .ok_or_else(overflow)?;
        let start = resources.len().checked_sub(3).ok_or_else(overflow)?;
        let encoded_bytes = resources[start..]
            .iter()
            .try_fold(0_usize, |total, resource| {
                total.checked_add(resource.bytes.len()).ok_or_else(overflow)
            })?;
        page_reports.push(BuiltPageReport {
            width: metadata.curve_width,
            height: metadata.curve_height,
            gpu_bytes,
            encoded_bytes,
        });
    }

    let logical_binary_length = binary.len();
    let root = json!({
        "asset": { "version": "2.0", "generator": SLUG_GENERATOR_LABEL },
        "extensionsUsed": [SLUG_EXTENSION],
        "extensionsRequired": [SLUG_EXTENSION],
        "extensions": {
            SLUG_EXTENSION: {
                "version": 0,
                "rasterKey": raster_key,
                "fingerprint": compatibility,
                "planeUnitsPerEm": SLUG_PLANE_UNITS_PER_EM,
                "recordBufferView": record_view,
                "recordStride": 40,
                "pages": pages,
            },
        },
        "buffers": [{ "byteLength": logical_binary_length }],
        "bufferViews": buffer_views,
    });
    Ok(BuiltRasterGlb {
        bytes: encode_glb(&root, binary)?,
        page_reports,
    })
}

fn append_resource(
    binary: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    resources: &mut Vec<BuiltResource>,
    bytes: Vec<u8>,
) -> Result<Value, SlugBakeError> {
    let view = append_buffer_view(binary, buffer_views, &bytes)?;
    let source = json!({ "type": "bufferView", "bufferView": view });
    resources.push(BuiltResource { bytes });
    Ok(source)
}
