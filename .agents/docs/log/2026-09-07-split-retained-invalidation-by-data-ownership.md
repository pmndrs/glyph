---
type: Log Entry
title: 'Split retained invalidation by data ownership'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Plain string edits now reuse their configured and planner binding
leases, publish only changed text plus root-style coverage when length changes, and omit unchanged lifecycle/order and
geometry tables. Rust now limits implicit paragraph inference to an empty planner, so a content batch can update
several existing paragraphs without dummy lifecycle upserts. The 684-label request shrank from 209,448 to 23,400
bytes; three fresh exact-main medians of 24.24–25.87 ms compare with final post-review medians of 11.39–11.89 ms on
the candidate, with one draw and 5,362 glyphs throughout. Configured
roots now prewarm one 64-unit spare paragraph rather than 256, saving roughly 462 KiB/root in the isolated cold probe,
while active paragraph arenas continue growing from actual content without a root-wide publication scan. The scoped
maintainability review additionally corrected style-limit accounting to use style dirtiness, made Three's nested
authored properties owned snapshots, removed one dead reserve method, and made unchanged plain strings true no-ops.
