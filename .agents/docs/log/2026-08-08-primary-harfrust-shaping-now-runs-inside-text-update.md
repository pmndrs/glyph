---
type: Log Entry
title: 'Primary HarfRust shaping now runs inside `text_update`'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

A borrowed run view lets legacy batching and the retained
engine share the prewarmed UnicodeBuffer, UTF-16 context, and reusable feature scratch. Retained style payloads feed
HarfRust without an owned request, and glyph SoA appends directly into a pre-reserved A/B session arena. A real-Inter
compiled-Wasm proof observes shape-plan count 0→1 after the frame and no increase after abort. Rust tests and
host/SIMD Clippy pass. Optimized Wasm is 973,367 / 364,517 / 287,942 raw/gzip/Brotli bytes (+5,281 / +1,853 /
+1,504). Ordered fallback, layout, nonempty plan output, and complete timing remain open.
