---
type: Log Entry
title: 'Added tagged stable publishing alongside canaries'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Extended the existing npm publishing workflow so matching
`vMAJOR.MINOR.PATCH` tags publish to `latest`, while main-branch pushes continue publishing canaries. Both paths run
the package check before publication. Version bumps and release preparation remain separate changes.
See [the package reference](../packages/glyph.md).
