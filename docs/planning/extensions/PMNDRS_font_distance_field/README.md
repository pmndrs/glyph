---
type: glTF Extension Specification
title: PMNDRS_font_distance_field
description: Defines MTSDF glyph records and linear texture resources for the MSDF raster module.
tags: [gltf, extension, font, msdf, mtsdf]
sources:
  - id: 'citation-1'
    resource: 'https://github.com/Chlumsky/msdfgen'
    title: 'msdfgen'
  - id: 'citation-2'
    resource: 'https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html'
    title: 'KTX 2.0 specification'
  - id: 'citation-3'
    resource: '../../raster-data-contract.md'
    title: 'Raster data contract'

generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-29T11:22:07Z'
---

<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font_distance_field

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

glTF 2.0 and a matching `PMNDRS_font` resource, embedded or registered separately.

## Overview

`PMNDRS_font_distance_field` stores the MTSDF glyph atlas consumed by the public MSDF raster module. V0 requires `encoding: "mtsdf"`: linear RGBA8 with multi-channel distance in RGB and true signed distance in alpha. Plain MSDF is not a V0 resource variant.

The extension declares generation em size, encoded pixel range, fixed-point plane units, one dense 20-byte glyph-record view, and a logical directory of KTX2 texture pages. `emSize` MUST be an integer in `1..=1022`, `pixelRange` MUST be an integer in `1..=1020`, and `planeUnitsPerEm` MUST equal `emSize`. `pixelRange` is the full encoded signed-distance range rather than a per-side radius; the reference baker pads each quantized glyph rectangle by `ceil(pixelRange / 2)` texels on every side. Each page variant may be embedded or independently addressed; the page index does not prescribe a GPU layer, draw, or residency state. Records share the bitmap plane/atlas/page layout. Advances and kerning are never duplicated.

The records are two-byte-aligned CPU-side typed-array inputs for bulk instance generation; texture pages, not these 20-byte records, are the direct GPU-upload resource.

The extension repeats the deterministic `rasterKey` and core shaping identity declared by its `PMNDRS_font` directory entry. Those values MUST match before upload. The package's canonical descriptor maps omitted or partial quality options onto the 64/8 compatibility defaults. Explicit effective 64/8 uses the legacy fieldless descriptor and raster key; every non-default descriptor authenticates both effective `emSize` and `pixelRange`, and the extension values MUST match that policy.

Lossless linear RGBA8 is the only V0 schema-admitted texture representation. One atlas and one batch support sharp fill edges from RGB and true-distance effects from alpha. UASTC or native BC7, ETC2, and ASTC variants remain future quality-gated research because channel error changes reconstructed edges.

The configurable values expose an authoring trade-off rather than changing the recommended default. Real 155-glyph subset artifacts at 32/4 and 32/6 pass generation and semantic validation; adopting either as a default still requires comparative source-outline, payload, residency, and rendering evidence.

## glTF Schema Updates

The extension adds a `PMNDRS_font_distance_field` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_distance_field.schema.json`](schema/glTF.PMNDRS_font_distance_field.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation planned against this contract.
