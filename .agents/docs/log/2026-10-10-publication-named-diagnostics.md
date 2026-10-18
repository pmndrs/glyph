---
type: Log Entry
title: Authenticate named publication profiles without changing executable Wasm
sources:
  - resource: ../packages/glyph.md
    title: Diagnostic build and authentication
  - resource: ../packages/benchmarks.md
    title: Installed artifact profiling
  - resource: ../planning/publication-frontier.md
    title: Remaining release gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T15:12:22.895Z'
---

Two diagnostic builds failed closed: changing Cargo strip profile changed crate identities/data; retaining Rust names inside Binaryen changed name-dependent ordering. The corrected wrapper preserves Cargo profile/metadata and dependency invocations, retaining names only in the raw shaper. Names remain a sidecar while custom sections are removed before identical production passes. A final read-only function map supplies actual optimized indexes. Generated/merged functions stay explicitly labeled. Build17254 passed exact executable proof: release2775a2acb03b2e5377413cbb94a8d1fdf8fad490e8943d3c91e78c978436e577; named8dc9dae77fd7e4bfb6a41318fd85d09a674fc3e815f96ebe8b20fea267aeba25. Packed artifact76ef36cdf5a78120a8f10bdaa12613238b40acbe07b478141790ce13fbda1b96. Production build9758 passed; all five shipping Wasm modules remain byte-identical. Diagnostic metadata is not shipped runtime code.

Installed bulk1024 profiles20734/50637 completed,100 measured cycles/10warmups. Setter+measurement preparation median14.944291ms,p9517.962833; setter+measurement+publication median20.692500ms,p9524.106792. These are profiled timings, not Labs release A/B or proof of improvement over historical32.12ms. Preparation sampled1572.459ms includes653.252JS/862.287Wasm; withpublication sampled2154.833ms includes790.750JS/1268.582Wasm. Retained GatherSource update_ordered_node sampled99.334ms self across100cycles, OrderedPlanCompiler.prepare_internal49.416ms, ParagraphState.prepare102.294ms. Names represent surviving optimized functions and may include inlined work; generated shared functions cannot be attributed to one source origin. Profiles live in .cache/publication-named-bulk-{preparation,publication}-profile. Source ownership audit of retained gather is the next bulk slice, not another unchanged benchmark rerun.

The draw draft remains held: per-draw root seeks changed short A/B/A traversal from linear to O(draws×logrecords);52B records inflated16B instances. Reviewed replacement proposes node-only summaries and transient per-batch forward frontiers in the same rope and consumer. Rank-only reorder lacks current glyph context, so safe leaf reconstruction needs an explicit producer contract first. No draft applied or speed/size claim. Rollback redesign remains deferred.

Static65229 and full Node92546 passed987/987 with0skips, including9 diagnostic fixtures for framing, invalid code, imports, map completeness, generated labels and archive snapshots. All466 shipping JavaScript/declaration/Wasm files match frozen runtime artifact byte-for-byte; no runtime size change. The complete997-index map re-derives identical named8dc9dae7 under final validation. Workflow tests17/17 passed. Independent review completeness finding fixed.
