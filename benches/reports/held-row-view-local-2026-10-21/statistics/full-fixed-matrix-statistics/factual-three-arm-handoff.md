# Three-arm fixed-matrix descriptive facts

This packet is descriptive only. It applies the installed Labs 0.9.0 classify and median exports to the saved eight block medians and computes pooled p50/p95 from the saved raw samples at floor(q*(N-1)). No bootstrap, new timing, retry, or inference implementation was used. Nominal raw classifications include the main clock-confounded row as a diagnostic; that row remains excluded from the accepted printed comparison. This packet makes no admission, causal-component, or publication claim and makes no multiple-testing adjustment.

| Arm | Raw rows | Exact paired | Unsupported candidate-only | Printed status counts | Nominal raw 95% CI: below / above / crosses or touches zero |
| --- | ---: | ---: | ---: | --- | --- |
| Main fixed | 145 | 145 | 0 | 92 faster / 30 slower / 22 neutral / 1 skipped | 95 / 32 / 18 |
| Published fixed | 145 candidate / 143 baseline | 143 | 2 | 104 faster / 28 slower / 11 neutral / 0 skipped; 2 unsupported | 104 / 32 / 7 |
| Prior E2 fixed | 145 | 145 | 0 | 5 faster / 4 slower / 136 neutral / 0 skipped | 15 / 16 / 114 |

The nominal CI counts include every exact pair in each arm; the main clock-confounded row is included in the 95/32/18 diagnostic totals. “Crosses or touches zero” includes intervals touching zero; exact zero-width intervals: 0 in each arm. Printed statuses are the Labs display labels (including the unchanged 5% UI minDelta); they are not admission decisions. The published summary’s 104/28/11/0 is likewise display-only.

Printed eligible p, relative CI, and verdict fields match the installed stock classifier for main 144 eligible rows, published 143 paired rows, and prior E2 145 rows (0 mismatches in each group). Main has one actual printed clock exclusion: adapter-publication.bench.ts / allocation-light adapter publication / normalize 1000 equivalent retained label updates, skipped clock-confounded: neutral→faster · 4.13→3.79. The row’s stock raw nominal classifier result remains present as diagnostic-only. There were no check failures or timing-mode mismatches in the saved manifests; the two published outline rows are unsupported because no exact baseline identity exists, not pass or fail.

The installed Labs clock-drift formula is (max(runFreq,postFreq) - min(runFreq,postFreq)) / ((max + min) / 2), with the result multiplied by 100 for percent. The exact saved software calibration drifts are:

| Arm | Baseline drift | Candidate drift | Saved warning |
| --- | ---: | ---: | --- |
| Main | 10.984502% | 4.022791% | baseline warning; plus the single row-level clock-confounded exclusion above |
| Published | 1.983945% | 4.022791% | none |
| Prior E2 | 7.877973% | 4.022791% | baseline warning |

A missing warning does not mean zero drift. The collector stores the 15 per-file runFreq/postFreq readings, counts, and min/max for each arm. Formula source: pinned installed @pmndrs/labs/dist/cli/cli.mjs, SHA-256 6385fc4a9511b3d68d9e9cf1f9eb1e897125bfdfd0bdb4d6c6e1177efb8fffd4.

Representative pooled quantiles below are milliseconds, baseline → candidate. They are single-run observations without timing retries; each row’s eight block medians and full arguments are in the JSON/CSV. Dense 1024 candidate p95 45.056167 ms and its first block median 32.416916 ms are retained; the other seven candidate block medians are 18.613042 through 20.005250 ms, with no noise-based deletion.

| Workload | Main | Published | Prior E2 |
| --- | --- | --- | --- |
| Rewrite 512 labels in one group | 6.968375 / 9.468042 | 7.459083 / 9.468042 | see full packet |
| Publish 1024 retained Text instances | 15.544292 / 20.212541 | 15.366375 / 20.212541 | 18.456334 / 20.212541 |
| Mount and publish a 22k-glyph paragraph (actual cold mount) | 17.431208 / 20.024292 | 18.747541 / 20.024292 | 19.952375 / 20.024292 |
| Mount a label and publish its first edit (separate first-set case) | 2.288833 / 2.277916 | 2.623916 / 2.277916 | 2.302750 / 2.277916 |
| Edit and independently copy one label among 1000 labels | 2.531791 / 1.817542 | 5.360250 / 1.817542 | 1.831709 / 1.817542 |
| Per-glyph inspection after width change | 7.137625 / 4.377625 | 9.220125 / 4.377625 | 4.444916 / 4.377625 |
| Unchanged setter preparation, one large paragraph / 8192 paint spans | 4.305625 / 2.694625 | 27.148333 / 2.694625 | 2.685583 / 2.694625 |
| 1000 labels first set (prepared-operations) | 0.036125 / 0.126875 | 0.031458 / 0.126875 | 0.130666 / 0.126875 |

The two split move and merge paint boundaries timings measure paint-boundary preparation/publication, not Text.split or independent text-lifetime behavior. Direct selected-copy timing exists in inspection.bench.ts as “edit and independently copy one label among …” and is reported above; no separate direct measurement of independent lifetime semantics is claimed. The 1000-label first-set timing is not the actual 22k-glyph cold-mount workload.

The existing root dense references agree for all four main/published 512 and 1024 baseline/candidate rows, including all pooled p50/p95 and block medians. Prior E2 uses the same candidate JSON SHA-256 69c6b80d2059ebe32909aa0a098e1e3a6c2a1e5e442d645c7f959b129c8db3d8; the complete packet carries its own raw quantiles. No result here establishes a causal component explanation or a release decision.
