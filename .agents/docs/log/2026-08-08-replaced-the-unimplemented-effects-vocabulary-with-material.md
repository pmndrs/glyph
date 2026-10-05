---
type: Log Entry
title: 'Replaced the unimplemented effects vocabulary with material routing'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Superseded `renderVariant` and the declared-
only `TextEffect` proposal with one batch → text → span `material` property and numeric Rust/Wire `material_id` identity.
The Rust contract is fixed: policies control material draw compatibility, material changes never reshape or relayout,
and different materials may share canonical glyph buffers. The exact Three material-factory API remains deliberately
provisional for a later design pass; current first-party targets do not yet implement it.
