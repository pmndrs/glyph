---
type: Log Entry
title: 'Reuse Three presentation without temporary objects'
sources:
  - resource: ../packages/glyph.md
    title: Glyph ownership and publication contracts
  - resource: ../planning/publication-frontier.md
    title: Compact publication frontier checklist
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T12:17:32.299Z'
---

Three presentation resolution now compares scalar resolved fields through the existing equality helper before allocating/freeze. The ancestry walk, cross-root/disposed-group behavior, finite-order validation and staged/rejected-state rules remain unchanged. The private signature and three callers were rewritten with pinned ts-morph in an isolated worktree, reviewed, integrated and formatted (+46/-19 production). No new cache, executor or public API. Independent source review found no actionable defect. A caller-reachable cache-hit regression covers invalid standalone draw order and grouped child rank, preserving accepted draws and recovering after a valid update. Static/build, all134 Three tests and974 Node tests pass.

Frozen sourcepatche73b18026b6d1e4ff0e651ea8b5ab8548668c2ba0133b3d3e55d167c0ef62d2b; TGZ49ab67dc5bb0a5ec91e6131421c211c4e86fbd5765f91d48773a63fa1fb9a196. Only three/text.js changes +81raw/+22gzip; all five Wasm binaries are identical to Map checkpoint. Evidence is .cache/publication-presentation-cache-candidate/size-evidence.json. Paired edit-sized Labs14373 completed: one faster, zero slower, 46 neutral and zero skipped. Immediate publication36.74→36.65ms and interleaved71.40→72.24ms were neutral. This report remains diagnostic because of the focused-test overlap recorded below. GPU90951 passed WebGPU/WebGL2 MTSDF dynamic-layout and WebGPU Slug rich-text probes; all three captures inspected without a new visible defect. Browser evidence uses matching source and authenticated Wasm, not a packed-JS network replacement. No landing, cumulative-size or release-parity clearance claimed.

Commit lint caught a shadowed subtest-context name after parameterizing the regression. Renamed that test-local binding, passed strict lint and reran134 Three tests. Production source and frozen package are unchanged. The approximately four-second focused rerun overlapped live Labs14373; preserve clock validity checks and treat that report as diagnostic rather than release clearance. The full release comparison must run alone.

Fresh solo full eight-block Labs41523 completed with exit0 against registry @pmndrs/glyph@0.1.0 and frozen candidate49ab67dc. Output .cache/publication-release-010-full, generatedAt2026-10-10T12:11:15.364Z. Rendered report55faster/33slower/15neutral/2excluded; median across103 comparable workload p50s1.830→1.350ms, not frame times. Immediate1000-root100-edits/publication218.67→36.78ms; interleaved259.02→72.51ms; batched14.12→11.59ms; trailing-span1000 labels81.13→68.21ms. Bulk1024 Text1.83→31.63ms and cold22k1.96→19.87ms are adverse report results requiring workload-equivalence investigation and attribution. These use standalone TextGroup fixtures whose checks currently count members, whereas createLabels attaches to Scene; equivalent publication must be proved rather than assumed. Borrowed100 promoted inspection478.15→979.35µs and copied100127.04→188.77µs regress; source shows lost warm borrowed-array reuse and additional copied-outline reader work, with causal call counts still unmeasured. Baseline visibility check failed and common text publication had a timing-mode mismatch; both excluded. No release-parity clearance, landing or size waiver.
