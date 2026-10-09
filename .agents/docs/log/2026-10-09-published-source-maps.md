---
type: Log Entry
title: 'Publish resolvable source maps'
generated:
  by: process:docs-new
  at: '2026-10-09T07:38:42Z'
---

Updated [Glyph](../packages/glyph.md) packaging to ship hidden JavaScript maps and referenced declaration maps. Build staging paths are rebased to the packaged source tree before publishing the distribution, preserving the actual mappings. Packed-tarball tests verify every declaration map reference and map source, and every JavaScript module remains free of sourceMappingURL comments. The larger install archive does not add maps to runtime import graphs.
