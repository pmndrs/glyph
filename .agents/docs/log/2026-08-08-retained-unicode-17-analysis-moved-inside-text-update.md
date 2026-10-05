---
type: Log Entry
title: 'Retained Unicode 17 analysis moved inside `text_update`'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The shared Unicode generator now emits compact Rust
Script/Script_Extensions partitions beside the TypeScript tables. A no-std Unicode 17 grapheme iterator validates
UTF-16, preserves UTF-16 boundaries, resolves contextual scripts, and reuses pre-reserved active/pending session
arrays. Analysis commits and aborts with text/styles and is skipped for unchanged text. Rust tests, host/SIMD Clippy,
and focused compiled-Wasm tests pass. Optimized Wasm is 964,019 / 360,765 / 288,742 raw/gzip/Brotli bytes. Bidi/run
intersection, fallback shaping, layout, nonempty plan output, and complete-path timing remain open.
