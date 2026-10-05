---
type: Log Entry
title: 'Named the integration building blocks `/core`'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Renamed the unmerged `/extend` entry without changing its exports or implementation. Updated consumers, package/type resolution, current documentation, and ownership guidance. Eight direct consumer bundles retain identical implementation modules and emitted assets; seven focused package tests, strict declarations, both example-package checks, and lint pass. The isolated packed consumer now imports both the root and `/core` without optional renderer peers. The former engine-driving API remains private. See [the package contract](../packages/glyph.md).
