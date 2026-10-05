---
type: Log Entry
title: 'Added a shaping-safe same-source drop-cap slice without changing renderer placement'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`ParagraphLayout.dropCap`
carries a one-to-sixteen-line span, logical side, text-top/baseline alignment, and margins through the generated Rust/TS
ABI. The core selects one complete grapheme through the first bounded `CLUSTER_SAFE_BEFORE` edge, disables the cap when
no edge exists, excludes its retained glyph/design bounds from body slots, resumes the same paragraph at the exact next
cluster, and positions both ranges through the existing x/y occurrence path. Focused Rust tests cover RTL side mapping,
safe-edge refusal, and a simultaneous independent rectangle exclusion; a real attached Three integration uses a
combining-mark cap and proves every source glyph appears once with renderer and shaped origins equal. Arbitrary cap
polygons, mixed-raster Editorial composition, and the complete interaction/browser matrix remain open.
