---
type: Log Entry
title: 'Fixed stacked-PR size reporting at the action boundary'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The pinned Size Limit action executes its configured
command directly rather than through a shell, so the compatibility pipe had been passed to the measurement script as
inert arguments and the action received the full report object. The workflow now supplies the same base-compatible
adapter through an explicit `sh -c` boundary. Executing the exact parsed workflow command locally emits 39 validated
`{name, size}` rows.
