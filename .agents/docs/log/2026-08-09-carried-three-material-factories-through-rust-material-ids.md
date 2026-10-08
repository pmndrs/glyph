---
type: Log Entry
title: 'Carried Three material factories through Rust material IDs'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added the public factory definition and a runtime-
scoped identity registry while keeping Rust callback-free. The executor resolves each nonzero `materialId` only when
a compatible realization is absent and supplies the canonical technique shader, final indexed-transform position,
and a DRY default-material constructor. A compiled-Wasm fixture proves two material draws over shared storage, zero
new factory calls on reorder/coalescing, and one new selected-factory call when the retained glyphs switch to MSDF and
Slug. The public `Text` property route and fence-bounded retirement remain cutover work.
