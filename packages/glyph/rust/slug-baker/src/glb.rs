use alloc::{format, string::String, vec::Vec};

use pmndrs_glyph_raster_artifact::{
    KtxFormat, PagePackaging, append_buffer_view, encode_glb, encode_ktx2,
};
use pmndrs_glyph_slug_core::PackedSlug;
use serde_json::{Value, json};

use crate::{
    error::{SlugBakeError, overflow},
    model::{SLUG_EXTENSION, SLUG_GENERATOR_LABEL, SLUG_PLANE_UNITS_PER_EM},
};

pub(crate) struct BuiltRasterGlb {
    pub bytes: Vec<u8>,
    pub resources: Vec<BuiltResource>,
    pub page_reports: Vec<BuiltPageReport>,
}

pub(crate) struct BuiltResource {
    pub id: String,
    pub bytes: Vec<u8>,
    pub sha256: String,
    pub embedded: bool,
}

pub(crate) struct BuiltPageReport {
    pub width: u16,
    pub height: u16,
    pub gpu_bytes: usize,
    pub encoded_bytes: usize,
    pub embedded: bool,
}

pub(crate) fn build_slug_glb(
    raster_key: &str,
    shaping_hash: &str,
    glyph_count: u16,
    page_packaging: PagePackaging,
    packed: &PackedSlug,
) -> Result<BuiltRasterGlb, SlugBakeError> {
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

    for (page_index, page) in packed.pages.iter().enumerate() {
        let metadata = page.metadata;
        let curve = encode_ktx2(
            KtxFormat::Rgba16Sfloat,
            metadata.curve_width,
            metadata.curve_height,
            &page.curve_bytes,
        )?;
        let stem = format!("slug-{shaping_hash}-{raster_key}-p{page_index}");
        let curve_source = append_resource(
            &mut binary,
            &mut buffer_views,
            &mut resources,
            format!("{stem}-curves.ktx2"),
            curve,
            page_packaging,
        )?;
        let header_source = append_resource(
            &mut binary,
            &mut buffer_views,
            &mut resources,
            format!("{stem}-headers.r32ui.bin"),
            page.header_bytes.clone(),
            page_packaging,
        )?;
        let reference_source = append_resource(
            &mut binary,
            &mut buffer_views,
            &mut resources,
            format!("{stem}-references.r16ui.bin"),
            page.reference_bytes.clone(),
            page_packaging,
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
            embedded: page_packaging == PagePackaging::Embedded,
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
                "shapingHash": shaping_hash,
                "glyphCount": glyph_count,
                "glyphIdWidth": 16,
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
        resources,
        page_reports,
    })
}

fn append_resource(
    binary: &mut Vec<u8>,
    buffer_views: &mut Vec<Value>,
    resources: &mut Vec<BuiltResource>,
    id: String,
    bytes: Vec<u8>,
    packaging: PagePackaging,
) -> Result<Value, SlugBakeError> {
    let sha256 = pmndrs_glyph_raster_artifact::sha256_hex(&bytes);
    let source = match packaging {
        PagePackaging::Embedded => {
            let view = append_buffer_view(binary, buffer_views, &bytes)?;
            json!({ "type": "bufferView", "bufferView": view })
        }
        PagePackaging::External => json!({
            "type": "external",
            "uri": id,
            "byteLength": bytes.len(),
            "artifactHash": sha256,
        }),
    };
    resources.push(BuiltResource {
        id,
        bytes,
        sha256,
        embedded: packaging == PagePackaging::Embedded,
    });
    Ok(source)
}
