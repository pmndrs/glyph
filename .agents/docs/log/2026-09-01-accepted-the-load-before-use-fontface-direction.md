---
type: Log Entry
title: 'Accepted the load-before-use FontFace direction'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Root `glyph.fontFace()` will infer default and technique-specific
selections from ordered `{ url | blob, format }` sources without `defineFont()` ceremony. MSDF is the zero-config
selection, exact technique options validate baked artifacts or drive source-font baking, and different Bitmap strike
contracts remain different faces. One idempotent `load()` replaces preload and resolves to the same selection;
imperative Three throws on an unloaded selection, while R3F suspends on that load before constructing `Text`. The
immutable `GlyphProvider fonts` map supplies local aliases. The provider may supply Suspense and selective font-error
boundaries while rethrowing unrelated errors. Face disposal releases its
cache leases without invalidating independently bound Fonts. The planned direct CLI zero-flag default changes from
shaping-only to embedded Bitmap 8/16, MSDF, and Slug.
