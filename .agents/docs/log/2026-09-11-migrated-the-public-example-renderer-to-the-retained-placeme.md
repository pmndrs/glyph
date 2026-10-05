---
type: Log Entry
title: 'Migrated the public example renderer to the retained placement contract'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The root gauntlet caught its custom
Codec still declaring the removed direct f32x2 occurrence buffer. Its Codec now declares only stable glyph identity and
the required engine placement slot. The deterministic adapter consumes the root-scoped placement table and resolves
slots into its own direct f32x2 stream, keeping backend memory layout out of portable raster authoring while preserving
the example's simple vertex pipeline. The package's five focused tests and strict TypeScript/lint/format gate pass.
