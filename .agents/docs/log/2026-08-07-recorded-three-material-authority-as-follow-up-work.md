---
type: Log Entry
title: 'Recorded Three material authority as follow-up work'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Applications can compose colour over the exported canonical shaders today, but only by registering a whole raster program, and the program-owned `MeshBasicNodeMaterial` writes no depth, so text cannot be lit, cast or receive shadows, or take part in depth-composited effects. Captured a proposal that render variants carry an optional material factory over those shaders, resting on the fact that core already splits ordered runs by variant and so already produces a separate draw per variant. Recorded as a draft research concept rather than an accepted design: maintainers have identified incorrect edges that remain unresolved, and the concept lists the open questions, including whether glyph coverage drives a shadow-casting depth prepass cleanly, what a per-variant material means for paint core has already resolved into canonical instance storage, and whether two variants differing only by material stay safely coalescable. Also noted that the separate request for text as a sampled function is satisfied today by rendering a group to a render target, which needs no package change and should be documented.
