---
type: Log Entry
title: Coalesce contiguous placement edits in the shared allocator
sources:
  - resource: ../packages/glyph.md
    title: Placement ownership
  - resource: ../planning/publication-frontier.md
    title: Validation gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T14:16:18.927Z'
---

The existing subset admission now merges only adjacent canonical occurrence ranges with contiguous desired-input ranges. Bounds, sorted ordering and checked cursor arithmetic precede admission. Exact complete root coverage thereby selects the existing sorted structural reconciliation instead of sparse removed-key collection/per-key rope binary searches and repeated occurrence-root replacements. Sparse gaps retain their original scope. No newcache/heuristic/executor, and rollback/rejection behavior is unchanged. Frozen10239b63 patch production10+/2−; formatted total108+/2− including tests. Independent source review clean.

Formatter63385/static27391 passed. Focused adjacent56471 covers full coverage with empty boundaries, gaps, swaps/newkeys, duplicate/overlap rejection and exact abort/free/quarantine restoration against independently prepared full control. Attribution65001 cold/full gather passes: publication rope point queries30,734→10,241 and iterator starts2,055→7 for1024×10DotGothic glyphs. Preparation counts and necessary binding/gather/draw/rollback counts remain unchanged. These are work counts, not elapsed timings or actual Inter Labs input.

Full native80514 passed388unit tests including deterministic mutation/cold/full-control coverage,6outline oracle cases,2bidi plus grapheme and line-break conformance. Optimized build59745 and full976 Node47367 passed0skip. Shaper5914485e868e0dac995dbfc3c3691f8621d19ace83bf43d3c32fd015884b2ba7:1,576,455raw/579,860system-gzip versus74c8f521's9256fa95, +65raw/+59gzip. Four bakers byte-identical. Frozen TGZb381b5fc75decee986a4d7d976e951f195fec084af055ad3e0c4c572fa1e1356; Solo stress4 Labs38719 exited0 against immediately preceding74c8f521:0faster/0slower/8neutral/0skip. Bulk33.65→32.83ms (-0.82ms/-2.4%,p.057,CI−4.4..+0.3%); reorder/edit7.60→7.53ms, denseborrow3.25→3.26ms, all neutral. Work reduction is proven by counters, not a statistically established elapsed win. Report .cache/publication-range-coalescing-stress/summary.md. Hardware GPU48712/37913 exited0: WebGPU/WebGL2 MTSDF dynamic-layout each387glyphs/1draw/1renderer, WebGPU Slug rich-text612glyphs/5draws/1renderer. Shaper5914485e authenticated; all three captures inspected without a new visible defect, existing panel occlusion remains. Uses matching workspace JS plus authenticated Wasm, not packed-JS network replacement or comparative FPS evidence. Kept as bounded removal of measured repeated work in the existing executor, with tiny size delta and neutral timings; no release-parity or #247 resolution claim.
