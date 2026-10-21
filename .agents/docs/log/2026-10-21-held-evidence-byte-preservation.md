---
type: Log Entry
title: 'Preserve authenticated performance report bytes through formatting'
generated:
  by: process:docs-new
  at: '2026-10-21T03:36:18Z'
---

Restored nine Markdown files in the [gather input-plan evidence packet](../../../benches/reports/held-gather-input-plan-local-2026-10-20/README.md)
from their exact authenticated local originals after the normal commit formatter had changed their bytes. All 47
packet copies were audited; the other 38 already matched. Source hashes, measurements and observations are unchanged.
The root formatter now excludes this authenticated packet as well as the direct-operand packet. This follows the
[engineering standard](../engineering/code-style.md) exemption for authenticated evidence rather than bypassing hooks.

The correction follows completion of E6 package/artifact gates and precedes any E6 timing. Its changed report and
formatter-policy hashes require a new timing-input freeze; they do not change runtime source, Wasm or packaged bytes.
The [publication frontier](../planning/publication-frontier.md) retains the full parity goal and held stack.
