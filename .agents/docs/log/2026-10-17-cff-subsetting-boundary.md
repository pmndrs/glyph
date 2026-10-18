---
type: Log Entry
title: 'Make CFF Unicode preparation explicit'
generated:
  by: process:docs-new
  at: '2026-10-17T20:49:50Z'
---

Unicode preparation now detects CFF/CFF2 outlines before invoking Skera. Since Skera 0.5.1 drops those outlines,
an actual subset request fails with a format-specific error; callers may explicitly retain the original source
container and selected face. The preparation report identifies this fallback and its byte size, and the direct CLI
prints both the retained source and output sizes. The fallback preserves glyph IDs, layout tables, and collection face
selection rather than passing unchanged charstrings through a renumbering subset. See the
[package reference](../packages/glyph.md) and [decision](../planning/decisions/cff-whole-face-fallback.md).
