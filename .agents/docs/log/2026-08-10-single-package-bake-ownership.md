---
type: Log Entry
title: 'Single-package bake ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Folded the portable font-baker Rust/Wasm source, TypeScript bridge, validator, schemas, tests, and build tooling into `@pmndrs/glyph`. `@pmndrs/glyph/bake` is now the sole programmatic product surface, while package-boundary tests prove the ordinary root import retains no eager edge to baker Wasm, `std`-enabled subsetting dependencies, Ajv, or glTF Validator.
