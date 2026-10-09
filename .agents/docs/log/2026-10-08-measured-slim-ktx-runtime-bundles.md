---
type: Log Entry
title: 'Measured the slim KTX runtime production bundles'
generated:
  by: process:docs-new
  at: '2026-10-08T19:06:18Z'
---

The named [`glyph:ktx-runtime-size`](../packages/benchmarks.md) workflow closes the exact-size follow-up left by the
native-reader change. It compiled fixed baseline `2ab37fdac6b05f5fd30ce3c165168c2c21176d15` and candidate
`ee2af476f9cde81aa0fb1ae7ac0d03c514b3d072` from their TypeScript sources with TypeScript 7.0.2 and tsdown 0.22.14;
the three TypeScript/tsdown configuration files have the same SHA-256 on both sides. Vite 8.1.5 then applied the
repository's production ES2022, peer-externalized, Wasm-externalized Rolldown configuration to both. Two complete runs
produced byte-identical evidence.

The isolated KTX closure falls from 12,109 raw / 8,791 minified / 2,666 gzip / 2,344 Brotli bytes to 6,613 / 6,502 /
2,234 / 1,928: reductions of 5,496 (45.39%), 2,289 (26.04%), 432 (16.20%), and 416 (17.75%) bytes. Complete Three
Bitmap, MSDF, and Slug graphs, including their selected dynamic chunks but excluding optional peers and Wasm, each lose
5,330 raw and 2,101 minified bytes. Bitmap and MSDF lose 576 gzip bytes; Slug loses 574. This is about 1.02% raw and
0.44% gzip per complete application-facing graph, not the unverified 70% estimate. Initial Three graphs contain neither
KTX implementation and change only by 73 raw / 64 minified / 3 gzip bytes from their changed dynamic-chunk references.
The selected root-core graph reaches no KTX reader before or after.

The candidate module sets contain no `ktx-parse`; each KTX-using baseline graph does. The candidate compiled output also
passes all five KTX tests covering six native formats, zero-copy payload views, semantic variants, truncation and safe
ranges, DFD structure and meaning, and metadata rejection. No Rust or Wasm build ran, and no Wasm byte contributes to a
reported delta. The [`@pmndrs/glyph` package reference](../packages/glyph.md#font-fallback-and-raster-formats) retains
the detailed result and its scope.
