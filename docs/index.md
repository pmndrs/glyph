---
okf_version: "0.1"
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

- [Benchmark plan](planning/benchmark-plan.md) — interactive/headless harness, scenarios, metrics, and reports.
- [Conformance plan](planning/conformance-plan.md) — shaping, layout, visual, binary, and runtime correctness gates.
- [Tooling fixtures](planning/tooling-fixtures.md) — pinned sources, goldens, malformed inputs, and package tests.
- [Payload budget](planning/payload-budget.md) — shaping, transport, raster, and GPU-memory accounting.
- [Autoresearch protocol](planning/autoresearch.md) — quality-gated optimization after baselines exist.

## Research and governance

- [Research bibliography](../RESEARCH.md) — attributed external sources and extracted findings.
- [Decision register](planning/decision-register.md) — proposed and settled architectural choices.
- [Open questions](planning/open-questions.md) — unresolved blockers and required prototypes.
- [Planning index](planning/index.md) — complete planning-document inventory.

