---
type: Log Entry
title: 'Stopped unchanged retained Three buffer uploads'
generated:
  by: process:docs-new
  at: '2026-10-09T04:26:53Z'
---

Changed Three's retained draw and transform storage from `DynamicDrawUsage` to version-driven `StreamDrawUsage`, while
preserving explicit dirty-range updates for content, count, growth, draw replacement, and transforms on WebGPU and
WebGL2. Corrected detached padded vec3 upload views and completed transform-table disposal across growth, rejection, and
root teardown. See the [Glyph package contract](../packages/glyph.md) and
[benchmark contract](../packages/benchmarks.md).

The new `benchmark:retained-uploads` workflow compared packed installed baseline and candidate artifacts in Chromium 149
under the shared advisory lock. One retained 2,880-glyph, 240-color-span Text rendered 30 unchanged WebGPU frames with
15,244,800 bytes across 600 baseline updates and zero candidate updates; WebGL2's PBO version path was already zero for
unchanged frames and remained zero. Both candidate backends uploaded every changed phase, produced visible readbacks,
and matched the baseline's emitted WGSL/GLSL hashes and ten storage declarations. Focused Three integration tests passed
71/71. These headless CPU submission samples are correctness and upload evidence, not hardware-GPU timing claims.
