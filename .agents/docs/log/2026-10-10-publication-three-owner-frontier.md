---
type: Log Entry
title: Settle only pending Three publication owners
sources:
  - resource: ../packages/glyph.md
    title: Three publication ownership
  - resource: ../planning/publication-frontier.md
    title: Publication frontier tracker
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T13:24:24.823Z'
---

Three publication preparation, acceptance and rejection now iterate the existing pending-measurement owner set instead of every bound Text. Capacity is maintained at the existing successful stage, removal and detached-cache transitions. Detached cache restoration preserves pending authority. No additional dirty set, cache, publication executor or public API is introduced. Production diff is +20/-7 lines; existing regression coverage adds successful removal/recreation, failed setter capacity rollback, UTF-16 growth/shrink repair and clean sibling revision/measurement identity.

Independent source review found no actionable defect. Formatter/static70066, build/focused134 Three38802 and full974 Node23215 passed with zero skipped tests. All five Wasm hashes remain unchanged. Emitted Three JavaScript increases285 raw/59 system-gzip bytes. Frozen TGZ SHA2562fe8345b3b51da7c0b951fdadbe224d3eb78611e94441a43d628fca48a8108f8 is preserved under .cache/publication-three-frontier-candidate. Four-block edit-sized Labs9133 compared it with the previous geometry TGZ3ab474a5 and exited0; live-render verification completed as recorded below. This does not establish resolution of #247 or release parity.

Four-block edit-sized Labs9133 exited0:2faster/1slower/44neutral/0skip. Color-only engine publication1000 first841.54→756.33µs and last825.63→763.42µs are faster. Small-root10 last same-length engine596.77→628.81µs (+32.04µs/+5.4%) is flagged slower. Immediate1000 edits35.55→34.23ms (-1.32ms) and interleaved73.16→69.71ms (-3.45ms) remain classified neutral; no #247 resolution. Median workload p50.830→.874ms; no broad speedup claim. GPU8600/6985 exited0: WebGPU/WebGL2 MTSDF dynamic-layout each387glyphs/1draw/1renderer; WebGPU Slug rich-text612glyphs/5draws/1renderer. All three captures inspected without a new visible defect; existing panel occlusion remains. Shaper64e4ce00 matched. Browser uses matching workspace JS plus authenticated Wasm, not packed JS replacement; no FPS comparison. Report .cache/publication-three-frontier-edit-sized/summary.md. Both artifacts were timed in this job without concurrent heavy work; several cases have variance warnings.
