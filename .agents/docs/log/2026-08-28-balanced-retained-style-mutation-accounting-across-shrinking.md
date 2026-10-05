---
type: Log Entry
title: 'Balanced retained style-mutation accounting across shrinking commits'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The pending-style ledger now subtracts a
dirty text's old published span count before publishing its replacement count. A regression repeatedly expands one
text to four styles and shrinks it to one, then proves a valid second two-style text still fits the unchanged
`maxClusters` budget instead of being rejected by leaked historical deltas.
