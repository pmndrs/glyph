<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font_slug

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

glTF 2.0 and a matching `PMNDRS_font` resource, embedded or registered separately.

## Overview

`PMNDRS_font_slug` stores analytic quadratic-curve presentation data indexed by `PMNDRS_font` local glyph IDs. It is commonly delivered as its own GLB so applications that select bitmap or MTSDF never download or initialize Slug resources.

V0 stores only final GPU data: dense 40-byte glyph records, RGBA16F endpoint-sharing curve pages, exact u32 band headers, and exact glyph-local u16 curve references. It incorporates the quality-preserving layout improvements proven in Three Flatland's uikit fork and planning research; it does not retain duplicate float32 source curves or nested band objects.

The header encoding is `(curveCount << 16) | referenceOffset`. References are u16 texel offsets relative to the glyph's curve-base texel. Pages never split glyphs, and any u16 capacity overflow rejects the bake rather than truncating.

Curve half-float bits may use lossless KTX2 supercompression. Lossy block-compressed curves are not part of V0. Headers and references are exact integer data and MUST NOT use lossy compression.

## glTF Schema Updates

The extension adds a `PMNDRS_font_slug` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_slug.schema.json`](schema/glTF.PMNDRS_font_slug.schema.json)

## Known Implementations

- [Three Flatland Slug](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/slug) — implementation prior art for curves, band construction, packing, shaders, paging, and GLB delivery; not yet this exact extension.
- [`pmndrs/text`](https://github.com/pmndrs/text) — reference port/rewrite planned against this contract.

## Resources

- [Presentation data contract](../../PRESENTATION_DATA_CONTRACT.md)
- [Slug audit](../../SLUG_AUDIT.md)
- [GPU compression and compact Slug storage](../../GPU_COMPRESSION.md)
