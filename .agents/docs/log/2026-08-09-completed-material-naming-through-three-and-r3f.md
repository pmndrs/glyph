---
type: Log Entry
title: 'Completed material naming through Three and R3F'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the obsolete `ThreeRenderVariant` generic and every
`renderVariant` property, setter, span field, comparison, and no-op binding hook from the command-buffer-backed public
adapters. `material` is now the sole authored name through numeric Rust `materialId` and renderer factory realization;
legacy core/TypeGPU variants remain scoped to the path awaiting deletion.
