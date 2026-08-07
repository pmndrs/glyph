# Planning concepts

## Product, API, and execution

- [Project brief](project-brief.md) — product intent, merged v0, target v1, and later horizon.
- [Merged v0 runtime and bake API](api-shapes.md) — public and internal TypeScript migration fixture.
- [Three.js text API](three-api.md) — authoritative `FontLoader`, `TextGroup`, and `Text` surface, including late binding, group disposal/rebinding, font leases, retained non-throwing errors, ordering, and render-loop synchronization.
- [Core text API](core-api.md) — authoritative API and rationale for ordered font stacks, batch-owned paragraph handles, identity-preserving capacity changes, font leases, fixed-capacity failure, physical batching, and cascading disposal.
- [Engine integration contract](engine-integration-contract.md) — exact prepared glyph-batch/run, variant, target storage, transform, draw compilation, staging, attachment ownership, and disposal contract.
- [Raster technique and engine resource API](raster-technique-api.md) — authoritative split between portable baker/artifact/CPU technique data, reusable backend technique shaders, variant-aware programs, and engine GPU targets.
- [TypeGPU raster programs and text engine](typegpu-api.md) — complete direct TypeGPU API for typed technique shaders, programs, variants, caller-owned render passes, transforms, synchronization, and disposal.
- [Merged v0 raster and baker plugin guide](raster-baker-plugin.md) — build against the implemented combined runtime/renderer module before the target v1 extraction replaces it.
- [Architecture](architecture.md) — system ownership, import boundaries, and runtime flow.
- [Renderer-neutral core, batching, and engine integration](engine-integration-boundary.md) — WIP extraction and proof plan for the batched core API, Three.js migration, direct TypeGPU engine, and Wayfare adapter.
- [External gpucat integration fitness plan](gpucat-integration.md) — public-surface mapping, external-package boundary, ordering/lifecycle plan, and remaining shader-reuse proof for gpucat.
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
- [Untrusted-resource validation library admission](untrusted-validation-research.md) — measured hand-validator, Zod Mini, Valibot, Ajv standalone, and TypeBox comparison.

## Shaping research

- [Shaping compilation and execution research](shaping-compilation-research.md) — closed-corpus baking, semantic bytecode, per-font CPU/Wasm specialization, and WebGPU execution research.
- [Language-aware font units and physical bitmap strikes](language-and-strike-bundles.md) — coverage-first language delivery, CJK units, DPR selection, and independent strike residency.
- [Responsive editorial flow and mixed-raster composition](editorial-flow-layout.md) — post-v1 exclusion regions, responsive columns, and a bitmap/MTSDF/Slug benchmark.

## Rendering analysis

- [MTSDF generation research](mtsdf-generation-research.md) — primary literature, implementation/license survey, owned Rust boundary, and data-oriented optimization gates.
- [Grayscale bitmap hinting research](bitmap-hinting-research.md) — native pixel placement, hinted strikes, and four-phase grayscale packing gates.
- [Renderer capabilities](renderer-capabilities.md) — feature matrix and developer guidance.
- [Three.js text effect composition](text-effect-composition.md) — optional TSL convenience over generic core variants and canonical raster shaders.
- [Implementation difficulty](implementation-difficulty.md) — relative correctness and performance effort.
- [Payload budget](payload-budget.md) — serialized, decoded, and resident cost model.
- [GPU compression and Rust container ownership](gpu-compression.md) — transport/GPU compression constraints plus the GLB/KTX2 serializer decision.
- [Slug audit](slug-audit.md) — prior-art findings and implementation disposition.

## Governance

- [Decision register](decision-register.md) — architectural decision status.
- [Architecture decision records](decisions/0001-package-runtime-boundaries.md) — accepted rationale grouped by package/runtime, shaping/identity, raster/container, and verification/optimization boundaries.
- [Open questions](open-questions.md) — unresolved decisions and required experiments.
