---
type: Log Entry
title: 'Avoid unused varying nodes in default Three materials'
generated:
  by: process:docs-new
  at: '2026-10-19T16:57:04Z'
---

In [the Glyph package](../packages/glyph.md), built-in Three material cache misses previously constructed two
`vertexStage()` nodes before checking whether a custom material factory existed. The default material used the raw
vertex graph, leaving both nodes unused. The shared material helper now creates them only for a custom factory. Its
`undefined` result still falls back to the raw default material, and the selected material is owned once. Cache keys,
cache-hit returns, external raster programs, and public context types are unchanged.

Installed Three.js 0.185.1 implements `vertexStage(node)` through `varying(node)`, whose proxy constructs a
`VaryingNode`. The change therefore removes two such constructions per built-in default cache miss; custom misses
still construct two and now spread the raw context into one additional factory-context object. This is a bounded
graph-construction result, not a measured latency or frame-rate gain. The exact `e4498972` baseline and candidate
builds have the same 238 JavaScript member paths; only `three/internal/material-realizer.js` changes, shrinking from
3,993 to 3,959 bytes under the same Node.js gzip level 9 method.

The full Glyph check, the focused material shader tests, and the existing composed-material proof passed. The
material-position browser proof passed all 16 stable TSL and TypeGPU combinations across WebGPU, WebGL2, direct and
indexed transforms, and displacement through an isolated Portless route.

All 227 declaration members and the tracked Rust/generated ABI inputs are byte-identical to the baseline. Three rebuilt
baker Wasm files differ for an unestablished reason despite matching source/build inputs; text-shaper and Slug are
byte-identical. Matching import/export names and kinds do not prove full binary function-signature equivalence. No
whole-package causal performance result or all-binary-identity claim is made from this comparison.
