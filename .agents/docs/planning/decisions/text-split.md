---
type: Decision
title: 'Rename detached text copies to split'
description: 'Rename the detached Three Text copy method to split without a compatibility alias.'
decision_status: Accepted
decided: '2026-10-08'
sources:
  - resource: https://github.com/pmndrs/glyph/pull/299
    title: Query prepared placements and split before publication
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T23:36:28Z'
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
before timing. Merged #299 supplies current desired reads and independent copies without source/root publication,
superseding the held #240 proposal. The root-wide publication performance frontier remains #247.
