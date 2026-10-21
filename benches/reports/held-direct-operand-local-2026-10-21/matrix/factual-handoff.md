# E5 matrix and current-profile factual handoff

All authorized full-matrix arms, the single current-candidate profile, and its maintained ancestry summary completed with exit 0. Final identity recheck confirms the frozen worktree HEAD and all 673 inventoried inputs, four archives, candidate reuse, and profile ancestry anchors.

## Frozen identities

- Worktree: `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo`; HEAD `277417596afbe2a8cd87454317d05607dc9ba51b`; branch `feat/rust-text-input-wire`.
- The 673-key input inventory matches exactly (canonical inventory SHA-256 `1d145a594c6499d5b3ea247e96a819751a97ecd39e4f6ae95c52ac5a571a90af`); zero mismatches at final check. Full expected per-file hashes are retained in [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/root-matrix-release.json](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/root-matrix-release.json).
- Candidate archive SHA-256: `83949860ae65b99fe6d7471b9782398234852668b54412870fafa81878c366a3`. Named Wasm SHA-256: `fb54c6442677f8cf6a8adbc220b86ed2031a68322669f79413a9ca1e6a2ea449`; executable/release Wasm SHA-256 `8b594e2b123c35c0789a1e38ee15761e9a6a2245fdce6da1181efacbc0ab366a`.

## Full matrix arms

Each command used the maintained Labs workflow, full suite, eight blocks, and the same candidate archive. Main measured the candidate once. Published and prior E2 reused that exact saved candidate JSON (`700944329123880bcb040be199f39bd938af964247a34581c5e13811981b04bd`).

| Arm       | Exit | Baseline SHA-256                                                   | Manifest SHA-256                                                   | Timing-mode exclusions | Calibration warning                                 |
| --------- | ---: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ---------------------: | --------------------------------------------------- |
| main      |    0 | `bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20` | `d5fd7f2e18af1653301bcd0724456a64a46ccb86c7dd368df8f451a6b348f23a` |                      3 | > ⚠ baseline CPU clock drifted 10.5% during its run |
| published |    0 | `6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b` | `fecf23566641971a7859e3f7419f87fb0edfa45137542fa2e3267ccbd6447fa5` |                      5 | > ⚠ baseline CPU clock drifted 5.3% during its run  |
| prior-e2  |    0 | `28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb` | `cb042fb47fb0aa3082a4cd0705db440d23204b23820945c4d7948d12c71c1e7d` |                      0 | none                                                |

Original Labs comparison reports retain the published block-statistics, p-values, confidence intervals, raw exclusions, and warnings. The published arm has 143 baseline identities against 145 candidate identities (two candidate-only identities); main and E2 each have 145 matched identities. Exact identities and exclusion flags are in the all-workload export below.

Absolute p50/p95 values are descriptive nearest-rank quantiles over stored per-call nanosecond samples, converted to milliseconds. Labs median-of-block-medians is separate; no cross-arm candidate average or acceptance floor is used. The report warns of 10.5% main baseline and 5.3% published baseline software-calibration drift; these are calibration estimates, not hardware-frequency measurements. E2 has no warning line.

| Dense workload                                  | Arm baseline pooled-sample p50 / p95 ms | Current candidate pooled-sample p50 / p95 ms | Original Labs report row (block-statistic estimator)                                                |
| ----------------------------------------------- | --------------------------------------: | -------------------------------------------: | --------------------------------------------------------------------------------------------------- |
| main: rewrite 512 labels in one group           |                     7.097750 / 7.876458 |                        10.019166 / 11.178209 | `▼ rewrite 512 labels in one group          7.07ms    10.00ms  +41.6%  +39.4% <.001  +39.3..+43.0%` |
| main: publish 1024 retained Text instances      |                   15.397250 / 16.380625 |                        20.358833 / 22.668167 | `▼ publish 1024 retained Text instances    15.31ms    20.23ms  +32.1%  +37.0% <.001  +29.8..+33.9%` |
| published: rewrite 512 labels in one group      |                     7.487042 / 8.096000 |                        10.019166 / 11.178209 | `▼ rewrite 512 labels in one group          7.46ms    10.00ms  +34.0%  +36.4% <.001  +32.3..+35.4%` |
| published: publish 1024 retained Text instances |                   15.327208 / 17.231833 |                        20.358833 / 22.668167 | `▼ publish 1024 retained Text instances    15.23ms    20.23ms  +32.9%  +13.4% <.001  +30.4..+33.9%` |
| prior-e2: rewrite 512 labels in one group       |                    9.384666 / 10.537833 |                        10.019166 / 11.178209 | `▼ rewrite 512 labels in one group          9.46ms    10.00ms   +5.8%   +5.4% <.001    +4.9..+7.5%` |
| prior-e2: publish 1024 retained Text instances  |                   18.514042 / 21.048084 |                        20.358833 / 22.668167 | `▼ publish 1024 retained Text instances    18.37ms    20.23ms  +10.1%   +7.8% <.001   +8.5..+11.3%` |

## All-workload files and original reports

- All 145 candidate identities in Markdown: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-all-workloads.md](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-all-workloads.md) — SHA-256 `b28a3d78aac365834083767f3124d21ff0cae92f08eb079dca8e289a94c0dfd2`.
- All 145 candidate identities in CSV: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-all-workloads.csv](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-all-workloads.csv) — SHA-256 `fbd4309feaf96059f113fc57094bf71219b8ab883e322838a1d499acfb1e8818`.
- Full per-arm stored-sample quantiles and identity lists: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-three-arm-absolute-quantiles.json](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-three-arm-absolute-quantiles.json) — SHA-256 `6f536c5ebe9accadb2392c3857b346fe12987af9f1365e3cf98ebc8c7ffa47ce`.
- Reproducible extractor: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/extract-e5-matrix-absolute-quantiles.py](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/extract-e5-matrix-absolute-quantiles.py). Renderer: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/render-e5-matrix-all-workloads.py](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/render-e5-matrix-all-workloads.py).

- main `comparison.txt`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-main-data/comparison.txt](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-main-data/comparison.txt) — SHA-256 `c83cd061b1a48acf587f03cc77183e99ec87b9f6894923cd165ef6c22be026bf`
- main `summary.md`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-main-data/summary.md](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-main-data/summary.md) — SHA-256 `8c4b7f65cc2ae664672b54bb2544b0776da55d2ce9dcd6639e0782c6f263791d`
- published `comparison.txt`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-published-data/comparison.txt](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-published-data/comparison.txt) — SHA-256 `35cb5a812c6884acd75a8c799725599a8752a2adc928f06dca71e9fbe4c68c0f`
- published `summary.md`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-published-data/summary.md](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-published-data/summary.md) — SHA-256 `1d3dc8a7526a08c6b84e08bf34e06164c57c091da7c4f8c12b3def28cff09950`
- prior-e2 `comparison.txt`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-prior-e2-data/comparison.txt](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-prior-e2-data/comparison.txt) — SHA-256 `a6eb9a3037dbd80c042e8cf956c3cc70bbb9523910f91638f08b54861e8b65ad`
- prior-e2 `summary.md`: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-prior-e2-data/summary.md](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-prior-e2-data/summary.md) — SHA-256 `6b2996cec359c1d893a67912e758a63bb711851b3f3367841eee08b2fcd3ceb5`

## One current-candidate CPU profile

- Capture wrapper exit 0; raw profile SHA-256 `466ae43041374579c732b3869dfe04c09a71c0c525648487115a7d266eecce6e`; manifest SHA-256 `467a3e1d2996716c2cd527f1bb5162d2c8d5c504b65693ef435ee35738880292`; maintained CPU ancestry report SHA-256 `2779dd1756bafce7d564f90fd655438b65997fba8e11ab011463c7a3bf09a651`.
- Workload: 1,024 text setters, bulk-write/publication, 10 warmups, 80 timed callbacks, zero timed reads, 80 scene publications; one draw and 9,216 glyphs before and after.
- The exact profile URL was `wasm://wasm/006e44da`. Fresh ancestry anchors share direct parent `updateBulk` node 6 and have disjoint subtrees: installed package `set text` node 7 and Three `updateMatrixWorld` node 44. The consumer assigns 527 samples / 790,207 µs to setter-descendant CPU, 306 / 454,502 µs to scene-update descendant CPU, and 45 / 112,291 µs unattributed.
- V8 sampled CPU is diagnostic attribution. The profiled elapsed mean is perturbed and is not comparable to the unprofiled matrix. The profile does not establish GPU time, exact phase latency, allocation bytes, or complete GC costs.
- Raw capture receipt: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/current1024-profile-01/result.json](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/current1024-profile-01/result.json). Anchor validation: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/current1024-profile-candidate/anchor-validation.json](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/current1024-profile-candidate/anchor-validation.json). Profile output directory: `/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/current1024-profile-candidate`.

## Handoff receipt

Consolidated source/artifact/matrix/profile identity record: [/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-profile-factual-handoff.json](/Volumes/Depot/Developer/glyph/.cache/held-direct-retained-20261021/evidence/matrix-profile-factual-handoff.json) — SHA-256 `1667463f9a497fae2e4dbba67d2c1f64394a1e5c699ff303e16550ce35e5e10a`.
No acceptance decision is made here. The original Labs reports and fresh High review remain the relevant interpretation inputs.
