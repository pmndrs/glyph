---
type: Log Entry
title: 'Prevented test-only Wasm variants from entering published baker artifacts'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Distributable MTSDF and Slug
artifact-baker builds and the optional SIMD compatibility switch now use feature-specific Cargo target directories;
the MTSDF kernel test uses a separate target. The package build rejects any optimized baker missing an export declared
by its Rust-generated TypeScript ABI. The full MTSDF artifact remains 552,025 bytes with SHA-256 `ec6eb164…7de8` before
and after the 60,993-byte kernel-only test. Generated ABI constants replace instance-ignoring or duplicate reader
functions across the font, Bitmap, MTSDF, and Slug baker hosts.
