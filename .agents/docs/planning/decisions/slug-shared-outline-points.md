---
type: Decision
title: 'Slug reads the shared outline points'
description: 'Slug renders from the shared outline point buffer instead of its own f16 curve texture, gated on shader speed parity; band tables stay baked and packed by default.'
decision_status: Proposed
decided: '2026-10-06'
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
---

# Slug reads the shared outline points

## Decision

This records decisions 5 and 6 on #244. The maintainer called the plan sound; the move itself is gated on shader speed parity, so this record stays Proposed.

**Proposed: Slug reads its curves from the [outline stream format](outline-stream-format.md) point buffer:**

1. Scale the em-space sample coordinate by `unitsPerEm` once, in the vertex shader, so the fragment shader works in font units.
2. Replace the two-texel curve fetch with the three-point read: a storage buffer on WebGPU, an integer texture on WebGL2 (RG16I in the [spike](../outline-stream-spike.md)). Slug already uses R32UI/R16UI integer textures on WebGL2.
3. Band references name point indices instead of curve texels.

The root solve, coverage and dilation stay the same. **Its RGBA16F em-space curve texture is removed.**

**Settled: band tables stay baked and packed by default** (decision 6). The maintainer: "baking slug tables is likely fine and packing them for faster loading, deriving may be slow". This holds whichever way the parity gate goes.

- **Default:** ship today's band headers, references and records, retargeted at point indices. They load with no CPU work.
- **Option, derive at load** with `slug-core::build_glyph_geometry`, which already takes quadratics and contour starts: 8–31 µs per glyph and +9.3 KB gzip of Wasm. Latin is 2–5 ms per font; CJK 2.004 takes 2.0 s eagerly, so it must be lazy per glyph.
- **Option, runtime re-bake** through the Slug baker from the stream's curves. This is not wired: `bake_slug` takes the source font bytes and checks the source fingerprint (`packages/glyph/rust/slug-baker/src/artifact.rs`), so it needs a curves-in entry point.

**Provisional parts** (maintainer, 2026-10-06):

- Baked, packed bands by default, and the optional WebGPU compute decoder, are provisional until the spike's numbers are in.
- **A WebGL2 path is mandatory, even if it runs on the CPU.** No runtime decoder ships without one. WebGL2 therefore gets the Wasm decode plus an integer-texture upload, and compute is only ever an extra on WebGPU.

## Why

**Wire size:** outlines plus Slug halve with bands shipped (Inter Latin: 59.0 → 28.6 KB brotli; Inter full: 454 → 233 KB). Deriving bands at load would take Inter Latin to 8.2 KB.

**Precision:** curves become exact. Slug's f16 em coordinates lose up to 2.0 units on Inter, with 0.83% of coordinates off by 0.5 units or more.

**GPU memory:** curve data shrinks 35–40%. Total resident Slug memory, compared unpadded on both sides, drops only 12–13% (Inter full: 1.81 → 1.57 MB), because band tables dominate. The first study write-up said GPU memory "roughly halves"; that compared today's padded texture pages with unpadded proposed data and was corrected.

**Why Slug stores f16 today:**

- The official reference shaders, [EricLengyel/Slug](https://github.com/EricLengyel/Slug) by Eric Lengyel, specify a curve texture of four 16-bit float channels holding em-space control points, endpoint-shared across texels. The patent is dedicated to the public domain; the code is MIT or Apache-2.0, and distributed use must give credit.
- `PMNDRS_font_slug` V0 adopted that layout through the Three Flatland uikit fork. No decision compared it with integer font units.
- f16 has 11 significant bits, so at 1 em the step is 2^-10 em, about 2 units at 2,048 units per em.
- The integer alternative costs nothing per curve: one scale in the vertex shader, then integer fetches.

## Consequences

**Status:** the move onto the shared buffer stays Proposed until the [spike](../outline-stream-spike.md) shows shader speed parity on WebGPU and WebGL2. A new decision record then accepts or rejects it.

**What it would supersede:** the `PMNDRS_font_slug` V0 curve-page resource.

**What stays open:**

- line encoding: #235's midpoint control (zero t² term, so `solve-quadratic.ts` takes its linear path below `|a| < 1/65536`) or the reference's duplicated endpoint `{p1, p2, p2}`. The point buffer stores no control point for lines, so the shader can synthesize either;
- whether u16 references to point indices still fit per glyph;
- lazy band derivation for CJK;
- raster identity for bakes made from the stream instead of the source font.

**Variable fonts:** bands built for the default instance are wrong at other instances. See [variable fonts in the outline stream](variable-font-outline-stream.md) for the conservative-band direction.
