---
type: Log Entry
title: 'Fixed paragraph removal across the measurement boundary'
generated:
  by: process:docs-new
  at: '2026-10-05T19:22:21Z'
---

A text controller measured but never published can now be disposed before the next publication, and a committed
paragraph re-measures while a sibling's removal waits for the next frame. The planner only stages removals for published
paragraphs, and the engine treats a committed paragraph as present in a measurement whose lifecycle removes only its
siblings. See [the package reference](../packages/glyph.md).
