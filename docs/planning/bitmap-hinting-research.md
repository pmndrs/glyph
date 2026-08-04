---
type: Research Note
title: Grayscale bitmap hinting and phase packing research
description: Frames hinted grayscale strikes and fractional pixel-phase packing without distance fields or LCD subpixel rendering.
status: draft
tags: [bitmap, hinting, grayscale, raster, atlas, gpu]
sources:
  - id: raster-contract
    resource: raster-data-contract.md
    title: Raster data contract V0
  - id: bitmap-baker
    resource: ../../packages/text/rust/bitmap-baker/src/rasterize.rs
    title: Bitmap baker rasterization implementation
  - id: bitmap-runtime
    resource: ../../packages/text/src/raster/bitmap.ts
    title: Bitmap runtime renderer
  - id: benchmark-evidence
    resource: ../../apps/benchmarks/src/benchmark/targets/product/bitmap-text.ts
    title: Bitmap public-Text product target
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-04T12:55:07Z'
---

# Grayscale bitmap hinting and phase packing research

Status: research follow-up only; it does not expand the Milestone 6 shipping path

## Baseline

The accepted bitmap baseline stores final linear R8 grayscale coverage. The baker preserves the rasterizer's integer pixel placement, the runtime selects a physical `ppem` strike, and the TSL vertex graph snaps every quad edge to the physical framebuffer. At native density the record invariant is exact:

```text
quad width in device pixels  = atlas right - atlas left
quad height in device pixels = atlas bottom - atlas top
```

The benchmark independently CPU-composes the authenticated atlas texels and requires the normalized WebGPU and WebGL2 framebuffers to match every byte. This proves transport and composition. It does not claim that the current unhinted outline rasterization reproduces a browser's platform-dependent grid fitting.

## Candidate: hinted grayscale strikes

True hinting adjusts an outline against a pixel grid before rasterization. A GPU sampling an already baked bitmap cannot reconstruct TrueType instructions, stem relationships, alignment zones, or phantom points. A future hinted mode therefore belongs in the baker and must record its rasterizer and hinting policy in artifact provenance.

The first experiment should compare exact physical strikes with identical font bytes and variation coordinates:

| Candidate           | Stored coverage                                                           | Runtime placement                                                                                               | Cost/risk                                                                                                 |
| ------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Current baseline    | One unhinted R8 mask                                                      | Integer device-pixel snap                                                                                       | Smallest and deterministic                                                                                |
| Hinted single phase | One hinted R8 mask                                                        | Integer device-pixel snap                                                                                       | Same texture width; grid-fitted appearance and metrics require an independent oracle                      |
| Hinted four phase   | Four hinted grayscale masks at `0`, `1/4`, `1/2`, `3/4` horizontal pixels | Preserve continuous shaping advances; select the nearest phase from each glyph's fractional device-pixel origin | Approximately four coverage channels before compression; phase selection and metric policy must be proven |

## Packing hypothesis

RGBA8 can pack the four final grayscale phase masks for one glyph into matching texel coordinates. The shader selects one channel; it does not reconstruct distance, interpolate an outline, or become an SDF technique. Separate R8 pages remain a required comparison because they may stream or compress better and avoid paying for unused phases on devices or sizes where integer placement is sufficient.

The experiment must measure:

- RGBA8 phase packing versus four R8 pages in raw, gzip/Brotli, decoded, and GPU-resident bytes;
- whether phase masks share identical integer bounds or require a conservative union rectangle;
- channel selection without filtering leakage from neighboring phases;
- exact hinted bearings and advance policy without cumulatively rounding HarfRust positions;
- static and variable-font instance identity;
- cold upload, one-draw batching, and real paragraph frame time;
- perceptual improvement against current browser Canvas 2D references while retaining independent rasterizer and CPU/GPU correctness oracles.

## Explicit non-goals

- LCD/ClearType RGB-subpixel rendering is out of scope.
- The design never assumes RGB/BGR panel order, opaque-background subpixel compositing, or display orientation.
- Coverage gamma, contrast, or stem darkening may be measured as presentation adjustments, but they are not described as hinting.
- Runtime outline rasterization, a GPU hinting interpreter, and distance-field reconstruction are not part of this experiment.

## Promotion gate

No hinted or phase-packed format enters the public raster descriptor until a maintained hinting implementation is selected, source and artifact provenance are versioned, an independent glyph bitmap/metric oracle exists, real product frames improve at representative ppem values, and the byte/performance trade is reviewed. Until then the universal behavior remains exact unhinted grayscale coverage at native density.
