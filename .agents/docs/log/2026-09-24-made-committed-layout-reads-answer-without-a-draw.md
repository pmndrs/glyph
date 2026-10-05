---
type: Log Entry
title: 'Made committed-layout reads answer without a draw'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

A Three `Text` that is pending inside a Scene now commits
itself when `breakApart()`, `measureGlyphs()`, `caretAt()`, or `selectionRects()` needs its layout, through the same
engine-wide `glyph.shape()` batch a traversal runs, so a caller no longer polls `commitState()` from a frame
callback. The R3F `Text` and `TextGroup` refs follow React 19: a callback ref sees only the mounted host, and a
cleanup it returns runs on detach, so a callback ref can break a paragraph apart on attach. Read-triggered publication
failures throw at the read; explicit text or group changes permit recovery while unchanged failures do not retry.
Regression tests cover error propagation, reentry rejection, unchanged failure observation, and recovery. See
[the commit-on-read decision](../planning/decisions/commit-on-read.md) and [the package reference](../packages/glyph.md).
