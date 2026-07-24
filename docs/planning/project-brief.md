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

Current execution is a one-font slice with a required minimal bake path: one font core runs behind generic Node and Worker hosts and emits the canonical `PMNDRS_font` asset; a separately owned bitmap package emits the first raster artifact. HarfRust Wasm shapes the retained font data, the JS paragraph engine reflows one paragraph, and the bitmap raster proves the Three.js and React boundaries. Advanced compiler work—subsetting/remapping, compiled IR, SIMD, and additional generators—remains later. The [canonical roadmap](../roadmap/roadmap.md) is authoritative for order and scope.

The interactive/headless benchmark harness is the first executable artifact. It exists before the font pipeline, and each implementation step enters through its shared adapters and scenarios. The bitmap slice's first rendered output is therefore already a measured, reproducible harness scenario rather than a throwaway demo.

The bitmap slice is an internal end-to-end proof, not the minimum shippable product. The first release requires bitmap, MSDF, and Slug raster engines to pass their format, quality, and performance gates. The MSDF engine uses MTSDF atlas encoding.

Terminology in the planning set is strict: the **integration slice** is the pre-release bitmap proof; **V1** is the first shippable release containing all three raster engines.

## Product statement

`pmndrs/text` will be a Three.js-first, raster-independent text system for JavaScript, WebGPU, and WebGL. It will shape modern Unicode text once, lay it out within application-controlled regions, and render the resulting glyph stream through interchangeable Slug, MSDF, or bitmap raster modules.

The package is the shipping successor to the text/font work explored in Three Flatland's Slug package. Selected Slug algorithms and formats may be ported or rewritten. UIKit v2 is a required consumer through a small adapter around its existing `CustomLayouting` and resolved content-box signals, and Three Flatland should eventually depend on `pmndrs/text` as well. Core remains independent of Yoga, Preact Signals, and UIKit rendering types.

## Problem

Existing web graphics text solutions commonly couple layout to one atlas or renderer, parse source fonts at runtime, use incomplete cmap/kerning logic, or produce object-heavy data that must be repacked before GPU use.

We need:

- modern script shaping and cluster semantics;
- bounded paragraph layout that reflows efficiently;
- a small normal-path runtime;
- pre-baked GPU-ready assets;
- automatic project-source discovery so font and raster declarations are not repeated in a bake manifest;
- a worker fallback for ordinary font files;
- one shaped result usable by several rendering techniques;
- measurable compatibility with HarfRust/HarfBuzz.

## Primary users

- pmndrs renderer and framework maintainers;
- UIKit v2, with its existing layout system supplying content constraints and `pmndrs/text` supplying allocation-light paragraph measurement and positioned glyphs;
- Three.js and React Three Fiber applications;
- Three Flatland as an initial downstream consumer;
- applications with UI text, 3D labels, icons, bitmap styles, or mixed raster needs;
- library authors who need shaping/layout without adopting one renderer.

## Product-horizon user outcomes

1. Load a pre-baked font package and shape Unicode text without source-font parsing on the main thread.
2. Load an ordinary supported font and receive the same canonical representation after worker baking.
3. Lay text into a constrained width/height and reflow it without reshaping everything unnecessarily.
4. Render the same positioned glyph stream with Slug, MTSDF-backed MSDF, or generated bitmap data.
5. Verify shaping output against pinned HarfRust and HarfBuzz references.
6. Upload raster buffers without per-glyph JavaScript reconstruction or numeric repacking.
7. Declare a font and raster once in application source, then let Node pre-baking and Worker fallback derive the same package-owned descriptor.
8. Let any retained layout system synchronously measure a prepared paragraph without producing glyph arrays, then request positioned output for its final content box. Validate that neutral contract against current UIKit.

## Current one-font slice

- one statically selected, pinned OpenType font;
- horizontal LTR and RTL shaping supported by the pinned HarfRust baseline;
- source-local `u16` glyph IDs scoped by opaque font handles;
- pre-baked GLB and automatic lazy Worker fallback;
- source-discovered `defineFont` tokens with conservative local URL-path resolution;
- one generated grayscale bitmap strike;
- JavaScript greedy paragraph reflow for the fixture scope;
- one framework-neutral Three.js `Text` object and thin `@pmndrs/text/react` wrapper;
- native ESM-only package and optional subpath graph;
- inferred raster/baker capability types with compile-time contract fixtures;
- WebGPU and WebGL2 first-frame proof;
- conformance, package-graph, and benchmark evidence.

## Product horizon after the slice

- horizontal LTR and RTL shaping;
- full Unicode scalar input with UTF-16 cluster offsets;
- OpenType shaping supported by the pinned HarfRust baseline;
- static variable-font instances;
- optional dense packed glyph-ID remapping after source subsetting and shaping closure are proven;
- pre-baked GLB and lazy worker fallback;
- Slug, MTSDF-backed MSDF, and generated bitmap rasters;
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

- Shaped output contains no raster-specific fields.
- One font-local glyph ID indexes every included raster for that font.
- Offline and worker baking produce equivalent canonical sections.
- Static discovery never executes application code, never guesses ambiguous local files, and produces the same raster key as runtime configuration.
- Public type fixtures preserve literal font inputs and raster capabilities while rejecting missing raster options and dynamic bitmap strikes.
- Paragraph layout makes at most one batched shaping call for a text/style change and zero or one for width-only reflow.
- A current-UIKit-shaped fixture derives `CustomLayouting`, maps unconstrained, at-most, and exact measurements, exposes baselines, lays out the authoritative final content box from size signals, and never imports UIKit, Yoga, or Preact Signals from core.

### Loading and rendering

- Pre-baked load performs no OpenType parsing.
- Raster records need no per-glyph JS objects or value conversion before upload.
- One test paragraph switches among all available rasters without reshaping.

### Evidence

- Every performance claim links to a reproducible benchmark.
- Size reports include raw and compressed Wasm, shaping data, and raster data separately.
- Runtime-bake tests record time, peak memory, cache behavior, and native/Wasm output parity.

## Product risks

- HarfRust integration may not expose the provider boundary needed for compiled lookup replacement.
- Runtime baking and large font subsets can exceed acceptable worker time or memory.
- GLB image/compression choices may conflict with truly upload-ready texture data.
- “Direct-to-GPU” alignment requirements differ across WebGL/WebGPU paths.
- Correct line-boundary shaping and bidi behavior can invalidate overly aggressive JS-side slicing.
- Three raster generators increase fixture and visual-regression cost.

## First decision gate

Before production code, maintainers should accept or revise:

1. HarfRust as the reference shaper.
2. GLB plus the `PMNDRS_font` extension family as the container.
3. JS paragraph policy with coarse Wasm shaping calls.
4. Static font instances in V1.
5. The worker fallback as a required product feature.
6. The initial raster set: Slug, MSDF, and generated grayscale bitmap strikes.
7. The Three.js-first `Text` object and nested-text React API.
