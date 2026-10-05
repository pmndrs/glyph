---
type: Log Entry
title: 'Renderer-agnostic engine boundary planning'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Drafted the proposed next additive milestone around three independent axes: canvas/game-engine host, GPU-authoring layer, and application binding. The plan keeps Bitmap, MSDF, and Slug contracts plus lazy bakers portable; extracts the Three-owned text-generation state machine without accepting its final name; preserves Three.js + TSL as the dual-backend baseline; and requires separate Three.js + TypeGPU and non-Three engine proofs before stabilizing package exports or an adapter API. The canonical roadmap order remains unchanged until maintainer acceptance.
