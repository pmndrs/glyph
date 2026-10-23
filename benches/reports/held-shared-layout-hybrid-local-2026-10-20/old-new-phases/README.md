# One fixed old/main, published and HELD phase comparison

One frozen observer ran once in each exact archived package, in order main, published0.1.0, HELD E2. All three receipts exit zero. Each arm uses its own original shipping Wasm: no named override, package build or package-source change. The opt-in `--phase-observer old-new-1024` mode fixes bulk-write/publication/count1024/first/10warmups/80iterations/reads-none/scene. No favorable reruns.

| Shipping arm   | Whole p50/p95 ms | Setter p50/p95 ms | Publication p50/p95 ms | Residual p50/p95 ms |
| -------------- | ---------------: | ----------------: | ---------------------: | ------------------: |
| main           |    12.577/35.044 |       1.281/4.917 |          11.259/31.794 |       .00362/.01125 |
| published0.1.0 |    11.400/13.401 |       1.043/1.666 |          10.235/12.241 |       .00242/.00475 |
| HELD E2        |    13.189/15.121 |      9.391/10.617 |            3.732/4.693 |       .00271/.00513 |

These are sequential, instrumented profile distributions, not a controlled latency matrix or parity gate. Old setters defer semantic preparation into publication; HELD setters prepare immediately. Complete callbacks have comparable outcomes; phases perform different duties. Marginal phase medians do not sum to whole median. The residual is algebraic and includes observer/bookkeeping overhead, not an independent measurement. Main has a long tail. No formal software-calibration drift was measured; host load/thermal observations are limited facts. Existing unprofiled seven-family E2 comparisons remain the acceptance reference, and parity is still open.

[Capture facts](captures-summary.json.raw), the three per-arm raw summaries/manifests/exit receipts, and [root integrity](root-integrity.json.raw) preserve source and result boundaries. All arms report81,920setters/80publications/zero timedreads with10warmups excluded. All1,024final strings, committed states and available glyph queries pass outside timing; initial/final topology remains1draw/9,216glyphs. This is a coarse output oracle, not independent cold physical-buffer equality.

Eight workflow/harness/fixture/support/loaded-GLB hashes match before/after all captures. Three installed critical members (text.js, render-planner.js, shipping Wasm) match each archive before/after. [Initial High review](../phase-observer-high-review.md) required GLB identity; [correction review](../phase-observer-correction-review.md) closes it. The existing named-Wasm workflow remains available outside the fixed observer mode.

Fresh High selected disjoint setter/publication ancestry roots from each profile, independently reproduced by root. [Ancestry integrity](ancestry-integrity.json.raw) records exact frames, roots and raw profile hashes. Exclusive setter/publication/unattributed sampled microseconds are main120459/1102751/88331, published71499/818793/73374, HELD737794/295497/66709. These are sampled ancestry totals, not wall phase sums. Old/release Wasm has no authenticated names; no Rust function/allocator coefficient is inferred.

The [independent decision](../paired-phase-architecture-decision.md) closes borrowing the existing positioned columns as-is and deleting a nonexistent no-view measurement sidecar. Selection, binding, recordless correspondence and field production have distinct duties. No product patch or impossibility claim follows. E2 stays live; E3 stays preserved. Separate kernel replacements may still be evaluated from actual source and work evidence; the full parity goal is unchanged.

Raw CPU profiles remain local ignored files under `.cache/held-hybrid-20261020/evidence/phase-{main,published,held-e2}-01/cpu-profile.json`; their hashes are committed here. They are not on GitHub and cannot be reconstructed from this summary or assumed present elsewhere. Raw JSON copies use `.json.raw`; copy provenance distinguishes source hashes from formatted reviewer prose. Stack held/unmerged; boost waves zero.
