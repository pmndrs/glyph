---
type: Engineering Research
title: Allocation-light adapter publication frontier
description: Records the remaining work required to keep Rust authoritative for text state while JavaScript adapters bind stable views and realize minimal patches.
status: draft
tags: [performance, correctness, adapters, publication, rust, wasm, three, typegpu]
sources:
  - id: follow-up-issue
    resource: https://github.com/pmndrs/glyph/issues/219
    title: Restore allocation-light adapter publication paths
  - id: render-planner
    resource: ../../../packages/glyph/src/internal/render-planner.ts
    title: Renderer-neutral plan orchestration
  - id: configured-handle
    resource: ../../../packages/glyph/src/internal/configured-handle.ts
    title: Configured handle state and publication
  - id: desired-text
    resource: ../../../packages/glyph/src/internal/desired-text.ts
    title: Desired text normalization
  - id: three-renderer
    resource: ../../../packages/glyph/src/three/command-buffer-renderer.ts
    title: Three command-buffer realization
  - id: transform-synchronizer
    resource: ../../../packages/glyph/src/three/transform-synchronizer.ts
    title: Three transform synchronization
  - id: typegpu-renderer
    resource: ../../../packages/glyph/src/typegpu/internal/renderer.ts
    title: TypeGPU plan realization
  - id: layout-query-view
    resource: ../../../packages/glyph/src/internal/layout-query-view.ts
    title: Borrowed layout query views
  - id: package-benchmark
    resource: ../../../benches/labs/package
    title: Public package performance benchmark suites
  - id: request-arena-benchmark
    resource: ../../../benches/labs/request-arena.bench.ts
    title: Direct request-arena encoding benchmarks
generated:
  by: openai-codex/gpt-6
  at: '2026-09-20T05:36:40Z'
---

# Allocation-light adapter publication frontier

## Contract

Rust owns text normalization, shaping, layout, ordering, stable identity, and render-patch planning. JavaScript adapters
should bind stable typed-array views and realize the published patches. They should not rebuild an equivalent command
tree, allocate replacement records for unchanged state, or infer semantic changes that the engine already classified.

This is both a performance and correctness contract. Duplicate representations can drift, make unchanged work expensive,
and obscure which layer owns an update. The retained engine and borrowed publication arena already provide the mechanisms
needed to avoid that duplication.[^render-planner][^layout-query-view]

## Current frontier

The current PR stack has removed complete-state reconstruction for normalized no-ops, kept Three order-only publication
out of transform work, kept TypeGPU position-only changes out of semantic publication, and removed framework shadow
normalization. React and Vue now submit complete desired state through Three's authoritative normalizer, which reuses equal
property and span snapshots and reports whether the accepted revision changed. Neither adapter retains a caller-owned
accepted-state mirror; Vue retains only the detached reactive snapshots required by its mutable proxy contract. The
Prepared planner frames now write directly into the retained Wasm request arena; the owned wire copy remains only as a
byte-for-byte compatibility path. The `txt`, React, and Vue compilers record that their frozen spans are already normalized
against the exact text they accompany, so Three validates but does not rebuild that grapheme grid. Arbitrary caller arrays,
changed text, and unaligned spans still enter the shared Unicode path. The existing `withGlyphs` path already starts sparse
and promotes only a repeated or explicit inspection. Focused Labs evidence improves one semantic request by 5.8%, 1,000
order records by 7.1%, 1,000 equivalent `txt` formatted-flow updates by 5.8%, and the framework-bound equivalent by 6.0%,
while a changed trailing-span stress case and the neighboring retained and cold workloads remain below the five-percent
regression threshold.

The remaining measured host work is now:

- TypeGPU patch realization still copies some borrowed payload and map data beyond backend-required upload ownership.
- fresh but equivalent flow descriptions still rebuild normalized regions before Three can reuse accepted flow identity.

These are not independent invitations to add caches. The first question for each path is whether the engine can publish the
authoritative delta through its existing stable identity, dependency masks, borrowed buffers, and patch tables. Adapter-
local scratch storage is appropriate only for state the engine intentionally does not own, such as scene transforms.

## Existing paths to preserve

- an idle `glyph.shape()` call is already constant-time;
- Three transform synchronization reuses scratch storage and does not require semantic layout work;
- Rust already owns ordering and changed-range planning;
- published patch and query tables are borrowed views rather than durable JavaScript object graphs.

Optimizations must preserve those fast paths and avoid moving policy from Rust into each renderer.

## Work sequence

1. Add allocation and timing evidence for unchanged, transform-only, order-only, style-only, and position-only workloads.
2. Attribute each remaining host allocation or copy to engine-owned state, adapter-local state, or backend-required upload.
3. Extend the existing dependency-mask and patch-publication contracts where engine-owned deltas are missing.
4. Replace snapshot-before-equality and full-table realization with generation checks, stable views, or changed ranges.
5. Verify Three and TypeGPU correctness and benchmark every changed path against already-fast workloads.

The implementation and acceptance checklist lives in [GitHub issue #219](https://github.com/pmndrs/glyph/issues/219).

## Acceptance

- Unchanged publication performs no semantic preparation and allocates no per-frame records or arrays.
- Transform-only and order-only work does not reshape, remeasure, or reconstruct desired text.
- Style and position changes publish only dependencies proven dirty by the engine.
- Three and TypeGPU consume the same authoritative patch semantics without private shadow models.
- Focused Labs benchmarks show the improvement and prove no regression in safe retained paths.
- Correctness tests cover stable identity, overlapping patch application, transaction rejection, and borrowed-view lifetime.

[^render-planner]: [Renderer-neutral plan orchestration](../../../packages/glyph/src/internal/render-planner.ts)

[^layout-query-view]: [Borrowed layout query views](../../../packages/glyph/src/internal/layout-query-view.ts)
