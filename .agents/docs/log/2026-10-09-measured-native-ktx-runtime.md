---
type: Log Entry
title: 'Measured native KTX runtime cost'
generated:
  by: process:docs-new
  at: '2026-10-09T01:28:56Z'
---

Added the package-owned `glyph:ktx-runtime-performance` workflow described in the
[`@pmndrs/glyph` package reference](../packages/glyph.md#font-fallback-and-raster-formats) and
[`@pmndrs/glyph-benchmarks` package reference](../packages/benchmarks.md). It compares the successful path of
`ktx-parse` 1.1.0 plus Glyph's native-image policy from base `f97d17be528c5fe0dbcf88ee407c000f46a38825` with the
bounded reader at `1959e998265a22a5d691723a558bf42a1ad562cf`. The workflow authenticates three checked-in Inter
Bitmap, MSDF, and Slug LFS artifacts, extracts and preloads their twelve real KTX2 pages, and independently serializes
BC4, EAC R11, and ASTC containers from authenticated R8 bytes to complete the six-format semantic suite. Before timing,
both implementations must return identical payload bytes at the same byte offset in the same input buffer.

The final advisory-locked Node 24.18.0 run on Apple M2 Pro measured fresh-process module load plus one real R8
validation at 2.024 ms for `ktx-parse` and 1.033 ms for the native reader, a 1.96× speedup. Process launch, fixture
construction and I/O, GLB parsing, and gzip are outside that cold interval. With modules and fixtures warm, the
six-format median fell from 545.7 to 120.9 ns/validation (4.51×), while the twelve-real-page median fell from 595.8 to
133.1 ns (4.48×). V8 statistical allocation sampling across 120,000 six-format validations observed 2,443.3 versus
196.7 sampled bytes/validation, a 91.95% reduction; automatic GC observations were 139 versus 11 events. Allocation
bytes are samples rather than an exact language-level counter, and GC observations are not a latency guarantee. The
workflow measures JavaScript parsing and policy validation, not upload, rendering, or frame rate.

The same candidate retained the focused production closure at 4,409 raw / 4,303 minified / 1,577 gzip / 1,370 Brotli
bytes versus 12,109 / 8,791 / 2,668 / 2,355 at `f97d17be5`, reductions of 63.59%, 51.05%, 40.89%, and 41.83%.
Complete peer- and Wasm-externalized Three Bitmap, MSDF, and Slug graphs each lost 7,860 raw and 4,586 minified bytes;
gzip fell by 1,295, 1,295, and 1,296 bytes. Initial raw, minified, and gzip graphs did not change because the KTX reader
remains lazy. The candidate compiled KTX tests passed all five oracle/corruption cases, and the complete Glyph package
check passed its build, 883 package/integration tests, fuzz and font-baker lanes, declaration checks, lint/format, and
strict Rust checks.
