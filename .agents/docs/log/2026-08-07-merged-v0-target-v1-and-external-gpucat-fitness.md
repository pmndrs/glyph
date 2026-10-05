---
type: Log Entry
title: 'Merged v0, target v1, and external gpucat fitness'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Corrected the planning vocabulary: milestones through 10 produced the merged, unreleased v0 implementation, while milestone 11 implements the target v1 API and earns the first public release only after core and integration gates pass. Recast the pre-extraction API and raster-plugin guide as v0 migration fixtures instead of misnaming the merged implementation. Kept Three, R3F, and TypeGPU behind explicit maintained integration boundaries over renderer-neutral core exports. Reviewed gpucat at pinned commit `11cf91b`, mapped public typed buffers, texture resources, partial update ranges, multi-draw meshes, transforms, render ordering, and scene synchronization onto the target contract, and added an isolated external-package proof gate. Core API fitness passes by source inspection; reusable canonical Slug shader access and visible three-technique output remain executable gates rather than inferred claims.
