---
type: Decision
title: 'A summary-only read answers from flow and leaves positioning owed'
description: 'A read that asks for no glyph facts commits flow layout and defers positioning, against a kept predecessor, to the publication or the next read of positions; its summary computes glyph counts, line glyph spans and ink on first read.'
decision_status: Accepted
decided: '2026-11-22'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-23T00:07:42Z'
---

# A summary-only read answers from flow and leaves positioning owed

## Decision

The owner chose designs B, C (folded into B) and D of
[measure() right after a width change](../measure-after-width-change-2026-11-22.md) on 2026-11-22, with option 1a.

- **Durable, not speculative.** A read still commits every stage it runs. Design A (a speculative read) is not built.
- **Positioning may be owed.** A preparation from a read or the frame's batch whose request asks for no
  `glyphFacts` and no layout inspection stops after flow layout. Its commit swaps each stage in as before but keeps
  the value it replaced (clusters, shaping runs, geometry, flow and boundary shape) in the stage's pending slot
  instead of clearing it.
- **Owed positioning runs once, with the eager inputs.** Publication, a glyph, ink, copy or editing read, a read that
  asks for glyph facts, and the next preparation of the same paragraph each settle it first: the kept pairs are
  restored to their pre-commit shape and the one positioning implementation runs. Retention, placement segments and
  canonical revisions are those an eager positioning produces. A paragraph holds at most one extra generation, and
  only while positioning is owed.
- **A measurement carries glyph facts exactly when its request asks for them.** Without `glyphFacts` the engine writes
  the summary from flow (line advances from the flow, which equal positioning's) and sets `GLYPHS_DEFERRED`; glyph
  count, missing-glyph count, line glyph spans and ink are absent. Equal requests over equal text return equal
  records, whatever the paragraph's history.
- **Lazy facts answer for the measured preparation (1a).** The TypeScript summary computes those fields on first read
  by a glyph-facts read. Before the engine prepares or removes that paragraph again, the owner resolves any
  outstanding deferred facts, so the engine keeps no generation for them and nothing blocks later preparation.

## Why

The 0.2.0 read ran positioning and built placement segments that only publication needs, making `measure()` after a
width change about twice `main` (0.50 against 0.24 ms, Latin 15k). Placement segments are part of how positioning
stores positions (segment-relative origins, translations from the pen), so they cannot be deferred alone (design C).
Keeping the predecessor is what lets deferred positioning retain lines and mint revisions as the eager one does.

## Consequences

Supersedes the sentence of [deferred, never-stale preparation](deferred-never-stale-preparation.md) that preparation
always includes positioning. The public API shape is unchanged; only when the glyph-fact fields are computed changes.
An engine failure that discards a root before deferred facts are read leaves them unanswerable: reading them throws.
The oracle's read-back after publication asks for glyph facts; its preparation reads do not.
