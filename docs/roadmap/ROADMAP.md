---
type: Roadmap
title: Canonical implementation roadmap
description: Defines the only active implementation sequence, dependencies, effort estimates, deliverables, and exit gates for pmndrs/text.
status: proposed
tags: [roadmap, implementation, milestones]
---

# Canonical implementation roadmap

This is the only active execution order. Earlier phased, scope-lane, and vertical-slice documents are inputs preserved for history; where they differ, this roadmap wins.

In this roadmap, **integration slice** means the internal bitmap proof in milestones 0–7. **V1** means the first shippable release at milestone 10, after bitmap, MTSDF, and Slug have all passed their gates.

Effort estimates are relative: **S** is one focused change, **M** is a multi-part change normally completed in one or two pull requests, **L** spans several coordinated pull requests, and **XL** is an epic that must be split before implementation.

## Target for the first integration slice

One pinned OpenType font must travel through Node pre-baking and automatic Worker fallback, register as one canonical core font, shape with HarfRust Wasm, reflow in the JavaScript paragraph engine, and render through one generated grayscale bitmap presentation on WebGPU and WebGL2.

The architecture supports multiple one-face fonts and independently packaged presentations from the beginning, but the first slice proves one font and one presentation.

This slice is an internal integration proof, not a release candidate. The first shippable release additionally requires production-ready MTSDF and Slug generators, payloads, runtime modules, visual fixtures, and performance evidence.

## Implementation order

| Order | Milestone | Effort | Depends on | Exit result |
| ---: | --- | --- | --- | --- |
| 0 | Accept contracts and versions | S | documentation audit | No unresolved identity, ownership, package, or version decision can force a redesign. |
| 1 | Pin fixtures and scaffold benchmark lab | L | 0 | Fixtures are reproducible and the shared interactive/headless harness contracts are executable. |
| 2 | Build portable bake core and Node host | L | 1 | Node emits a valid core GLB plus one bitmap presentation without advanced compiler work. |
| 3 | Build baked-first loader and Worker fallback | L | 2 | Baked hits stay small; misses dynamically load the Worker path and reproduce canonical bytes. |
| 4 | Integrate HarfRust Wasm shaping | L | 2–3 | Coarse batch calls match pinned HarfRust fixtures and expose clusters, positions, and flags. |
| 5 | Implement JavaScript paragraph reflow | L | 4 | Fixed-width wrapping and resize reuse broad shaping and batch boundary reshapes. |
| 6 | Render bitmap presentation | L | 3, 5 | The same layout renders on WebGPU and WebGL2 with direct bulk upload. |
| 7 | Harden the integration proof | L | 1–6 | Identity, cancellation, limits, invalid data, package separation, and baselines pass review. |
| 8 | Implement and validate MTSDF | XL | 7 | General-purpose distance-field text passes visual, payload, and GPU performance gates. |
| 9 | Port/rewrite and validate Slug | XL | 7 | Outline-accurate text passes correctness, packing, visual, and GPU performance gates. |
| 10 | Harden the first shippable release | L | 8–9 | Bitmap, MTSDF, and Slug ship as independent modules over one shaping/layout result. |

Do not start a milestone before its dependencies and exit evidence exist.

## Milestone 0 — accept contracts and versions

Deliver:

- maintainer review of the [API](/planning/API_SHAPES.md), [architecture](/planning/ARCHITECTURE.md), [shaping data](/planning/SHAPING_DATA_CONTRACT.md), and [presentation data](/planning/PRESENTATION_DATA_CONTRACT.md);
- accepted font identity `(FontHandle, LocalGlyphId)` and one-face asset rule;
- accepted embedded/external presentation binding;
- pinned HarfRust, HarfBuzz reference, Unicode, glTF schema, and generator versions;
- decision records for any revised contract.

Do not implement production runtime behavior in this milestone.

## Milestone 1 — pin fixtures and scaffold benchmark lab

Deliver:

- authorized Inter Regular fixture with exact URL, license, version, and SHA-256;
- UTF-16 text corpus and HarfBuzz/HarfRust expected outputs;
- bitmap strike, paragraph layout, GLB, malformed input, and GPU readback fixtures;
- benchmark environment manifest and result schema;
- interactive benchmark lab shell modeled on the adapter/scenario structure of `js-physics-benchmarks`;
- shared target/scenario/capability contracts, shareable configuration, headless smoke runner, and independent bundle-size pipeline;
- empty multi-font/multi-presentation contract fixtures that test identity without adding product behavior.

Exit only when every oracle can be regenerated deterministically and one fixture target produces the same validated result through the interactive and headless paths.

## Milestone 2 — portable bake core and Node host

Deliver:

- host-independent bake request/result library;
- source validation and face selection;
- deterministic reduced shaping SFNT, dense extents, and required contour-point data;
- one unhinted grayscale bitmap strike and 20-byte dense glyph records;
- `PMNDRS_font` and `PMNDRS_font_bitmap` writers plus validators;
- `@pmndrs/text/bake` Node API and thin CLI;
- bake timing, peak memory, and byte report.

Explicitly exclude subsetting, shaping closure, dense remapping, compiled layout IR, MTSDF, and Slug.

## Milestone 3 — baked-first loader and Worker fallback

Deliver:

- deterministic baked sibling resolution;
- valid-hit, missing, invalid, and incompatible asset behavior;
- development-only deduplicated pre-bake warning;
- dynamically imported runtime baker library and Worker host;
- transferable source/results and selected generator imports;
- in-memory request/result deduplication;
- Node/Worker authoritative-byte parity and import-graph tests.

Exit only when a baked hit cannot reach the runtime baker, Worker, bake Wasm, or generator in the application graph.

## Milestone 4 — HarfRust Wasm shaping

Deliver:

- opaque font registration and disposal;
- cached HarfRust font data and shape plans;
- one coarse `shapeBatch` call and one coarse `reshapeRanges` call;
- structure-of-arrays result views with UTF-16 clusters and mapped flags;
- bit-for-bit comparison against the pinned HarfRust corpus;
- recorded cold/warm call time, memory, and boundary-crossing count.

HarfRust reads the retained SFNT tables in Wasm. The milestone does not claim compiled-IR or zero table interpretation.

## Milestone 5 — JavaScript paragraph reflow

Deliver:

- paragraph, span, style, and constraint models;
- measured clusters and legal break representation;
- greedy wrapping, alignment, clipping, max-lines, and ellipsis for the fixture scope;
- broad-shape and width-layout caches;
- one batched boundary-reshape seam;
- wide/narrow and bidi-aware golden layouts.

Width changes always reflow. Simple reflow crosses into Wasm zero times; boundary-sensitive changes cross once for the batch.

## Milestone 6 — bitmap presentation and first frame

Deliver:

- optional bitmap presentation module;
- KTX2 lossless R8 path, flat record validation, bulk GPU upload, and instance batching;
- WebGPU and WebGL2 scenes with clipping and resize;
- first-draw, frame-time, GPU-memory, and quality reports.

Bitmap is the first implementation because it proves the complete boundary with the least generator risk. It does not become the universal default by virtue of being first.

## Milestone 7 — harden the integration proof

Deliver:

- stale-handle, cancellation, source/resource limit, corrupt GLB, and unsupported capability tests;
- second registration of the same font proving scoped identity and lifecycle;
- offline/Worker byte parity and cold/warm end-to-end benchmark reports;
- populated interactive lab scenarios for shaping, loading, paragraph reflow, and bitmap rendering using the same definitions as headless runs;
- tree-shaking and dynamic-import bundle assertions;
- accepted ADRs and updated extension schemas;
- an autoresearch baseline with optimization campaigns still disabled.

Milestone 7 authorizes implementation of the release renderers; it does not authorize a package release.

## Milestone 8 — MTSDF release renderer

Deliver:

- optional MTSDF generator and runtime presentation module;
- canonical 20-byte glyph records and linear RGBA8 KTX2 lossless baseline;
- independently packaged and embedded presentation parity;
- WebGPU and WebGL2 shaders, mip behavior, effects limits, and resize/transform scenes;
- visual-error, atlas-size, upload, GPU-memory, and frame-time reports;
- bundle assertions proving bitmap- and Slug-only consumers do not import MTSDF code.

Exit only when MTSDF is credible as the general-purpose recommendation across the accepted size and transform corpus.

## Milestone 9 — Slug release renderer

Deliver:

- ported or rewritten outline conversion, curve normalization, band construction, and shaders;
- the adopted RGBA16F curve and exact header/reference packing;
- independently packaged and embedded presentation parity;
- large-size, extreme-zoom, complex-outline, clipping, and transform scenes;
- quality-preserving comparisons to source outlines and the reviewed Three Flatland prior art;
- payload, upload, GPU-memory, and frame-time reports;
- bundle assertions proving bitmap- and MTSDF-only consumers do not import Slug code.

Exit only when Slug satisfies its outline-accurate large/zoomed-text role without quality regression.

## Milestone 10 — harden the first shippable release

Deliver:

- one paragraph rendered through bitmap, MTSDF, and Slug without reshaping or remeasurement;
- explicit presentation-selection API and failure behavior;
- documented technique recommendations backed by the benchmark corpus;
- interactive comparison scenarios for bitmap, MTSDF, and Slug with correctness/visual gates and downloadable raw results;
- second-font registration and presentation-binding smoke fixtures;
- release-level conformance, browser, GPU, memory, package-size, and malformed-input suites;
- reviewed public API, migration notes, and versioned extension schemas.

The project cannot ship before this gate passes.

## Additive work after the release renderer set

The order below preserves lanes without pretending the work is part of V1:

| Order | Workstream | Effort | Why next |
| ---: | --- | --- | --- |
| 11 | Mixed-font spans and explicit font fallback | XL | Extend the multi-font identity smoke proof into paragraph behavior. |
| 12 | Color emoji and SVG icon-font baking | XL | Extend Slug vector paint/layers and bitmap color resources without changing layout. |
| 13 | Presentation effects and expanded recommendations | L | Extend outlines, colorization, shadows, and projected-size guidance with measurements. |
| 14 | Measured optimization campaigns | ongoing | Activate autoresearch only with strict correctness and visual gates. |
| 15 | Advanced font compiler units | XL each | Add subsetting, closure, remapping, normalized lookups, or SIMD only from evidence. |

Windfoil, browser-time JIT, MLIR, GPU shaping, vertical writing, runtime variation axes, and automatic renderer switching are not scheduled.

## Roadmap change rule

Any change to order, scope, or an exit gate must update this document, the [artifact map](ARTIFACTS.md), the [decision register](/planning/DECISION_REGISTER.md), and affected contract references in one review. Historical plans are never silently reactivated.
