---
type: Engineering Plan
title: Outline stream GPU spike
description: "Temporary spike that renders identical glyph grids through Slug's f16 curve texture and through the shared i16 outline point buffer on WebGPU and WebGL2, to settle the shader speed-parity gate, plus a CPU decode comparison against #235."
tags: [outlines, slug, gpu, webgpu, webgl2, spike, benchmark]
sources:
  - id: research
    resource: outline-stream-research.md
    title: Outline stream research
  - id: slug-decision
    resource: decisions/slug-shared-outline-points.md
    title: Slug reads the shared outline points
  - id: format-decision
    resource: decisions/outline-stream-format.md
    title: Outline stream format
generated:
  by: anthropic/claude-code
  at: '2026-10-06T14:00:00Z'
status: draft
---

# Outline stream GPU spike

## Purpose

[Slug reads the shared outline points](decisions/slug-shared-outline-points.md) stays Proposed until the shader shows speed parity. That shader is the three-point read from the i16 point buffer, compared against Slug's RGBA16F curve texture on WebGPU and WebGL2. No GPU was available while the [research](outline-stream-research.md) ran.

The maintainer asked for a draft branch to run on a local GPU, "comparing main vs new algo", with temporary spike code preferred over a full implementation. This spike measures the gate on a maintainer's machine. It is temporary code under `spikes/outline-stream/`:

- outside the pnpm workspace;
- with no package exports and no CI wiring;
- to be deleted or refactored into `packages/glyph` once the decision is settled.

## What it compares

| Variant               | Curve data                                                                             | Band references                               | Shader curve fetch                                                    |
| --------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| **A, today's layout** | RGBA16F endpoint-shared curve texels in em units, as `PMNDRS_font_slug` V0 stores them | u16 texel offsets from the glyph's curve base | Two texel loads per curve, as in the reference `SlugPixelShader.hlsl` |
| **B, shared points**  | i16 point words in font units: `(x << 1) \| offCurve`, `y`                             | u16 point offsets from the glyph's point base | Three point loads per curve plus the implied-on-curve rule            |
| **main** (optional)   | The real `.slug.glb` baked by today's CLI                                              | V0 records                                    | Same as A                                                             |

**Main against the new algorithm:** A models main's curve layout and fetch so that only the fetch differs from B. The main variant is the check that A times and renders like today's real bake; run it whenever `prepare` can bake the font.

**Same everything else:** A and B share one band partition, curve set, sort order, glyph grid, coverage and dilation code. Only the curve fetch differs, so the timing difference is the cost of the read rule and the integer fetch.

**Toggle in B:** lines can use a midpoint control (`{p1, mid, p2}`) or the reference's duplicated endpoint (`{p1, p2, p2}`), to settle the line-encoding gate.

## Asset format

`prepare` writes `out/<font>.spike.json` and `out/<font>.spike.bin`. The JSON gives metadata plus the `{ offset, length }` of each binary section. Everything is little-endian.

| Section       | Contents                                                                                                                                                        |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `glyphs`      | Per glyph, 32 bytes: `curveBase u32`, `pointBase u32`, `bandBase u32`, `hBands u16`, `vBands u16`, then bounds `minX, minY, maxX, maxY` as f32 font units.      |
| `curvesF16`   | Variant A: RGBA16F texels (`x1, y1, x2, y2`) in em units. A curve is two consecutive texels; contours share endpoint texels as in V0. 4096 texels per row.      |
| `pointsI16`   | Variant B: one RG16I texel per point. Per contour: rotated to start on an on-curve point, with a wrap point appended. 4096 texels per row.                      |
| `bandHeaders` | One u32 per band: `(refCount << 16) \| refOffset`, relative to the glyph's `bandBase`. Horizontal bands first, then vertical. Shared by A and B.                |
| `bandRefsA`   | u16 curve texel offsets from `curveBase`, per band, sorted by descending max x (horizontal) or max y (vertical).                                                |
| `bandRefsB`   | u16 point offsets from `pointBase`, in the same order as `bandRefsA`. A reference names an off-curve point (a quadratic) or the first on-curve point of a line. |

**Bands:** built once with `slug-core::build_bands` over the shared curve set.

- Both variants use identical band boundaries and order.
- Axis-flat lines are excluded from the matching axis, as the reference README requires.

**Curve set:**

- **TrueType** fonts use their quadratics exactly.
- **CFF** fonts use `slug-core::cubic_to_quadratics_into(…, 4)` for the spike, so curve sets match today's Slug. Bake-time cu2qu is a separate gate.
- **Composites** are expanded.

## Harness

`serve` starts a static server; the browser page runs all variants on one canvas size.

**Grid:** a fixed glyph grid (the Latin set repeated) at 12, 32, 128 and 512 px per em, plus a full-screen single-glyph magnification view.

**Timing, median ms per frame over N frames after warm-up:**

- **WebGPU:** `timestamp-query` when available, otherwise wall time around `queue.onSubmittedWorkDone()`.
- **WebGL2:** `EXT_disjoint_timer_query_webgl2` when available, otherwise wall time around `gl.finish()`.

**Pixels:**

- A and B are read back and compared: max and mean absolute difference, and the count of pixels differing by more than 1/255.
- The page shows a diff image.

**Output:** a results table on the page, and the same results printed as JSON to the console for pasting into #244.

## CPU comparison

`cpu-bench` runs in Node 22 and compares:

- **#235:** its shipped `outlineAt()` decode, the dist shaper's `glyphOutline` export plus the JS reader, over every glyph of Inter.
- **This design:** the scalar triplet decoder plus point-layout emitter, built from the research decoder crate.
- **Variable fonts:** decode plus f32 SIMD instancing, from the research instancer crate, on Inter VF, when a variable font is supplied.

## Running locally

From `spikes/outline-stream/` (see its README for the exact commands):

1. Build the package once with the pinned toolchain.
2. Run `prepare` to bake each fixture font with today's CLI (variant main) and run the spike encoder (variants A and B).
3. Run `serve`, open the printed URL in Chrome (WebGPU and WebGL2) and in Safari or Firefox (WebGL2), and press Run.
4. Run `cpu-bench` for the CPU numbers.

## Done when

- Results exist for at least one integrated and one discrete GPU, on WebGPU and WebGL2, at all four sizes.
- B is within noise of A, or the difference is explained.
- The A–B pixel difference is explained by f16 quantization, with no structural errors (no missing or extra curves) in the magnified view.
- The line-encoding toggle has a recommendation.
- The numbers are posted on #244, and [Slug reads the shared outline points](decisions/slug-shared-outline-points.md) is moved to Accepted or Rejected by a new decision record.
