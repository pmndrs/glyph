---
type: Log Entry
title: Skip redundant preflight for already queued Three roots
sources:
  - resource: ../packages/glyph.md
    title: Publication and queue ownership
  - resource: ../planning/publication-frontier.md
    title: Current gates
generated:
  by: openai-codex/gpt-6
  at: '2026-10-10T14:50:06Z'
---

Frozen source patchd3b0959bf9e09fb3e3e036c846a50407c010e7cfbb1b072a6b40796fcb361987 queries the existing dirty-registration Set and skips only redundant Three traversal preflight when preparation is already queued. The same preparation still reconciles raw hierarchy/presentation. Unqueued clean roots keep their current preflight. Queue consumption, rejection, capacity deferral, disposal and settlement order remain unchanged; pendingMeasurements is not used as a queue proxy. No new dirty flag/cache/executor. Independent review clean. Production21+/1−, formatted tests124+/0−. Retired held scheduler56a17036 from the active work queue: unconditional clean staging would add a Set allocation and full reconciliation.

Static32109/build96123 passed; focused engine/Three/declaration22258 passed150/150, full Node72957 passed978/978 with0skips. Existing multi-root, rejection/deferral, raw hierarchy and late-sibling coverage remains active. All five Wasm modules unchanged; shaper2775a2ac. Three changed JS modules total+187raw/+64system-gzip (module sum, not combined bundle): engine+111/+31, configuredhandle+49/+19, Three+27/+14. Frozen TGZ76ef36cdf5a78120a8f10bdaa12613238b40acbe07b478141790ce13fbda1b96.

Solo edit-sized4 Labs85341 versus71830308 completed:2faster/0slower/43neutral/2clock-confounded exclusions among47matched. At1000labels last length-changing Scene publication3.42→3.24ms(-0.18/-5.3%,p.029); last color-only Scene1.29→1.13ms(-0.16/-12.1%,p.029). First same-length Scene2.84→2.74ms neutral; interleaved100edits69.55→70.36ms neutral and batched11.11→11.16ms neutral. Excluded1000-label no-op traversal and100-label immediate measurements+publication remain inconclusive, not cleared. Report .cache/publication-queued-registration-edit-sized/summary.md. This does not close #247 or establish release parity.

Hardware GPU9071/7699 passed: WebGPU/WebGL2 MTSDF dynamic-layout387glyphs/1draw/1renderer and WebGPU Slug rich-text612glyphs/5draws/1renderer. Shaper2775a2ac authenticated, all three screenshots inspected without new visible defects; existing UI occlusion remains. Verification uses matching workspace JS and authenticated Wasm, not packed-JS replacement or screenshot FPS comparison. Exact draw map/reduce proposal is recorded in the canonical retained-assignment plan; it is not implemented. Named release-equivalent Wasm diagnostics are a separate reviewed tooling slice, not shipped runtime code.
