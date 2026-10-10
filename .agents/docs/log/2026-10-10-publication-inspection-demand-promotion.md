---
type: Log Entry
title: Promote recurring glyph demand through the existing inspection owner
sources:
  - resource: ../packages/glyph.md
    title: Retained inspection ownership
  - resource: ../planning/publication-frontier.md
    title: Publication frontier tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T13:52:01.501Z'
---

One inspection owner now holds either sparse borrowed demand or materialized columns and the existing lazy outline reader. Successful glyphAt/outlineAt decoding increments bounded demand; descriptor, invalid and expired reads contribute zero. Once demand reaches the prepared glyph count, the next callback materializes through the same producer used by explicit owned inspection, before caller entry and within the existing borrow guard. Copy failure preserves borrowed state; successful edits retire the entry and rejected edits preserve it. No second cache, shape path or publication executor is added. Pre-format production+41/-16,tests+54.

Independent source review found no actionable defect. Formatter/static39713 and build/focused135 Three72242 passed. The new public test proves exact record crossings, promotion timing, callback throw, expiration, mutation rejection, failed setter preservation, caller-copy independence and edit reset. Full975 Node85261 passed with zero skips. Frozen TGZ586bdac7868646c27a472089da56adaefc766f8da99a921e822b261f217b7770 under .cache/publication-inspection-promotion-candidate; glyphs4 Labs88086 completed against5cbe345f. Emitted planner+382raw/+114system-gzip and borrowed-view+51raw/+14gzip versus frozen retained-style TGZ5cbe345f; shaper9256fa95 is byte-identical. The exact packed Labs and seeded extension results follow. Performance claims are scoped to those workloads; release parity remains open.

Glyphs4 Labs88086 exited0:3faster/0slower/7neutral/0skip. Denseborrow1000 5.37→3.21ms (-2.16/-40.2%); denseborrow100 918.48→457.46µs (-50.2%); inspection+publication width14.12→12.28ms (-13.1%). Sparse edit/borrow211.98→210.98µs neutral. Bulk publication is not fixed by this read-path result. Report .cache/publication-inspection-promotion-glyphs/summary.md. Both artifacts measured without competing heavy work. Seeded12-step cold-oracle test extensionb72939d5 is integrated and focused136 Three39289 passed. It covers text/width/font-size/paint edits, rejected candidate, raw callback errors, expired borrows, owned copy independence and matching missing-outline errors; existing outlined-font tests retain successful-outline coverage. GPU4789 and81573 exited0: WebGPU/WebGL2 MTSDF dynamic-layout each387glyphs/1draw/1renderer, WebGPU Slug rich-text612glyphs/5draws/1renderer. Shaper9256fa95 authenticated; all three captures inspected without a new visible defect. Existing panel occlusion remains. This uses matching workspace JS and authenticated Wasm, not packed-JS network replacement or comparative FPS evidence.

Release glyphs4 Labs30458 exited0:2faster/2slower/4neutral/0skip across eight comparable workloads. Baseline is authenticated registry0.1.0; candidate586bdac7 timings reuse the saved glyphs4 run. CPU model, architecture, Node, suite, blocks and artifact digest match; separate-run machine variability remains. Denseborrow1000 is3.16→3.21ms (+0.05ms,neutral); denseborrow100476.54→457.46µs (neutral). Copy after text8.75→6.88ms and sparse edit/borrow314.29→210.98µs are faster. Unchanged copy100127.50→188.23µs (+60.73µs/+47.6%) and inspection+publication width11.20→12.28ms (+1.08ms/+9.6%) are slower. Report .cache/publication-inspection-promotion-release-glyphs/summary.md. Dense-read parity is recovered within this comparison, but release parity and #247 remain open.
