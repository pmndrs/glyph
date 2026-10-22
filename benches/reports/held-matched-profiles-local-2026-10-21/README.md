# Matched dense publication profiles

Twelve actual captures compare frozen main, published0.1.0 and six HELD variants on this machine. These are profiling diagnostics, **not performance acceptance**. The workload is identical in all captures: 1024 labels, bulk text writes followed by scene publication, no timed reads, 10 warmups and 80 iterations (81920 timed setters, 80 publications). The scene has 9216 final glyphs. The separate native replay has 10240 source rows; its counts must not be substituted for this profile fixture.

## Observations

Main defers semantic preparation until publication; HELD performs it synchronously in setters. Publication-only comparisons conceal that tradeoff. All columns below come from the first pass. Setter/publication values are exclusive sampled stack time **summed across 80 callbacks**, not per-call wall components. V8 sample intervals include scheduling effects; this is not a hardware utilization measurement.

| Frozen arm | callback p50 ms | callback p95 ms | setter sampled ms | publication sampled ms |
| ---------- | --------------: | --------------: | ----------------: | ---------------------: |
| published  |          13.229 |          15.536 |              95.8 |                  912.9 |
| main       |          14.797 |          17.172 |             110.9 |                 1019.4 |
| e2         |          15.344 |          17.612 |             823.0 |                  354.6 |
| e3         |          15.652 |          18.483 |             800.9 |                  409.1 |
| e4         |          16.815 |          23.243 |             953.6 |                  457.4 |
| e5         |          15.998 |          22.201 |             797.7 |                  477.7 |
| e6         |          14.737 |          16.791 |             764.5 |                  380.0 |
| v3         |          20.128 |         148.512 |            2023.2 |                 1024.1 |

E3 returns work to fresh gathering. E5 direct operands retain publication costs in `DirectRowContext::f32` (74.9 sampled ms), `u32` (32.5), candidate construction (34.3), and Codec execution (50.8). E6 lowers direct-row float access (47.9) while candidate construction (30.3) and Codec execution (40.4) remain. V3 deletes owner-range iteration, not source/record traversal or synchronous preparation. See the [source-grounded diagnosis](profile-differential-diagnosis-sol-high.md) for actual call ancestry, source locations, limits and deletion candidates.

## Counterbalanced repeat and exclusions

The original V3 has 39 sample intervals over5ms. One predetermined reverse-order repeat used the exact frozen packages and named binaries, without rebuilding or selectively retrying arms:

| Arm  | original p50/p95 ms | reverse repeat p50/p95 ms |
| ---- | ------------------: | ------------------------: |
| E6   |     14.737 / 16.791 |           15.840 / 25.116 |
| V3   |    20.128 / 148.512 |           15.885 / 45.377 |
| E4   |     16.815 / 23.243 |          15.446 / 150.919 |
| main |     14.797 / 17.172 |           12.746 / 15.095 |

The large tail moves to E4 (43 intervals over5ms). Process snapshots before the repeat arms record competing CPU work: Chromium140.8%, duetexpertd89.9%, siriactionsd83.7% plus fseventsd52.2%, and BackgroundShortcutRunner55.4%, respectively. The initial precheck was clear, but orchestration did not pause at later busy snapshots. This limits the repeat; it does not isolate a causal source of any individual pause. No process was stopped and no favorable rerun substituted. **Neither pass establishes a stable variant ranking, V3 regression, parity, or a speed win.** No further timing series was run.

## Evidence and next decision

[Provenance](provenance.json) hashes the exact copied raw profiles, manifests, phase anchors, summaries, original command receipts and process snapshots. Raw receipts retain their original local absolute paths; the relative paths in provenance locate portable copies. Package archives/named binaries remain local, identified by manifest hashes. Independent root audits recompute disjoint ancestry totals for all12captures and verify all7named binaries' noncustom Wasm sections byte-identical to their respective shipping archives. Published Wasm is stripped and receives no invented Rust names. Full installed dependency-member hashes are not retained by this profile workflow; this packet does not close final package-consumer authentication.

The source review identifies repeated single-owner preflight and frame encoding as a bounded next target inside the existing setter transaction. Erasing their entire named frames plus publication no-op commits would only total about1.22sampledms/callback in the original E4 capture; necessary portions remain, and this is neither a predicted saving nor proof it closes the published gap. Both main and HELD must shape1024final distinct labels. Source review finds no duplicate shaping/cluster/positioned pass: setters commit their prepared state, and publication does not prepare those owners again. Proven repeated work is per-setter validation/routing/admission plus publication calling eleven stage commit methods on already committed owners. Phase migration alone does not explain extra total work; individual cluster/positioning differences remain attribution questions. Preserve synchronous queries, one executor, packed/SoA/SIMD paths and exact rollback/cold-output oracles. No production source was changed by this profile study. V3 remains preserved at `experiments/held-dense-frontier-v3-native-gated-20261021`; the full seven-family parity and final browser/API/ABI/lifetime/memory gates remain open. Stack stays held/unmerged.
