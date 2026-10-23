# E5 small-gain admission correction (read-only)

20 October 2026, America/Detroit. This addendum corrects the E5 performance-admission interpretation; it does not alter the earlier report or establish E6 timing. The E5 archive is `83949860ae65b99fe6d7471b9782398234852668b54412870fafa81878c366a3`, compared here only with the matched E2 archive `28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb`. The one E5 candidate JSON, SHA-256 `700944329123880bcb040be199f39bd938af964247a34581c5e13811981b04bd`, was reused across the three historical arms. Main and published-release arms have three and five timing-mode exclusions and 10.5% and 5.3% baseline software-clock drift warnings respectively; their paired claims cannot be substituted for E2's 145/145 matched, mode-comparable, zero-exclusion arm without a global warning.

## Corrected finding and scope

The former E5 admission report's statement that E5 has **“no validated E2 gain to retain in the active path”** is too strong. Labs 0.9.0 printed **0 faster, 14 slower, 131 neutral**, because its verdict requires both exact two-sided Mann–Whitney `p ≤ .05` and `|Hodges–Lehmann relative shift| ≥ 5%`. The 5% gate is Labs' default display/admission rule, not a user requirement or a minimum useful gain. Recomputing the installed classifier from each saved pair of eight block medians, with the 5% gate removed, gives **5 nominally favorable and 30 nominally adverse directional rows** with exact 95% relative-shift intervals excluding zero; the adverse 30 include the 14 already printed slower, leaving **16 adverse rows hidden among “neutral.”** The other 110 intervals include zero. All 145 recomputed statuses, displayed p-values and one-decimal CI endpoints match the saved summary, and all 145 baseline/candidate timing modes and workload identities match.

One of the five favorable intervals is easily missed: framework normalization has an exact upper bound of **−0.027054%**, printed as `−0.0%`. A parser that tests the rounded printed endpoint against zero finds only four. The exact sign comes from saved block medians and the installed Labs statistic; it is not inferred from the rounded display. The relative-shift estimate below is the median of all 8×8 candidate/baseline block-median ratios minus one; it is **not** the change in the displayed p50, a pooled per-call quantile, a phase timer or an absolute-time confidence interval. Times in the tables are median-of-block-medians in **milliseconds**. Negative means E5 was faster. CIs and p-values are nominal, unadjusted across 145 related workloads.

### Favorable sub-5% rows in the E2 comparison

| Exact workload | E2 → E5 block median (ms) | HL shift | Exact 95% CI | Exact p |
| --- | ---: | ---: | ---: | ---: |
| `adapter-publication`: normalize 1000 equivalent retained label updates | 2.212604 → 2.187730 | −0.99% | −1.557..−0.141% | .028127 |
| `framework-publication`: bind and normalize 1000 framework-shaped formatted flow updates | 4.944333 → 4.902833 | −1.10% | −2.264..−0.027% | .037918 |
| `prepared-operations`: 1 labels first overwrite-before-scene-publication | 0.369229 → 0.356729 | −2.81% | −5.755..−0.763% | .020668 |
| `prepared-operations`: 100 labels first set+measure | 0.020344 → 0.019956 | −1.92% | −3.097..−0.838% | .001088 |
| `prepared-operations`: 100 labels first set+measure+scene-publication | 0.500603 → 0.493312 | −1.61% | −4.366..−0.225% | .028127 |

### Adverse sub-5% rows also printed neutral

| Exact workload | E2 → E5 block median (ms) | HL shift | Exact 95% CI | Exact p |
| --- | ---: | ---: | ---: | ---: |
| `adapter-publication`: mutate one trailing span across 1000 formatted labels | 36.482104 → 37.173479 | +2.15% | +1.176..+3.570% | .001865 |
| `batching`: 10 labels no-op scene traversal | 0.003766 → 0.003911 | +3.62% | +1.346..+6.595% | .006216 |
| `batching`: 10 labels last length-changing engine publication | 0.439500 → 0.457083 | +3.99% | +2.664..+10.568% | .000155 |
| `batching`: 100 labels first length-changing scene publication | 0.657813 → 0.666646 | +1.55% | +0.272..+3.095% | .020668 |
| `batching`: 100 labels first length-changing engine publication | 0.596541 → 0.623125 | +4.39% | +2.165..+8.231% | .000622 |
| `batching`: 100 labels last length-changing engine publication | 0.546354 → 0.559396 | +2.65% | +0.855..+4.647% | .020668 |
| `batching`: 1000 labels last same-length engine publication | 1.364375 → 1.399833 | +2.05% | +0.125..+3.161% | .049883 |
| `batching`: 100 labels batched edit-read publication | 4.503667 → 4.556459 | +1.53% | +0.085..+2.360% | .028127 |
| `cold`: mount and publish a 22k-glyph paragraph | 19.829666 → 20.110333 | +1.20% | +0.926..+1.571% | .000155 |
| `common`: measure after text change | 1.586021 → 1.601708 | +0.88% | +0.430..+1.194% | .010412 |
| `edit`: type one character into a long paragraph and measure | 1.676271 → 1.695666 | +1.11% | +0.383..+1.479% | .002953 |
| `edit`: type one character into a long Fredoka paragraph and measure | 2.008042 → 2.030480 | +0.92% | +0.285..+1.755% | .002953 |
| `inspection`: edit and independently copy one label among 100 labels | 0.943604 → 0.959688 | +2.06% | +0.700..+3.841% | .002953 |
| `layout`: per-glyph inspection after width change | 4.407000 → 4.458812 | +1.15% | +0.435..+2.491% | .020668 |
| `sparse-assignment`: split move and merge paint boundaries publication | 5.883625 → 6.112063 | +3.75% | +2.786..+4.385% | .000155 |
| `stress`: reorder then edit one of 1000 retained labels | 5.408041 → 5.460646 | +1.04% | +0.221..+2.105% | .020668 |

These rows sit in mixed families. The favorable adapter-normalization row shares its file with the adverse trailing-span mutation. The favorable framework-shaped normalization is a separate full-operation row; it does not imply that all framework publication improves. Three favorable prepared-operation rows coexist with a **+13.8%** E2→E5 `100 labels first set` regression (`16.22→18.46 µs` in Labs' block-median display), and `100 labels first set+measure` has a different timing mode from the main baseline, so its E2 conclusion must not be exported to main. Seven additional adverse small rows are in `batching`, including no-op, first/last length-changing publication and batched edit/read. The separate 14 Labs-classified slow rows include dense `rewrite 512 labels in one group` **+5.8%** and `publish 1024 retained Text instances` **+10.1%**. Their stored pooled per-call nearest-rank p50/p95 costs are E2 `9.385/10.538` → E5 `10.019/11.178 ms` and E2 `18.514/21.048` → E5 `20.359/22.668 ms`. Those pooled p95s are descriptive and have no independent CI here.

The five favorable rows are candidate partial gains worth preserving as evidence and testing in combinations. They do **not** prove a separate E5 component caused each gain: E5 is one whole source wave, the rows are related, nominal p-values were not corrected for multiple workload searches, and no E5-versus-E2 decomposition isolates direct getters, preparation or publication phases. Conversely, “neutral” cannot be used to erase the 16 smaller adverse observations. A family decision must compare absolute time, tails, semantic constraints and costs, including the scoped engine-allocator increase of **1,377,716 requested-live bytes and 46 Wasm pages** and **+16,279 raw shipping shaper bytes** against E2. The authenticated Bitmap witness proves **117,760 actual E4 gathered slots** avoided per matching publication, not the hypothetical `175,104` full-field count; neither counter proves whole-operation speed.

## Admission consequence

Correct the earlier conclusion to: **E5 has five nominally supported small E2 improvements, alongside 30 nominally supported adverse rows, including 14 at or above Labs' 5% threshold. Its whole variant is not admitted as an overall performance improvement on this record.** Keep the exact E5 archive/source and the current E6 source wave available for targeted combination and review; do not discard the possible small gains merely because Labs prints “0 faster,” and do not promote E5 whole merely because five rows favor it. E6 includes E5 plus row-view repair, so E5 historical latency is not a measurement of E6. This audit makes no new algorithm selection and starts no timing wave.

For the next E6 all-row admission review, inspect each matched workload's exact block-median estimator, p-value and CI sign **without a 5% floor**, even if the unchanged Labs UI still labels sub-5% effects “neutral.” Preserve all adverse rows and timing-mode/calibration/exclusion context, compare the selected families' absolute p50/p95 and memory/size costs, and require independent before/after evidence before attributing a retained partial benefit to a particular code path. The one synchronous prepared-query executor, independent split ownership and physical publication authority remain binding.

## Evidence and method

- Raw E2/E5 `baseline.json`, `candidate.json`, `manifest.json`, `comparison.txt` and `summary.md`: `.cache/held-direct-retained-20261021/evidence/matrix-prior-e2-data/` relative to the Glyph repository root.
- Descriptive stored-sample quantiles and identity/mode checks: `matrix-three-arm-absolute-quantiles.json` in the E5 evidence directory. Their pooled per-call quantiles are kept separate from Labs' block-median CI calculations.
- Installed Labs 0.9.0 statistic: `benches/node_modules/@pmndrs/labs/dist/stats-DyCSLnVh.mjs`, `classify` and `hodgesLehmannDelta`; CLI CI rounding: `dist/cli/cli.mjs`. I reran `classify` on all 145 raw 8+8 stored block medians and checked each exact workload identity, kind, batching mode, status, formatted p and CI against the saved report: **145 matched, zero mismatches**. No benchmark, build, product-source edit or fresh timing was run.
- Prior interpretation retained unchanged for traceability: `held-direct-retained-20261021/evidence/direct-hybrid-wave-admission-high.md`. The earlier ANSI-stripped 20-row starter `e5-neutral-ci-threshold-audit.json` omitted the rounded-negative-zero framework row; this report corrects that omission from raw numerical evidence.
