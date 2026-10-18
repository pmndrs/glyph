---
type: Log Entry
title: 'Authenticate an RTL corrected line edge'
generated:
  by: process:docs-new
  at: '2026-10-18T01:22:02Z'
---

The initial issue [#245](https://github.com/pmndrs/glyph/issues/245) Amiri line comparison covered RTL layout, but its chosen lines did not cross an unsafe shaping boundary. A CrossSpace run with an authored RTL span now supplies that missing [Glyph package](../packages/glyph.md) oracle: paragraph shaping selects contextual `e.fina` (glyph 1465) at the line start, while the wrapped line selects base `e` (glyph 32). The test requires the changed glyph to have an odd bidi level, then compares the full visible line's glyph identities, advances, visual positions, and width against the same RTL text shaped alone.

The existing installed-package `unsafe-line-breaks` Labs suite now contains paired LTR and RTL width and text edits over the CrossSpace fixture. These cases are part of the named `benchmark:labs-package -- --suite full` workflow. No performance timings were taken while coordinating the final candidate run; the default PR smoke suite does not include these rows.
