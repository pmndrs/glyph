---
type: Log Entry
title: 'Identity-preserving capacity changes'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed core paragraph-batch cloning and Three `TextGroup` capacity cloning. `ParagraphBatch.setCapacity()`, `TextGroup.setCapacity()`, and standalone `Text.setCapacity()` now preserve every public and core handle while staging canonical and target storage replacement through the next synchronization. The setter records capacity intent; allocation occurs at synchronization. Fixed capacity means no automatic growth, not permanent immutability. The previous complete revision remains live through failure and target retirement; `TextGroup.clone()` and `copy()` are explicitly unsupported because recursive copying cannot safely preserve application refs, listener state, batch membership, or renderer ownership.
