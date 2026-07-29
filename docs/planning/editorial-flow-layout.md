---
type: Design Research
title: Responsive editorial flow and mixed-raster composition
description: Defines the post-V1 layout model and benchmark for responsive multi-column text around exclusions rendered with bitmap, MTSDF, and Slug.
tags: [layout, benchmark, typography, exclusions, bitmap, mtsdf, slug]
sources:
  - id: 'pretext'
    resource: 'https://github.com/chenglou/pretext'
    title: 'Pretext'
  - id: 'pretext-playground'
    resource: 'https://pretextjs.dev/playground'
    title: 'Pretext playground'
  - id: 'benchmark-plan'
    resource: 'benchmark-plan.md'
    title: 'Benchmark plan'
  - id: 'roadmap'
    resource: '../roadmap/roadmap.md'
    title: 'Canonical implementation roadmap'

generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-27T01:29:13Z'
---

# Responsive editorial flow and mixed-raster composition

Status: accepted post-V1 direction; API and performance conclusions remain evidence-gated

## Recommendation

Add responsive flow regions and a mixed-raster editorial benchmark after Slug and the V1 release gate. Do not expand V1's box-constrained paragraph contract to fit this work prematurely.

The benchmark should be a typographic composition that needs all three first-party techniques:

- Slug for a transformed or oversized display headline and drop cap;
- MTSDF for a medium-sized pull quote or callout that must remain clean through responsive scaling;
- native-strike bitmap text for small body copy, captions, folios, and marginalia;
- one shared shaping and positioned-layout source beneath every raster so selecting a rendering technique never invents independent typography.

This is a benchmark surface for interactive cost and visual judgment. Smaller conformance cases separately prove safe breaks, exclusion geometry, renderer agreement, bidi behavior, and absence of overlap.

## What Pretext proves

Pretext demonstrates that useful editorial wrapping does not require a browser layout tree. It prepares Canvas-measured segments once, then performs line breaking with cached widths and pure arithmetic. Its streaming line API accepts a different available width for each line, while its examples derive those widths by subtracting image or projected-object obstacles.

The 3D Object Textwrap demonstration is therefore important prior art for the interaction, not a complete text-rendering architecture to copy. The caller projects an obstacle into screen-space exclusion intervals and gives the line breaker the remaining space. Pretext intentionally stops short of exact custom-renderer glyph positions for complex scripts and mixed-direction text; its browser measurements are designed primarily for line-breaking compatibility.

Dynamic obstacle wrapping alone is not a differentiator: Pretext already demonstrates it. The pmndrs/text opportunity is to combine that interaction with exact HarfRust glyph identity and positioning, Unicode paragraph policy, deterministic conformance, and one GPU-ready output that can feed bitmap, MTSDF, and Slug without a second shaping system.

### Two different meanings of dynamic

Performance claims must distinguish geometry changes from content changes:

| Change                                                | Pretext                                                                                                                                                | pmndrs/text direction                                                                                                                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same text, new width or obstacle                      | Reuses prepared segment widths; line walking is allocation-light arithmetic and should be treated as a strong baseline.                                | Reuses broad shaping and cluster measurements; replans slots and reshapes only affected unsafe boundaries.                                                                                           |
| Edited or typewriter text                             | A changed string requires another `prepare` analysis/measurement result, although shared internal measurement caches may still help repeated segments. | Reanalyzes and shapes changed content; the intended advantage is incremental paragraph state with exact clusters and direct reuse by the GPU renderer, not an assumption that HarfRust work is free. |
| Same layout, moving presentation                      | Rendering is caller-owned; Pretext produces line strings or ranges rather than positioned GPU glyph instances.                                         | Reuses committed layout and can update or interpolate instance presentation without reshaping.                                                                                                       |
| Changed features, variations, script, or bidi content | Canvas measurement is the browser ground truth for widths, but the documented result is not an exact custom-renderer glyph stream.                     | HarfRust produces the authoritative glyph IDs, positions, clusters, and flags consumed by every renderer.                                                                                            |

The showcase should exercise all four lanes and label them separately. Repeated resizing is not enough to establish an advantage because it is already Pretext's optimized hot path. Editable complex-script content, local invalidation, and direct GPU publication are the more meaningful product test, but they still require measured evidence.

## Current boundary

V1 lays out horizontal text in a rectangular `ParagraphConstraints` box. It can reshape changed line boundaries efficiently, but it does not represent columns, holes, floats, arbitrary contours, or more than one usable interval on a baseline. An oversized letter can be rendered beside a box today, but body text cannot correctly flow around its contour.

The shaping engine is not the missing piece. The missing piece is a flow planner between paragraph measurement and final positioning.

### What already exists

- exact HarfRust shaping over reduced font data, including glyph IDs, UTF-16 clusters, positions, and shaping-safety flags;
- Unicode grapheme, line-break, script, bidi, alignment, clipping, ellipsis, and horizontal CJK paragraph policy;
- broad paragraph shaping followed by measured clusters, greedy breaks, positioned fragments, bounded caches, and batched boundary reshaping;
- one font-local positioned result that raster modules can consume without duplicating advances or kerning;
- a live benchmark/conformance harness with explicit WebGPU/WebGL2 and DPR controls.

### What is missing

- a region vocabulary beyond one rectangle and one available width per line;
- exclusion subtraction, column progression, and multiple usable slots on one baseline;
- explicit logical and visual ordering across fragments separated by an obstacle;
- incremental invalidation keyed by changing region geometry and edited source ranges;
- a mixed-raster composition policy that selects techniques by typographic role without splitting layout authority;
- correctness oracles for collision, reading order, safe breaks, and responsive region transitions;
- comparable timing evidence against Pretext for both stable-text reflow and edited-text preparation.

## Proposed flow model

Represent a composition as an ordered sequence of flow regions. For each line band, a region resolves zero or more horizontal slots after subtracting its exclusions:

```ts
type FlowSlot = Readonly<{
  inlineStart: number;
  inlineEnd: number;
}>;

type LineBand = Readonly<{
  blockStart: number;
  blockEnd: number;
  slots: readonly FlowSlot[];
}>;
```

These are illustrative internal values, not an accepted public API.

The planner should:

1. project drop caps, images, callouts, or known 3D geometry into line-band exclusion intervals;
2. subtract those intervals from each column or region to produce ordered slots;
3. place shaped clusters into slots without crossing grapheme, bidi, or unsafe shaping boundaries;
4. use the existing batched boundary reshaping path when a new slot changes a line boundary;
5. emit explicit fragments so reading order and visual order remain inspectable when one baseline has space on both sides of an obstacle;
6. retain shaped text while viewport, column, or obstacle changes invalidate only the flow plan and affected boundaries.

The first implementation should use conservative line-box collision against explicit two-dimensional exclusions. Tight glyph-ink collision, arbitrary rendered-scene occlusion, balanced columns, hyphenation, and vertical writing require separate evidence and should not hide inside the initial contract.

For known scene objects, the application can project bounds or a simplified silhouette from its CPU-visible transform and geometry. A general solution that discovers occlusion from already-rendered pixels may require GPU readback and is not part of the first flow-region milestone.

## Editorial benchmark

The benchmark working title is **Editorial composition**. It should present long-form benchmark ipsum as a responsive one-, two-, or three-column article with:

- a Slug headline or initial whose exclusion changes with layout;
- a bitmap body rendered at declared native strikes;
- an MTSDF pull quote spanning or interrupting columns;
- ligatures, mathematics, punctuation, combining marks, Arabic, Indic, and CJK passages that make shaping and safe line boundaries visible;
- controls for viewport width, column count or target column width, obstacle position, text editing or typewriter progression, body strike, display transform, and animation;
- an optional known-geometry 3D exclusion whose screen-space projection moves without a pixel readback.

The live scene should make change cheap and legible: resize the article, drag the obstacle, edit the text, or animate the composition while the text reshapes and reflows correctly. Presentation interpolation may soften visual movement, but committed layout and benchmark timing remain discrete and inspectable.

What is outside Pretext's stated scope—and therefore worth demonstrating—is not merely movement. It is editable, complex-script text reflowing around dynamic exclusions while exact positioned glyphs feed three specialized GPU raster techniques in one composition.

## Performance position

Do not claim that pmndrs/text is categorically faster than Pretext before measuring it. Pretext's prepared simple-Latin line breaker is deliberately small arithmetic over cached Canvas widths and may be faster for that narrow task.

The plausible pmndrs/text advantage is total-system work for exact custom rendering: one universal shape/layout result can replace a Canvas measurement pass followed by renderer-specific shaping or glyph reconstruction. That advantage is strongest for complex scripts, repeated responsive updates, and scenes that already need exact GPU instance data. It is a hypothesis until the same font, text, viewport, DPR, exclusions, and update sequence are measured.

The comparison must report phases rather than one opaque duration:

| Phase       | Required evidence                                                          |
| ----------- | -------------------------------------------------------------------------- |
| Prepare     | font registration, shaping, segmentation, and retained bytes               |
| Project     | obstacle-to-exclusion computation                                          |
| Reflow      | slot planning, line breaking, and affected boundary reshaping              |
| Publish     | instance/geometry updates and allocations                                  |
| Render      | warm CPU frame, FPS, GPU time, draw count, and resident GPU bytes          |
| Correctness | safe boundaries, no overlap, expected reading order, and visual references |

Compare both a static first layout and deterministic dynamic updates. Keep approximate browser-compatible breaking and exact GPU-ready shaping labeled as different products when their outputs are not equivalent.

## Milestone gates

Milestone 11 begins only after Slug and the V1 renderer-set gate. Before accepting a public flow API it must prove:

- rectangular layout remains the zero-overhead common path;
- the same prepared paragraph can produce box and exclusion-region layouts;
- multi-column and multi-slot reading order is explicit for LTR, RTL, and mixed-direction text;
- moving an exclusion reuses broad shaping and batches only necessary boundary reshapes;
- bitmap, MTSDF, and Slug consume one authoritative positioned layout without duplicated advances or kerning;
- benchmark mode reports consumer costs, while conformance mode visibly explains every tested boundary and collision;
- allocation, latency, payload, and bundle isolation stay within measured budgets;
- the Pretext comparison is reproducible and states where contracts differ.

## Deferred follow-ups

- contour-tight drop-cap wrapping based on glyph ink rather than conservative geometry;
- balanced columns, widows/orphans policy, automatic hyphenation, and shape-inside authoring tools;
- arbitrary GPU scene occlusion derived from depth or masks;
- vertical editorial flow;
- making a flow-region representation public before integration experience proves it.
