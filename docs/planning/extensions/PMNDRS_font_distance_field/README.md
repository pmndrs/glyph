---
type: glTF Extension Specification
title: PMNDRS_font_distance_field
description: Defines MTSDF glyph records and linear texture resources for the MSDF raster module.
status: draft-v0
tags: [gltf, extension, font, msdf, mtsdf]
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

The extension declares generation em size, encoded pixel range, fixed-point plane units, one dense 20-byte glyph-record view, and KTX2 texture pages. Records share the bitmap plane/atlas/page layout. Advances and kerning are never duplicated.

The records are two-byte-aligned CPU-side typed-array inputs for bulk instance generation; texture pages, not these 20-byte records, are the direct GPU-upload resource.

The extension repeats the deterministic `rasterKey` and core shaping identity declared by its `PMNDRS_font` directory entry. Those values MUST match before upload.

Lossless RGBA8 is the V0 baseline. One atlas and one batch support sharp fill edges from RGB and true-distance effects from alpha. UASTC or native BC7, ETC2, and ASTC variants are quality-gated because channel error changes reconstructed edges.

## glTF Schema Updates

The extension adds a `PMNDRS_font_distance_field` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_distance_field.schema.json`](schema/glTF.PMNDRS_font_distance_field.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation planned against this contract.

## Resources

- [Raster data contract](../../raster-data-contract.md)
- [msdfgen](https://github.com/Chlumsky/msdfgen)
