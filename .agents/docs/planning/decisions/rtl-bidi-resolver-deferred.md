---
type: Decision
title: "Close the RTL bidi gap later, not with a second resolver now"
description: 'Right-to-left paragraphs keep using unicode-bidi for resolution in 0.2.0; a glyph-owned resolver for simple RTL paragraphs is not built until its cost and benefit are measured and approved.'
decision_status: Accepted
decided: '2026-11-22'
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-22T09:05:00Z'
---

# Close the RTL bidi gap later, not with a second resolver now

## Decision

- Bidi resolution of a paragraph that needs it (any right-to-left, number or neutral run that must be resolved)
  goes through `unicode-bidi`, as today. glyph does not ship a second, glyph-owned resolver in 0.2.0.
- glyph may skip resolution only where it can prove from class codes that none is needed. The landed fast out
  (16 units classified per step, one run when the paragraph is plain) is of that kind.
- A glyph-owned resolver for explicit-free right-to-left paragraphs (no embeddings, overrides or isolates) is a
  candidate for a later release. It is built only after a written estimate of its speed-up, size and proof
  cost is reviewed and approved by Justin.

## Why

- **The gap is small and rides.** On right-to-left text the branch measured 1–5% slower than `main`, within the
  aggregate rule that lets a row under about 4 ms ride until after ship (see the
  [build log](../segment-indexed-layout-build-log.md) and
  [benchmark record](../benchmark-main-vs-0.2.0-2026-11-22.md)).
- **The cheap wins are already taken.** The bidi class-lane experiment made the bidi stage 19× faster on ASCII,
  8× on Latin prose and 4–6× on CJK and Devanagari, by proving most paragraphs need no resolution. Arabic,
  Hebrew and mixed paragraphs need full resolution in every paragraph of the test corpora, so that fast out
  does not reach them ([experiments-unicode](../experiments-unicode-2026-11-22.md)).
- **What is left costs a shadow implementation.** `unicode-bidi` costs about 25 ns per unit on those paragraphs.
  The only route found to beat it is a second resolver for the explicit-free subset of UAX #9. That is new code
  on a correctness-critical path, and it would have to be proven identical to `unicode-bidi` on every paragraph
  it accepts.
- **Smallest surface and risk before ship.** 0.2.0 is already carrying a large architectural change. A second
  bidi implementation adds risk for a 1–5% row.

## Consequences

- Right-to-left layout in 0.2.0 stays 1–5% behind `main` on the affected rows; that is reported as riding, not
  as a blocker.
- To reopen this, the proposal must state: the expected speed-up on the Arabic, Hebrew and mixed rows, end to
  end; the wasm size cost; how the subset is detected; and the proof of equality: the UAX #9 conformance files
  (`BidiTest.txt`, `BidiCharacterTest.txt`) plus a differential fuzz against `unicode-bidi` over random and
  adversarial explicit-free paragraphs, with the oracle green and no reference re-frozen.
- Nothing is superseded. The typographic scope decision
  ([typographic-feature-scope-for-layout-refactor](typographic-feature-scope-for-layout-refactor.md)) is
  unchanged.
