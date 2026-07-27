---
okf_version: "0.2"
---

# pmndrs/text knowledge bundle

## Start here

- [Project README](../README.md) — product overview, API preview, implementation order, and local setup.
- [Project brief](planning/project-brief.md) — product outcome, scope, non-goals, and success criteria.
- [Canonical roadmap](roadmap/roadmap.md) — implementation sequence, issue-sized milestones, dependencies, and exit gates.
- [Runtime and bake API V0](planning/api-shapes.md) — proposed public API and package boundaries.

## Architecture and data contracts

- [Architecture](planning/architecture.md) — ownership, loading, shaping, paragraph, and raster boundaries.
- [Shaping data contract V0](planning/shaping-data-contract.md) — retained SFNT profile, Wasm ABI, validation, and conformance.
- [Raster data contract V0](planning/raster-data-contract.md) — bitmap, MSDF, and Slug records and resources.
- [glTF extension drafts](planning/extensions/index.md) — `PMNDRS_font` and raster companion schemas.
- [uikit integration](planning/uikit-integration.md) — framework-neutral measurement/layout boundary and adoption path.

## Verification and evidence

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
- [Shaping compilation research](planning/shaping-compilation-research.md) — static shaping, semantic bytecode, per-font specialization, MLIR, and WebGPU hypotheses and gates.
- [Bitmap hinting research](planning/bitmap-hinting-research.md) — hinted grayscale strikes and four-phase coverage packing without distance fields or LCD rendering.
- [MTSDF generation research](planning/mtsdf-generation-research.md) — primary literature, open implementations and licenses, repository ownership, and scalar/SIMD evidence gates.
- [Research bibliography](../RESEARCH.md) — attributed external sources and extracted findings.
- [Decision register](planning/decision-register.md) — proposed and settled architectural choices.
- [Open questions](planning/open-questions.md) — unresolved blockers and required prototypes.
- [Planning index](planning/index.md) — complete planning-document inventory.
- [Knowledge bundle log](log.md) — newest-first record of knowledge-bundle changes.
