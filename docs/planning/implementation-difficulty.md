---
type: Planning Estimate
title: Rendering implementation difficulty
description: Compares the relative effort to make bitmap, MSDF, and Slug rasters correct and performant.
tags: [planning, rendering, effort]
sources:
  - id: "citation-1"
    resource: "https://lup.lub.lu.se/luur/download?func=downloadFile&recordOId=9024910&fileOId=9024911"
    title: "GPU-accelerated text rendering thesis"
  - id: "citation-2"
    resource: "https://github.com/texel-org/windfoil"
    title: "texel-org/windfoil"
  - id: "citation-3"
    resource: "https://github.com/thejustinwalsh/three-flatland/blob/feat/uikit-fork/planning/perf/slug-uikit-shader-perf-plan.md"
    title: "Three Flatland Slug/uikit performance plan"
  - id: "citation-4"
    resource: "../../RESEARCH.md"
    title: "Research bibliography"

generated:
  by: "openai-codex/gpt-5"
  at: "2026-07-25T01:24:00Z"
---

# Rendering implementation difficulty

Status: proposed planning estimate  
Scope: raster generation and rendering, not shaping or paragraph layout

This ranking separates two different problems:

1. making a technique render correctly with the shared glyph-ID and metric model;
2. making the complete baker, payload, loader, and renderer performant enough to recommend.

Scores are relative planning estimates from 1 (lowest effort/risk) to 5 (highest). They are not schedule estimates. A technique moves only when prototypes and checked-in measurements replace the estimate.

## Ranked summary

| Rank | Technique | Make it work | Make it performant | Primary difficulty |
| ---: | --- | :---: | :---: | --- |
| 1 | Generated grayscale bitmap strikes | 2 | 2 | Deterministic rasterization, bounds, atlas packing, and optional hinting; the runtime shader is simple. |
| 2 | MSDF | 3 | 2 | MTSDF edge coloring, field generation, padding, and atlas quality are harder than the runtime sampling path. |
| 3 | Slug | 4 | 5 | Correct curve/band generation and robust analytic coverage are followed by fill-bound per-fragment curve work. |
| — | Windfoil (research only) | 5 | 5 | General-vector technique outside the current text roadmap; no implementation is planned. |

## 1. Generated bitmap strikes

### Make it work

The minimum useful implementation rasterizes a canonical outline at selected ppem values, crops it, packs it into an atlas, and emits plane/atlas bounds keyed by the shared glyph ID. An unhinted grayscale implementation is comparatively direct.

The difficulty rises if V1 requires TrueType hinting, LCD/subpixel output, native/Wasm byte-identical output, or authored bitmap-font ingestion. Those are separate capability decisions rather than reasons to complicate the first strike generator.

### Make it performant

Rendering is a texture sample over a quad and should establish the practical performance floor. Optimization work is primarily atlas occupancy, batching, texture format, mip/sampler policy, upload, and avoiding unnecessary strikes.

### Initial role

Use for tiny text with known pixel sizes and for deliberately raster-styled content. It is not the general scaling or perspective solution.

## 2. MSDF raster

### Make it work

The renderer is straightforward once correct atlas data exists. Most implementation risk is in the baker:

- canonical outline conversion and edge coloring;
- deterministic MTSDF atlas generation in native and worker Wasm;
- padding and distance-range conventions;
- multi-page atlas packing;
- linear texture sampling and correct plane bounds;
- quality fixtures for corners, thin features, overlap, and minification.

### Make it performant

Runtime cost is bounded and texture-oriented. Expected work is atlas occupancy, compression/upload choices, batching, layer padding, and selecting an appropriate generation scale and distance range. These are conventional GPU optimization problems compared with an analytic curve shader.

### Initial role

Proposed general-purpose default for UI and world-space text when an application has no stronger constraint.

## 3. Slug

### Make it work

Three Flatland supplies substantial prior art, but the implementation still has to be reworked around the shared font container and direct GPU payloads. Correctness includes robust quadratic solving, curve classification, band generation, fill rules, antialiasing, transform behavior, and identical packed-glyph indexing across rasters.

The new implementation should treat the quality-preserving improvements already measured in the Three Flatland Slug/uikit fork as baseline requirements where they apply:

- dynamic band-curve loops instead of a fixed loop ceiling;
- explicit shader-variable hoisting after inspecting generated WGSL/GLSL;
- structural branches that avoid eagerly evaluating expensive alternatives;
- compact one-channel band headers/references where exact encoding is preserved;
- complete identical-band-list deduplication;
- exact quadratic bounds to reduce avoidable overdraw.

These need to be ported or reproduced with attribution and tests; commit hashes from another codebase are evidence, not a drop-in implementation specification.

### Make it performant

This is the hardest initial backend to optimize because its cost scales with covered fragments and relevant curves. The prior fork found a fill-bound floor and achieved approximately 19% compounded GPU improvement on its measured ladder, plus a band-texture reduction from 4 MB to 2 MB. It also found that some plausible optimizations were neutral for Latin and useful only for dense CJK or complex SVGs.

Performance work therefore needs separate Latin, CJK, icon, complex-outline, magnification, minification, and perspective workloads. Candidate adaptive band counts and hull-assisted early exits must not become defaults without those measurements.

### Initial role

Use when outline fidelity under large or dynamic scaling justifies higher fragment cost.

## Research-only: Windfoil

### Make it work

Windfoil is not a shader swap for Slug. It requires xy-monotone curve subdivision, its own row-band representation and metadata, duplicated curve pieces where subdivision requires them, a new renderer, and an integration/compatibility strategy beyond the current WebGPU/WGSL research implementation.

It also needs validation of winding-fold limitations, transformed pixel footprints, deep-zoom precision, font corpus behavior, WebGL requirements, provenance, and possible prior-art/patent concerns identified by its own repository.

### Make it performant

The official and Three Flatland comparisons place its likely advantage at high magnification, exact overlap/self-intersection cases, hairlines, and band memory—not ordinary UI text. The shader performs more arithmetic per candidate curve than public Slug. A production optimization effort would therefore begin with a narrower market and fewer transferable results.

### Initial role

Research reference only. Its precise niche is deeply zoomable, overlap-heavy vector art and hairlines. It is not planned for ordinary text or XR UI, and it does not enter the implementation sequence.

## Shared implementation order

The recommended sequence is:

1. define the shared raster directory, glyph-ID contract, and direct-upload records;
2. build the minimal shared baker and generated bitmap strike to prove the required Node/Worker convergence without adding advanced compiler units;
3. establish baked-hit, worker-fallback, runtime shaping, paragraph, loader, and renderer baselines;
4. later implement the MSDF module and its MTSDF generator as the proposed general-purpose path;
5. port/rewrite Slug with the already proven quality-preserving optimizations in its baseline;
6. run the autoresearch loop against Slug and shared GPU infrastructure;
7. retain Windfoil only as research; prototype it in a separate vector package only if product scope expands or measured production evidence matches its niche.

This ordering does not require the package to expose the techniques in the same sequence. It minimizes the amount of novel shader and preprocessing work required to validate the shared architecture.

## Evidence required to revise the ranking

- checked-in native and worker bake timings;
- direct GPU upload measurements;
- representative visual/conformance fixtures;
- GPU frame-time distributions across the target browser/device matrix;
- payload and retained GPU memory reports;
- implementation maintenance and dependency-size evidence.

The source basis for the current estimates is maintained in [`RESEARCH.md`](../../RESEARCH.md), especially the Alvin thesis, Three Flatland Slug audit, Windfoil entry, and renderer-specific references.
