# Local HELD rope diagnosis — Mac16,10, 16 October 2026

Dense regressions remain **unresolved**. After the user relaxed the materiality floor, a small private transport allocation cleanup was implemented and retained. The original diagnostics and historically rejected optimizer ablation below remain evidence for their exact artifacts; the compiler candidate is now preserved as inconclusive for combination tests under the user’s 17 October direction; the latest transport wave is recorded at the end of this report. This is not completed seven-family or release acceptance. [Machine-readable evidence](diagnostics.json) preserves source/artifact/input hashes, exact exits, sampled ancestry, absolute diagnostic p50/p95 and native work counts. The earlier machine’s profiles and archives were neither available nor reconstructed.

The isolated HELD checkout started at `60d3c26f135b360ab1111131ce274218959d176f`; fetched checkpoint ancestry passed. Real `gh stack checkout` imported stack #293 with merged #291 and open #292 → #301 → #302 → draft #310. Remote main is `4e25a96a57462fef5ad0d19065a822695b480f60`, two commits beyond the integrated base. No rebase, merge, tag, release or demo merge ran.

The initial build failed on unhydrated Git LFS pointers; after authenticated hydration the pinned build exited **0**. Node tests passed **1,048**, native tests **472**. Added test-only counters and the indexed Inter oracle subsequently pass **473** native tests. Glyph/benchmark static gates and nine profile-summary tests pass. The new diagnostic builder option explicitly reproduces main’s historical optimizer default and authenticates executable equality; it does not change production compiler policy.

Exactly one HELD capture ran: 1,024 indexed alpha/bravo labels, scene publication, no timed reads, ten warmups and 80 iterations. Post-timing correctness passed; both initial and final topology are one draw / 9,216 drawable glyphs. A second, specifically selected main capture distinguishes per-setter preparation from batched publication. Both use their exact packed package and executable-authenticated named Wasm.

| Capture | Setter/preparation sampled CPU | Scene publication sampled CPU | Unattributed | Profiled elapsed p50/p95 |
| ------- | -----------------------------: | ----------------------------: | -----------: | -----------------------: |
| HELD    |                   1,371.714 ms |                    658.123 ms |   174.413 ms |       25.107 / 46.442 ms |
| Main    |                     112.003 ms |                  1,079.788 ms |   103.709 ms |       15.437 / 18.044 ms |

These are inspector diagnostics, **not** paired acceptance results or clock-drift-corrected latency. Main/HELD source and optimizer policy differ. Every sample is assigned once by disjoint node ancestry; detached GC/runtime stacks remain unattributed. The temporary capture consumer lockfile was not retained. No favorable-clock retry or third capture ran.

Existing native counters first ruled out publication-time re-layout, query serialization and clean-gap suffix copying for their dense outlined fixture. The new indexed Inter fixture uses font size 16 and width 160, with synchronous preparation followed by an empty semantic publication. Per cycle it records 1,024 HarfRust calls / 10,240 input units, 20,480 retained-cluster loop visits, 10,240 run-local glyph visits, 1,024 recomposed lines and 10,240 newly positioned glyphs. Publication visits 10,240 gather and codec records, with 5,120 full masks and stable-ID mismatches. Independent cold shape/output and full-gather oracles pass. Its outlined binding is not the bitmap benchmark’s binding; unchanged outlined PlanGlyph extents do not establish unchanged ink, bitmap fields or GPU bytes.

Source/consumer review does not justify deleting broad changed output. The reviewed transport ownership cleanup is deferred: the _entire_ `#decodeResult` and `writeHeader` self times sum to only 50.960 ms over 80 iterations, a 0.637ms/frame upper bound before required work is retained. No speedup is claimed. Global order validation and lifecycle work already have guarded no-mutation paths. Sparse/inspection gains, synchronous setters, prepared queries/split, batching/order, Rust semantics and packed/SWAR/SIMD storage remain protected.

| Frozen local artifact |     Tarball |     Shaper raw / gzip |       JS raw / gzip |
| --------------------- | ----------: | --------------------: | ------------------: |
| HELD `bec6c173…`      | 3,166,898 B | 1,585,989 / 585,969 B | 867,649 / 232,575 B |
| Main `bbb3375c…`      | 3,120,073 B | 1,462,005 / 537,846 B | 865,501 / 232,222 B |

Gzip uses `gzip -n -c`; JS is sorted concatenation of all dist JS, not the per-entry delivery graph. Published0.1.0, live/peak memory, acceptance GC/drift/exclusions, final API/ABI/peer/lifetime, browser/hero and advanced-main integration gates remain open. No completed runtime wave exists to compare against both baselines yet.

Local raw evidence remains under `.cache/held-local-20261016/`; hashes here authenticate those exact artifacts if moved later. The canonical final plan and compact frontier carry the next action. The user subsequently approved one bounded compiler-policy discriminator. Its completed result follows.

## Approved optimizer ablation: rejected

The user reopened only the one-caller inline-policy experiment. [Portable ablation evidence](optimizer-ablation.json) records its pre-timing admission rule, same-input authentication, package member delta, tool versions, four-block results, absolute distributions, correctness and raw-evidence hashes. Re-optimizing the stored clean `60d3c26f` Rust input under the production flags reproduced the original packed Wasm byte for byte. Omitting only `--one-caller-inline-max-function-size=0` produced treatment archive `e1cfc4b2…`, whose sole changed member among 1,217 is `dist/text-shaper.wasm` (`ed19321e…`). The treatment named Wasm has the same executable sections as that release member. No Rust rebuild or application change entered either arm.

| Dense 1,024 scene publication |       p50 |       p95 |
| ----------------------------- | --------: | --------: |
| Production-policy control     | 21.841 ms | 24.315 ms |
| Historical-policy treatment   | 21.431 ms | 23.951 ms |

One normal, unprofiled Labs comparison exited 0: four fresh-process blocks per arm, no timed reads, matching single-call mode, no correctness errors or excluded workload rows. p50 is the median of block medians; p95 uses the pooled retained samples at `floor(.95*(N-1))`. Labs retains 64 of 80 samples per arm after its existing two-low/two-high trim per block. No analyst trimming or repeat ran. The 0.410 ms / 1.88% p50 reduction fails the predeclared 1 ms and 5% minimum; Mann–Whitney p=0.343 and the displayed 95% relative interval is −8.1% to +4.0%. This does not establish a speedup. Baseline-first serial order remains a limitation.

Labs environment calibration drift was 0.333% / 0.409%; block calibration drift was 5.203% / 5.254%, exceeding the predeclared 5% ceiling independently of the failed effect threshold. These are clock calibration estimates. Saved GC p50/max are 0.257/11.828 ms control and 0/12.062 ms treatment; observed JS heap ranges are 6,996,096–10,890,440 and 6,821,168–10,742,512 bytes. Heap observations are not Rust live/peak memory proof.

The installed treatment passes all 1,048 Node tests with exit 0; all 943 installed dist members match the archive. JavaScript, declarations, manifest exports/imports and peers match exactly. Archive-based same-method gzip level 9 with mtime 0 gives Wasm 1,585,989 raw / 584,730 gzip bytes control and 1,581,681 / 590,149 treatment. Treatment removes 4,308 raw bytes but adds 5,419 gzip bytes. Both archives have identical sorted-concatenated JS: 866,455 raw / 231,237 gzip bytes. This is an archive-member inventory, distinct from the earlier dist-directory inventory. Tarballs are 3,166,898 and 3,211,102 bytes; different packers prevent a causal archive-compression comparison.

**Production policy stays unchanged; the experiment is retired.** No additional CPU capture, favorable-clock retry, memory experiment or full acceptance matrix is justified by this rejection. Final live/peak memory, main-and-0.1.0 acceptance and browser/hero gates remain open for a material runtime wave. Dense source diagnosis continues within the existing executor and fixed seven-family scope.

Actual Wasm interface inspection confirms matching 0 imports and 38 exports. Fresh scoped Sol High source review found no redundant shape, flow, positioning or gather pass that can be deleted while retaining all prepared consumers: the two cluster passes establish geometry then adjacency, and both exist in main. No source wave is admitted from the current counters and ancestry alone. A future bitmap identity/output investigation must first prove actual unchanged fields and downstream uploads; the outlined fixture cannot provide that proof.

## Preparation receipt cleanup: retained under revised priority

The user explicitly accepts improvements below the previous materiality floor. [Portable wave evidence](preparation-receipt-cleanup.json) records the frozen package, exact source hashes, gates, all 145 candidate workload distributions and both baseline comparisons. This wave retires an unconditional full publication decode on no-view preparation: the transport still performs one synchronous Rust call, status/fault/root checks, extent validation and capacity adoption, but constructs a publication view/object/WeakMap lease only when the planner supplies a synchronous measurement consumer. Full decoding remains for demanded measurement, renderer publication and independent copies. No request-pointer cache, header rewrite, semantic executor, storage or public contract was added.

For each no-view preparation, source execution now omits one `Uint8Array` view, one PlanPublication object, one WeakMap lease insertion and eleven unused header-field reads. Demanded measurement uses a callback; no allocation reduction is claimed for query-bearing setters. Complexity changes only by constant per-call JS work; request encoding, shaping, flow, positioning and dense output bounds remain. The earlier 0.637 ms/frame attribution bounded two entire functions and is not an estimated saving. These comparisons measure the whole held branch against main/release, **not** the isolated cleanup against its predecessor.

Frozen candidate `2a7f0317…` has 1,217 members / 3,167,180 bytes. Build, pack, static, matching named-Wasm authentication, all 1,048 Node tests, 30 deterministic prepared-operation generators, 55 minimum-peer tests and the completed production size workflow pass. Fresh scoped Sol High review found no reachable ownership or recovery defect. The prior 473 native tests remain applicable to unchanged Rust source. The preliminary Node run begun before staged build publication is excluded; the final 1,048-test run used the completed candidate. The peer workflow's rebuild matches all 943 packed dist members exactly.

Published declarations, manifest/exports/peers and the other four Wasm files match the predecessor. Shaper Wasm is 1,585,989 raw / 584,738 same-method gzip bytes; every optimized non-data section, including instructions and exports, matches the predecessor. Rust source-location data shifted after the earlier test instrumentation; raw size stays fixed and gzip changes by 8 bytes. Shipping sorted-concatenated JS is 866,545 raw / 231,270 gzip bytes: +90 raw / +33 gzip versus the predecessor. Current production graph sizes are separately recorded by the maintained size workflow; archive inventories use gzip level 9, mtime 0 and do not mix with the earlier dist-directory method.

One four-block full-suite candidate run is reused byte for byte for main and published0.1.0. Main is authenticated `4e25a96a` / archive `bbb3375c…`; registry 0.1.0 archive `6e2bf7bd…` matches the installed baseline lock's SHA-512 integrity. Candidate correctness errors and baseline check failures are zero. Maintained summaries report main 54 faster / 28 slower / 47 neutral, with 16 exclusions (10 clock, 4 mode, 2 unresolved truncated identities). Published reports 76 / 11 / 46, with 10 such exclusions plus two outline workloads absent from that release. Counts are workload rows, not completion of the seven families.

| Workload                                             |         Main p50/p95 | Published0.1.0 p50/p95 |  Candidate p50/p95 |
| ---------------------------------------------------- | -------------------: | ---------------------: | -----------------: |
| Rewrite512 labels                                    |     7.074 / 8.483 ms |       8.266 / 9.178 ms | 10.975 / 23.085 ms |
| Dense1024 scene publication                          |   17.605 / 21.193 ms |     16.759 / 18.923 ms | 20.155 / 21.869 ms |
| Width inspection then publication                    |     8.673 / 9.352 ms |     10.371 / 11.058 ms |   4.790 / 5.695 ms |
| 1,000 labels /100 interleaved edit-read publications | 138.952 / 172.060 ms |   181.657 / 196.825 ms | 50.578 / 56.929 ms |

Times are median-of-block-medians p50 and pooled-retained-sample floor(.95·(N−1)) p95. No analyst trimming or favorable-clock retry ran. Main/candidate/release software clock-calibration drift is approximately 6.0% / 8.5% / 33.1%; dense1024 versus main is clock-confounded and excluded from classification. Absolute rows are retained for transparency. These conditions prevent unqualified speedup, parity, FPS or release-acceptance claims. Inspection remains favorable in this capture; the dense regression is not resolved. The small cleanup is retained for its proven removal of unused work under the revised priority, with no isolated latency claim.

The candidate memory artifact's feature-off control byte-matches its shipped Wasm. Eight cycles / 71 phases pass with unchanged archive identity: requested live max 40,345,423 bytes, completed-call requested peak max 40,553,931 bytes and final retained baseline 7,641,016 requested-live bytes /727 Wasm pages. Counters cover that shaper instance only, excluding JS, GPU, separate font decoders, Talc fragmentation and transient physical realloc peaks. The attempt to authenticate memory against the original `60d3c26f` archive failed byte reproduction and produced no accepted memory result; its failed log is preserved. There is no paired predecessor memory claim.

Portless 0.15.8 served fresh Chromium 149 verification without a package dependency. All 16 maintained browser conformance cases and six Dynamic Layout cells (Bitmap/MTSDF/Slug × WebGPU/WebGL2) pass against the candidate; representative WebGPU Bitmap and WebGL2 Slug screenshots were inspected. The six cells authenticate shaper `6f7afa1c…`. These are scoped correctness checks, not paired browser frame-time proof. The owned server/proxy are stopped. The previous ignored ASCII hero source has not been retrieved or authenticated in this checkout, so its historical 15-scene result is not reused. Full hero A/B, cumulative whole-stack API/ABI review, advanced-main integration and final seven-family acceptance remain open. Keep #310 and its stack held and unmerged.

## Inconclusive candidate preservation — 17 October 2026

[Preservation index](experiment-retention.json) authenticates the named local compiler candidate and its source reproducer. The earlier standalone admission failure remains historical evidence; it does not establish zero benefit. The next bounded experiment combines that policy with the retained preparation cleanup. No combined timing result exists yet. Local binary archives are not available from GitHub.

## Preparation and compiler combination — 17 October 2026

The combination is **inconclusive and preserved**. Four frozen arms share identical Wasm bytes within each compiler-policy column; the two normalized cleanup archives are derived experiments. [Portable receipt](preparation-compiler-combination.json) includes exact identities, member invariants, raw-result hashes, block medians/frequencies, GC time, JS heap deltas, correctness and exclusions.

| Arm                                  | p50 ms | p95 ms | File calibration drift |
| ------------------------------------ | -----: | -----: | ---------------------: |
| Unchanged HELD                       | 23.141 | 34.429 |                   2.4% |
| Compiler only                        | 21.614 | 26.289 |                   0.9% |
| Preparation cleanup only, normalized | 27.910 | 48.868 |                  16.3% |
| Both                                 | 28.401 | 42.311 |                   7.4% |

Each arm ran once: 16 blocks, 256 retained samples, no timed reads, scene publication. The combined result was reused byte-for-byte in all three comparisons. p50 is the median of block medians; p95 is the pooled retained sample at `floor(.95*(N-1))`. Serial order and software clock instability preclude causal acceptance of all three combined comparisons. Raw output classifies two slower and one neutral; p/CI and observed slower medians remain recorded. This proves neither a speedup, zero benefit nor a causal regression. No interaction significance is claimed, and no favorable-clock retry ran.

The exact combined distribution passed 1,048 Node tests, 30 prepared generators, 27 diagnostic/workflow tests, both static gates and named/member/actual Wasm interface checks. Same Python zlib 1.2.12 gzip9 method: compiler Wasm −4,308 raw / +5,419 gzip bytes, cleanup JS +90 raw / +33 gzip. The report labels the separate Node zlib method explicitly. GC diagnostics are time in nanoseconds; JS heap deltas are not Rust or whole-process live/peak memory. No arm11 live/peak, new browser/hero or final main/published matrix is claimed.

The preparation cleanup stays retained, production compiler policy stays unchanged, and both isolated options plus the combination remain available. Local preservation bundle/ref: `held-preparation-plus-compiler-inconclusive-2026-10-17`; the committed `glyph:shaper-combination-artifacts` workflow reconstructs the authenticated member composition from its required frozen inputs. Local binary archives and raw samples are not on GitHub. Dense regressions and the final seven-family readiness gates remain open.
