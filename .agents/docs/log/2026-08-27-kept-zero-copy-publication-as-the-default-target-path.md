---
type: Log Entry
title: 'Kept zero-copy publication as the default target path'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`PlanTarget` consumes the borrowed A/B publication and
accepts synchronously after renderer submission and state commit. Only `AsyncPlanTarget` receives a package-created copy
and returns a Promise, for worker round trips or another genuinely deferred acceptance boundary. A worker transfers that
buffer back with its correlated commit result before the Promise resolves and the session advances its retirement fence.
No owned synchronous mode duplicates the plan merely because GPU execution completes later.
