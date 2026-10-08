---
type: Log Entry
title: 'Slimmed the native KTX2 runtime reader'
generated:
  by: process:docs-new
  at: '2026-10-08T18:21:06Z'
---

Replaced the general `ktx-parse` production dependency with the bounded native reader described in the
[`@pmndrs/glyph` package reference](../packages/glyph.md#font-fallback-and-raster-formats). The reader supports only the
uncompressed, single-level native KTX2 variants used by Bitmap, MSDF, and Slug; validates the identifier, header, level
index, safe uint64 conversion, section ranges, payload size, basic DFD, channel semantics, and metadata absence; and
returns a zero-copy level view. Shared numeric constants now remain package-internal. `ktx-parse` moved to development
dependencies because the package tests use its writer and reader as an independent oracle.

History establishes that this is a new TypeScript reader, not a recovery of the GLB reader or an earlier JavaScript KTX
implementation. Commit `741b9e674f077b8ee77c7521606161472b24e1c1` introduced `raster-ktx.ts` already delegating to
`ktx-parse`. The earlier `packages/text/rust/bitmap-baker/src/ktx.rs` was an R8 encoder whose standard-library validation
delegated to Rust's `ktx2::Reader`; that same commit replaced it with the generalized package-owned raster-artifact KTX2
writer. The complete Git object inventory contains only those Rust writer paths and the later `raster-ktx.ts` renames, so
there is no earlier slim JavaScript parser or GLB-derived implementation to attribute.

Focused evidence: source-only TypeScript compilation, changed-file lint and formatting, and five oracle/corruption tests
covering all six admitted formats, zero-copy views, semantic variants, truncation, unsafe and out-of-range coordinates,
DFD structure and meaning, and bounded metadata. The full Rust/Wasm distribution build and `release:size:generate` lane
were deliberately held while issue #247's agent was timing; exact before/after production-graph bytes remain a follow-up
measurement rather than an estimate in this record.
