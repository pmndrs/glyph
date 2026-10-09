---
type: Log Entry
title: 'Documented the 0.2.0 Glyph migration'
generated:
  by: process:docs-new
  at: '2026-10-09T15:47:58Z'
---

Added the package-owned [0.2 migration guide](../../../packages/glyph/MIGRATION-0.2.md) and linked it from the README,
changelog, and [Glyph package reference](../packages/glyph.md). The guide records the merged `withGlyphs` to
`readGlyphs` and `breakApart` to `split` migrations, drawable-only detached indices, removed `sourceIndex`, shape
identity, range errors, optional static-font outlines, TextGroup batching, manual visibility, and explicit retry rules.
It names outline-format metadata, variable-font outlines, and automatic off-screen culling as unshipped rather than
release features. The package reference now cites the release artifacts and no longer implies that a dense detached
index can address full-layout columns. The package manifest includes the guide in the published file set.

The command names and write behavior come from `pnpm scripts list` and `scripts show`; the migration transforms were not
executed. Claims were checked against the public TypeScript sources, integration/type tests, archived recipes, the three
merged breaking commits since `v0.1.0`, and the baker's variable-font rejection test.

CI caught the strict packed-file inventory missing the newly included migration guide. Updated that explicit expected
list and reran `glyph:node-tests -- tests/package/packed-package.test.mjs`: 1 passed, 0 failed, 0 skipped. This focused
packaging check used the previously built sparse-slice distribution; no runtime source changed in this documentation
PR. OKF validation passed with zero errors/warnings; the remote full CI rerun remains required.
