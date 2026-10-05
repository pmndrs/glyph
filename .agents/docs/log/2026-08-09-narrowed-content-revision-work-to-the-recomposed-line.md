---
type: Log Entry
title: 'Narrowed content-revision work to the recomposed line'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The line-convergence proof now carries exact old/new
glyph spans into positioning. Retained prefix and suffix records preserve their revisions and publish zero semantic
change masks; only the changed span compares fields or looks up stable identities. A focused test proves revisions
`[10,20,30]` become `[10,40,30]` for a middle-span change. The 101-update optimized benchmark improves from 7.633
to 6.894 ms median (9.7%); p95 is effectively flat at 9.358→9.314 ms, so no tail improvement is claimed. Optimized
Wasm grows 1,693 raw bytes to 1,139,567.
