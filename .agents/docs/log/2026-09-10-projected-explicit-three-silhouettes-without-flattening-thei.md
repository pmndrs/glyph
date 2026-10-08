---
type: Log Entry
title: 'Projected explicit Three silhouettes without flattening their concavity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`projectTextFlowSilhouette` accepts an
ordered finite object-local `Vector3` ring, clips it through the camera-side text plane and camera frustum, ray-projects
it into paragraph flow coordinates, and returns the existing normalized keyed exclusion. Zero-inflation projections
preserve validated simple concavities; declared error inflation remains conservatively convex. Seven focused package
tests cover the existing bound path plus concavity, clipping, fully hidden geometry, and malformed caller rings.
