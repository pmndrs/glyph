---
type: Log Entry
title: 'Separated semantic measurement from the render plan'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Activated the existing `semanticViewMask` for an explicit
retained-Rust measurement query while ordinary rendering continues to request zero semantic records. The first view
publishes one paragraph summary plus its line records in the immutable A/B sidecar; Three's command-buffer executor
ignores it. Public `Text.layout()` caches the frozen result until a committed semantic update. Rust exact and
at-most/overflow tests plus a compiled-Wasm Three lifecycle prove the query retains the existing mesh and does not
restore renderer-side positioned arrays.
