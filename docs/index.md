---
okf_version: "0.1"
---

# pmndrs/text knowledge bundle

## Start here

- [Planned API walkthrough](tutorials/api-preview.md) - Load, bake, lay out, resize, and switch presentation using the proposed V0 API.
- [Canonical roadmap](roadmap/roadmap.md) - Exact implementation sequence, dependencies, effort, and exit gates.
- [Artifact map](roadmap/artifacts.md) - Libraries, Wasm modules, GLBs, fixtures, and reports produced by the roadmap.
- [Project brief](planning/project-brief.md) - Product outcome, current slice, later product horizon, and non-goals.

## Reference

- [Runtime and bake API V0](planning/api-shapes.md) - Canonical TypeScript API fixture and package boundaries.
- [Architecture](planning/architecture.md) - Ownership, import graph, loading state machine, and system invariants.
- [Runtime data design V0](planning/data-design-v0.md) - Identity, metrics, resource binding, and runtime memory.
- [Shaping data contract V0](planning/shaping-data-contract.md) - Reduced SFNT profile, Wasm ABI, validation, and byte accounting.
- [Presentation data contract V0](planning/presentation-data-contract.md) - Bitmap, MTSDF, and Slug binary/GPU records.
- [glTF extension drafts](planning/extensions/) - Concrete `PMNDRS_font` extension family and schemas.
- [Renderer capability matrix](planning/renderer-capabilities.md) - Supported effects, content types, and technique limits.

## Verification and tooling

- [Tooling fixtures](planning/tooling-fixtures.md) - Pinned inputs, golden artifacts, and runners.
- [Conformance plan](planning/conformance-plan.md) - HarfBuzz/HarfRust/runtime comparison and correctness gates.
- [Benchmark plan](planning/benchmark-plan.md) - Cold/warm performance, memory, payload, and GPU evidence.
- [Autoresearch protocol](planning/autoresearch.md) - Human-reviewed optimization loop after baselines exist.

## Explanation and research

- [Research bibliography](../RESEARCH.md) - Primary external sources and concise extracted findings.
- [Three Flatland Slug audit](planning/slug-audit.md) - Prior art to port, rewrite, or leave behind.
- [GPU compression](planning/gpu-compression.md) - Transport, decoded, and GPU-resident compression constraints.
- [Payload budget](planning/payload-budget.md) - Measured and modeled costs by payload category.
- [Rendering difficulty](planning/implementation-difficulty.md) - Relative effort to make each presentation correct and fast.

## Governance

- [Decision register](planning/decision-register.md) - Proposed choices and acceptance status.
- [Open questions](planning/open-questions.md) - Remaining blockers and prototype questions.
- [Documentation audit](documentation-audit.md) - Source inventory, contradictions, canonical homes, and superseded plans.
- [Planning index](planning/index.md) - Detailed inventory including historical records.
- [Update log](log.md) - Documentation-bundle changes.
