---
type: Log Entry
title: "Republish a reflow without regathering unchanged glyph rows"
generated:
  by: process:docs-new
  at: '2026-11-22T08:25:45Z'
---

A width change on the 0.2.0 integration branch republished a long paragraph more slowly than `main` (stress 22k
sweep 3.96 against 3.49 ms per GPU-completed step in the
[headline comparison](../planning/benchmark-main-vs-0.2.0-2026-11-22.md)), and the sweep profile put a third of busy
time in gather and publication. Two pieces of that work produced nothing:

- The retained gather filled every lane of every glyph and compared all sixteen MSDF inputs, although a reflow moves a
  paragraph-run glyph between lines and placement segments without changing its style, binding selection or run-local
  geometry.
- Every glyph below the first new break takes a new record revision, so the ordered plan re-encoded the rect, effect
  and effect-colour buffers of the whole paragraph, compared about 600 kB with the accepted bytes, found them equal and
  suppressed the write.

Preparation now records per paragraph whether a stage that authors glyph rows ran since its last publication
(`ParagraphChange::glyph_rows`). While none did, the retained gather pairs rows by stable identity, reads only identity
and ink origin, and compares only the inputs a placement span decides; the gather reports which Codec inputs changed in
any record, and the ordered plan skips a buffer that reads none of them. The mechanism and its fallbacks are described
in the [Glyph package concept](../packages/glyph.md). A source row had to learn whether it was read from the
paragraph's runs: the layout oracle's CJK cases showed a boundary glyph carrying a run glyph's identity under another
shape, which an identity comparison alone accepted as unchanged.

Gathered lanes, record revisions and published bytes are unchanged: the native and Wasm layout oracles pass the full
tier against the frozen reference set without a re-freeze.

Measured with the headline harness, three interleaved rounds per arm, per-step median through a GPU-completed frame.
The before columns are the 2026-11-22 evidence run; the after columns were measured later on the same machine under
heavier background load, each against its own `main` arm, so the ratio is the comparable figure:

| workload | main, before | branch, before | ratio | main, after | branch, after | ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| sweep, Latin 15k | 2.95 | 3.25 | 1.10 | 3.05 | 2.78 | 0.91 |
| sweep, stress 22k | 3.49 | 3.96 | 1.14 | 3.58 | 3.21 | 0.90 |
| sweep, bidi Amiri 15k | 6.23 | 4.70 | 0.76 | 6.30 | 4.84 | 0.77 |

Publication alone went from 1.17 to 0.62 ms per step on Latin (`main` 0.95) and from 1.66 to 0.85 ms on 22k (`main`
1.34). The eight edit rows keep their ratios to `main` (0.45 to 0.67) within 0.02. The Latin row's per-load ranges
overlap `main`'s under the harness's verdict rule, so it reads "same"; a second three-round run gave the same 0.91.

Not changed, and why:

- `measure()` right after a width change is still about twice `main` (four times for bidi). Its time is the flow and
  positioning preparation the read forces, spread over some thirty functions with none above 8%; deferring positioning
  would move published lanes of measure-only steps.
- Typing at the end still uploads the whole instance buffer. A Content edit regathers its owner whole, every record
  takes a new revision, the plan forms one changed range over the paragraph and writes the range when any byte in it
  differs. Narrowing that changes the frozen `wire.publication` lane, so it waits for a decision to re-freeze.
