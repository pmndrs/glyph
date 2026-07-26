# Planning concepts

## Product, API, and execution

- [Project brief](project-brief.md) — product intent, current integration slice, V1, and later horizon.
- [Runtime and bake API V0](api-shapes.md) — public and internal TypeScript contract fixture.
- [Architecture](architecture.md) — system ownership, import boundaries, and runtime flow.
- [Canonical roadmap](../roadmap/roadmap.md) — authoritative implementation order and exit gates.
- [uikit integration](uikit-integration.md) — third-party retained-layout integration boundary.

## Data and extension contracts

- [Shaping data contract V0](shaping-data-contract.md) — reduced SFNT and Wasm shaping ABI.
- [Raster data contract V0](raster-data-contract.md) — raster records, texture resources, and paging.
- [glTF extension drafts](extensions/index.md) — core and companion extension schemas.
- [glTF registration draft](gltf-extension-registration.md) — proposed Khronos prefix/extension submission.

## Verification and tooling

- [V0 version pins](version-contract.md) — exact toolchain, oracle, schema, validator, ABI, format, and generator versions.
- [Portable font baker implementation evidence](font-baker-implementation.md) — package-owned Rust/Wasm/TypeScript core evidence; roadmap status remains canonical.
- [Wasm allocator experiment](font-baker-allocator.md) — allocator candidates, representative workloads, and selection gate.
- [Benchmark plan](benchmark-plan.md) — benchmark harness and performance evidence.
- [Conformance plan](conformance-plan.md) — correctness oracles and acceptance gates.
- [Tooling fixtures](tooling-fixtures.md) — reproducible sources, goldens, and validators.
- [Autoresearch protocol](autoresearch.md) — controlled optimization workflow.

## Shaping research

- [Shaping compilation and execution research](shaping-compilation-research.md) — closed-corpus baking, semantic bytecode, per-font CPU/Wasm specialization, and WebGPU execution research.

## Rendering analysis

- [Grayscale bitmap hinting research](bitmap-hinting-research.md) — native pixel placement, hinted strikes, and four-phase grayscale packing gates.
- [Renderer capabilities](renderer-capabilities.md) — feature matrix and developer guidance.
- [Implementation difficulty](implementation-difficulty.md) — relative correctness and performance effort.
- [Payload budget](payload-budget.md) — serialized, decoded, and resident cost model.
- [GPU compression](gpu-compression.md) — transport and GPU-native compression constraints.
- [Slug audit](slug-audit.md) — prior-art findings and implementation disposition.

## Governance

- [Decision register](decision-register.md) — architectural decision status.
- [Open questions](open-questions.md) — unresolved decisions and required experiments.
