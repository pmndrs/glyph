# Proposed architecture

Status: proposed; interfaces are illustrative and not public API commitments.

## System boundaries

```text
                           shared portable bake core
                         /                           \
                Node host / CLI              browser Worker host
                development bake             lazy loader fallback
                         \                           /
                          canonical PMNDRS_font bytes
                                      │
                                      ▼
                           validator + font registry
                              │                │
                   shaping data│                │GPU-ready ranges
                              ▼                ▼
                     HarfRust Wasm       selected presentation
                              │                │
                              ▼                │
                       shaped buffers          │
                              │                │
                              ▼                │
                      JS paragraph engine      │
                              │                │
                              └── positioned glyphs ──→ GPU
```

The loader first probes the canonical baked asset. Only a miss dynamically imports the runtime baker library, whose Worker host loads the bake core and selected presentation generator. The Node host and runtime library use the same core and emit the same format. Subsetting, remapping, compiled IR, and SIMD specialization remain later compiler units. See the editable [system design diagram](system-design.excalidraw).

## Terminology

- **Baked font asset**: canonical `PMNDRS_font` GLB data produced ahead of time or during loader fallback.
- **Bake core**: host-independent font transformation library shared by Node and browser builds.
- **Node baker library**: Node host/API and CLI adapter around the bake core.
- **Runtime baker library**: dynamically imported browser module that owns the Worker host and loads the Wasm bake core plus selected generator modules.

The runtime baker is a shared library/module, not an auxiliary process or adjacent data-file category.

## What we retain from Three Flatland Slug

- a single loader that derives and probes a baked sibling;
- no application code change between baked and fallback delivery;
- a browser-safe main surface;
- Node tooling behind a separate bake subpath and thin CLI;
- heavy runtime generation reachable only through dynamic import;
- development-only, deduplicated guidance to pre-bake.

## What we change

- remove `forceRuntime` and similar policy switches;
- move fallback parsing/generation into a Worker;
- make fallback return canonical bytes instead of a distinct in-memory model;
- run those bytes through the same validation, registration, and presentation paths as a baked asset;
- make presentation generators independently importable.

## Ownership

### Shared bake core owns

- source-font validation and face selection;
- canonical bake descriptor and provenance;
- outline/metric access shared by generators;
- selected presentation generation;
- deterministic section packing and diagnostics.

V0 retains shaping-required OpenType bytes and generates one bitmap strike. Later units may add variation instancing, subsetting, closure, dense remapping, shaping-only tables, compiled lookups, Slug, and MTSDF.

### Node host owns

- filesystem reads/writes;
- CLI and JavaScript API;
- output naming and process diagnostics;
- invoking the shared core.

### Worker host owns

- transferred source input and result output;
- dynamic generator imports;
- cancellation, resource limits, and serialized errors;
- invoking the same shared core without main-thread font work.

### Loader and registry own

- baked asset naming/probing;
- the automatic hit/miss state machine;
- development warnings;
- canonical asset validation;
- in-flight/result caching;
- font handles, presentation ranges, and lifetime.

### Wasm shaper owns

- UTF-16 decoding and clusters;
- HarfRust script behavior and GSUB/GPOS;
- reusable font/shaper data and shape plans;
- glyph flags and packed outputs.

### JS paragraph engine owns

- text/styles, region constraints, and break selection;
- alignment, clipping, max lines, ellipsis, and reflow caches;
- batching boundary-sensitive reshapes.

### Presentation plugins own

- validation of technique-specific ranges;
- GPU resource creation and direct upload;
- instance generation and renderer submission.

## Dependency and import graph

```text
@pmndrs/text (browser-safe)
  ├─ asset validator / registry
  ├─ shaper bridge
  ├─ paragraph engine
  └─ presentation interfaces

@pmndrs/text/bake (Node-only)
  └─ Node host → shared bake core

@pmndrs/text/runtime-bake (dynamically loaded browser library)
  └─ Worker host → shared bake core → dynamic selected generator

@pmndrs/text/presentation/* (optional)
  ├─ runtime renderer plugin
  └─ corresponding bake generator entry
```

A baked asset hit must not make the main module graph reach the runtime baker library or generator modules.

## Canonical identity and coordinates

- Public clusters are UTF-16 offsets; Unicode logic uses scalar values.
- Glyph identity is `(FontHandle, LocalGlyphId)`.
- V0 local IDs may preserve source glyph IDs; later packed IDs remain font-local.
- Shared metrics and shaping positions use design units.
- Presentation plane bounds use a documented design-unit/fixed-point space.
- World/screen scaling occurs after shaping.

## Font loading state machine

```text
load(source, presentation)
  │
  ├─ derive baked asset URL and fetch
  │    ├─ valid → canonical load
  │    ├─ missing → dev warning once → runtime fallback
  │    └─ invalid/incompatible → structured diagnostic → fallback policy
  │
  └─ runtime fallback
       ├─ import runtime baker library
       ├─ start/reuse Worker
       ├─ fetch and transfer source bytes
       ├─ import selected generator in Worker
       ├─ bake canonical bytes
       └─ canonical load
```

There is no public branch that intentionally bypasses the baked asset probe.

## `PMNDRS_font` extension family

The names are provisional vendor-extension names. `PMNDRS` must be registered with Khronos before the format is published as stable; internal code uses neutral asset/section type names so serialization naming remains isolated.

`PMNDRS_font` contains one font face, version/provenance, retained shaping data for HarfRust, metrics/capabilities, and a presentation directory.

`PMNDRS_font_bitmap`, `PMNDRS_font_distance_field`, and `PMNDRS_font_slug` contain only technique-specific records and GPU payloads. They never repeat advances, kerning, or shaping behavior.

The asset supports multiple presentation sections; the first implementation emits one. Applications support multiple fonts by registering multiple one-face assets.

## Binary rules

1. JSON locates top-level views; authoritative numeric records remain flat binary.
2. Sections meet typed-view alignment; GPU ranges meet backend upload constraints.
3. Registration bounds-checks offsets and lengths once.
4. Shaping and layout outputs use structure-of-arrays.
5. GPU data records final formats, strides, dimensions, row layout, and alignment.
6. No platform-sized values appear on disk.
7. Unknown optional sections are skipped; unknown required sections reject.
8. Every serialized structure receives golden-byte and corrupt-input tests.

## Shaping and reflow

Initial reference path:

```text
retained OpenType bytes → cached HarfRust runtime shaping → typed shaped output
```

Width changes reuse broad shaping where safe. JS recomputes line breaks and batches only boundary-sensitive line ranges into one reshape call. Presentation data never participates in text measurement.

## Caching

V0 requires:

- baked asset/load promise deduplication;
- in-memory runtime-bake result keyed by source identity, descriptor, and versions;
- registered HarfRust state and shape plans;
- broad-run, line-shape, paragraph-analysis, and width-layout caches;
- GPU resources by font and presentation.

Persistent runtime-bake caching is deferred, but the key shape is reserved for source hash, descriptor hash, format/baker/generator versions, and selected presentation.

## Failure and warning model

- A missing baked asset is recoverable and warns once in development.
- An invalid baked asset yields a structured diagnostic before any allowed fallback.
- Unsupported source fonts, output/resource limits, Worker failures, and unsupported required sections are distinct errors.
- HarfRust shaping never silently falls back to approximate shaping.
- Production fallback remains functional but does not emit the development pre-bake warning.

## Central invariant

> The loader may obtain canonical bytes from the network or from a lazy Worker bake, but every downstream consumer sees exactly one asset model and one shaping/layout/presentation architecture.
