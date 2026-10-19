---
type: Log Entry
title: 'Keep built-in material realization separate from external contexts'
generated:
  by: process:docs-new
  at: '2026-10-19T17:18:23Z'
---

The first issue #181 material-realizer change passed Glyph's own checks, but the exact-head CI Check job exposed a
downstream TypeScript error in `glyph-example-raster`: its external `studio.glyph-example` augmentation of
`ThreeTextMaterialContextMap` has no `paragraphPosition`. The private `RawMaterialContext` union mapped over every
key of that open public map, even though `#createMaterial` is called only by the four built-in producers.

The private mapped union now names those four built-in context keys explicitly: decoration, Bitmap, MSDF, and Slug.
External factories and their material-context contracts remain unchanged. This closes the type regression without a
public type change or a runtime guard. The [Glyph concept](../packages/glyph.md) records that boundary.

The existing raster downstream check (13 tests, typecheck, lint, format), renderer downstream check, and full Glyph
check pass after the correction. The rebuilt distribution matches the earlier issue #181 candidate byte-for-byte
across all 238 JavaScript files, five Wasm files, and 227 declarations; its rendered material-position proof remains
applicable. The earlier baseline-to-candidate Wasm differences still exist and are not attributed to this type fix.
