---
type: Log Entry
title: 'Renamed borrowed glyph reads to readGlyphs'
generated:
  by: process:docs-new
  at: '2026-10-08T12:44:00Z'
---

PR #238 renames synchronous borrowed reads to `readGlyphs` across core, Three and TypeGPU, preserving the callback
contract and publishing no old-name alias. The [decision](../planning/decisions/read-glyphs.md) and [Glyph concept](../packages/glyph.md) describe the boundary.
Updated the archived recipe project for the split Labs suites and the outline tests added by #235, applied the AST
migration, and migrated the one untyped test helper explicitly. The shared Labs fixture adapts older installed canaries
once before timing. Three codemod fixture tests pass and a second migration preview reports no changes. Retired log pins
and generated size snapshots follow current main. Package build, source/public declaration types, lint and formatting,
76 focused integration tests and 277 package tests pass. Fresh CI compares the borrowed-inspection suite; no local speed
result is claimed for the rename. Pending read-publication work in #240 will receive the same migration when combined.
