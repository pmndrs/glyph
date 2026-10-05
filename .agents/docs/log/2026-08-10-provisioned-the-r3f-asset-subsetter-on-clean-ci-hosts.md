---
type: Log Entry
title: 'Provisioned the R3F asset subsetter on clean CI hosts'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

The example's byte-exact asset check requires HarfBuzz
14.2.0, but CI had provisioned only the separate 13.0.0 shaping oracle and CJK fixture tool. The authenticated utility
provisioner now accepts either recorded release, verifies the 14.2.0 source archive as
`94017020…eaff`, and keeps each build in its versioned ignored cache. CI publishes only the 14.2.0 utility directory to
later steps. A fresh source build self-identifies as 14.2.0, and the complete R3F type/lint/format, byte-exact asset,
production build, and live GPU interaction gate passes without changing either checked font artifact.
