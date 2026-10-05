---
type: Log Entry
title: 'TypeGPU-first shader authority review'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Ran a read-only Claude Opus adversarial review, independently checked its boundary findings against the merged v0 shaders, pinned Three source, official TypeGPU documentation, and the reviewed gpucat source, and added a falsifiable TypeGPU-first research plan. The core batching/revision/attachment model remains renderer-neutral; the specs now expose pre-update raster density, stable batch-key identity, interface-safe exact storage typing, and synchronous target copying without an invented target font lease. Complete shader authority now includes vertex work and resource access, not only fragment coverage. The current `@typegpu/three` bridge is recorded as WebGPU-only and unproven for real Slug/Bitmap resources; native TSL remains the flagship path while TypeGPU is evaluated as a reusable WebGPU program package that does not require a full scene engine. Gpucat's GLSL-companion and render-order-interval limitations are explicit proof gates.
