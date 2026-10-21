# Fixed matrix terminal facts

Created 2026-10-21T05:32:34.694588+00:00 UTC. All three arms completed with wrapper exit 0 under the frozen full-suite, 8-block, single-call policy. This is a factual handoff, not a performance acceptance decision.

Candidate archive: `d2f7a01ffb47aeaf87499979310286f1c980b88389e20bd1fc0f39794a0fc18c`. Candidate JSON SHA-256 in main, published, and prior-E2 data is identical: `69c6b80d2059ebe32909aa0a098e1e3a6c2a1e5e442d645c7f959b129c8db3d8`. It was sampled once on main and reused by the other arms.

Frozen input check: 788 files, 0 mismatches. All four archives re-hashed to their released identities. No matrix/Labs worker remains in the process snapshot.

| Arm | baseline availability | baseline rows | candidate rows | Labs summary counts | clock drift warning | exclusions / coverage | receipt |
|---|---|---:|---:|---|---|---|---|
| main | complete | 145 | 145 | 92 faster · 30 slower · 22 neutral · 1 skipped | 11.0% during its run | 1 clock-confounded skip; 0 timing-mode mismatches | `/Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-main-fixed-01` |
| published | published-no-outlines | 143 | 145 | 104 faster · 28 slower · 11 neutral · 0 skipped | none shown | 2 candidate-only outline identities; 0 timing-mode mismatches | `/Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-published-fixed-01` |
| prior-e2 | complete | 145 | 145 | 5 faster · 4 slower · 136 neutral · 0 skipped | 7.9% during its run | 0 skipped; 0 timing-mode mismatches | `/Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-prior-e2-fixed-01` |

Raw `baseline.json`, `candidate.json`, manifests, comparison output, summaries, and durable wrapper logs remain at each `dataDir` and `receiptDir` recorded in the JSON. Published baseline coverage is 143 of the 145 candidate identities because its manifest explicitly uses `published-no-outlines`; the two missing outline rows are listed as candidate-only. All three manifests report no baseline check failures or timing-mode mismatches. The Labs summaries and block-median confidence output are preserved as diagnostics; this handoff makes no acceptance classification.

Detailed JSON SHA-256: `2cf2d57baad693debd736b494144d69b88daa9eb601537601a79ee8cff4e6d2b`.
