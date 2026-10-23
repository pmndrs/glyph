# Prior E2 fixed arm: factual handoff

The saved E2 arm has 145 exact file/group/name/args pairs. The candidate JSON is byte-identical to the completed main-arm candidate; only the baseline was measured in this job. The printed summary says 5 faster, 4 slower, 136 neutral, and no skips. These labels are report observations, not admission.

Per-row JSON/CSV preserve pooled p50/p95 from raw sample values, eight block medians, actual batch plans, modes, sample counts, and correctly parsed printed Δp50, p, and CI. The E2 arm used 8 blocks and single-call sampling.

| Cell | Workload | Baseline p50/p95 ms | Candidate p50/p95 ms | Printed status; Δp50; p; CI |
|---|---|---:|---:|---|
| dense512 | `batching.bench.ts` / rewrite 512 labels in one group | 9.252167 / 10.577458 | 9.468042 / 10.614125 | neutral; +2.5%; .015; +0.5..+3.8% |
| dense1024 | `stress.bench.ts` / publish 1024 retained Text instances | 18.456334 / 20.953583 | 20.212541 / 45.056167 | slower; +4.9%; <.001; +3.5..+9.1% |
| coldMount | `cold.bench.ts` / mount and publish a 22k-glyph paragraph | 19.952375 / 20.955375 | 20.024292 / 21.045125 | neutral; +0.3%; .382; -0.3..+0.8% |
| inspection | `layout.bench.ts` / per-glyph inspection after width change | 4.444916 / 5.815333 | 4.377625 / 5.764916 | neutral; -1.8%; <.001; -2.3..-0.9% |
| sparse | `sparse-assignment.bench.ts` / scattered setter preparation in one large paragraph with 8192 paint spans | 12.768291 / 14.356417 | 12.803542 / 14.272208 | neutral; +0.8%; .195; -0.5..+1.4% |
| preparedFirstSet | `prepared-operations.bench.ts` / 1000 labels first set | 0.130666 / 0.169833 | 0.126875 / 0.162208 | neutral; -1.4%; .223; -8.2..+1.7% |
| independentCopy | `inspection.bench.ts` / edit and independently copy one label among 1000 labels | 1.831709 / 2.291333 | 1.817542 / 2.256541 | neutral; -1.2%; .442; -2.7..+1.7% |
| paintBoundaryPreparation | `sparse-assignment.bench.ts` / split move and merge paint boundaries preparation only | 4.607041 / 4.820042 | 4.608250 / 4.947625 | neutral; -0.2%; .878; -1.1..+1.0% |

Saved software calibration drift, using the pinned Labs formula `(max-min)/((max+min)/2)`, is 7.8780% for E2 baseline and 4.0228% for candidate. The comparison printed clock warnings: ['⚠ baseline CPU clock drifted 7.9% during its run']; this does not mean zero drift. Cross-run median calibration frequency difference is 0.0698%. Manifest check failures and timing-mode mismatches are both empty.

The two candidate outline rows are not excluded here: this baseline is marked complete and all 145 identities pair. This file performs no three-arm inference or admission decision.
