---
type: Log Entry
title: 'Deleted the duplicate TypeScript raster packing and lifecycle path'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Raster techniques now stop at identity,
artifact decoding, retained CPU resource ownership, and disposal; Rust policy programs remain the only production
instance packers and dirty-range publishers. Removed `RasterRuntime`, candidate/commit staging, glyph selection,
storage allocation, record writers, their obsolete public types, and tests that reconstructed the deleted packers.
A Mori 0.19.1 production scan corroborated the parallel path and separated it from the live ordered-direct and
stable-indirect planners, whose shared draw-emission shape has distinct allocation and retirement semantics. All 154
Rust engine tests, all 161 package integration tests, Unicode 17 conformance, TypeScript, lint, formatting, and OKF
validation pass. The cleanup leaves Wasm unchanged and reduces core JS + Wasm from 461,917 to 460,901 gzip bytes and
complete Three + Wasm from 501,815 to 498,922 gzip bytes, with renderer peers external.
