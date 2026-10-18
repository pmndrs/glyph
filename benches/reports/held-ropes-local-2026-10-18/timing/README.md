# Physical byte elision: consolidated full Package Labs wave

This is a factual report for three installed-package comparisons. The full local evidence bundle preserves raw Labs samples, per-file and per-block frequency readings, summaries, comparison text, install manifests/lockfiles, exact package archives, and pack/member evidence. The `raw/` and `artifacts/` directories remain local-only and are not included in the curated repository report; `sha256-manifest.json` records checksums for this local bundle but does not embed those files. No algorithm or acceptance verdict is assigned here.

## Wave and method

- Candidate archive SHA-256: `880255c15c9822ded79cc934dba755070348faf729bc96af9cd6f450a57cb332`; candidate shaper Wasm SHA-256: `52e6c93589926675c52bccf0d880b2005f9544d9322f4273af364ca47a7c2adb`. The before-HELD 2a7 archive contains the distinct `text-shaper.wasm` SHA-256 `6f7afa1c596dc7c08d2138a67c4ae955d8aff5824602452cb6d12f30f2df3bbd`; it is saved separately as `artifacts/before-held-wasm-6f7afa1c.wasm`. Frozen source HEAD is `ad6327d9199cedf88217f1098db3aeb439ec3e66`; pinned current main is `4e25a96a57462fef5ad0d19065a822695b480f60`.
- A timed the candidate once against main. B and C reused A’s `candidate.json`; its SHA-256 is `e0ffee37d27787d31a7f811cbc888e2cb9a7abe2ba1a1dc4b6e0955f95bb2497` for all three copied result files. Each reuse is confirmed in its runner log and manifest.
- All lanes used the `full` suite, 8 blocks, Labs 0.9.0, Apple M4, arm64-darwin, Node 24.18.0. p50 is the median of block medians. p95 is the pooled retained sample at zero-based `floor(0.95*(N-1))`. Raw `gc` and `heap` diagnostics are carried per row; heap fields are diagnostics and do not represent live/peak process memory.
- Runner status: A exit 0 / 2,639.886 s; B exit 0 / 1,411.132 s; C exit 0 / 1,247.336 s. Exact argv, start/finish epoch values and log path are in each `raw/<lane>/operator-exit.json`.

## Raw console counts and final summary counts

Console counts are before the runner subtracts timing-mode mismatches. Final counts are taken from the generated summary after those exclusions. These are separate stages.

| Comparison   | Raw console faster / slower / neutral / clock skips | Timing-mode exclusions | Final faster / slower / neutral / skipped | Comparable | Candidate-only unmatched |
| ------------ | --------------------------------------------------: | ---------------------: | ----------------------------------------: | ---------: | -----------------------: |
| main         |                                    89 / 30 / 23 / 3 |                      4 |                          87 / 28 / 23 / 7 |        138 |                        0 |
| published010 |                                    96 / 26 / 21 / 0 |                      3 |                          95 / 24 / 21 / 3 |        140 |                        2 |
| beforeHeld2a |                                     3 / 7 / 133 / 2 |                      3 |                           2 / 5 / 133 / 5 |        140 |                        0 |

For every lane `baselineCheckFailures` is empty. Main: raw console 89/30/23 with 3 clock-confounded skips; after 4 timing-mode exclusions the final summary is 87/28/23 and 7 skipped (138 comparable). Published 0.1.0: raw console 96/26/21; after 3 mode exclusions the final summary is 95/24/21 and 3 skipped (140 comparable). The release archive lacks two candidate-only outline cases below; they do not contribute to the 143 raw-console matched rows or final 140 comparable rows. Before-HELD: raw console 3/7/133 with 2 clock-confounded skips; after 3 mode exclusions final is 2/5/133 and 5 skipped (140 comparable).

### Exact timing-mode exclusions

**main**

- `common.bench.ts / measure 100 unchanged labels / measure 100 unchanged labels: baseline single-call, candidate batched`
- `layout.bench.ts / cached per-glyph inspection / cached per-glyph inspection: baseline batched, candidate single-call`
- `prepared-operations.bench.ts / 1 labels first set / 1 labels first set: baseline batched, candidate single-call`
- `prepared-operations.bench.ts / 1000 labels first set+measure / 1000 labels first set+measure: baseline single-call, candidate batched`

**published010**

- `layout.bench.ts / cached per-glyph inspection / cached per-glyph inspection: baseline batched, candidate single-call`
- `prepared-operations.bench.ts / 1 labels first set / 1 labels first set: baseline batched, candidate single-call`
- `prepared-operations.bench.ts / 1000 labels first set+measure / 1000 labels first set+measure: baseline single-call, candidate batched`

**beforeHeld2a**

- `prepared-operations.bench.ts / 1 labels first set / 1 labels first set: baseline batched, candidate single-call`
- `prepared-operations.bench.ts / 100 labels first set / 100 labels first set: baseline single-call, candidate batched`
- `prepared-operations.bench.ts / 100 labels first set+measure / 100 labels first set+measure: baseline batched, candidate single-call`

### Unmatched case identities

Published 0.1.0 has no outline fixtures for these two candidate-only workloads; they are listed explicitly and were not compared:

- `main`: no unmatched baseline/candidate cases.
- `outlines.bench.ts / glyph outlines / copy per-glyph metrics with outlines after text change`
- `outlines.bench.ts / glyph outlines / read every outline from an unchanged copy`
- `beforeHeld2a`: no unmatched baseline/candidate cases.

## Clock evidence

A’s two timed result captures and B’s baseline have no summary-level clock warning. C’s before-HELD baseline report carries the warning “baseline CPU clock drifted 9.6% during its run.” The bundle retains raw per-file run/post frequencies and per-workload per-block frequencies/spreads for all four unique timed captures (one candidate capture reused three times). The derived first-file-run to last-file-post values are separately labeled in JSON and should not be substituted for Labs’ warning calculation. Row-level local clock data accompanies every workload; no global drift label is used to erase unrelated rows.

## Seven fixed-family coverage

The mapping below identifies candidate workload fixture coverage by exact benchmark labels; it does not claim isolated attribution. Each row has per-arm sample counts, p50/p95, block medians/frequencies/spreads, GC, heap, and final classification in `timing-evidence.json`.

| Fixed family                  | Candidate workload count | Representative exact fixtures                                                                                                                                                          |
| ----------------------------- | -----------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| long Unicode / shaping / flow |                       16 | `type one character into a long Fredoka paragraph and measure`; `type one character into a long paragraph and measure`; `type one character into a long paragraph and publish a frame` |
| dense 512 / 1024              |                        2 | `rewrite 512 labels in one group`; `publish 1024 retained Text instances`                                                                                                              |
| width / cold / inspection     |                       18 | `mount 100 labels and borrow glyphs from each once`; `mount a label and publish its first edit`; `mount and publish a 22k-glyph paragraph`                                             |
| small unchanged ingress       |                        5 | `measure 100 unchanged labels`; `1 labels first same-value-set`; `100 labels first same-value-set`                                                                                     |
| sparse root publication       |                       22 | `100 labels 100 edits immediate measurements with publication`; `100 labels batched edit-read publication`; `100 labels interleaved edit-read publication`                             |
| selected copy inspection      |                        8 | `borrow per-glyph metrics from 100 promoted labels`; `copy per-glyph metrics after text change`; `copy per-glyph metrics from 100 unchanged labels`                                    |
| tails / memory delivery       |                        5 | `mutate one trailing span across 1000 formatted labels`; `write 22k UTF16 text into Wasm request arena`; `write 22k UTF16 text into owned array control`                               |

## Before-HELD slower rows

The five final slower rows remain in the raw evidence with their full 8-block medians, per-block clock frequencies/spreads, pooled samples and p95. These are workload observations from the unchanged frozen candidate result compared with the before-HELD package.

| Workload                                                                                    | p50 baseline → candidate (ms) | p95 baseline → candidate (ms) | N baseline / candidate |     p50 Δ | Console p / CI           | Block frequency min–max GHz (baseline → candidate) |
| ------------------------------------------------------------------------------------------- | ----------------------------: | ----------------------------: | ---------------------: | --------: | ------------------------ | -------------------------------------------------- |
| common.bench.ts / common text operations / measure 100 unchanged labels                     |     0.006541659 → 0.007758196 |     0.012764205 → 0.015973214 |              544 / 608 | +1.217 µs | p=.005; CI +3.1..+30.5%  | 3.516–3.695 → 3.347–3.679                          |
| layout.bench.ts / public paragraph layout at 22k glyphs / cached measurement                |     0.000028744 → 0.000031378 |     0.000074623 → 0.000076942 |              576 / 672 | +0.003 µs | p=<.001; CI +7.6..+11.0% | 3.368–3.673 → 3.504–3.660                          |
| prepared-operations.bench.ts / prepared label operations / 1000 labels first same-value-set |     0.000073230 → 0.000080385 |     0.000134344 → 0.000142528 |              296 / 304 | +0.007 µs | p=<.001; CI +9.1..+11.1% | 3.469–3.634 → 3.446–3.672                          |
| prepared-operations.bench.ts / prepared label operations / 1000 labels first set            |     0.020763221 → 0.022304175 |     0.033038462 → 0.038567725 |              288 / 288 | +1.541 µs | p=<.001; CI +4.3..+8.8%  | 3.440–3.690 → 3.496–3.637                          |
| prepared-operations.bench.ts / prepared label operations / 1000 labels first set+measure    |     0.028565531 → 0.031417969 |     0.078971354 → 0.050391906 |              256 / 288 | +2.852 µs | p=.038; CI +1.2..+16.0%  | 3.384–3.670 → 3.481–3.706                          |

## Dense 512/1024 and width inspection control rows

These are exact HELD-control p50/p95 observations, not final verdicts. p95 is empirical and not a separate significance test.

| Workload                                                                                          | Classification | p50 baseline → candidate (ms) | p95 baseline → candidate (ms) | N baseline / candidate |
| ------------------------------------------------------------------------------------------------- | -------------- | ----------------------------: | ----------------------------: | ---------------------: |
| batching.bench.ts / batched text operations / rewrite 512 labels in one group                     | neutral        |   10.924437500 → 10.881166500 |   12.283083000 → 12.526625000 |              168 / 160 |
| layout.bench.ts / public paragraph layout at 22k glyphs / per-glyph inspection after width change | neutral        |     5.003895500 → 5.012000000 |     7.192958000 → 6.348542000 |              208 / 288 |
| stress.bench.ts / 1,000-label stress / publish 1024 retained Text instances                       | neutral        |   21.587104000 → 21.585499500 |   24.107500000 → 24.656375000 |              128 / 128 |

## Bundle contents

- `timing-evidence.json`: all per-row results, block data, captures, exclusions, unmatched names, and saved-candidate proof.
- `raw/`: full raw result JSON, comparison text, summary, manifests, per-install locks/packages, and exact command logs/exit objects.
- `artifacts/`: candidate and baseline `.tgz` files, Wasm artifacts, and complete candidate package/member evidence.
- `sha256-manifest.json`: SHA-256 checksums and byte lengths for every other file.
- `derive.py`, `augment.py`: local derivation helpers. They refer to this machine’s evidence paths; the raw inputs are not part of the curated repository report.
