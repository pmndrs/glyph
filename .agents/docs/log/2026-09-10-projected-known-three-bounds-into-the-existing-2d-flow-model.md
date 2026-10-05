---
type: Log Entry
title: 'Projected known Three bounds into the existing 2D flow model'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`projectTextFlowBounds` accepts one caller-known
conservative object-local `Box3`, the current object/text transforms, a perspective or orthographic camera, and authored
paragraph-flow bounds. It intersects the six transformed box planes, camera-side text plane, and six camera-frustum
planes as one convex half-space volume, projects the surviving vertices back onto text-local inline/block coordinates,
inflates declared projection error, clips to the flow rectangle, and returns the existing normalized keyed
`TextFlowExclusion`. Bounds wholly behind the text plane return no exclusion; noninvertible transforms, a camera on the
text plane, and degenerate orthographic plane projection reject before producing geometry. Four focused package tests
cover both camera types, crossings, a box enclosing the frustum, flow clipping, and quantized no-op movement. This is
camera-to-text-plane occlusion only; explicit silhouettes, drop caps, and live browser evidence remain open.
