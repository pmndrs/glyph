# HELD Codec scratch and publication-request wave — 20 October 2026

The correct candidate remains held and provisional: dense512/1024 still trail main and published0.1.0. Relative to the preceding candidate, dense changes are inconclusive and two balanced1000 grow/shrink publication cases regress. This wave is preserved for combination, without parity or blanket no-regression clearance.

| workload                                    |     main p50 / p95 ms |        published0.1.0 |              prior340 |             candidate |
| ------------------------------------------- | --------------------: | --------------------: | --------------------: | --------------------: |
| rewrite 512 labels in one group             |   7.910396 / 8.935917 |   8.582000 / 9.430375 | 10.216917 / 11.318750 | 10.143000 / 11.442625 |
| publish 1024 retained Text instances        | 16.843542 / 18.395083 | 17.100417 / 18.684375 | 20.119729 / 22.929917 | 19.762229 / 22.340916 |
| sparse borrow after one edit in 1000 labels |   0.268501 / 0.495000 |   0.267209 / 0.500625 |   0.215563 / 0.474875 |   0.211875 / 0.416208 |
| per-glyph inspection after width change     |  7.509792 / 10.065750 |  9.307229 / 11.120916 |   4.780834 / 6.193917 |   4.755979 / 6.188292 |
| width-change inspection then publication    |   5.361896 / 9.781125 | 10.260396 / 10.952167 |   5.084897 / 6.311834 |   5.038771 / 6.357041 |

Dense p50 trails main by28.2%/17.3% and release by18.2%/15.6%. Versus prior340 it changes−0.7%/−1.8%, both neutral. Prior comparisons retain1 faster/2 slower/142 neutral: balanced1000 grow-shrink-space engine publication+6.3% (p.028,CI+1.7..10.6%) and scene publication+5.9% (p.007,CI+2.6..13.6%) are unresolved slow flags. No favorable retry or dismissal as noise.

All145 main identities retain89 faster/26 slower/24 neutral/six excluded (two clock,four mode). Release has100 faster/26 slower/13 neutral/four excluded (one clock,three mode), with two unavailable outline cases. Prior has no exclusions. All absolute distributions, sample counts, deltas, uncertainty and exclusions remain in [full tables](comparisons-all.md), [structured results](comparisons-all.json), and [absolute distributions](absolute-distributions.json).

p50 is the median of eight fresh-process block medians; p95 pools retained samples at floor(.95\*(N−1)). Dense512 sample counts main/release/prior/candidate are208/200/176/184; dense1024 has128 each. Software calibration drift is10.139267%/3.718001%/1.301837%/1.213498%, respectively, not hardware frequency. The installed Labs classifier uses Mann–Whitney p≤.05 and absolute Hodges–Lehmann delta≥.05; its estimator differs from the reported p50 ratio. This describes the tool, not a user admission floor. [Policy receipt](classification-policy-receipt.json).

The same candidate JSON SHA07379e474976e9b84a2a552989031f09bdd8645ae0a0d2940f8bed396bcfb8b7 is byte-identical in all three comparisons. All1039 recorded inputs,20 Labs supplemental inputs,four archives and harness67d7e692… remain unchanged; process groups are gone. The Labs supplement was recorded mid-main-run, not preflight. [Integrity](matrix-all-arms-integrity.json).

## Source, deletion and correctness

Archive28fd04139e792aa37fd963bf6100c091a4acdbd24417e2435f1a71d898ab37bb; shipping01001ff67186294925137a0fc2deadb94eea294d13182f72ca59e7c164f667cd; named6fa7083f44eb1b652e0bf7d772f6c7b5e8f0136a75f8a883257fd52550e2a909. Built from291fb51 plus the six frozen source/test changes, not291 alone. All ten named/shipping executable sections match. [Authentication](final-artifact-verification.json), [frozen sources](candidate-source-freeze.json), [actual Labs supplement](actual-labs-source-supplement.json). The20 Labs hashes were recorded during the main capture and verified afterward; do not label their supplement as preflight.

The same scalar/SIMD executor initializes scratch once per populated invocation. Active operations still read current definitions under validated masks/def-use; no cache, retained scratch, second executor, finite-predicate or ABI change. The scalar-record helper is retired into its loop owner. Optimized zero fills have no loop ancestor and the frame remains1536B. Four finite lane extracts remain. Static opcode counts are not runtime utilization or latency savings. [Compiled ancestry](codec-codegen/README.md), [scoped review](implementation-proof/scoped-review.md).

Request compilation retains pending snapshot/removals before upserts/independent orderDirty. It retires map/filter/spread intermediates and fresh empty sections in favor of the existing frozen list, with local nonempty arrays and synchronous readonly transport lifetime. This is source allocation removal, not a measured GC-churn rate.

Native literal-byte oracles cover0..11records, masks/padding/self-target/redefinition/Select/error prefixes. Shipping-Wasm oracles independently compute physical F32/U32/U16 bytes from authored finite columns and borrowed semantic glyph IDs; a reachable finite arithmetic overflow rejects publication, then reset and exact valid recovery pass. Native masks/prefix tests do not prove actual Wasm SIMD execution. No new real-Wasm inactive-mask sentinel fixture is claimed. The real Inter1024 native program is a custom one-store Codec; its2560eligible groups are not production Bitmap counts. [Producer bridge limit](dense-producer-source-bridge.md).

Candidate build/package check passes1142Node/587Rust tests, one ignored; root check exits0, plus55peer tests/eightfloors, two production builds,32sizeentries, fresh four-arm Node/browser cold oracles and12presentation cells pass. Root check has a truncated tool stream and no durable raw log; its numerical tool exit is0. A mistaken presentation `--help` invocation ran a default scene and is excluded from the12 planned cells. Earlier compiler/test/probe failures remain local. [Package receipt](package-check-summary.json), [downstream](downstream-final-verification.json), [memory/browser/presentation](memory-presentation-summary.json), [procedural exception](procedural-unwrapped-presentation-help.json).

API declarations, binary interfaces, manifest/exports/peers match prior340. Source maps change where implementation moved; maps are not declarations. [Member and binary inventory](artifact-api-member-inventory.json), [inventory correction](artifact-inventory-correction.md). Preceding291 CI39445779433 has all5jobs successful, which does not cover this uncommitted candidate.

## Size and scoped memory

Same Node24 gzip9mtime0 sum-of-individual-dist-members: shaper1609247raw/599549gzipB, +15/+2 versus prior340; JS875885/298974B across237files, +10/+2;226declarations unchanged494232/160334B. Against main, shaper+147242/+58186B and JS+11702/+3231B. [All four arms and method](size-comparison.json).

Allocator requested-live maximum40471115B, completed-call highwater40671431B, retained7641020B,728pages over71phases/eightcycles. This captured engine instance excludes JS/GPU/font decoders, Talc fragmentation, transient internal realloc peak and unmeasured stack. Capacity is separate from requested bytes. [Allocator](allocator-summary.json).

| eight after-update/publish checkpoint maxima | JS heap B |     RSS B | engine Wasm capacity B | whole-command observed OS maximum B |
| -------------------------------------------- | --------: | --------: | ---------------------: | ----------------------------------: |
| main                                         |  26533832 | 389726208 |              158662656 |                           609725520 |
| candidate                                    |  30799072 | 326909952 |               44630016 |                           650498632 |
| published010                                 |  31015648 | 387481600 |              158072832 |                           581640176 |
| prior340                                     |  30773648 | 323928064 |               44630016 |                           651105200 |

Per-field maxima need not coincide. Whole-command OS25ms process-family sweeps are non-atomic, include bootstrap/all1024cold oracles/teardown and are not edit-only physical peaks or simultaneous sums. Do not sum heap/Wasm/RSS views or infer allocation rate/GC churn. [Exact observation scopes](node-memory-summary.json).

All six browser phase signatures match fresh main on both backends for all four installed archives, with authenticated delivered entries/Wasm and no errors. Signatures are noncryptographic; full pixels were not retained. Main/candidate/prior idle uploads are zero over30frames; release WebGPU dynamic uploads15244800B/600calls, releaseWebGL zero. The12presentation cells use the committed fresh ASCII hero and matching shipping Wasm, not an unavailable historical hero. Separate Three186 PR317 is not integrated or cleared. All owned Portless listeners/proxy were stopped before timing; unrelated port1355 was preserved. [Browser comparison](browser-oracle-comparison.json), [cleanup](memory-presentation-cleanup.json).

## Current-source CPU and next decision

Exactly one new matching named-Wasm1024 bulk-write scene-publication capture uses10warmups/80iterations/no timedreads:81920 timed setters,80 scene publications,0 timed reads. Initial/final output is1draw/9216 visible glyphs. Fresh ancestry anchors7 (`set text`) and53 (`updateMatrixWorld`) are disjoint children of6 (`updateBulk`). Of1293833µs/842 sampled CPU observations, preparation is835835µs/560samples, publication358876µs/240samples and unattributed99122µs/42samples. Phase totals and self costs conserve the raw profile. This is sampled CPU, not removable latency or paired performance. [Authentication](current1024-profile-authentication.json), [exclusive partition](current1024-profile-data/exclusive.md).

The profile callback omits the Labs returned textCount descendant walk. Its elapsed timer therefore is not an acceptance result; no timing difference is attributed to that walk without evidence. Whole-function samples identify investigation scope, not safely deletable time. Publication-only changes cannot be promised to close a predominantly preparation-side gap.

The user explicitly requested a hybrid after repeated shared-path waves failed to close dense regressions. The next wave must choose dense versus sparse work coarsely inside the existing executor and shared packed/SoA layouts, with exact guards, bounded ownership, deletion targets and independent cold-output oracles. Existing complete/sparse ordered-plan selection and contiguous fields already exist; renaming them is not a new hybrid. A scoped source review is evaluating dense gather reconstruction using existing producers to bypass retained correspondence and splice work, plus preparation-side scope. No extra executor, speculative cache, shadow parser, duplicated semantic model or segmented storage is approved.

Private plain-string ingress and shaping-scope advice are complete and conditional, not implemented or promised savings. Short dense shaping cannot assume whitespace is a safe splice boundary; Rust/HarfBuzz unsafe-to-concat authority remains. The fixed seven-family scope remains; parity is false and post-parity boost waves are0. Real gh-stack submission stays held/unmerged; no release, tag or demo merge.

Raw packages, profiles, samples, WAT and build outputs remain local. The copied receipts are authenticated in [copy provenance](portable-copy-sources.json); local absolute artifact paths identify this capture and are not prerequisites on another machine.
