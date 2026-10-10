---
type: Log Entry
title: Retain the outline reader in the existing owned inspection cache
sources:
  - resource: ../packages/glyph.md
    title: Prepared inspection ownership
  - resource: ../planning/publication-frontier.md
    title: Publication frontier tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T12:45:38Z'
---

Repeated owned glyph inspection now retains the outline reader and its font-store references in the existing inspection entry instead of rebuilding them for each copy. Caller-owned columns remain independently copied. Successful setters invalidate the entry; rejected setters retain it. Returned copies retain their original font stores after font replacement or disposal. No public API, ABI, preparation executor, or secondary cache was added. Production source changes +25/-15 lines; existing integration coverage adds 27 lines.

Independent source review, static checks, build, focused 18 outline tests and all 974 Node tests passed; full session34510 exited0. Frozen package33b4d098d1d549e3632bfbf77ad73590a0c0c1c42eca20236a204c1756713c70 is preserved in .cache/publication-inspection-cache-candidate. All five Wasm artifacts match the prior49ab67dc package; shaper64e4ce00 remains1,576,383 raw/580,034 system-gzip bytes. Emitted render-planner.js changes34,970→35,069 raw and10,060→10,091 system-gzip bytes. Paired glyphs Labs session63334 against49ab67dc exited0: all ten workloads neutral and zero skipped. Copied100182.42→183.40µs and cached22k85.19→81.67µs do not establish a speedup. Report .cache/publication-inspection-cache-labs/summary.md. The cumulative Wasm size gate, borrowed-read regression and #247 publication gate remain open.
