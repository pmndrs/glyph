---
type: glTF Extension Specification
title: PMNDRS_font
description: Defines the core font, shaping payload, metrics, provenance, and raster directory extension.
tags: [gltf, extension, font, shaping]
sources:
  - id: "citation-1"
    resource: "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html"
    title: "glTF 2.0 specification"
  - id: "citation-2"
    resource: "../../shaping-data-contract.md"
    title: "V0 shaping data contract"
  - id: "citation-3"
    resource: "../../raster-data-contract.md"
    title: "V0 raster data contract"
  - id: "citation-4-1"
    resource: "../../api-shapes.md"
    title: "Runtime and bake API fixture"
  - id: "citation-4-2"
    resource: "../../payload-budget.md"
    title: "payload budget"

generated:
  by: "openai-codex/gpt-5"
  at: "2026-07-26T02:40:00Z"
---

<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

Written against the glTF 2.0 specification.

## Overview

`PMNDRS_font` stores one baked font face for runtime text shaping. It owns a canonical static OpenType shaping payload, authoritative font metrics, deterministic provenance, and a directory of renderer-specific rasters. Glyph IDs are local to this face and are shared by all attached rasters.

The extension separates shaping from drawing. Shaping yields glyph IDs, UTF-16 clusters, advances, offsets, and flags. Raster packages draw those glyph IDs without duplicating advances or kerning. Bitmap, MTSDF-backed MSDF, and Slug are the companion extensions currently specified by this project, not an exhaustive registry.

Rasters may be embedded in the same GLB, fetched as independent raster GLBs, or supplied by an application resolver. The font identity and raster records are unchanged by that packaging choice.

This extension does not define text strings, paragraph layout, line breaking, raster-module selection policy, or scene nodes.

### Root extension object

```json
{
  "extensions": {
    "PMNDRS_font": {
      "version": 0,
      "shaping": {
        "format": "opentype-sfnt-harfrust-v0",
        "bufferView": 0,
        "hash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "fontFunctions": {
          "glyphExtentsBufferView": 1,
          "glyphExtentsStride": 8,
          "glyphExtentsAvailabilityBufferView": 2
        }
      },
      "metrics": {
        "glyphCount": 2937,
        "glyphIdWidth": 16,
        "unitsPerEm": 2048,
        "ascender": 1984,
        "descender": -494,
        "lineGap": 0
      },
      "provenance": {
        "sourceHash": "1111111111111111111111111111111111111111111111111111111111111111",
        "descriptorHash": "2222222222222222222222222222222222222222222222222222222222222222",
        "bakerVersion": "0.1.0",
        "harfrustVersion": "0.12.0",
        "harfbuzzReferenceVersion": "13.0.0",
        "unicodeVersion": "17.0.0"
      },
      "rasters": [
        {
          "rasterKey": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "kind": "msdf",
          "extension": "PMNDRS_font_distance_field",
          "version": 0,
          "source": { "type": "external", "uri": "inter.ui-msdf.glb" }
        },
        {
          "rasterKey": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          "kind": "slug",
          "extension": "PMNDRS_font_slug",
          "version": 0,
          "source": { "type": "embedded" }
        }
      ]
    }
  }
}
```

### Shaping payload

`shaping.bufferView` MUST contain exactly one static, single-face SFNT conforming to profile `opentype-sfnt-harfrust-v0`.

Required tables are `head`, `maxp`, `cmap`, `hhea`, `hmtx`, and `OS/2`. `GDEF`, `GSUB`, `GPOS`, `kern`, `BASE`, `vhea`, `vmtx`, and `VORG` are retained when present. The profile does not fabricate optional tables and excludes outlines, hinting, font-authored raster data, variable-font tables, AAT, Graphite, collections, WOFF, and WOFF2. Retaining vertical-form source data does not enable vertical shaping or paragraph layout.

`fontFunctions` preserves the optional glyph-extents query used by HarfRust fallback positioning after outlines are removed. `glyphExtentsBufferView` contains one dense 8-byte `(xMin, yMin, xMax, yMax)` i16 record per glyph. `glyphExtentsAvailabilityBufferView` contains exactly one bit per glyph, rounded up to a byte; a clear bit makes the adapter return no extents and requires a zeroed record. HarfRust 0.12.0 exposes no contour-point callback, so Anchor Format 2 point records are not serialized.

The exact whitelist, metric policy, checksums, and validation rules are normative in the [V0 shaping contract](../../shaping-data-contract.md) while this extension is incubated in `pmndrs/text`.

`shaping.hash` is lowercase SHA-256 over the domain-separated, length-prefixed SFNT, glyph-extents, and extents-availability bytes defined by the shaping contract. Companion raster artifacts MUST repeat this hash.

### Metrics

`metrics.glyphCount` MUST equal `maxp.numGlyphs`; `metrics.unitsPerEm` MUST equal `head.unitsPerEm`; and V0 `glyphIdWidth` MUST be `16`.

When `OS/2.fsSelection.USE_TYPO_METRICS` is set, the serialized line metrics come from the OS/2 typographic fields. Otherwise they come from `hhea`. Serialized metrics are authoritative for consumers and MUST agree with that policy.

### Raster directory

Raster keys MUST be unique within the font. A key is the lowercase deterministic SHA-256 over the raster kind, companion extension/version, and canonical package-owned descriptor defined by the [raster contract](../../raster-data-contract.md); it is not a caller-authored alias. `kind` is an open identifier owned by the raster module. `extension` names the companion glTF extension that defines its data, and `version` selects that companion contract. Core consumers MUST NOT reject an otherwise valid font merely because the directory contains an unknown optional raster kind. `rasterKey`, `kind`, `extension`, and `version` MUST agree with an attached raster that the consumer elects to load.

An embedded raster is stored at the root `extensions` object in the same GLB. Because glTF permits one root value per extension name, a combined GLB MUST NOT embed more than one raster using the same companion extension; additional entries using that extension MUST be external. The embedded root's reciprocal `rasterKey` MUST equal its elected directory entry. An external source URI resolves relative to the core GLB and MUST carry `artifactHash`, the lowercase SHA-256 over the complete external artifact. When an external source omits `uri`, the application supplies bytes through its resolver and MAY still declare a hash for authentication.

Companion extensions own a logical raster-page directory. Page payloads may remain embedded in the companion asset or use independently addressed URI, byte-length, and SHA-256 sources relative to that companion asset. Core does not interpret those pages or equate their indexes with GPU binding state.

The top-level glTF `extensionsRequired` array is the sole required-extension mechanism. Raster entries do not duplicate it.

## glTF Schema Updates

The extension adds a `PMNDRS_font` object to the root glTF `extensions` object. It does not modify core properties.

### JSON Schema

- [`schema/glTF.PMNDRS_font.schema.json`](schema/glTF.PMNDRS_font.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation in development.

Three Flatland Slug is prior art for baked GLB font delivery but does not implement this extension.
