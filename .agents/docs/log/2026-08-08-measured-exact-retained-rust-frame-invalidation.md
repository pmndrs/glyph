---
type: Log Entry
title: 'Measured exact retained Rust frame invalidation'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Style changes now invalidate bidi, shaping, metrics, and
positioning independently; exact rectangle geometry skips flow when safe; unchanged ordered-direct frames publish an
empty reuse transaction without scanning glyphs. A hard-break regression now skips the deliberately unshaped cluster
before visual-run lookup. Over 25,515 glyphs, eight warmups, and 31 samples, Rust cold/no-op/font-size/full-column
resize/suffix edit/localized edit measure 13.693/0.001/4.090/3.374/13.927/13.986 ms median and
14.111/0.001/4.236/3.706/14.511/14.381 ms p95. The unchanged TypeScript cold/font-size/width/suffix-edit medians are
55.25/11.90/8.36/38.55 ms. The comparison remains provisional because the Rust lane writes one F32 policy lane rather
than Bitmap's complete five-buffer record. The optimized module is 1,060,175 / 400,500 / 316,984
raw/gzip/Brotli bytes; the sequential 76.25 MiB process high-water mark is unresolved memory evidence, not a
per-session budget. All 192 package tests, six fuzz tests, 115 Rust unit tests, and Unicode 17 conformance pass.
