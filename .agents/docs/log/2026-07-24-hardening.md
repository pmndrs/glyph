---
type: Log Entry
title: 'Hardening'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Isolated every TypeScript 7 unstable import and project/symbol-handle operation behind an exact-version compiler adapter; added a source-boundary sentinel and a plain-JavaScript discovery fixture so typed and untyped module support is executable rather than assumed.
