<!-- Copyright 2026 Poimandres contributors. SPDX-License-Identifier: CC-BY-4.0 -->

# PMNDRS_font_distance_field

## Contributors

- Poimandres text maintainers, Poimandres, [pmndrs/text](https://github.com/pmndrs/text)

## Status

Draft vendor extension, version 0.

## Dependencies

glTF 2.0 and a matching `PMNDRS_font` resource, embedded or registered separately.

## Overview

`PMNDRS_font_distance_field` stores an MSDF or MTSDF glyph atlas indexed by `PMNDRS_font` local glyph IDs. Both techniques use linear RGBA8 pages: MSDF writes an opaque alpha channel, while MTSDF stores true signed distance in alpha.

The extension declares generation em size, encoded pixel range, fixed-point plane units, one dense 20-byte glyph-record view, and KTX2 texture pages. Records share the bitmap plane/atlas/page layout. Advances and kerning are never duplicated.

Lossless RGBA8 is the V0 baseline. UASTC or native BC7, ETC2, and ASTC variants are quality-gated because channel error changes reconstructed edges.

## glTF Schema Updates

The extension adds a `PMNDRS_font_distance_field` object to the root glTF `extensions` object.

### JSON Schema

- [`schema/glTF.PMNDRS_font_distance_field.schema.json`](schema/glTF.PMNDRS_font_distance_field.schema.json)

## Known Implementations

- [`pmndrs/text`](https://github.com/pmndrs/text) — reference implementation planned against this contract.

## Resources

- [Presentation data contract](../../PRESENTATION_DATA_CONTRACT.md)
- [msdfgen](https://github.com/Chlumsky/msdfgen)
