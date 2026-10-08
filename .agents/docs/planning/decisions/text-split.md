---
type: Decision
title: 'Rename detached text copies to split'
description: 'Rename the detached Three Text copy method to split without a compatibility alias.'
decision_status: Accepted
decided: '2026-10-08'
generated:
  by: process:docs-new
  at: '2026-10-08T13:20:17Z'
---

# Rename detached text copies to split

## Decision

`Text.split()` replaces `Text.breakApart()` and returns the same frozen `[Glyphs, Decorations | undefined]` tuple.
The rename preserves copy ownership, drawable-only dense indices, transform alignment and disposal.

## Why

[PR #239](https://github.com/pmndrs/glyph/pull/239) names the detached-copy operation consistently.
The [archived AST migration](../../../skills/codemod/codemods/2026-09-24-text-split/instructions.md) preserves consumer call semantics; repository and installed-consumer fixtures verify it.

## Consequences

This is a breaking name change for 0.2.0. No old-name alias is published. The comparison harness alone adapts old canaries
before timing. Read-publication behavior belongs to #240, and the root-wide publication performance frontier remains #247.
When those changes are combined, preserve their layout-publication order and apply this rename to their callers.
