---
type: Log Entry
title: 'Promoted the retained frame ABI into a production host'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

`RuntimeShaper` now exposes one package-internal,
ownership-checked view of its existing Wasm instance to a typed text-engine host. The host owns cold policy,
font-binding, font-stack, and session registration; reserves before pinning; writes requests into the retained arena;
and returns the published A/B slot as borrowed bytes without copying. An integration test publishes slots A and B
through the compiled module and proves B does not mutate A. Three still consumes the legacy paragraph batch in this
checkpoint; request/policy compilation and render-plan lowering are the next cutover slices.
