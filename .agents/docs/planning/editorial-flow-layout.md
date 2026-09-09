---
type: Design Research
title: Responsive editorial flow and mixed-raster composition
description: Records the product motivation, prior-art comparison, and benchmark concept for post-v1 editorial flow; the fragment-relative reflow plan owns implementation.
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
  - id: 'fragment-relative-reflow'
    resource: 'fragment-relative-reflow.md'
    title: 'Fragment-relative reflow and LayoutRun placement'

generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-09T02:02:17Z'
---

# Responsive editorial flow and mixed-raster composition

Status: accepted post-v1 research direction; implementation model and gates are superseded by the
[fragment-relative reflow plan](fragment-relative-reflow.md)

## Recommendation

Use responsive flow regions and a mixed-raster editorial benchmark to prove the post-v1 feature. The canonical roadmap
now authorizes that work over the landed retained Rust core and paragraph-reflow optimization; the implementation sequence,
data model, numeric contract, and release gates live only in the
[fragment-relative reflow plan](fragment-relative-reflow.md).

The benchmark should be a typographic composition that needs all three first-party techniques:

- Slug for a transformed or oversized display headline and drop cap;
- MTSDF for a medium-sized pull quote or callout that must remain clean through responsive scaling;
- native-strike bitmap text for small body copy, captions, folios, and marginalia;
- one shared shaping and positioned-layout source beneath every raster so selecting a rendering technique never invents independent typography.

This is a benchmark surface for interactive cost and visual judgment. Smaller conformance cases separately prove safe breaks, exclusion geometry, renderer agreement, bidi behavior, and absence of overlap.

## What Pretext proves

Pretext demonstrates that useful editorial wrapping does not require a browser layout tree. It prepares Canvas-measured segments once, then performs line breaking with cached widths and pure arithmetic. Its streaming line API accepts a different available width for each line, while its examples derive those widths by subtracting image or projected-object obstacles.

The 3D Object Textwrap demonstration is therefore important prior art for the interaction, not a complete text-rendering architecture to copy. The caller projects an obstacle into screen-space exclusion intervals and gives the line breaker the remaining space. Pretext intentionally stops short of exact custom-renderer glyph positions for complex scripts and mixed-direction text; its browser measurements are designed primarily for line-breaking compatibility.

Dynamic obstacle wrapping alone is not a differentiator: Pretext already demonstrates it. The pmndrs/glyph opportunity is to combine that interaction with exact HarfRust glyph identity and positioning, Unicode paragraph policy, deterministic conformance, and one GPU-ready output that can feed bitmap, MTSDF, and Slug without a second shaping system.

### Two different meanings of dynamic

Performance claims must distinguish geometry changes from content changes:

| Change                                                | Pretext                                                                                                                                                | pmndrs/glyph direction                                                                                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same text, new width or obstacle                      | Reuses prepared segment widths; line walking is allocation-light arithmetic and should be treated as a strong baseline.                                | Reuses broad shaping and cluster measurements; replans slots and reshapes only affected unsafe boundaries.                                                                                           |
| Edited or typewriter text                             | A changed string requires another `prepare` analysis/measurement result, although shared internal measurement caches may still help repeated segments. | Reanalyzes and shapes changed content; the intended advantage is incremental paragraph state with exact clusters and direct reuse by the GPU renderer, not an assumption that HarfRust work is free. |
| Same layout, moving presentation                      | Rendering is caller-owned; Pretext produces line strings or ranges rather than positioned GPU glyph instances.                                         | Reuses committed layout and can update or interpolate instance presentation without reshaping.                                                                                                       |
| Changed features, variations, script, or bidi content | Canvas measurement is the browser ground truth for widths, but the documented result is not an exact custom-renderer glyph stream.                     | HarfRust produces the authoritative glyph IDs, positions, clusters, and flags consumed by every renderer.                                                                                            |

The showcase should exercise all four lanes and label them separately. Repeated resizing is not enough to establish an advantage because it is already Pretext's optimized hot path. Editable complex-script content, local invalidation, and direct GPU publication are the more meaningful product test, but they still require measured evidence.

## Current boundary

The public authoring surface lays out horizontal text in a rectangular content box and flows it through side-by-side
ordered columns. Internally, the Rust engine already retains bounded rectangle or polygon regions and exclusions, subtracts
them into multiple slots, and composes line fragments through sequential regions. Those records are package-owned frame
geometry, not yet a public arbitrary-contour or scene-object API.

The missing production boundary is retained fragment-relative placement: public contour authoring, object projection,
same-source drop caps, and geometry-local publication must reuse shaped text without rematerializing absolute geometry for
every glyph.

### What already exists

- exact HarfRust shaping over reduced font data, including glyph IDs, UTF-16 clusters, positions, and shaping-safety flags;
- Unicode grapheme, line-break, script, bidi, alignment, clipping, ellipsis, and horizontal CJK paragraph policy;
- broad paragraph shaping followed by measured clusters, greedy breaks, positioned fragments, bounded caches, and batched boundary reshaping;
- one font-local positioned result that raster modules can consume without duplicating advances or kerning;
- a live benchmark/conformance harness with explicit WebGPU/WebGL2 and DPR controls.

### What is missing

- public region and exclusion authoring beyond the content-box column shorthand;
- retained run placement that can update a subset of lines, fragments, and publication rows;
- explicit logical and visual ordering across fragments separated by an obstacle;
- incremental invalidation keyed by changing region geometry and edited source ranges;
- known-object 2D/3D projection and same-source drop-cap contour ownership;
- a mixed-raster composition policy that selects techniques by typographic role without splitting layout authority;
- correctness oracles for collision, reading order, safe breaks, and responsive region transitions;
- comparable timing evidence against Pretext for both stable-text reflow and edited-text preparation.

## Implementation ownership

The [fragment-relative reflow plan](fragment-relative-reflow.md) is the sole owner of the `LayoutRun` model, transactional
placement, two-dimensional polygon authoring, projected known-geometry objects, same-source drop caps, query behavior,
renderer publication, milestone sequence, and acceptance gates. This research concept does not define a parallel API or
algorithm. Existing retained geometry and slot composition remain the starting authority recorded by D-190–D-192.

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

Do not claim that pmndrs/glyph is categorically faster than Pretext before measuring it. Pretext's prepared simple-Latin line breaker is deliberately small arithmetic over cached Canvas widths and may be faster for that narrow task.

The plausible pmndrs/glyph advantage is total-system work for exact custom rendering: one universal shape/layout result can replace a Canvas measurement pass followed by renderer-specific shaping or glyph reconstruction. That advantage is strongest for complex scripts, repeated responsive updates, and scenes that already need exact GPU instance data. It is a hypothesis until the same font, text, viewport, DPR, exclusions, and update sequence are measured.

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

Milestone 12 gates are maintained in the [fragment-relative reflow plan](fragment-relative-reflow.md). The benchmark and
comparison here supply product evidence to those gates; they do not weaken exact layout, renderer parity, allocation,
latency, payload, or bundle-isolation requirements.

## Deferred follow-ups

- balanced columns, widows/orphans policy, automatic hyphenation, and shape-inside authoring tools;
- arbitrary GPU scene occlusion derived from depth or masks;
- vertical editorial flow;
- freezing a general-purpose shape-inside API before integration evidence proves it.
