<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

Written against the glTF 2.0 specification.

## Overview

`PMNDRS_font` stores one baked font face for runtime text shaping. It owns a canonical static OpenType shaping payload, authoritative font metrics, deterministic provenance, and a directory of renderer-specific presentations. Glyph IDs are local to this face and are shared by all attached presentations.

The extension separates shaping from drawing. Shaping yields glyph IDs, UTF-16 clusters, advances, offsets, and flags. Bitmap, distance-field, and Slug companion extensions draw those glyph IDs without duplicating advances or kerning.

Presentations may be embedded in the same GLB, fetched as independent presentation GLBs, or supplied by an application resolver. The font identity and presentation records are unchanged by that packaging choice.

This extension does not define text strings, paragraph layout, line breaking, renderer-selection policy, or scene nodes.

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
          "glyphExtentsStride": 8
        }
      },
      "metrics": {
        "glyphCount": 2871,
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
        "unicodeVersion": "17.0"
      },
      "presentations": [
        {
          "id": "ui-mtsdf",
          "kind": "distance-field",
          "extension": "PMNDRS_font_distance_field",
          "version": 0,
          "source": { "type": "external", "uri": "inter.ui-mtsdf.glb" }
        },
        {
          "id": "display-slug",
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

Required tables are `head`, `maxp`, `cmap`, `hhea`, `hmtx`, and `OS/2`. `GDEF`, `GSUB`, `GPOS`, and `kern` are retained when present. The profile excludes outlines, vertical-only tables, hinting, font-authored presentation data, variable-font tables, AAT, Graphite, collections, WOFF, and WOFF2.

`fontFunctions` preserves geometry queries needed during shaping after outlines are removed. `glyphExtentsBufferView` contains one dense 8-byte `(xMin, yMin, xMax, yMax)` i16 record per glyph. Optional contour-point records contain sorted 8-byte `(glyphId, pointIndex, x, y)` values for every point referenced by GPOS Anchor Format 2.

The exact whitelist, metric policy, checksums, and validation rules are normative in the [V0 shaping contract](../../SHAPING_DATA_CONTRACT.md) while this extension is incubated in `pmndrs/text`.

`shaping.hash` is lowercase SHA-256 over the domain-separated, length-prefixed SFNT, glyph-extents, and contour-point bytes defined by the shaping contract. Companion presentation artifacts MUST repeat this hash.

### Metrics

`metrics.glyphCount` MUST equal `maxp.numGlyphs`; `metrics.unitsPerEm` MUST equal `head.unitsPerEm`; and V0 `glyphIdWidth` MUST be `16`.

When `OS/2.fsSelection.USE_TYPO_METRICS` is set, the serialized line metrics come from the OS/2 typographic fields. Otherwise they come from `hhea`. Serialized metrics are authoritative for consumers and MUST agree with that policy.

### Presentation directory

Presentation IDs MUST be unique. `kind`, `extension`, and `version` MUST agree with the attached companion extension.

An embedded presentation is stored at the root `extensions` object in the same GLB. An external source URI resolves relative to the core GLB. When an external source omits `uri`, the application supplies bytes through its resolver. `artifactHash`, when present, is lowercase SHA-256 over the complete external artifact.

The top-level glTF `extensionsRequired` array is the sole required-extension mechanism. Presentation entries do not duplicate it.

## glTF Schema Updates

The extension adds a `PMNDRS_font` object to the root glTF `extensions` object. It does not modify core properties.

### JSON Schema

- [`schema/glTF.PMNDRS_font.schema.json`](schema/glTF.PMNDRS_font.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation in development.

Three Flatland Slug is prior art for baked GLB font delivery but does not implement this extension.

## Resources

- [V0 shaping data contract](../../SHAPING_DATA_CONTRACT.md)
- [V0 presentation data contract](../../PRESENTATION_DATA_CONTRACT.md)
- [Runtime/bake API fixture](../../API_SHAPES.md)
- [Payload budget](../../PAYLOAD_BUDGET.md)
