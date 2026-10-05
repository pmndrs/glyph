---
type: Log Entry
title: 'Cut imperative Three rendering over to the Rust command buffer'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the public binding's private
`ParagraphBatch` plus attachment `prepare`/`commit` state machine with one retained Rust session and renderer
executor. A `TextGroup` now submits every descendant paragraph in one update and owns shared draws; standalone text
uses the same path with its own root. Public `material` definitions resolve through Rust `materialId`, while scene
transforms and render-order bases remain renderer-local. Focused compiled-Wasm tests prove mixed-font spans, one
indexed draw across two public text transforms, retained custom material realization, reparenting, and disposal.
Rendering deliberately does not publish layout arrays, and the old Three layout/snapshot/origin surface is removed;
a future interaction or measurement query remains separate.
