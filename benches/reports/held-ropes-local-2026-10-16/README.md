# Local HELD rope diagnosis — Mac16,10, 16 October 2026

Dense regressions remain **unresolved**. No runtime performance change was admitted. This is a local build and diagnostic checkpoint, not a completed seven-family acceptance run. [Machine-readable evidence](diagnostics.json) preserves source/artifact/input hashes, exact exits, sampled ancestry, absolute diagnostic p50/p95 and native work counts. The earlier machine’s profiles and archives were neither available nor reconstructed.

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
