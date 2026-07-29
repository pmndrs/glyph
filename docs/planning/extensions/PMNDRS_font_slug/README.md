---
type: glTF Extension Specification
title: PMNDRS_font_slug
description: Defines Slug glyph, curve, band-header, curve-reference, and GPU page resources bound to a PMNDRS font.
tags: [gltf, extension, font, slug]
sources:
  - id: 'citation-1'
    resource: 'https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/slug'
    title: 'Three Flatland Slug'
  - id: 'citation-2'
    resource: '../../raster-data-contract.md'
    title: 'Raster data contract'
  - id: 'citation-3-1'
    resource: '../../slug-audit.md'
    title: 'Slug audit'
  - id: 'citation-3-2'
    resource: '../../gpu-compression.md'
    title: 'GPU compression design'

generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-26T20:08:45Z'
---

<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font_slug

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

glTF 2.0 and a matching `PMNDRS_font` resource, embedded or registered separately.

## Overview

`PMNDRS_font_slug` stores analytic quadratic-curve raster data indexed by `PMNDRS_font` local glyph IDs. It is commonly delivered as its own GLB so applications that select bitmap or MSDF never download or initialize Slug resources.

The extension repeats the deterministic `rasterKey` and core shaping identity declared by its `PMNDRS_font` directory entry. Those values MUST match before upload.

V0 stores only final GPU data: dense 40-byte glyph records, RGBA16F endpoint-sharing curve pages, exact u32 band headers, and exact glyph-local u16 curve references. Integer arrays declare their two-dimensional R32UI/R16UI upload grids, including zeroed tail texels, so WebGL2 requires no CPU repacking. It incorporates the quality-preserving layout improvements proven in Three Flatland's uikit fork and planning research; it does not retain duplicate float32 source curves or nested band objects.

The dense glyph-record buffer view is four-byte aligned because its 40-byte records contain u32 members. Curve/header/reference page resources retain their independently declared upload alignment. Their sources may be embedded or independently addressed; all three resources become resident atomically as one logical Slug page. A page index never prescribes a GPU layer, binding, draw, or residency state.

The header encoding is `(curveCount << 16) | referenceOffset`. References are u16 texel offsets relative to the glyph's curve-base texel. Pages never split glyphs, and any u16 capacity overflow rejects the bake rather than truncating.

Curve pages are lossless linear RGBA16F KTX2 resources. Lossy block-compressed curves are not part of V0. Headers and references are exact integer data and MUST NOT use lossy compression.

## glTF Schema Updates

The extension adds a `PMNDRS_font_slug` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_slug.schema.json`](schema/glTF.PMNDRS_font_slug.schema.json)

## Known Implementations

- [Three Flatland Slug](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/slug) — implementation prior art for curves, band construction, packing, shaders, paging, and GLB delivery; not yet this exact extension.
- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation planned against this contract.
