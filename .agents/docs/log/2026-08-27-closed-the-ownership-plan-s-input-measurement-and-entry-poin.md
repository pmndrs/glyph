---
type: Log Entry
title: "Closed the ownership plan's input, measurement, and entry-point gaps"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Opus High verified the font/runtime ownership
thesis but found the draft had hidden the renderer-neutral text mutation path, omitted target-less Paragraph measurement,
`defineFont` bake discovery, app migrations, and target-construction cleanup, and left borrowed expiry and worker payload
ownership unenforced. The corrected plan gives render sessions retained text handles, adds async root
`createParagraph()` over a private measurement service, preserves existing `FontInput`/`FontToken`/`defineFont`, reuses
the bounded transfer pool, and prevents canonical Font backing from entering a transfer list. The root remains the
canonical barrel for portable application/provider names; runtime-driving names live only in `/core`, and integrations
re-export only signature-required root types. Follow-up review aligned the pool with full-span ownership by requiring
exact-length reuse, changed policy installation to consume a complete descriptor with session-owned capability/limit
selection, restored explicit baked-byte loading, and made package-size scenarios stable across entry-point moves. The
final bounded pass preserved renderer transform ownership through opaque bindings, restored the combined semantic-view
request, tied async transfer capacity to session output limits, and added bounded LRU/counter benchmarks for exact-size
pooling. Opus High's final diff-only verification at `c94f3093` found no actionable blocker and judged the contract
implementable.
