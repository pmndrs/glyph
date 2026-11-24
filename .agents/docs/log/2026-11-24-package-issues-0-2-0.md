---
type: Log Entry
title: 'Record and fix the 0.2.0 package issues from the hero and docs-site lanes'
generated:
  by: process:docs-new
  at: '2026-11-24T16:36:00Z'
---

The package findings of the hero (`experiments/sil-hero`) and docs-site (`experiments/sil-docs-site`) lanes are now
local issue records in [issues-0.2.0](../planning/issues-0.2.0/index.md), each reproduced against the
`experiments/segment-indexed-layout` build with its root cause and chosen fix. Two defects found while reproducing
them got records of their own: `overflow: 'visible'` drops lines past the box while `'clip'` lays them all out (16),
and Three `TextGroup` options throw raw errors (17).

Fixed on `experiments/sil-issues`, one commit per issue, each with a test that failed first: CFF/CFF2 `--unicodes`
subsets keep their outlines through retained glyph IDs (03); `Pixi3DText` refuses input with `GlyphInputError` (04);
Three no longer types an `order` it never read (06); root and group material changes run `root.onInvalidate` (07);
`DropCapLayout` is a root export (08); a second Slug `coverageAt` no longer floods rename warnings (09);
`glyph bake --check` reports a missing output as `STALE_OUTPUT` and `--yes` is gone (10); R3F `Text`/`TextGroup` refs
are set in the mounting commit (11); the release notes are corrected and `overflow` is documented (12).

Held for a decision or another lane: keeping every OpenType feature in a subset (02) is implemented and tested but
grows the committed Inter ASCII asset 2,355,620 → 8,743,692 bytes, so it waits for Justin; pixel clipping (01) and the
overflow semantics (16) need engine-directory work; the React disposed-font race (05) is not reproduced
deterministically; per-glyph material identity, `split()` cost and `Font` from `FontFace` (13–15) are API proposals.
