---
type: Log Entry
title: 'Added narrow paragraph editing without exposing engine complexity'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Three `Text` now provides `insertText`,
`deleteText`, and `replaceText` over DOM-compatible UTF-16 offsets; direct `text` assignment derives the smallest
scalar-aligned replacement. Multiple edits queue into the same next-frame Rust transaction, surrogate-pair splits fail
synchronously, and rich-text spans shift with explicit boundary semantics. A wire-level integration regression inspects
the serialized request rather than inferring narrowness from final pixels.
