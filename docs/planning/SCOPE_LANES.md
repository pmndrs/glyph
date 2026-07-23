# Scope lanes

Status: rescoping worksheet  
Purpose: decide what to build now without hard-coding away later capabilities

## Current proof

> Can `pmndrs/text` take one ordinary OpenType font through the same portable baker from Node or a lazy loader Worker, load one canonical asset, shape and reflow a paragraph, and render one generated presentation without identity or dependency debt?

## Build now

### Delivery and baking

- one host-independent bake core;
- Node filesystem/CLI host;
- runtime baker library dynamically imported only after baked-asset miss, with its core executed in a Worker;
- baked-first loader with deterministic sibling naming;
- one development-only deduplicated warning on fallback;
- no `forceRuntime` or baked-asset bypass option;
- one canonical asset output and one validator/registration path;
- one generated grayscale bitmap strike;
- Node/Worker output-parity and package-graph tests;
- in-memory load/fallback deduplication.

This is a real baker, not fixture assembly. It is deliberately not yet an optimizing OpenType compiler.

### Shaping and layout

- one pinned font retained in the canonical asset for HarfRust;
- source-local glyph IDs scoped by opaque font handles;
- HarfRust Wasm registration and reusable shaping state/plans;
- coarse batched shaping with UTF-16 clusters, four positions, and flags;
- HarfBuzz/HarfRust/runtime conformance fixtures;
- JS paragraph model, measured clusters, greedy fixed-width reflow, and batched boundary reshape seam;
- font slots in runtime output even with one font.

### Presentation and evidence

- flat bitmap records and direct bulk GPU upload;
- explicit optional presentation plugin selection;
- WebGPU/WebGL2 visual fixtures;
- bake, load, Wasm, layout, upload, memory, and GPU baselines;
- malformed source/asset and resource-limit fixtures.

## Reserve the lane

The V0 contracts must permit, without implementing:

- many one-face font assets in one registry;
- zero, one, or many presentations per asset;
- MTSDF and Slug generator/runtime pairs as optional imports;
- shaping-only or compiled lookup sections;
- dense per-font glyph remapping;
- persistent content-addressed fallback cache;
- font fallback, mixed-font spans, bidi growth, and advanced line breaking;
- color/image presentations and multiple atlas pages/strikes.

Reserve these through font-scoped identity, versioned optional sections, capability bits, provenance, clear ownership, and stable request/result seams—not placeholder engines.

## Do not build now

- subsetting or shaping closure;
- dense glyph remapping;
- compiled GSUB/GPOS IR or alternate HarfRust provider;
- SIMD-specific shaping kernels, AOT/JIT Wasm, or MLIR;
- runtime variable axes;
- automatic presentation switching;
- MTSDF or Slug generation;
- Windfoil integration;
- persistent runtime-bake storage;
- progressive generation;
- public React/Three bindings;
- stable external format promises.

## Boundary rules

### Baker

- The core accepts bytes plus a canonical descriptor and returns bytes plus diagnostics.
- Node and Worker hosts contain no font-domain decisions.
- Source parsing occurs once per bake, not once per presentation.
- Presentation generators are optional modules and may be dynamically imported.
- The CLI is a host over the core, never the compiler API itself.

### Loader

- A baked asset hit never downloads or instantiates the runtime baker library, Worker, or Wasm core.
- A miss warns only in development and automatically uses the Worker.
- Invalid/incompatible baked assets produce structured diagnostics before fallback.
- Raw OpenType never becomes a second registered runtime model.

### Shaper

- Do not use string indices as glyph identity.
- Do not assume one character equals one glyph.
- Do not expose HarfRust structs or presentation-space coordinates.
- Keep `yAdvance` and `yOffset` even before vertical layout.

### Paragraph

- Wrapping is not a shaper option.
- Breaks live in source coordinates and respect clusters/unsafe flags.
- Source logical order remains distinct from visual order.
- Width changes reuse broad shaping and batch required reshapes.

### Presentation

- Advances and kerning remain shared font data.
- Logical, ink, and presentation bounds are distinct.
- On-disk records are not Three.js instance structs.
- “Direct to GPU” means no per-glyph reconstruction/repacking, not zero browser upload work.

## Delivery sequence

1. Freeze request/result, identity, container, and import boundaries.
2. Pin the font and capture shaping/visual oracles.
3. Build the minimal shared baker, bitmap generator, canonical writer, and Node host.
4. Build the baked-first loader and lazy Worker fallback; prove Node/Worker parity and bundle separation.
5. Add HarfRust runtime shaping over the canonical asset.
6. Add the JS paragraph engine and resize behavior.
7. Render the generated bitmap on WebGPU/WebGL2 and record baselines.
8. Register the same asset twice and harden identity, lifetime, limits, cancellation, and diagnostics.

The first slice is successful when the next font or presentation is additive—not when every future technique is already present.
