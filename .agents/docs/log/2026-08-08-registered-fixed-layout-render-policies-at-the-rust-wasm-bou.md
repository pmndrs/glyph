---
type: Log Entry
title: 'Registered fixed-layout render policies at the Rust/Wasm boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added compiler-derived `#[repr(C)]` policy
headers and fixed-width program, buffer, and operation records to the existing generated shaper ABI. Registration
performs one bounded direct-memory decode, rejects overlapping tables, forged lengths, nonzero reserved fields,
noncanonical op encodings, and semantically incomplete programs, then retains typed Rust policy state independent of
the caller's allocation. Identical handle registration is idempotent, conflicting registration is observable, and
disposal is exact. No JSON, string dispatch, runtime reflection, or frame-path schema decode entered the Wasm module.
Twenty-one Rust unit tests, both complete Unicode 17 bidi conformance suites, and a real optimized-Wasm lifecycle test
pass. Making validation and lifecycle reachable grows the optimized shaper from 680,312 to 698,238 raw bytes, from
253,568 to 260,228 gzip bytes, and from 199,365 to 203,760 Brotli bytes; this is registration-time infrastructure, not
evidence of frame-path performance. As expected for unreachable hot-path code, the 25,515-glyph comparison remains
within run variance: cold/font-size/layout-width/text medians move from 55.28/12.02/8.42/38.66 milliseconds to
52.48/11.92/8.23/38.73 milliseconds, with corresponding p95 values of 69.57/14.87/11.07/41.06 milliseconds.
