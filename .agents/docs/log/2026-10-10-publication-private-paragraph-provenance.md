---
type: Log Entry
title: Trust package-minted paragraph identities in private transport
sources:
  - resource: ../packages/glyph.md
    title: Producer boundary
  - resource: ../planning/publication-frontier.md
    title: Compact publication frontier
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T13:58:08.354Z'
---

Four private PlanTransport methods no longer repeat the global paragraph-ID provenance lookup. Their sole production caller supplies retained-state IDs minted by the package-owned GlyphIdScope. Public Codec and stable-glyph validation, active-root/borrow guards, range checks and Rust root/paragraph ownership remain. No new state, cache, public API or executor; production0+4−. Independent source review was clean and parent traced creation/callers/export closure before applying959cba15.

Static1738 and build19625 passed. Focused161 Node56823 passed with zero skips: handle-state, ownership model, Codec identities, entry-point boundaries, ESM-only and complete Three integration including seeded cold-oracle promotion. No new full Node/native/GPU run for this four-line deletion; the immediately preceding promotion wave has full975 Node and three inspected hardware captures. Emitted handle-state JS24,129→24,001raw and6,733→6,721system-gzip (−128raw/−12gzip). All five Wasm files match frozen586bdac7 exactly; shaper9256fa95 remains1,576,390raw/579,801gzip.

Frozen .cache/publication-private-id-candidate/pmndrs-glyph-0.1.0.tgz SHA25674c8f52134ea1dca6cb941a2b2188a02a0e24c5ebb509f0d26118a3c52836a95. Solo stress4 Labs88060 measured both586bdac7 and74c8f521:0faster/0slower/8neutral/0skip. Bulk1024 publication33.21→33.41ms (+0.20ms,p.886); dense1000borrow3.19→3.24ms neutral; sparse edit/measure204.60→193.77µs neutral. Reorder2.92→3.01ms (+3.2%,p.029) remains report-neutral; preserve this movement rather than claiming every case improved. Report .cache/publication-private-id-stress/summary.md. Kept for smaller source and retirement of redundant owned-value checks; no measured speedup, release parity or #247 resolution claim.
