---
type: Decision
title: 'Slug reads the shared outline points'
description: 'Slug renders from the shared outline point buffer instead of its own f16 curve texture, gated on shader speed parity; band tables stay baked and packed by default.'
decision_status: Proposed
decided: '2026-10-06'
generated:
  by: process:docs-new
  at: '2026-10-06T13:09:26Z'
---

# Slug reads the shared outline points

## Decision

**Slug reads its curves from the [outline stream format](outline-stream-format.md) point buffer:**

- a storage buffer on WebGPU, an RG16I integer texture on WebGL2;
- the sample coordinate is scaled to font units once, in the vertex shader;
- band references name point indices.

**Its RGBA16F em-space curve texture is removed.**

**Bands:** band headers, references and records stay baked and packed by default.

- Deriving them at load with `slug-core`, or re-baking from the stream through a curves-in Slug entry point, are options.

**Compute:** a WebGPU compute decoder is optional. WebGL2 has no compute, so the Wasm path is the one that must work everywhere.

## Why

**Wire size:** outlines plus Slug halve (Inter Latin: 59.0 → 28.6 KB brotli with bands shipped; 8.2 KB with bands derived at load).

**Precision:** curves become exact. Slug's f16 em coordinates lose up to 2.0 units on Inter.

**GPU memory:** curve data shrinks 35–40%. Total resident memory drops only 12–13%, because band tables dominate.

**Where f16 came from:** the official reference shaders (EricLengyel/Slug), through the Three Flatland uikit fork. No decision compared it with integer units. See [outline stream research](../outline-stream-research.md).

## Consequences

**Status:** this decision stays Proposed until the [spike](../outline-stream-spike.md) shows shader speed parity on WebGPU and WebGL2.

**What it supersedes:** the `PMNDRS_font_slug` V0 curve-page resource.

**What stays open:**

- line encoding (a midpoint control, or the reference's duplicated endpoint);
- whether u16 references to point indices fit;
- lazy band derivation for CJK;
- raster identity for stream-fed bakes.
