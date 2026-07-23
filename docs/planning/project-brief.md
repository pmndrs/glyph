---
type: Project Brief
title: Project brief
description: Defines the product outcome, users, current one-font slice, later product horizon, non-goals, and success criteria.
status: proposed
tags: [product, scope, roadmap]
---

# Project brief

Status: proposed  
Audience: pmndrs maintainers and initial contributors

Current execution is a one-font slice with a required minimal baker: one shared core runs behind a Node host and a dynamically imported loader Worker, both emit the same canonical `PMNDRS_font` asset, HarfRust Wasm shapes its retained font data, the JS paragraph engine reflows one paragraph, and one generated bitmap presentation proves the rendering boundary. Advanced compiler work—subsetting/remapping, compiled IR, SIMD, and additional generators—remains later. The [canonical roadmap](/roadmap/roadmap.md) is authoritative for order and scope.

The bitmap slice is an internal end-to-end proof, not the minimum shippable product. The first release requires bitmap, MTSDF, and Slug presentation engines to pass their format, quality, and performance gates.

Terminology in the planning set is strict: the **integration slice** is the pre-release bitmap proof; **V1** is the first shippable release containing all three presentation engines.

## Product statement

`pmndrs/text` will be a renderer-independent text system for JavaScript and WebGPU/WebGL ecosystems. It will shape modern Unicode text once, lay it out within application-controlled regions, and render the resulting glyph stream through interchangeable Slug, MSDF/MTSDF, or bitmap presentations.

The package is the shipping successor to the text/font work explored in Three Flatland's Slug package. Selected Slug algorithms and formats may be ported or rewritten, while Three Flatland should eventually depend on `pmndrs/text`.

## Problem

Existing web graphics text solutions commonly couple layout to one atlas or renderer, parse source fonts at runtime, use incomplete cmap/kerning logic, or produce object-heavy data that must be repacked before GPU use.

We need:

- modern script shaping and cluster semantics;
- bounded paragraph layout that reflows efficiently;
- a small normal-path runtime;
- pre-baked GPU-ready assets;
- a worker fallback for ordinary font files;
- one shaped result usable by several rendering techniques;
- measurable compatibility with HarfRust/HarfBuzz.

## Primary users

- pmndrs renderer and framework maintainers;
- Three.js and React Three Fiber applications;
- Three Flatland as an initial downstream consumer;
- applications with UI text, 3D labels, icons, bitmap styles, or mixed presentation needs;
- library authors who need shaping/layout without adopting one renderer.

## Product-horizon user outcomes

1. Load a pre-baked font package and shape Unicode text without source-font parsing on the main thread.
2. Load an ordinary supported font and receive the same canonical representation after worker baking.
3. Lay text into a constrained width/height and reflow it without reshaping everything unnecessarily.
4. Render the same positioned glyph stream with Slug, MTSDF/MSDF, or generated bitmap data.
5. Verify shaping output against pinned HarfRust and HarfBuzz references.
6. Upload presentation buffers without per-glyph JavaScript reconstruction or numeric repacking.

## Current one-font slice

- one statically selected, pinned OpenType font;
- horizontal LTR and RTL shaping supported by the pinned HarfRust baseline;
- source-local `u16` glyph IDs scoped by opaque font handles;
- pre-baked GLB and automatic lazy Worker fallback;
- one generated grayscale bitmap strike;
- JavaScript greedy paragraph reflow for the fixture scope;
- WebGPU and WebGL2 first-frame proof;
- conformance, package-graph, and benchmark evidence.

## Product horizon after the slice

- horizontal LTR and RTL shaping;
- full Unicode scalar input with UTF-16 cluster offsets;
- OpenType shaping supported by the pinned HarfRust baseline;
- static variable-font instances;
- optional dense packed glyph-ID remapping after source subsetting and shaping closure are proven;
- pre-baked GLB and lazy worker fallback;
- Slug, MSDF/MTSDF, and generated bitmap presentations;
- post-V1 Slug support for color emoji and SVG icon fonts through baked vector paint/layer and image records;
- JS paragraph engine with greedy wrapping, alignment, height/max-lines, clipping, and ellipsis;
- batched boundary reshaping;
- conformance fixtures and benchmark harnesses.

## Explicit non-goals for the current slice

- replacing HarfRust script shaping;
- browser-time JIT or MLIR;
- GPU compute shaping;
- runtime variable-font axes;
- vertical writing;
- Graphite and deprecated AAT `mort`;
- unrestricted SVG DOM, scripting, animation, filter, or external-resource semantics inside font glyphs;
- complete locale-specific hyphenation;
- standardizing a Khronos extension before the internal format stabilizes;
- promising numeric speed or size gains before benchmarks.

## Success criteria

### Correctness

- The supported corpus matches pinned HarfRust output field-for-field.
- Differences from pinned HarfBuzz are tracked with an explicit allowlist and rationale.
- Cluster, unsafe-break, and boundary reshape tests cover ligatures, combining marks, Arabic, Indic, bidi, emoji ZWJ, and variation selectors.

### Architecture

- Shaped output contains no presentation-specific fields.
- One font-local glyph ID indexes every included presentation for that font.
- Offline and worker baking produce equivalent canonical sections.
- Paragraph layout makes at most one batched shaping call for a text/style change and zero or one for width-only reflow.

### Loading and rendering

- Pre-baked load performs no OpenType parsing.
- Presentation records need no per-glyph JS objects or value conversion before upload.
- One test paragraph switches among all available presentations without reshaping.

### Evidence

- Every performance claim links to a reproducible benchmark.
- Size reports include raw and compressed Wasm, shaping data, and presentation data separately.
- Runtime-bake tests record time, peak memory, cache behavior, and native/Wasm output parity.

## Product risks

- HarfRust integration may not expose the provider boundary needed for compiled lookup replacement.
- Runtime baking and large font subsets can exceed acceptable worker time or memory.
- GLB image/compression choices may conflict with truly upload-ready texture data.
- “Direct-to-GPU” alignment requirements differ across WebGL/WebGPU paths.
- Correct line-boundary shaping and bidi behavior can invalidate overly aggressive JS-side slicing.
- Three presentation generators increase fixture and visual-regression cost.

## First decision gate

Before production code, maintainers should accept or revise:

1. HarfRust as the reference shaper.
2. GLB plus the `PMNDRS_font` extension family as the container.
3. JS paragraph policy with coarse Wasm shaping calls.
4. Static font instances in V1.
5. The worker fallback as a required product feature.
6. The initial presentation set: Slug, MTSDF, and generated grayscale bitmap strikes.
