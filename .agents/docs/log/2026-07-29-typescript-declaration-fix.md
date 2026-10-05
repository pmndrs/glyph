---
type: Log Entry
title: 'TypeScript declaration fix'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Carried DefinitelyTyped PR 75246 as a pnpm patch over `@types/three` 0.185.1, replacing the nested `Node<TNodeType>` conditional tree identified by TypeScript Go issue 4528 with a behaviorally equivalent `NodeExtras` lookup. The permanent regression now compiles the formerly explosive method chain, uint shifts and bitwise operations, integer division/modulo, vector `fwidth`, and object-form `Loop` in 215 milliseconds at 4 MiB peak RSS. Package and application projects complete normally, so the native compiler process guard, its AGENTS requirement, and its skill/package/build integrations were removed.
