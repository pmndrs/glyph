---
type: Log Entry
title: 'Reusable HarfRust initialization workspace'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Module initialization now reserves HarfRust's real 32,768-codepoint
info/position allocation and a reusable UTF-16 context array beside the existing plan/gather arena. Segment shaping
returns that allocation through `GlyphBuffer::clear` on success and restores it on fallible setup without boxing.
Optimized Wasm initialization grows 57 pages in total (25 new pages for shaping/context), repeated initialization
preserves `memory.buffer`, focused compiled-Wasm shaping/frame tests pass 11/11, and the module measures 847,814 raw /
315,809 gzip / 249,629 Brotli bytes. Legacy batch-result vectors and the not-yet-landed bidi/layout arrays remain
explicit allocation gaps rather than being included in the claim.
