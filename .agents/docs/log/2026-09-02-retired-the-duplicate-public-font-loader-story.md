---
type: Log Entry
title: 'Retired the duplicate public font-loader story'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`glyph.fontFace()` now owns the only application loading path and
static bake discovery. Root and `/config` no longer export `loadFont`, `FontLibrary`, `createFontLibrary`, `defineFont`,
or font tokens. Renderer-free Paragraph accepts a loaded explicit FontFace selection and owns an independent immutable
Font lease, while configured handles resolve omitted defaults through `GlyphConfig.fonts`. Focused package tests retain
private loader access only when they prove the underlying resource graph; benchmark transport and timing injection is
confined to one harness-owned module.
