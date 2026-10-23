# Published fixed arm: factual handoff

This records the published 0.1.0 baseline against the candidate JSON reused byte-for-byte from the completed main arm. The baseline was measured in this job; the candidate was not rerun. There are 143 exact paired identities and two candidate-only outline identities recorded as unsupported. The saved Labs summary reports 104 faster, 28 slower, 11 neutral, and no skips across 143 comparable workloads. These are display labels, not an admission result.

Pooled p50/p95 use all raw per-call nanosecond samples at sorted index `floor(q*(N-1))`, divided by 1e6. They are distinct from the eight block medians. The JSON/CSV retain per-arm sample counts, actual `stats.plan`, GC mode, block medians, and correctly separated printed report fields. This job used 8 blocks and `single-call` sampling.

## Representative cells

| Cell | Exact workload | Baseline p50 / p95 (ms) | Candidate p50 / p95 (ms) | Printed report (status; Δp50; p; CI) |
|---|---|---:|---:|---|
| dense512 | `batching.bench.ts` / group 1 / rewrite 512 labels in one group | 7.459083 / 8.059542 | 9.468042 / 10.614125 | slower; +27.5%; <.001; +25.3..+28.7% |
| dense1024 | `stress.bench.ts` / group 1 / publish 1024 retained Text instances | 15.366375 / 16.277125 | 20.212541 / 45.056167 | slower; +24.2%; <.001; +22.3..+29.8% |
| coldMount | `cold.bench.ts` / group 1 / mount and publish a 22k-glyph paragraph | 18.747541 / 19.603292 | 20.024292 / 21.045125 | slower; +7.2%; <.001; +5.4..+8.5% |
| inspection | `layout.bench.ts` / group 1 / per-glyph inspection after width change | 9.220125 / 10.667084 | 4.377625 / 5.764916 | faster; -48.4%; <.001; -53.1..-44.9% |
| sparse | `sparse-assignment.bench.ts` / group 1 / scattered setter preparation in one large paragraph with 8192 paint spans | 37.020000 / 39.018833 | 12.803542 / 14.272208 | faster; -65.2%; <.001; -65.5..-65.0% |
| preparedFirstSet | `prepared-operations.bench.ts` / group 1 / 1000 labels first set | 0.031458 / 0.055500 | 0.126875 / 0.162208 | slower; +317.8%; <.001; +281.3..+334.8% |
| independentCopy | `inspection.bench.ts` / group 1 / edit and independently copy one label among 1000 labels | 5.360250 / 6.433541 | 1.817542 / 2.256541 | faster; -66.1%; <.001; -66.5..-65.7% |
| paintBoundaryPreparation | `sparse-assignment.bench.ts` / group 7 / split move and merge paint boundaries preparation only | 6.859417 / 7.104875 | 4.608250 / 4.947625 | faster; -33.3%; <.001; -33.7..-32.4% |
| paintBoundaryPublication | `sparse-assignment.bench.ts` / group 7 / split move and merge paint boundaries publication | 9.606709 / 10.061084 | 6.042875 / 6.399875 | faster; -37.0%; <.001; -37.5..-36.6% |

The matrix contains the named independent-copy workload `edit and independently copy one label among 1000 labels`. The `split move and merge paint boundaries` rows time paint-boundary preparation/publication; they do not measure `Text.split()` or establish independent `Text` lifetime. No separately named `Text.split()` or selected-copy lifetime timing identity is present.

## Unsupported candidate-only identities

Both records are from `outlines.bench.ts`, group 1 (`glyph outlines`): `copy per-glyph metrics with outlines after text change` and `read every outline from an unchanged copy`. The manifest marks baseline availability `published-no-outlines`; each candidate raw run exists, but the published baseline has no matching identity. These comparisons are unsupported, not failed or passed.

## Clock and mode observations

The pinned Labs source computes within-run calibration drift as `(max - min) / ((max + min) / 2)` over all `runFreq` and `postFreq` values in `environment.freqs`. Published baseline drift is 1.9839%; candidate drift is 4.0228%. Their raw frequency ranges are 3.932038–4.010829 GHz and 3.853509–4.011710 GHz. The comparison text has no clock warning; that absence does not mean zero drift. Cross-run median calibration frequencies differ by 0.0946%. The manifest reports no baseline check failures and no timing-mode mismatches.
For context, the same formula gives main-arm baseline drift 10.9845% and candidate drift 4.0228%. The main baseline warning printed 11.0%, consistent with the computed 10.9845%. This diagnostic uses saved calibration readings only.
The formula source is `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo/node_modules/.pnpm/@pmndrs+labs@0.9.0_patch_hash=1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002/node_modules/@pmndrs/labs/dist/cli/cli.mjs` (SHA-256 `6385fc4a9511b3d68d9e9cf1f9eb1e897125bfdfd0bdb4d6c6e1177efb8fffd4`); its median helper is `/Volumes/Depot/Developer/glyph/.cache/held-rerun-20261019/repo/node_modules/.pnpm/@pmndrs+labs@0.9.0_patch_hash=1475111a563f675ba8de804b57a4a7500acad4f500771713dad8ad33b5be3002/node_modules/@pmndrs/labs/dist/stats-DyCSLnVh.mjs` (SHA-256 `ddab0c388cd7e24851c504cbc8788e9e244f03adf6b3915ea8f4615f5bde2668`). Raw calibration records, frequency ranges, paths, and input hashes are in `provenance.json`.

## Provenance and limits
- Published receipt: `/Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-published-fixed-01/result.json`; exit 0.
- Manifest: `/Volumes/Depot/Developer/glyph/.cache/held-row-view-20261021/evidence/matrix-published-fixed-data/manifest.json`; harness digest `badf82b0d84dbced158f4bb44ee50b7adac7169323f295d108909c2b93413627`, baseline archive SHA-256 `6e2bf7bdef50ec528a4e4799b8f067e81335388265fbb4950cbbcf08f840581b`, candidate archive SHA-256 `d2f7a01ffb47aeaf87499979310286f1c980b88389e20bd1fc0f39794a0fc18c`.
- Candidate JSON SHA-256 `69c6b80d2059ebe32909aa0a098e1e3a6c2a1e5e442d645c7f959b129c8db3d8`; bytes match the main candidate JSON.
- Root’s four dense descriptive rows are compared in provenance; all four match.
- This is factual evidence for the saved published arm, not an E5 adaptive comparison, E2 comparison, or publication claim.
