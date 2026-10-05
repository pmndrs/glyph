---
type: Log Entry
title: 'Resolved Rust resource references directly in Three'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The Three coordinator now registers each validated Bitmap
page, MTSDF atlas, and Slug analytic page under the same collision-checked numeric identity compiled into the Rust
font binding. A command-buffer `referenceId` resolves in one map lookup; Three does not scan fonts or repeat resource
partitioning. Incompatible technique reuse is rejected. Focused type-check, build, and compiled-Wasm coordinator tests
pass; physical buffer, patch, and draw realization remain open.
