# One-font vertical-slice roadmap

Status: proposed current roadmap  
Goal: bake, load, shape, reflow, and render one font while hardening interfaces for many fonts and presentation engines

## Finish line

Given one pinned OpenType font, the package can:

1. bake a canonical `PMNDRS_font` asset with a bitmap presentation from Node;
2. discover and load that baked asset without importing the runtime baker library;
3. when the baked asset is absent, warn once in development, dynamically import the runtime baker library, execute it in a Worker, and produce the same canonical asset;
4. register the canonical font once in HarfRust Wasm;
5. shape reference text with correct clusters, glyph IDs, positions, and flags;
6. lay text into a fixed-width region in JavaScript and reflow on resize;
7. upload bitmap records and texture data without per-glyph reconstruction;
8. render on WebGPU and WebGL2;
9. report bake, load, shape, layout, upload, memory, and GPU baselines.

No `forceRuntime` option exists. Pre-baking is the expected path; fallback is an automatic compatibility path.

## Current exclusions

- subsetting, shaping closure, or glyph remapping;
- compiled GSUB/GPOS data or an alternate HarfRust provider;
- SIMD, AOT Wasm, browser-time JIT, or MLIR;
- persistent runtime-bake cache;
- automatic font fallback;
- MTSDF/Slug generation;
- color emoji and SVG icon-font generation through the Slug feature set;
- Windfoil implementation, which remains general-vector research outside the text roadmap;
- automatic presentation selection;
- progressive baking;
- React/Three public bindings.

The minimal baker, Node host, Worker host, and dynamic import boundary are in scope now. The advanced font compiler is not.

## Milestone 0 — Contract freeze

Deliverables:

- approve the runtime/bake API and V0 data design;
- approve one portable bake core with Node and Worker hosts;
- approve one canonical output path and no runtime-forcing option;
- approve `(FontHandle, LocalGlyphId)` and layout font slots;
- pin the reference font, HarfRust, HarfBuzz, Unicode, and generator versions.

Exit gate: no unresolved ownership, identity, or package-boundary question can force a breaking multi-font or multi-generator redesign.

## Milestone 1 — Fixture and oracle foundation

Deliverables:

- pinned Inter Regular candidate with license/hash manifest;
- UTF-16 shaping cases and HarfBuzz/HarfRust oracle outputs;
- expected bitmap strike outputs and visual goldens;
- malformed font/asset/range/page fixtures;
- benchmark environment and result schema.

Exit gate: every oracle and visual fixture is versioned and reproducible.

## Milestone 2 — Minimal shared baker and Node host

Deliverables:

- host-independent bake request/result contract;
- source parsing sufficient to retain shaping bytes and enumerate/rasterize glyphs;
- one deterministic bitmap strike and flat GPU-ready records;
- canonical `PMNDRS_font` writer and validator;
- Node filesystem host, JS API, and thin CLI;
- Node bake timing, size, and memory baseline.

Exit gate:

- the Node host contains no font-domain logic;
- the core contains no filesystem or CLI logic;
- the output loads through the canonical asset validator;
- no subsetting, remapping, or compiled layout IR sneaks into the milestone.

## Milestone 3 — Baked-first loader and Worker fallback

Deliverables:

- deterministic baked asset naming and probe;
- normal baked hit path;
- one development-only, deduplicated warning on miss;
- separate dynamically loaded `runtime-bake` library entry and Worker lifecycle;
- transferable request/result buffers;
- dynamically imported bitmap generator and bake Wasm;
- in-memory in-flight/result cache;
- baked asset hit/miss/invalid tests and bundle-graph assertions;
- Node-versus-Worker canonical-section parity test.

Exit gate:

- a baked asset hit does not download or instantiate the runtime baker library or its Wasm core;
- fallback work never parses or rasterizes on the main thread;
- fallback bytes re-enter the same validator/registration path;
- no public API can force or bypass the baked probe.

## Milestone 4 — Runtime HarfRust shaper

Deliverables:

- minimal Wasm wrapper and memory ABI;
- font registration/disposal by opaque handle;
- cached HarfRust state and reusable shape plans;
- coarse `shapeBatch` and `reshapeRanges` calls;
- structure-of-arrays outputs;
- exact comparison with pinned HarfRust fixtures.

Reasonable-speed gate: one registration copy, one Wasm call per batch, warm state reuse, no per-glyph objects, and recorded p50/p95/memory/call-count evidence.

## Milestone 5 — JS paragraph engine

Deliverables:

- paragraph text/default-font/span model;
- broad shapes and measured clusters;
- legal break representation for the fixture;
- greedy wrapping, placement, and width-only reflow cache;
- batched boundary-reshape seam;
- wide/narrow golden layout outputs.

Exit gate: layout remains UTF-16/cluster-correct, reuses broad shaping on ordinary resize, carries font slots, and never reads presentation bounds to measure text.

## Milestone 6 — Bitmap presentation and first frame

Deliverables:

- bitmap plugin consuming direct canonical ranges;
- texture upload and instance generation;
- WebGPU and WebGL2 reference scenes;
- clipping and resize demonstration;
- first-draw and GPU-memory report.

Exit gate: layout uses font metrics, no record reconstruction/repacking occurs, and changing presentation code cannot change shaped identities.

## Milestone 7 — Harden the complete path

Deliverables:

- stale-handle, cancellation, malformed-input, and resource-limit tests;
- cold/warm offline and fallback benchmark report;
- two-registrations identity tests;
- export-boundary and tree-shaking tests;
- accepted decision records;
- autoresearch baseline artifacts, with optimization search disabled until quality gates pass.

Exit gate: one font completes both delivery paths reproducibly, the normal path stays small, runtime performance is reasonable, and adding another font or presentation is additive.

## After the slice

1. add a genuinely different second font and explicit multi-font spans;
2. add font fallback and mixed-script fixtures;
3. add MTSDF behind the established generator/plugin boundaries;
4. port/rewrite Slug with its proven optimizations;
5. add baked COLR/SVG vector layers and embedded color-bitmap presentations to the Slug feature set;
6. activate autoresearch on measured bottlenecks;
7. introduce subsetting, remapping, compiled lookup data, or SIMD only when evidence justifies each unit.
