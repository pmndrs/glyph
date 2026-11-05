---
type: Log Entry
title: 'Added a supplied-bounds Three culling experiment'
generated:
  by: process:docs-new
  at: '2026-11-05T02:09:00Z'
---

Added an opt-in [Three batch culling experiment](../reports/three-batch-culling-experiment.md) for #236, rooted on
main `4e25a96a5`, without changing production culling. Supplied fixture envelopes feed Three's native frustum traversal
after normal matrix updates. The recorded Apple GPU run passed 18 exact pixel comparisons per backend/transform-mode
combination, actual displaced-material opt-out/supplied bounds, and an incorrect-bound negative control. Raw samples
separate scene update, bounds, native object tests, submission and GPU timing, including identically reset moving/editing
observations. The Glyph build and all 122 Three integration tests passed. Benchmark type/lint/format checks, 159 unit
tests, 24 workflow tests, browser conformance and production build passed; the loopback test required an unsandboxed
rerun after an initial EPERM. Final instrumentation received focused static and GPU reruns. Full repository Rust/check
and installed-package Labs were not run locally. The report documents unsupported raster/resource/transform cases and
why compatibility and reduced draw calls do not establish a net speedup. See the [benchmark package](../packages/benchmarks.md).
