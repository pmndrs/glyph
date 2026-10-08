---
type: Log Entry
title: 'Fixed stale and throwing layout reads after presentation changes and root disposal'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:21Z'
---

A committed `Text` moved to
another group, or its root/group material, snapping, or draw order changed. Its reads answered from the
previous publication, so `breakApart()` copied the old material. Each entry now records the presentation, including
its root material fallback, and order rank it was published with; a read republishes when the presentation differs.
The check reads root material and walks the Text's ancestors without scanning other root members. Reads on a Text
whose root was disposed threw from the read-triggered commit;
they again answer `undefined`, and `breakApart()` throws its uncommitted error, as before the [commit-on-read decision](../planning/decisions/commit-on-read.md). Regression tests
cover both. See [the package reference](../packages/glyph.md).
