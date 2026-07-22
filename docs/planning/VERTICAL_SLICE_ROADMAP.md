# One-font vertical-slice roadmap

Status: proposed current roadmap  
Goal: render one constrained paragraph from one runtime-shaped font, while hardening identities and interfaces for multiple fonts

## Finish line

Given one pinned OpenType font and one pre-generated bitmap presentation fixture, the package can:

1. register the font once in HarfRust Wasm;
2. shape reference text with correct UTF-16 clusters, glyph IDs, advances, offsets, and flags;
3. lay the text into a fixed-width region in JavaScript;
4. reflow on width change without unnecessary reshaping;
5. build bitmap instances using the same local glyph IDs;
6. upload prepared records/texture data without per-glyph reconstruction;
7. render and verify the result on WebGPU and WebGL2;
8. report registration, shaping, layout, upload, memory, and GPU baselines.

The implementation uses one font, but all identities and output records remain correct when more fonts are registered.

## Current exclusions

- font compiler or generalized baker;
- subsetting, shaping closure, or glyph remapping;
- worker runtime baking and persistent baked cache;
- compiled GSUB/GPOS data or alternate HarfRust provider;
- SIMD, AOT Wasm, browser-time JIT, or MLIR;
- automatic font fallback;
- MTSDF/Slug generation or Windfoil integration;
- automatic presentation selection;
- React/Three public bindings.

These remain documented future lanes. They do not enter the critical path.

## Milestone 0 — Contract freeze for the experiment

Deliverables:

- review `API_SHAPES.md` and `DATA_DESIGN_V0.md`;
- approve `(FontHandle, LocalGlyphId)` and layout font slots;
- approve one-font-per-asset, many-fonts-per-registry ownership;
- approve the typed shaped/layout buffer fields and lifetimes;
- approve explicit presentation plugin selection;
- choose/pin the reference font, HarfRust commit, HarfBuzz version, and Unicode version.

Exit gate:

- no unresolved identity or ownership question can force a multi-font breaking change;
- no compiler or presentation-specific field appears in the shaping API.

## Milestone 1 — Fixture and oracle foundation

Deliverables:

- pinned Inter Regular candidate with source/license/hash manifest;
- exact UTF-16 shaping cases;
- HarfBuzz and HarfRust oracle outputs;
- pre-generated bitmap strike, dense glyph records, and asset envelope;
- corrupt range/count/page fixtures;
- benchmark environment/result manifest.

Exit gate:

- oracle generation is deterministic and versioned;
- presentation glyph IDs agree with source/OpenType glyph IDs;
- fixture packer performs assembly and validation only, not compilation.

## Milestone 2 — Runtime HarfRust shaper

Deliverables:

- minimal Wasm wrapper and memory ABI;
- font registration/disposal by opaque handle;
- cached HarfRust font data and reusable shape plans;
- coarse `shapeBatch` call over UTF-16 and run records;
- structure-of-arrays output views;
- exact comparisons against pinned HarfRust fixtures.

Reasonable-speed gate:

- font bytes are copied/registered once;
- shaping performs one JS/Wasm call per batch;
- warm calls reuse parsed font state and plans;
- no per-glyph JS object allocation occurs;
- raw timing, p50/p95, retained memory, and call counts are recorded before optimization claims.

## Milestone 3 — Font registry and asset loader

Deliverables:

- `FontDefinition`, `RegisteredFont`, and `FontRegistry` experiment;
- experimental asset-envelope reader and validator;
- source bytes registered with the shaper;
- presentation metadata retained as flat views;
- lazy presentation resource preparation;
- two-handles/one-source collision and disposal tests.

Exit gate:

- glyph lookup always includes font identity;
- the loader creates no per-glyph map/object graph;
- malformed assets fail with structured diagnostics.

## Milestone 4 — JS paragraph engine, one font

Deliverables:

- paragraph text/default-font/span model;
- broad shaping and measured clusters;
- initial legal break representation sufficient for the fixture;
- greedy word wrapping and line placement;
- width-only reflow cache;
- batched reshape seam even if the first Latin fixture rarely needs it;
- wide and narrow golden layout outputs.

Exit gate:

- source ranges and clusters remain UTF-16 based;
- ordinary width changes reuse broad shaping;
- layout output includes a font table and font slots;
- no presentation technique participates in line measurement.

## Milestone 5 — Bitmap presentation and first frame

Deliverables:

- bitmap presentation plugin;
- direct dense-record views and texture upload;
- instance generation from positioned glyphs;
- WebGPU and WebGL2 reference scenes;
- fixed-region clipping and resize demonstration;
- first-draw timing and GPU memory report.

Exit gate:

- the fixture paragraph renders correctly on both backends;
- shared OpenType metrics—not bitmap atlas bounds—control layout;
- no per-glyph record reconstruction or numeric repacking occurs before upload;
- changing presentation code cannot change shaped/layout identities.

## Milestone 6 — Harden the first complete path

Deliverables:

- API misuse and stale-handle tests;
- corrupt/untrusted-input limits;
- cold/warm benchmark report;
- multi-font identity contract tests using two registrations;
- package/export boundaries that keep presentation code optional;
- accepted decision records for the experimental API and data contracts;
- autoresearch baseline artifacts, with optimization search still disabled until quality gates are complete.

Exit gate:

- one font completes the full pipeline reproducibly;
- baseline performance is reasonable for the reference workload and bottlenecks are measured;
- the next font or presentation requires an additive fixture/plugin, not an identity/API redesign;
- all performance claims link to raw evidence.

## After the slice

Recommended next sequence:

1. add one genuinely different second font and explicit multi-font spans;
2. add fallback selection and mixed-script fixtures;
3. add MTSDF as the general-purpose presentation target;
4. port/rewrite Slug with its proven quality-preserving optimizations;
5. activate the autoresearch loop on measured Slug and shared runtime bottlenecks;
6. reconsider compiler/baker work only when runtime parsing, asset delivery, or payload evidence justifies it.

The first slice is successful if it makes these additions routine—not if it implements them early.
