---
type: Log Entry
title: "Removed the project baker's consumer TypeScript requirement"
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Replaced the exact-version compiler adapter with Oxc parsing, lexical scopes, and module resolution while preserving automatic JS/JSX/TS/TSX discovery. Existing test files cover bindings, imports, re-exports, literal evaluation, and isolated CLI baking with neither TypeScript nor Babel installed. The existing package test command owns verification; no new workflow scripts are needed. TypeScript remains development-only; public baking signatures are unchanged. See [the package contract](../packages/glyph.md), [tooling fixtures](../planning/tooling-fixtures.md), and D-368 in [the decision register](../planning/decision-register.md).
