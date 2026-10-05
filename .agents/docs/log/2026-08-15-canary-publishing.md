---
type: Log Entry
title: 'Canary publishing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Made `@pmndrs/glyph` publicly publishable and added a `main`-branch release workflow that
runs the complete package check, derives an immutable commit-and-date canary version, and publishes the `canary`
dist-tag through npm trusted publishing with GitHub OIDC and automatic provenance.
