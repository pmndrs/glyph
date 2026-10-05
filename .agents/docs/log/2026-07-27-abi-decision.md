---
type: Log Entry
title: 'ABI decision'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Accepted compiler-derived direct-memory contracts: fixed-width `#[repr(C)]` layouts, Rust `size_of`/`align_of`/`offset_of!` generation of portable JSON and typed TypeScript, freshness checks, and a full generated-resource regression sweep. This avoids both numeric layout mirrors and runtime schema/generator cost. WebAssembly's guaranteed little-endian memory order does not replace explicit byte-order handling for portable GLB, KTX2, SFNT, or extension formats.
