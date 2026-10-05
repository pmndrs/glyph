---
type: Log Entry
title: 'Preserved multi-paragraph Three batching in the Rust session design'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Existing `TextGroup` batches independent
paragraphs, while the current Rust session's multiple constraints all flow the same prose. The cutover therefore uses
one group/session containing stable-ID paragraph states and one shared planner/publication, rather than one Wasm call
and buffer set per `Text`. The policy gather workspace now appends independent positioned SoA inputs after one total
reservation, with an exact two-layout proof and no allocation inside append. Paragraph-keyed frame mutation and
transactional session state remain the next Rust slice. Adjacent rebuilt-Wasm Bitmap runs measured 4.083 ms before
and 4.078 ms after for full-column resize; that does not establish a speed change and does rule out a visible
regression in this run. Wasm changes by +105/+40/+252 raw/gzip/Brotli bytes.
