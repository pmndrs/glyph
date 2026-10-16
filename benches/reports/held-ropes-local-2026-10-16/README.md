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

Local raw evidence remains under `.cache/held-local-20261016/`; hashes here authenticate those exact artifacts if moved later. The canonical final plan and compact frontier carry the next action. The compiler-policy discriminator is proposed but unexecuted because the authoritative frontier explicitly excludes restarting that experiment.
