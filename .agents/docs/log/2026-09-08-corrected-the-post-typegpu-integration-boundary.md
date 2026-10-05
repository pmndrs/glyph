---
type: Log Entry
title: 'Corrected the post-TypeGPU integration boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Published renderer-free shader realizations as the explicit
`/shaders/tsl` and `/shaders/typegpu` siblings, retained `/three/typegpu` as the isolated Three experiment, and kept
`/typegpu` as the narrower direct renderer. Packed-consumer builds now prove the root and stable Three entry never
request optional TypeGPU peers, while TypeGPU entries declare and require them. Focused Bitmap-plus-decoration evidence
holds the custom-material contract equal across both Three configs. The physical source mirrors those dialect paths,
each Slug leaf deliberately exports its reusable primitives, and deep shader implementation modules remain private.
Shared Three types and config construction no longer pull native TSL into `/three/typegpu`. Package-size gates price
`/three`, `/three/typegpu`, and direct `/typegpu`; shader barrels retain package-resolution, graph-isolation, and
tree-shaking proofs without a redundant per-technique size matrix. No shader algorithm changed.
