---
type: Log Entry
title: 'Finished the placement-slot vocabulary fold'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Classified the retained allocator against D-358 and removed its
two remaining one-field generic wrappers. The planner now passes its already domain-specific `PlacementLogicalKey`
values directly, and slot state retains `Option<Key>` rather than wrapping the same key again. Allocation,
acknowledgement quarantine, generation, reorder, commit, and abort behavior are unchanged; all eight allocator
lifecycle tests and the complete 321-test Rust unit lane remain green.
