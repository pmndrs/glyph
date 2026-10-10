---
type: Log Entry
title: 'Sparse placement binding checkpoint'
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T08:04:12.820Z'
---

The existing placement binding executor now preserves authenticated retained handles and journals only changed rows.
Dense rollback snapshots, full glyph comparison/restore walks and the duplicate mutation loop are removed. Production
prefix net -11 lines; targeted counters prove unchanged glyph spans are skipped. Static, 383 native and 971 package
tests pass, including cold output, generation reuse and overflow rollback/retry. Frozen shaper 74b263af is 1,554,228 raw /
572,439 gzip, 217 gzip bytes smaller than ce7f8bfe; shipped JS and four other Wasm modules are unchanged. Assignment
Labs is running against that immediate artifact baseline; no speedup or release-parity claim. Full hashes and open gates
live in [the design](../planning/retained-text-assignment.md) and [the compact tracker](../planning/publication-frontier.md).

Exact-artifact assignment Labs completes with six neutral/no skips; edit-sized Labs completes with 47 neutral/no skips and limited resolution. No demonstrated publication speedup. Three hash-authenticated GPU probes pass and their captures are inspected; no new placement, text or decoration defect observed, with existing UI overlay occlusion. These are rendering checks, not comparative frame-time evidence. The separate rope gather source wave is frozen for independent review and remains unverified.
