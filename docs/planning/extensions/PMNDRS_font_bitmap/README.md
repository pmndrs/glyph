---
type: glTF Extension Specification
title: PMNDRS_font_bitmap
description: Defines generated bitmap strikes, dense glyph records, and texture resources bound to a PMNDRS font.
status: draft-v0
tags: [gltf, extension, font, bitmap]
---

<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font_bitmap

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

glTF 2.0 and a matching `PMNDRS_font` resource, embedded or registered separately.

## Overview

`PMNDRS_font_bitmap` stores generated grayscale or color bitmap strikes indexed by the local glyph IDs of a `PMNDRS_font`. Each strike contains one dense 20-byte record per glyph and KTX2 atlas pages. Layout metrics remain in the core font.

The extension repeats `rasterKey`, `shapingHash`, `glyphCount`, and `glyphIdWidth`; all MUST match the core raster reference before upload. Its strike array MUST exactly satisfy the canonical strike tuple encoded by that raster key. A missing requested strike makes the artifact incompatible and triggers the ordinary automatic runtime-bake path when source bytes are available.

Each 20-byte glyph record contains four signed fixed-point plane bounds, four unsigned pixel-edge atlas bounds, a page index, and flags. `page = 0xffff` marks an absent image. Bounds and byte offsets are defined in the [raster contract](../../raster-data-contract.md).

The records are two-byte-aligned CPU-side typed-array inputs for bulk instance generation; texture pages, not these 20-byte records, are the direct GPU-upload resource. The validator enforces unique `(ppemX, ppemY)` pairs in addition to JSON Schema validation.

Grayscale V0 requires a lossless linear R8 KTX2 variant. Color image strikes use a separate sRGB RGBA8 resource. Native compressed variants may be added with a retained baseline fallback.

## glTF Schema Updates

The extension adds a `PMNDRS_font_bitmap` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_bitmap.schema.json`](schema/glTF.PMNDRS_font_bitmap.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation in development.

## Resources

- [Raster data contract](../../raster-data-contract.md)
