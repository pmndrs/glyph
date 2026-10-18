---
type: Log Entry
title: 'Restore Tres Slug draw batching'
generated:
  by: process:docs-new
  at: '2026-10-18T01:39:27Z'
---

The [Tres playground](../packages/tres-playground.md) now sets its label `TextGroup` to `shared` batching.
The default `auto` boundary had kept those labels in a separate draw from the Slug greeting after authored
[TextGroup batch boundaries](../planning/decisions/authored-text-group-batch-boundaries.md) were added, while the
playground's browser probe still expected them to coalesce. The live probe now observes 25 records in three draws
for MSDF and Bitmap and 25 records in two draws for Slug.
