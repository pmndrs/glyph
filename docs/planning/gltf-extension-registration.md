---
type: Submission Draft
title: glTF vendor-prefix request and extension submission set
description: Contains the proposed PMNDRS vendor-prefix request and extension submission checklist.
tags: [gltf, extension, governance]
timestamp: 2026-07-24T14:01:29Z
---

# glTF vendor-prefix request and extension submission set

Status: ready for Poimandres maintainer review; do not submit or push without approval
Target: [`KhronosGroup/glTF`](https://github.com/KhronosGroup/glTF)

## Prefix-registration issue

### Title

```text
Request for PMNDRS vendor prefix
```

### Body

```markdown
Hello glTF maintainers,

Poimandres would like to request registration of the `PMNDRS` vendor prefix.

- **Project:** Poimandres (pmndrs)
- **Website:** https://pmnd.rs/
- **GitHub organization:** https://github.com/pmndrs
- **Contact:** https://github.com/pmndrs/text/issues

The prefix will be used for experimental glTF 2.0 extensions developed by the Poimandres community. The first extension family represents baked fonts for real-time graphics: one raster-independent shaping resource plus independently loadable bitmap, distance-field, and analytic-vector glyph rasters.

The design uses glTF buffer views, extension discovery, and validation while allowing a consumer to embed all selected resources in one GLB, load only the raster required by its renderer, and resolve large raster pages independently through integrity-checked external resources. Detailed specifications, schemas, examples, and implementations will be submitted separately as they are validated.

Thank you.
```

This request contains the project, URL, contact, and intended namespace use required by [`extensions/Prefixes.md`](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md). It requests a prefix only; it does not claim Khronos approval or multi-vendor status.

## Maintainer checklist

- Confirm the registry name should be `Poimandres` and the requested prefix remains `PMNDRS`.
- Confirm `https://github.com/pmndrs/text/issues` is the public contact.
- Recheck that `PMNDRS` is absent from `extensions/Prefixes.md` immediately before filing.
- File from an account authorized to represent Poimandres.
- Do not submit the extension pull request until the golden assets, schema tests, and first implementation exist.

## Extension specifications

These are no longer illustrative placeholders. They encode the current V0 data contracts and are maintained with the implementation:

| Extension | Specification and schema |
| --- | --- |
| `PMNDRS_font` | [Core font](extensions/PMNDRS_font/README.md) |
| `PMNDRS_font_bitmap` | [Bitmap](extensions/PMNDRS_font_bitmap/README.md) |
| `PMNDRS_font_distance_field` | [Distance field](extensions/PMNDRS_font_distance_field/README.md) |
| `PMNDRS_font_slug` | [Slug](extensions/PMNDRS_font_slug/README.md) |

`PMNDRS_font` owns one static shaping face, metrics, provenance, and raster directory. The companion extensions own generated bitmap strikes, MTSDF RGBA8 atlases for the MSDF raster, or RGBA16F Slug curves with exact compact band acceleration.

Shared texture-resource schemas live in [`extensions/schema`](extensions/schema). Before a Khronos pull request, these shared definitions must either be placed at registry-approved paths or duplicated into companion extension directories according to maintainer guidance; that packaging change cannot alter their data model.

## Contract source

- [Shaping data contract V0](shaping-data-contract.md)
- [Raster data contract V0](raster-data-contract.md)
- [Runtime and bake API V0](api-shapes.md)
- [Payload budget](payload-budget.md)

## Submission readiness gate

The extension pull request waits for:

1. schema validation against golden combined and split GLBs;
2. one Node bake and one Worker bake producing identical authoritative records;
3. HarfBuzz/HarfRust/runtime shaping comparison on the pinned fixture;
4. bitmap upload through WebGPU and WebGL2;
5. reciprocal shaping-hash rejection tests;
6. measured section and texture reports;
7. named specification editors and accepted Poimandres ownership.

# Citations

[1] [glTF extension template](https://github.com/KhronosGroup/glTF/blob/main/extensions/Template.md) — required structure for extension proposals.

[2] [glTF extension registry guidance](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md) — registry process and extension organization.

[3] [Registered glTF vendor prefixes](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md) — prefix availability and registration source.

[4] [BEVY](https://github.com/KhronosGroup/glTF/issues/2497), [KITTYCAD](https://github.com/KhronosGroup/glTF/issues/2344), [MANYFOLD](https://github.com/KhronosGroup/glTF/issues/2398), and [PYTHA](https://github.com/KhronosGroup/glTF/issues/2581) — accepted vendor-prefix request precedents.

[5] [GODOT_single_root](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/GODOT_single_root), [CESIUM_primitive_outline](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/CESIUM_primitive_outline), and [MSFT_lod](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/MSFT_lod) — representative vendor extension specifications.
