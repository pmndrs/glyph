---
type: Log Entry
title: Reuse committed style structure during text-only preparation
sources:
  - resource: ../packages/glyph.md
    title: Retained preparation ownership
  - resource: ../planning/publication-frontier.md
    title: Publication frontier tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T13:35:04.417Z'
---

The single style validator now factors text-dependent validity from structural sorting/nesting. Text-only changes with unchanged committed styles call the shared text-dependent checks, preserving UTF-16 length and style/feature endpoints, registered fonts and attributed errors. New or changed styles still validate structure and resolve through the existing path. There is no authority flag, additional cache or second validation implementation. Pre-format production diff+21/-10; new tests exercise authentic-font measurement, nested styles, endpoint failures, committed rollback and a subsequent valid assignment.

Independent source review found no actionable defect. The first focused run63502 failed because the new measurement fixture omitted layout geometry; the fixture was corrected to use the existing root geometry constructor, without changing production. Formatter passed and focused84612 passed3 tests. Full native62506 passed387 unit tests,6 outline oracles,2 Unicode bidi suites and complete grapheme/line-break conformance. Build85332/static95972 passed. The new shaper SHA2569256fa9580c6f0ce9d8b48726f60c5d72694169134686d6d994e6183e1e93904 is1,576,390 raw/579,801 system-gzip bytes, +7raw/-233gzip versus the frozen Three-frontier artifact2fe8345b. Four baker Wasm files are unchanged. Full Node91137 passed974/974 with zero skips. Frozen TGZ5cbe345f93684c83248ec4ce83be886cf6de777551d47a102c19b46c171627f6 under .cache/publication-retained-style-candidate. Four-block stress Labs17237 exited0 versus frozen pre-change TGZ2fe8345b:0faster/0slower/8neutral/0skip. Bulk1024 publication34.51→34.62ms and denseborrow10005.45→5.41ms are neutral; no demonstrated speedup. packed performance is neutral and GPU evidence completed as recorded below. No #247 or release-parity completion is claimed.

Report .cache/publication-retained-style-stress/summary.md. Both artifacts were measured in this job without competing heavy work. Median workload p50 across8 cases1.775→1.765ms is not a frame-time result. GPU91012/62296 passed: WebGPU/WebGL2 MTSDF dynamic-layout387glyphs/1draw/1renderer; WebGPU Slug rich-text612glyphs/5draws/1renderer. Authenticated shaper9256fa95; all three captures inspected, no new visible defect. Existing panel occlusion remains. Matching source JS plus authenticated Wasm; not packed-JS network replacement or comparative FPS evidence.
