---
type: Log Entry
title: 'Added direct-bake glyph lookups'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`glyph bake --glyph-map <path>` emits a deterministic JSON name-to-code-point
lookup from the same font face and Unicode selection as the GLB. The lookup and font publish together with rollback,
`--check` verifies both outputs byte-for-byte, and ambiguous selected aliases fail before either output is written.
