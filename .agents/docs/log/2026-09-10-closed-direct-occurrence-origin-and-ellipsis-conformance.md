---
type: Log Entry
title: 'Closed direct occurrence-origin and ellipsis conformance'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Gather now reads each rendered glyph's final semantic
inline/block origin through its `semantic_glyph_index`; it no longer treats a shared compact CPU segment translation as
the renderer input or builds a detached-copy placement vector. An ellipsis-only fragment with an empty retained source
interval is a valid no-op before its boundary replacement emits. The deliberately re-pinned additive f32 contract
changes only expected coordinate bits and hashes in the authenticated bidi/CJK fixtures; their measurement, glyph,
cluster, line, and advance contracts remain unchanged. The complete public paragraph-contract matrix and Bitmap,
MTSDF, and Slug WebGL2 product targets pass with one draw and no reference mismatch. The 68-frame advanced-shaping
timeline retains its exact 709-glyph, 625-rendered-glyph, 63-draw structure under the same coordinate repin. Placement
invalidation now compares those final semantic-origin bits rather than the compact segment translation; all 333
mutation/topology cases pass, including clipped CJK edits. The final A/B/B/A ordered Bitmap matrix uses 40 warmups
and two 101-sample passes per revision. Pooled current median/p95 is `2.874 / 2.915 ms` for 21,805 Latin glyphs and
`2.233 / 2.258 ms` for 21,978 dense-CJK glyphs, versus exact main's `3.697 / 3.754 ms` and `2.909 / 2.968 ms`.
That is 22.3%/22.4% lower Latin median/p95 and 23.2%/23.9% lower CJK median/p95. Each update still writes one
174,440/175,824-byte f32x2 patch and preserves draw topology.
The optimized shaper is 1,325,689 raw / 511,751 gzip / 393,474 Brotli bytes. The reviewed consumer graphs are 44,703
raw / 11,682 gzip for config, 230,346 / 43,525 for direct TypeGPU, 540,499 / 133,033 for Three, and 648,878 /
146,273 for Three plus TypeGPU; their ceilings were re-priced with bounded headroom. The focused Editorial browser
matrix is green across Bitmap/MTSDF/Slug, WebGPU/WebGL2, and both native TSL and experimental Three/TypeGPU shaders.
Every cell retains three draws through 64 projected-obstacle reflows; median end-to-end reflow is `0.950–1.580 ms` for
TSL and `1.185–1.720 ms` for TypeGPU, with publication accounting for `0.740–1.230 ms` and `0.965–1.320 ms`
respectively. Transfer-size reduction remains open because the direct occurrence buffer is correctly dirty across
the full active paragraph.
