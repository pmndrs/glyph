---
type: Project Brief
title: Project brief
description: Defines the product outcome, users, merged v0 baseline, target v1 boundary, later product horizon, non-goals, and success criteria.
tags: [product, scope, roadmap]
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# Project brief

Status: proposed  
Audience: pmndrs maintainers and initial contributors

The repository's merged v0 implementation proves portable baking, HarfRust Wasm shaping, JavaScript paragraph layout, and
Bitmap, MTSDF, and Slug rendering through the original Three.js-oriented API. It has not been published as a release. The
current work extracts the target v1 core API and proves that API through independent engine integrations. Advanced compiler
work—subsetting/remapping, compiled IR, and additional generators—remains later. The
[canonical roadmap](../roadmap/roadmap.md) is authoritative for order and scope.

The interactive/headless benchmark harness is the first executable artifact. It exists before the font pipeline, and each implementation step enters through its shared adapters and scenarios. The bitmap slice's first rendered output is therefore already a measured, reproducible harness scenario rather than a throwaway demo.

The original bitmap slice was the first internal end-to-end proof. The merged v0 implementation subsequently added MTSDF
and Slug, but completing raster engines did not by itself stabilize a release API. The first public v1 release additionally
requires clean batching, loading, synchronization, resource, customization, and external-engine boundaries. The MSDF engine
uses MTSDF atlas encoding.

Terminology in the planning set is strict: **v0** is the merged, unreleased implementation; **target v1** is the API and
integration design being implemented now; **v1** names the first public release only after those shapes pass their gates.

## Product statement

`pmndrs/glyph` will be a renderer-neutral, raster-independent text system for JavaScript and WebGPU. It will shape modern
Unicode text once, lay it out within application-controlled regions, and expose batched glyph data through interchangeable
Slug, MSDF, or bitmap techniques. Three.js, React Three Fiber, TypeGPU, and other engines consume that public core through
separate integrations.

The intended public package is informed by the text/font work explored in Three Flatland's Slug package. Selected Slug algorithms and formats may be adapted or reimplemented from that prior art. uikit is a required consumer through a small adapter around its existing `CustomLayouting` and resolved content-box signals. Core remains independent of Yoga, Preact Signals, and uikit rendering types.

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
- uikit, with its existing layout system supplying content constraints and `pmndrs/glyph` supplying allocation-light paragraph measurement and positioned glyphs;
- Three.js and React Three Fiber applications;
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
8. Let any retained layout system synchronously measure a prepared paragraph without producing glyph arrays, then request positioned output for its final content box. Validate that neutral contract against current uikit.

## Merged v0 baseline

- one statically selected, pinned OpenType font;
- horizontal LTR and RTL shaping supported by the pinned HarfRust baseline;
- source-local `u16` glyph IDs scoped by opaque font handles;
- pre-baked GLB and automatic lazy Worker fallback;
- source-discovered `defineFont` tokens with conservative local URL-path resolution;
- one generated grayscale bitmap strike;
- JavaScript greedy paragraph reflow for the fixture scope;
- one framework-neutral Three.js `Text` object and thin `@pmndrs/glyph/react` wrapper;
- native ESM-only package and optional subpath graph;
- inferred raster/baker capability types with compile-time contract fixtures;
- WebGPU and WebGL2 first-frame proof;
- conformance, package-graph, and benchmark evidence.

## Target v1 and later horizon

- horizontal LTR and RTL shaping;
- full Unicode scalar input with UTF-16 cluster offsets;
- OpenType shaping supported by the pinned HarfRust baseline;
- static variable-font instances;
- optional dense packed glyph-ID remapping after source subsetting and shaping closure are proven;
- pre-baked GLB and lazy worker fallback;
- Slug, MTSDF-backed MSDF, and generated bitmap rasters;
- post-v1 large-coverage paging for CJK, private-use icon fonts, OpenType-SVG icon fonts, and manifest-backed standalone SVG icon sets;
- later Slug and bitmap support for color emoji through baked vector paint/layer and image records;
- JS paragraph engine with greedy wrapping, alignment, height/max-lines, clipping, and ellipsis;
- batched boundary reshaping;
- conformance fixtures and benchmark harnesses.

## Explicit non-goals for the target v1 extraction

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
- A current-uikit-shaped fixture derives `CustomLayouting`, maps unconstrained, at-most, and exact measurements, exposes baselines, lays out the authoritative final content box from size signals, and never imports uikit, Yoga, or Preact Signals from core.

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

## Original decision gate

Before production code, maintainers should accept or revise:

1. HarfRust as the reference shaper.
2. GLB plus the `PMNDRS_font` extension family as the container.
3. JS paragraph policy with coarse Wasm shaping calls.
4. Static font instances in v0 and the target v1.
5. The worker fallback as a required product feature.
6. The initial raster set: Slug, MSDF, and generated grayscale bitmap strikes.
7. The Three.js-first `Text` object and nested-text React API.
