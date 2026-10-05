---
type: Log Entry
title: 'Started the production LayoutRun cutover'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`ClusterArena` now retains maximal shaping-compatible runs in normal
execution. Flow extents consume those runs as their single production traversal, while boundary-free, zero-indent,
trivial-order positioning—including justification—reuses one run geometry tuple and preserves the existing f64 pen
sequence and f32 publication narrow. Bidi, boundary, and indent cases remain on the shared cluster-emission authority.
TypeGPU placement must join the existing scene bind group rather than consume a fifth group alongside both callbacks.
