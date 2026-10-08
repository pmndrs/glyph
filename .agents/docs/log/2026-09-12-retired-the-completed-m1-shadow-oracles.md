---
type: Log Entry
title: 'Retired the completed M1 shadow oracles'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The full 12.1–12.5 core, renderer, browser, size, and performance matrix
is accepted, so the standalone visual-span mapper and multi-fragment shadow planner no longer gate an unresolved
cutover. Their production counterparts and focused integration regressions remain. The associated shadow geometry
walker and proof-only visual-span ledger were removed with them; production retains the single compact
`segment_instance_counts` authority used by publication. This drops more than 3,000 lines without changing batching,
renderer output, or shipping positioning arithmetic.
