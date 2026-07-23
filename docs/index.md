---
okf_version: "0.1"
---

# pmndrs/text knowledge bundle

## Start here

- [Planned API walkthrough](tutorials/API_PREVIEW.md) - Load, bake, lay out, resize, and switch presentation using the proposed V0 API.
- [Canonical roadmap](roadmap/ROADMAP.md) - Exact implementation sequence, dependencies, effort, and exit gates.
- [Artifact map](roadmap/ARTIFACTS.md) - Libraries, Wasm modules, GLBs, fixtures, and reports produced by the roadmap.
- [Project brief](planning/PROJECT_BRIEF.md) - Product outcome, current slice, later product horizon, and non-goals.

## Reference

- [Runtime and bake API V0](planning/API_SHAPES.md) - Canonical TypeScript API fixture and package boundaries.
- [Architecture](planning/ARCHITECTURE.md) - Ownership, import graph, loading state machine, and system invariants.
- [Runtime data design V0](planning/DATA_DESIGN_V0.md) - Identity, metrics, resource binding, and runtime memory.
- [Shaping data contract V0](planning/SHAPING_DATA_CONTRACT.md) - Reduced SFNT profile, Wasm ABI, validation, and byte accounting.
- [Presentation data contract V0](planning/PRESENTATION_DATA_CONTRACT.md) - Bitmap, MTSDF, and Slug binary/GPU records.
- [glTF extension drafts](planning/extensions/) - Concrete `PMNDRS_font` extension family and schemas.
- [Renderer capability matrix](planning/RENDERER_CAPABILITIES.md) - Supported effects, content types, and technique limits.

## Verification and tooling

- [Tooling fixtures](planning/TOOLING_FIXTURES.md) - Pinned inputs, golden artifacts, and runners.
- [Conformance plan](planning/CONFORMANCE_PLAN.md) - HarfBuzz/HarfRust/runtime comparison and correctness gates.
- [Benchmark plan](planning/BENCHMARK_PLAN.md) - Cold/warm performance, memory, payload, and GPU evidence.
- [Autoresearch protocol](planning/AUTORESEARCH.md) - Human-reviewed optimization loop after baselines exist.

## Explanation and research

- [Research bibliography](../RESEARCH.md) - Primary external sources and concise extracted findings.
- [Three Flatland Slug audit](planning/SLUG_AUDIT.md) - Prior art to port, rewrite, or leave behind.
- [GPU compression](planning/GPU_COMPRESSION.md) - Transport, decoded, and GPU-resident compression constraints.
- [Payload budget](planning/PAYLOAD_BUDGET.md) - Measured and modeled costs by payload category.
- [Rendering difficulty](planning/IMPLEMENTATION_DIFFICULTY.md) - Relative effort to make each presentation correct and fast.

## Governance

- [Decision register](planning/DECISION_REGISTER.md) - Proposed choices and acceptance status.
- [Open questions](planning/OPEN_QUESTIONS.md) - Remaining blockers and prototype questions.
- [Documentation audit](DOCUMENTATION_AUDIT.md) - Source inventory, contradictions, canonical homes, and superseded plans.
- [Planning index](planning/index.md) - Detailed inventory including historical records.
- [Update log](log.md) - Documentation-bundle changes.
