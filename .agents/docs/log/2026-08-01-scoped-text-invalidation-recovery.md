---
type: Log Entry
title: 'Scoped Text invalidation recovery'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Bound terminal font-disposal state to the invalidated generation's input rather than a newer replacement already in flight, and clear that saved state on explicit disposal. A two-registry regression proves disposing a superseded font cannot permanently suppress recovery through the healthy replacement font.
