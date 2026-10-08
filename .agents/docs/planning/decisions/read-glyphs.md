---
type: Decision
title: 'Name the synchronous borrowed glyph read readGlyphs'
description: 'Use readGlyphs for synchronous borrowed glyph reads, without a compatibility alias in the package.'
decision_status: Accepted
decided: '2026-10-08'
generated:
  by: process:docs-new
  at: '2026-10-08T12:44:00Z'
---

# Name the synchronous borrowed glyph read readGlyphs

## Decision

`Text.readGlyphs(callback)` replaces `withGlyphs(callback)` across the shared controller, Three and TypeGPU entries.
The callback contract, return inference, exceptions, indexed access and expiring view lifetime remain unchanged.

## Why

The name states that the call reads indexed glyph data synchronously. The [archived codemod](../../../skills/codemod/codemods/2026-09-24-read-glyphs/instructions.md) preserves typed method references and optional calls while leaving unrelated methods and persisted strings alone.

## Consequences

This is a breaking API rename for 0.2.0, recorded by PR #238. No old-name alias ships. Installed-package benchmarks
install their compatibility alias once before timing to compare older canaries. Consumer recipe tests cover old and new
installed declarations; current package tests retain the borrowed-view behavior checks.
