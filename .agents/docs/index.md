---
okf_version: '0.2'
---

# pmndrs/glyph knowledge bundle

## Start here

- [Project README](../../README.md) — product overview, API preview, implementation order, and local setup.
- [Project brief](planning/project-brief.md) — product outcome, scope, non-goals, and success criteria.
- [Canonical roadmap](roadmap/roadmap.md) — implementation sequence, issue-sized milestones, dependencies, and exit gates.
- [Merged v0 runtime and bake API](planning/api-shapes.md) — superseded migration fixture; it describes the merged v0 surface that the Rust render-plan cutover deleted.
- [Three.js text API](planning/three-api.md) — authoritative Three-native loader, explicit `TextGroup` batching, reusable text across group disposal, retained non-throwing errors, ordering, and lifecycle contract.
- [Core text API](planning/core-api.md) — historical application and integration API superseded by the config-owned handle contract.
- [Font and engine ownership plan](planning/font-runtime-ownership.md) — historical ownership analysis that led to immutable fonts and config-owned handle roots.
- [Rust layout engine contract](planning/rust-layout-engine.md) — engine ABI, Codec execution, and command-buffer publication contract.
- [Engine integration contract](planning/engine-integration-contract.md) — superseded historical record; the Rust command buffer replaced this storage and batching contract.
- [Raster technique and engine resource API](planning/raster-technique-api.md) — superseded historical record; the Rust render-plan cutover replaced these TypeScript binding and packing interfaces.
- [TypeGPU-first shader authority](planning/typegpu-first-shader-authority.md) — exploratory TypeGPU-first shader/program architecture, Three and gpucat bridge limits, fallback authority models, and proof gates.
- [Renderer integration guide](guides/renderer-integration.md) — the config-only path for a custom engine: define its
  schema, Codec, resource resolver, renderer decoder, and root recipe through the same public API used by Three.
- [Technique implementation report](guides/technique-implementation-report.md) — worked portable program, Codec, raster,
  and baker examples with ownership maps and the end-to-end draw flow.
- [Merged v0 raster and baker plugin guide](planning/raster-baker-plugin.md) — build against the implemented combined runtime/renderer module before the target v1 extraction replaces it.
- [External gpucat integration fitness plan](planning/gpucat-integration.md) — source-validated proof plan for consuming the target v1 core without private imports or core changes.

## Architecture and data contracts

- [Architecture](planning/architecture.md) — ownership, loading, shaping, paragraph, and raster boundaries.
- [Renderer-neutral core and engine plan](planning/engine-integration-boundary.md) — WIP extraction sequence and proof gates for Three.js and Wayfare.
- [Shaping data contract V0](planning/shaping-data-contract.md) — retained SFNT profile, Wasm ABI, validation, and conformance.
- [Raster data contract V0](planning/raster-data-contract.md) — bitmap, MSDF, and Slug records and resources.
- [glTF extension drafts](planning/extensions/index.md) — `PMNDRS_font` and raster companion schemas.
- [sync measure plan](planning/sync-measure-plan.md) — paragraph-scoped synchronous measurement implementation plan (11.17).
- [uikit integration](planning/uikit-integration.md) — framework-neutral measurement/layout boundary and adoption path.

## Verification and evidence

- [Engineering reports](reports/index.md) — durable HTML implementation, ownership, review, and benchmark reports.
- [Workspace package catalog](packages/index.md) — enforced package roles, boundaries, status, and source-freshness digests.
- [Portable font baker implementation evidence](planning/font-baker-implementation.md) — package-owned Rust/Wasm/TypeScript core evidence.
- [Wasm allocator experiment](planning/font-baker-allocator.md) — evidence plan for the ABI-private Wasm allocator choice.
- [Benchmark plan](planning/benchmark-plan.md) — interactive/headless harness, scenarios, metrics, and reports.
- [Conformance plan](planning/conformance-plan.md) — shaping, layout, visual, binary, and runtime correctness gates.
- [Tooling fixtures](planning/tooling-fixtures.md) — pinned sources, goldens, malformed inputs, and package tests.
- [Payload budget](planning/payload-budget.md) — shaping, transport, raster, and GPU-memory accounting.
- [Autoresearch protocol](planning/autoresearch.md) — quality-gated optimization after baselines exist.

## Research and governance

- [Engineering house style](engineering/code-style.md) — canonical Rust, TypeScript, React, boundary, testing, and maintenance conventions.
- [Agent router operations](guides/agent-router.md) — setup, model routing, resumable review and implementation recipes,
  CLI fallback, and bounded trace handling for the pinned external-agent server.
- [Shaping compilation research](planning/shaping-compilation-research.md) — static shaping, semantic bytecode, per-font specialization, MLIR, and WebGPU hypotheses and gates.
- [Bitmap hinting research](planning/bitmap-hinting-research.md) — hinted grayscale strikes and four-phase coverage packing without distance fields or LCD rendering.
- [MTSDF generation research](planning/mtsdf-generation-research.md) — primary literature, open implementations and licenses, repository ownership, and scalar/SIMD evidence gates.
- [Research bibliography](../../RESEARCH.md) — attributed external sources and extracted findings.
- [Decision register](planning/decision-register.md) — proposed and settled architectural choices.
- [Open questions](planning/open-questions.md) — unresolved blockers and required prototypes.
- [Planning index](planning/index.md) — complete planning-document inventory.
- [Knowledge bundle log](log.md) — newest-first record of knowledge-bundle changes.
