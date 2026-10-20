# Held shared-layout hybrid: portable evidence packet

The frozen E3 hybrid (`37c1e088…`) passed scoped correctness and package checks but is **not admitted as the live path** after its completed three-control timing matrix. Dense 512 rewrite and 1,024-instance publication p50 are slower than main, published 0.1.0, and direct prior `28fd`; sparse borrow and width inspection improve against main/release while regressing or remaining inconclusive against direct prior. The whole correct E3 source variant is preserved at commit `734dae75e9d39cd90f0e60c2244aa488b5b64bf2` and ref `experiments/held-shared-layout-hybrid-measured-20261020`, submitted through the real held stack. Live package source has subsequently been restored to exact `a829b86b`/`28fd`; fresh rebuilt artifact authentication passed: all947shipped dist members match the saved28fd archive, including shipping shaper01001ff6…. The copied receipts below retain their frozen source-stage scope. The [independent architectural review](independent-architecture-reset.md) gives the detailed decision basis. Parity is false; no boost wave has started.

## Identity and measured results

The candidate archive is SHA-256 `37c1e0882acfb16bc6ebc9e2538340b4a12eeff6d8006e0055e86423db3572e6`; its shipping shaper Wasm is `81153a6202caef528f235ae69d34ff0c8b2515c8c711af84b92db57b1f700aa6`. The controls are main archive `bbb3375c…` (source `4e25a96a`), published 0.1.0 archive `6e2bf7bd…` (published source commit not established), and direct prior E2 archive `28fd0413…` (shipping shaper `01001ff6…`; the older `2e434…` artifact is not this control). All three arms used the same byte-identical candidate JSON (`1c18b27d…`), frozen 1,059 inputs, Labs 0.9.0, eight blocks, and exited zero with no task-owned matrix processes remaining. See [matrix integrity](matrix-all-arms-integrity.json), [source freeze](candidate-source-freeze.json), and [full comparison](comparisons-all.json).

| Complete timed operation, p50 / p95 ms         |            Main | Published 0.1.0 | Direct prior `28fd` |           E3 hybrid |
| ---------------------------------------------- | --------------: | --------------: | ------------------: | ------------------: |
| Rewrite 512 labels in one group                |  7.759 / 11.488 |  7.967 / 24.900 |      9.816 / 11.674 | **10.720 / 13.628** |
| Publish 1,024 retained Text instances          | 16.727 / 18.614 | 16.277 / 17.612 |     18.497 / 20.997 | **19.519 / 21.530** |
| Edit and sparsely borrow one of 1,000 labels   |   0.270 / 0.460 |   0.265 / 0.362 |       0.186 / 0.270 |   **0.214 / 0.324** |
| Per-glyph inspection after width change        |   7.460 / 9.988 |  7.903 / 10.779 |       4.437 / 5.812 |   **4.640 / 6.401** |
| Inspection then publication after width change |   6.186 / 9.737 |  9.845 / 10.243 |       4.688 / 5.707 |   **4.920 / 6.233** |

These are absolute distributions, not a composite ranking. The **inspection then publication after width change** row is excluded **only against direct prior `28fd`** as clock-confounded; its absolute p50/p95 values remain visible above. The 1,024 direct-prior comparison is classified Labs-neutral under its 5% minimum-delta rule, despite a measured **+5.5% p50**, `p=.007`, 95% CI `+1.5..+7.8%`; neutral does not mean parity. The unchanged JS-owned-array control also measured `+12.2% p50`, so the matrix cannot assign every slower flag to the Rust diff or dismiss all of them as machine noise. Across all 145 exact workload identities, E3 vs main is 60 faster / 37 slower / 31 neutral / 17 excluded (12 clock, 5 mode); vs release 71 / 31 / 30 / 11 excluded / 2 unavailable (7 clock, 4 mode); vs direct prior 1 / 75 / 44 / 25 excluded (23 clock, including two prefix-group members, and 2 mode). All rows, slower flags, exclusions, N, p50/p95, confidence fields, and block software calibration values are in [absolute distributions](absolute-distributions.json), [comparisons](comparisons-all.json), and the readable [comparison table](comparisons-all.md). No sample deletion, retry, or favorable resampling was used. Software calibration warnings were main 12.9%, release 116.3%, prior 27.8%, and candidate 89.6%; these are **not hardware GHz** and prevent a clean paired causal claim.

## What was implemented and checked

The two-file source change in `state.rs` and `work_attribution.rs` chooses the existing whole-run shape window for admitted short, broad edits and the existing complete gather path when every active owner is on the frontier and at least half the old source rows carry full semantic rewrite masks. Sparse, mixed, decoration, and checkpoint paths retain their previous admission behavior. This reuses the same semantic executor, aligned fields, packed output, and fallible preparation/commit machinery; the dense admission adds mask scanning and can write more fields. The [implementation brief](implementation-brief.md), [final scoped review](scoped-review.md), [earlier review gap](scoped-review-before-physical-oracle.md), and [source freeze](candidate-source-freeze.json) identify the exact code, guards, independent cold-root physical oracle, and repaired initial fixture mismatch. The final scoped review reported no finding after that repair. Source is still uncommitted on top of `a829b86b` in the held checkout. The code itself, complete diff, package, and named Wasm stay in the capture or preserved source ref; this packet carries their authenticated summaries, not those large artifacts.

The standalone native run passed 498 tests, 0 failed, 0 ignored after the test-only cold fixture repair; root `pnpm check` also exited 0 with durable raw log hashes in [the package receipt](package-artifact-summary.json). These are separate runs and their test counts must not be added into one total. The preceding `a829` CI run `39472962401` had all five jobs successful ([metadata](preceding-a829-ci-terminal.json)); it did **not** cover the uncommitted E3 hybrid. [Static/native summary](static-native-final-summary.json), [package receipt](package-artifact-summary.json), and [final identity verification](final-downstream-identity-verification.json) scope those checks. Peer check passed 55 tests across its eight peer floors. The production package-size workflow measured all 32 entries; only `package/dist/text-shaper.wasm` changed relative to `28fd`: +1,007 raw and +403 Node-gzip bytes. JS, declarations, and the other four Wasm members are byte-identical. The [size/ABI receipt](size-and-binary-abi-summary.json) compares all 38 shaper function export signatures plus the memory export from standard binary sections, as well as packaged member identities; its convenience function-index list is not an ABI difference list.

| Packed `dist` size, raw / Node gzip bytes |                Main |     Published 0.1.0 | Direct prior `28fd` |           E3 hybrid |
| ----------------------------------------- | ------------------: | ------------------: | ------------------: | ------------------: |
| JS members                                |   864,183 / 295,743 |   837,472 / 289,977 |   875,885 / 298,974 |   875,885 / 298,974 |
| Shaper Wasm member                        | 1,462,005 / 541,363 | 1,362,353 / 500,993 | 1,609,247 / 599,549 | 1,610,254 / 599,952 |

These are absolute member sizes. Node v24.18.0 `gzipSync` level 9, mtime 0 compresses each `dist` member separately; JS is the sum of 237 files for main, prior, and E3, and 230 for the published package. The shaper is one member, not a full package or network-transfer size. Relative to direct prior, E3 changes only the shaper member; the +1,007 raw / +403 gzip bytes are not a claim of full-package equivalence to main or release.

Four archives × six cold browser phases × two backends matched a fresh main capture on `pixelHash`, `litPixels`, draws, and instances ([browser oracle](browser-oracle-comparison.json)). The hash is noncryptographic and full pixel readback bytes were not retained. Published 0.1.0 alone had a WebGPU idle attribute-update exception: 15,244,800 bytes in 600 calls; the other archive/backend idle counters were zero in that hook scope. Separately, 12 dynamic-layout presentation cells completed across three raster techniques, two backends, and two shader paths ([presentation/memory summary](memory-presentation-summary.json)). Two candidate MTSDF screenshots were visually inspected and have HUD occlusions ([visual record](visual-inspection.json)); they do not establish a historical hero comparison. The [hero inventory](hero-gate-factual-inventory.md) found no literal maintained hero workflow or historical hero identity. An editorial local baseline could be defined later under existing authorization, with its new comparison contract stated explicitly. Three PR #317 remains a separate integration lane and is not cleared by this package's browser gate.

Memory evidence is deliberately separated by measurement layer. The [allocator comparison](allocator-work-comparison.json) uses untimed instrumented engine Wasm on the same authored 1,024-label fixture: warm cycles show E3 minus direct prior **+4,469 allocations, +960 reallocations, +432,156 cumulative requested bytes** per cycle. These are allocator-work counts, not shipping JS GC, latency, or a proof of the allocating function. The E3 diagnostic's maximum requested live was 40,524,235 bytes, completed-allocation-call requested high water 40,724,551 bytes, and Wasm capacity 731 pages; these maxima occur in different phases/cycles and are not additive. Requested live omits Talc fragmentation and transient internal realloc peaks.

| Four-arm memory observation, bytes                                     |          Main | Published 0.1.0 | Direct prior `28fd` |     E3 hybrid |
| ---------------------------------------------------------------------- | ------------: | --------------: | ------------------: | ------------: |
| Node JS heap used, checkpoint maximum                                  |    26,411,632 |      31,032,384 |          30,790,320 |    30,846,776 |
| Node RSS, checkpoint maximum                                           |   396,001,280 |     388,972,544 |         326,942,720 |   327,565,312 |
| Engine Wasm capacity, checkpoint maximum                               |   158,662,656 |     158,072,832 |          44,630,016 |    44,695,552 |
| Node whole-command observed non-atomic process-family sweep maximum    |   620,604,832 |     581,951,568 |         654,644,888 |   651,957,192 |
| Browser whole-command observed non-atomic process-family sweep maximum | 1,642,522,952 |   1,690,758,336 |       1,611,359,816 | 1,565,731,768 |

The [Node memory summary](node-memory-summary.json) reports per-field maxima over eight after-update-and-publish checkpoints of the untimed 1,024-label fixture; maxima need not coincide. [Presentation/memory summary](memory-presentation-summary.json) records the separate 25 ms whole-command process-family sweeps, including bootstrap, cold oracles, and teardown. Each sweep sums sampled process footprints non-atomically and is neither a simultaneous peak nor an edit-only measurement. Browser sweeps cover their own browser command, not the Node checkpoint process. JS heap, RSS, Wasm capacity, requested live, and process-family footprint are distinct views; do not sum them or infer GC rate.

## Review boundary and handoff

The [independent reset](independent-architecture-reset.md) and [ingress audit](independent-ingress-audit.md) are final read-only reviews. They do not establish a production Bitmap allocation site or a latency cause. A saved opt-in transaction-ledger proposal exists in the capture but is **unapplied** and is not runtime evidence. The complete E3 preservation and source restoration are recorded above; current operation and rebuild status are owned by the canonical frontier. After a live candidate earns parity, the API/lifetime and new editorial visual comparison still require their own scoped gates. The exact capture-local paths in receipts locate the original evidence; they are not required for a reader to open this portable packet. [Copy provenance](draft-copy-provenance.json) records each included source and target SHA-256/size and the single intentional Markdown-link substitution in the independent review.

## Restored live source and independent stop decision

After preserving and submitting the complete E3 variant, root restored only its two package files to exact a829.
The fresh [package authentication](restored-prior-package-authentication.json) records exit0, all947shipped dist
members matching the saved28fd archive and exact source preimages. Existing source attestation dba4f566 remains
valid; the workflow refuses duplicate attestations. The [source restoration receipt](live-source-restoration.json)
records the earlier transition stage, and [copy provenance](restoration-copy-provenance.json) authenticates these
additional receipts without changing the original evidence copies.

Fresh no-history Sol High's [final source audit and next decision](independent-next-decision-addendum.md) selects no
product wave. It traced actual Bitmap prepared columns through gathered Codec inputs, ordered instances, physical
bytes and borrowed host patches, finding no whole redundant pass source-proven removable. It skips the E3 allocator
split; its opt-in patch remains unapplied. Keep28fd live and E3 fully recoverable. A new wave requires a named whole
removable owner/path with cold physical and lifetime proof; current counts do not supply one. Parity remains
unresolved, not proved impossible. No setter/query contract change, release, merge or boost-wave completion is implied.

## Later exact-fixture evidence design

A separate fresh no-history Sol High subsequently selected one
[actual-Bitmap evidence discriminator](bitmap-evidence-design.md), extending evidence feasibility rather than
admitting a product patch. Its [source review](bitmap-replay-high-review.md) narrowed the route to an external
observer of the unchanged installed package's existing Wasm exports. The
[authentication implementation brief](bitmap-replay-implementation-brief.md) requires a named workflow, complete
captured lifecycle and exact native encoded result equality before counters. Implementation is in progress; these
are designs, not runtime results. No counter, new profile/timing or optimization is selected. The
[brief provenance](bitmap-replay-brief-copy-provenance.json) records raw source and repository-formatted target hashes for these design/review prose copies; original reviews and measured receipts remain unchanged.

The [actual Bitmap authentication checkpoint](bitmap-native-auth/README.md) now records the completed full05
boundary, including independent review corrections, exact query/publication bytes, source/blob hashes and all947
shipping members restored byte-identical. It supports later native work counts under its stated scope; it is not a
performance improvement or parity result.
