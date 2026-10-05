---
type: Log Entry
title: 'Final renderer lifecycle size evidence'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Regenerated the canonical package-size record after the final Three retry,
dirty-range, disposal, and transform-identity fixes. Renderer-neutral JavaScript and the optimized shaper Wasm remain
byte-identical. The complete Three adapter adds 764 raw / 355 minified / 118 gzip / 82 Brotli bytes, putting the
Three-plus-core total at 1,488,082 raw / 498,494 gzip / 395,212 Brotli bytes with Three, React, and R3F external.
Every reviewed absolute and cumulative size ceiling still passes.
