---
type: Decision
title: "Scope Three text batches to authored groups"
description: 'Make top-level authored TextGroups physical draw boundaries by default, with explicit nested and shared policies.'
decision_status: Accepted
decided: '2026-10-08'
generated:
  by: process:docs-new
  at: '2026-10-08T18:14:08Z'
---

# Scope Three text batches to authored groups

## Decision

Three `TextGroup` batching follows authored boundary intent without creating another Glyph root, planner, or publication
stream. `batching: 'auto'` is the default: each top-level authored group owns a physical draw boundary and nested
automatic groups inherit it. `batching: 'group'` forces a nested boundary. `batching: 'shared'` creates no boundary and
joins the nearest authored boundary or the implicit root pool.

## Why

The 0.1.0 global pool could coalesce compatible records across sibling groups, so hiding one authored group could not
skip its complete draw without affecting another group. A renderer-owned scope on the material binding lets compatible
records remain coalesced within the selected boundary and lets visibility suppress the realized draw without entering
Wasm. [Integration tests](../../../../packages/glyph/tests/integration/three-v1.test.mjs) distinguish automatic siblings,
shared compatibility, nested explicit boundaries, first publication while hidden, and reused-draw visibility.

## Consequences

The default changes 0.1.0 multi-group draw topology and therefore targets 0.2.0; applications that require the old
cross-group coalescing select `shared`. Boundary changes reuse compatible meshes when possible, and accepted buffers,
semantic text state, transform slots, and the single root transaction remain authoritative. Visibility stays an
engine-free scene update even when semantic publication is rejected. The package changelog is included in the published
artifact and records the migration.
