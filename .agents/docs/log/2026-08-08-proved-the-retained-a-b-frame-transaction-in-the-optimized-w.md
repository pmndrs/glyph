---
type: Log Entry
title: 'Proved the retained A/B frame transaction in the optimized Wasm'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added session lifecycle, cold reservation, one
retained 16-byte-aligned request arena, two retained 16-byte-aligned result arenas, explicit engine/plan/publication
revisions, base-revision checkpoints, and a compiler-derived 120-byte request plus 128-byte result header. The result
already reserves fixed semantic, resource, buffer, patch, primitive, draw, retirement, and diagnostic table fields;
unimplemented nonempty sections fail at the Rust boundary instead of falling back to host typography. Updates return
the selected result pointer in their single call. Success alternates slots, while malformed or stale-revision requests
write only the inactive slot and leave the active publication byte-identical. A real Node/Wasm proof observes zero
warm memory growth, then forces an 8 MiB cold reserve, observes the old fixed buffer detach, re-reads the aligned request
pointer, and disposes the session exactly. Twenty-five Rust unit tests, both complete Unicode 17 bidi suites, and the
optimized-Wasm policy/frame proofs pass. The frame shell grows the optimized shaper from 698,238 to 725,302 raw bytes,
from 260,228 to 269,438 gzip bytes, and from 203,760 to 210,867 Brotli bytes. The tables are still empty, so this proves
ownership and transaction semantics rather than shaping/layout performance. The still-unwired 25,515-glyph host path
remains within run variance at 54.42/12.15/8.31/38.98 millisecond cold/font-size/layout-width/text medians and
70.38/14.48/11.31/40.89 millisecond p95 values. The package's 186 integration tests, six fuzz targets, 117 benchmark
application tests, 20/20 warmed headless conformance scenarios, and the 172,156-byte packed-consumer proof
(`af7bfb85f04a6a63c6462735a6e8ec6d739576adb354c07ca51e744814db2f7b`) also pass. The aggregate benchmark script
still stops at its deliberately stale checked package-size snapshot; this stage records the new measured size instead
of rewriting unrelated historical evidence.
