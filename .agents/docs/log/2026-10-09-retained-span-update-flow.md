---
type: Log Entry
title: 'Retained sparse span updates through planner staging'
generated:
  by: process:docs-new
  at: '2026-10-09T13:35:55Z'
---

Three now preserves package-owned cluster-alignment provenance while mapping formatted spans through material and font
bindings. The retained planner reconciles one canonical immutable formatted input, adopts owned style snapshots, and no
longer makes a second source-span copy. Raw caller records still receive range validation, grapheme normalization, and
deep mutation-isolating style snapshots.

Planner staging replaces the coarse `styleDirty`/published-count state with retained style changes derived against the
last engine-adopted state. It scans the full compact non-empty span sequence, emits only semantically changed style
upserts and removed tail IDs through the existing ABI, retains changes across pre-adoption discard, and leaves renderer
rejection recovery on the existing checkpoint path. Focused wire tests cover one-row paint updates, normalized no-ops,
removal, and caller mutation isolation; a seeded Three assignment sequence compares sparse character edits, grapheme
length changes, range splits/merges, nesting, and broad paint changes with the cold full-publication oracle.

This advances the `@pmndrs/glyph` retained-frame ownership described in [the package concept](../packages/glyph.md) and
keeps the package-private provenance rule from the
[trusted cluster-aligned span handoff decision](../planning/decisions/trusted-cluster-aligned-span-handoffs.md). Public assignment APIs and the engine ABI are
unchanged. Full-batch change discovery remains O(span count); only retained allocation, style compilation, and wire rows
become sparse.
