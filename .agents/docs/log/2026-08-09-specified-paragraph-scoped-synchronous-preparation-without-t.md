---
type: Log Entry
title: 'Specified paragraph-scoped synchronous preparation without triple buffering'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Current `measure()` either
returns committed cache or drives a complete session update and plan. The reviewed follow-up design retains one
speculative session transaction with paragraph-keyed pending states, linear identity reservation, explicit
prepare/adopt/leave-committed modes, inactive-slot copied query results, host lease retention, and new-paragraph
candidate ownership. Sequential paragraph queries extend the same transaction and the next frame adopts that exact
work before global plan compilation. Roadmap items 11.17 and 11.18 queue the query layer and promised realtime
publishing set as independent `feat/*` follow-up stacks after the Rust/Three cutover merges; neither is a hidden
prerequisite for consuming the cutover. Factoring preparation from plan commit is cohesive but not a safe flag-only
change.
