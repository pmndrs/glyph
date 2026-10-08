---
type: Log Entry
title: 'Build-time TypeGPU metadata'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept the repository-pinned TypeScript compiler as `@pmndrs/glyph`'s type and module emitter, then added a post-emit transform over staged JavaScript containing GPU directives. Published `/typegpu` modules and the TypeGPU-backed Slug host carry resolvable shader metadata without requiring consumer bundlers to transform package code; declarations and unrelated modules remain untouched.
