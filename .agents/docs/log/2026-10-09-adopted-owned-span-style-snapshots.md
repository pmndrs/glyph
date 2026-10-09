---
type: Log Entry
title: 'Adopted owned span style snapshots at the retained planner seam'
generated:
  by: process:docs-new
  at: '2026-10-09T06:47:35Z'
---

The retained planner now adopts span-style snapshots carrying Glyph's package-private immutable provenance instead of
cloning them a second time. Styles without that provenance—including shallow-frozen caller objects—still cross the
owning clone-and-deep-freeze boundary, preserving mutation isolation and the [Glyph package contract](../packages/glyph.md).

The focused public Three mutation path reduced `structuredClone` calls for a two-span color edit from three to one: the
one changed caller style is snapshotted at the Three boundary, while both planner inputs reuse proven snapshots. Twelve
focused property/span tests and 40 adjacent React, Vue, TypeGPU, rejection, retry, and mutation tests passed. This does
not retain span arrays or remove their planner validation/mapping; that broader model remains outside this change.
