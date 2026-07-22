# Phased implementation plan

Status: proposed  
Rule: every phase ends with an evidence gate before the next optimization layer begins.

## Phase 0 — Decisions and baselines

Goal: remove architectural ambiguity before production code.

Deliverables:

- approve the project brief and architecture boundaries;
- review the [decision register](DECISION_REGISTER.md) and record accepted choices as ADRs;
- select and pin HarfRust/HarfBuzz/Unicode reference versions;
- select the initial font corpus and licenses;
- review the [Three Flatland Slug audit](SLUG_AUDIT.md) and confirm port/rewrite dispositions;
- write ADRs for container, shaper baseline, paragraph boundary, and static variations;
- adopt the [benchmark plan](BENCHMARK_PLAN.md), machines/browsers, and result format;
- adopt the [conformance plan](CONFORMANCE_PLAN.md) and unsupported-feature policies.

Exit gate:

- maintainers agree on the six decisions in the project brief;
- every open blocking question has an owner or prototype issue;
- no public API is declared stable.

## Phase 1 — Reference shaping and format experiment

Goal: prove the canonical glyph identity and conformance pipeline without optimized lookup IR or production rendering.

Deliverables:

- minimal binary-model specification for header, section directory, metrics, cmap, and reference shaping data;
- native research baker that emits deterministic experimental bytes;
- HarfRust Wasm wrapper that shapes a registered font in coarse calls;
- typed-array shaped output with UTF-16 clusters and flags;
- HarfRust/HarfBuzz three-way fixture runner;
- raw/compressed Wasm and shaping-data size reports;
- initial Latin, Arabic, Devanagari, emoji, icon, and CJK-subset fixtures.

Non-goals:

- compiled GSUB/GPOS replacement;
- worker baking;
- production paragraph layout;
- production presentation renderers.

Exit gate:

- supported fixtures match the pinned HarfRust baseline;
- all observed HarfBuzz differences are understood and recorded;
- repeated output is byte-deterministic for the same native inputs;
- the Wasm boundary shapes batches without per-glyph calls.

## Phase 2 — Shared GLB container and presentation records

Goal: prove one glyph-ID space and zero-repacking payloads.

Deliverables:

- experimental `FL_font` extension specification and golden GLBs;
- presentation directory and availability model;
- port/rewrite assessment implemented for Slug flat data;
- MTSDF metadata and placeholder/generator experiment;
- generated grayscale bitmap strike experiment;
- loader validation and direct binary views;
- GPU upload probes for target WebGL/WebGPU paths;
- one visual fixture rendered through every available technique from one glyph stream.

Exit gate:

- no presentation duplicates advances or kerning;
- packed glyph IDs agree across all sections;
- GPU records need no per-glyph JS conversion;
- extension validator catches corrupt offsets, alignments, and capabilities.

## Phase 3 — Runtime worker baker

Goal: make source fonts converge on the same canonical representation during load.

Deliverables:

- shared native/Wasm compiler core;
- lazy worker protocol with cancellation and structured progress/errors;
- source transfer and baked-result transfer without cloning large buffers;
- persistent cache and deterministic cache key;
- glyph-range/text selection plus shaping closure;
- native-versus-Wasm canonical section parity tests;
- time/memory limits and large-font failure behavior.

Exit gate:

- the normal loader cannot distinguish offline from runtime-baked canonical data;
- worker baking does not block the main thread;
- cache hits bypass the baker;
- large-font limits fail explicitly instead of exhausting the tab.

## Phase 4 — JS paragraph engine V1

Goal: lay shaped text into constrained regions with controlled Wasm traffic.

Deliverables:

- paragraph/style/constraint data model;
- run segmentation and font fallback boundary;
- UAX #14 break opportunities and UAX #29 grapheme safety;
- greedy word/character wrapping;
- alignment, max-lines, clipping, and ellipsis;
- broad-run and line-shape caches;
- batched boundary reshape protocol;
- bidi line-order fixtures;
- interactive-resize benchmark recording reflow time and Wasm call count.

Exit gate:

- ordinary Latin width changes use zero shaping calls;
- boundary-sensitive width changes use at most one batched reshape call;
- unsafe-to-break, soft hyphen, ellipsis, RTL, Arabic, and mixed-script fixtures behave as specified;
- shaped output remains presentation-independent.

## Phase 5 — Compiled lookup data and SIMD

Goal: replace measured bottlenecks while preserving reference behavior.

Order of experiments:

1. direct cmap and advances;
2. glyph classes and coverage;
3. single substitutions;
4. direct/class pair positioning;
5. ligature trie;
6. mark and cursive attachment;
7. contextual operations;
8. SIMD-assisted scans and bulk adjustments.

For every operation family:

- add compiler representation;
- add scalar executor;
- differential-test against reference;
- benchmark before/after on representative fonts;
- measure raw and compressed payload change;
- add SIMD only where scalar profiling justifies it.

Exit gate:

- each enabled fast path is bit-for-bit equivalent on the supported corpus;
- benchmarks demonstrate a material product benefit;
- regressions can disable an operation family independently;
- unproven performance estimates are removed from public claims.

## Phase 6 — Stabilization and downstream adoption

Goal: ship a supportable package and migrate Three Flatland.

Deliverables:

- public API review and semver policy;
- format/version migration policy;
- security review for untrusted fonts and binary sections;
- browser compatibility and scalar fallback policy;
- documentation and examples;
- package-size budgets and CI gates;
- Three Flatland integration adapter and migration guide;
- production telemetry hooks limited to opt-in timings/diagnostics.

Exit gate:

- Three Flatland renders equivalent or better text through `pmndrs/text`;
- no production consumer depends on experimental internal binary structs;
- supported/unsupported font behavior is documented;
- release artifacts meet agreed size, correctness, and browser gates.

## Cross-cutting workstreams

### Correctness

Conformance fixtures, Unicode tests, differential fuzzing, corrupt-input tests, and visual snapshots begin in Phase 1 and expand continuously.

### Performance

Every phase records startup, steady-state, allocation/peak memory, raw/compressed bytes, and boundary-call counts. Benchmarks are versioned artifacts, not prose estimates.

### Format governance

Binary structs remain experimental until golden fixtures, forward-compatibility behavior, and at least one migration exercise exist.

### Documentation

Annotated source references stay in `RESEARCH.md`; design reasoning stays in planning documents; accepted choices become ADRs; user-facing behavior belongs in package documentation once stable.
