---
type: Log Entry
title: 'Simplified the native KTX2 payload reader'
generated:
  by: process:docs-new
  at: '2026-10-08T19:23:57Z'
---

Simplified the restricted reader described in the
[`@pmndrs/glyph` package reference](../packages/glyph.md#font-fallback-and-raster-formats). The validation boundary now
checks the fixed header, admitted one-level index, safe uint64 coordinates, all section ranges, DFD structure and channel
semantics, payload size, and metadata policy directly over one `DataView`. It returns only the zero-copy base payload
view. The previous general container, level array, DFD object, sample objects, generic mip loop, and duplicate
parse-then-validate pass are gone. An unsupported level count now fails at the variant gate before unused mip coordinates
are read; this deliberately avoids validating a representation the runtime does not admit. Bitmap/MSDF/Slug consumers
and baker validators retain their existing ownership and validation behavior, and no published signature changed.

The named [`glyph:ktx-runtime-size`](../packages/benchmarks.md) workflow now compiles baseline and candidate sequentially
at the same stable path. This corrects a measurement flaw in the prior record: different baseline/candidate source paths
could enter emitted chunk references. The corrected first-pass figures below therefore supersede the few-byte-different
figures in `2026-10-08-measured-slim-ktx-runtime-bundles.md`. Both final comparisons used Node 24.18.0, TypeScript 7.0.2,
tsdown 0.22.14, Vite 8.1.5, identical build-configuration SHA-256
`3c2c15783b8c72fd64c4e612951e2af33e8f551b4a388886c1b643b7ac2f2d96`, ES2022 production bundling, Oxc
compression and mangling, external peers and Wasm, gzip level 9, and Brotli quality 11.

The isolated reader closure moved from the first native reader `ee2af476f` at 6,611 raw / 6,501 minified / 2,233 gzip /
1,929 Brotli bytes to `e03de5a4f` at 4,409 / 4,303 / 1,577 / 1,370. Those reductions are 2,202 (33.31%), 2,198
(33.81%), 656 (29.38%), and 559 (28.98%) bytes. Against original baseline `2ab37fdac`, the same closure moved from
12,109 / 8,791 / 2,668 / 2,355 to 4,409 / 4,303 / 1,577 / 1,370: reductions of 7,700 (63.59%), 4,488
(51.05%), 1,091 (40.89%), and 985 (41.83%) bytes.

Complete peer- and Wasm-externalized Three Bitmap, MSDF, and Slug graphs each lose another 2,438 raw / 2,402 minified /
705 gzip bytes relative to `ee2af476f`; their Brotli reductions are respectively 516, 422, and 626 bytes. Their final
totals are 516,371 / 505,091 / 128,845 / 105,096 bytes for Bitmap, 516,362 / 505,087 / 128,849 / 105,117 for MSDF,
and 516,367 / 505,087 / 128,847 / 105,056 for Slug. Initial Three raw and minified sizes remain unchanged because the
reader is in a lazy dynamic graph; gzip shifts by at most one byte and Brotli by changed dynamic-chunk references. Both
initial and complete root graphs are byte-identical and never include the KTX reader.

Every candidate graph excludes `ktx-parse`. The compiled candidate passes five independent oracle/corruption tests over
all six admitted formats, zero-copy behavior, header and level variants, truncated/out-of-range/unsafe coordinates, DFD
structure and fields, and metadata rejection. Source TypeScript, focused lint, and formatting also pass. This was a
JavaScript-only change: no Rust/Wasm build or performance timing ran, and no Wasm byte contributes to the measurements.
