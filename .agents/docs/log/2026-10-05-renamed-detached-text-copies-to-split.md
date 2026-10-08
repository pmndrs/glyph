---
type: Log Entry
title: 'Renamed detached text copies to split()'
generated:
  by: process:docs-new
  at: '2026-10-05T20:01:20Z'
---

Replaced Three's `Text.breakApart()` with `Text.split()` while preserving
the frozen glyph/decorations tuple, committed-state requirement, source independence, and caller-owned disposal.
Updated typed and browser callers, diagnostics, and current API documentation. The
[archived migration](../../skills/codemod/codemods/2026-09-24-text-split/instructions.md) includes tested transforms for
repository source and consumers of old or new declarations.
