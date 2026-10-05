---
type: Log Entry
title: 'Moved searched Unicode properties onto generated code-point tries'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Bidi class, line break, and script now share one
two-stage trie generator. Focused kernels improve those lookups by 5.6–14.1×; the current-main shaper comparison adds
67,279 raw bytes while removing 7,534 gzip and 4,505 Brotli bytes. Generators round-trip every Unicode code point and
Rust tests exhaustively compare the emitted tables with independent range oracles. See [the package evidence](../packages/glyph.md)
and D-370 in [the decision register](../planning/decision-register.md).
