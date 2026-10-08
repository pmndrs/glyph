---
type: Log Entry
title: 'Reviewed the detached copy rename'
generated:
  by: process:docs-new
  at: '2026-10-08T13:20:18Z'
---

Updated PR #239 onto merged #235/#255 and re-applied the archived AST rename to their detached-copy implementation.
Preserved drawable-only dense indices and the private source mapping. Corrected split diagnostics and the current
concept's old-name reference, and added a shared comparison adapter for older installed canaries outside timing.
Three codemod fixtures pass and a second preview is idempotent. Build, public declaration types, 76 focused integration tests, 277 package tests, lint/format and docs conformance pass;
fresh CI is the remaining gate. No speed result is claimed for this rename. The [decision](../planning/decisions/text-split.md) records the boundary.
