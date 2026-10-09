---
type: Log Entry
title: 'Retired WebGPU timestamp reads before renderer disposal'
generated:
  by: process:docs-new
  at: '2026-10-09T16:29:25Z'
---

Restored causal WebGPU timing teardown in the benchmark application after issue #282 exposed an aborted mapped-buffer
read during a Presentation WebGPU→WebGL2 switch. The route-owned persistent host remains the sole renderer lifecycle
owner: it stops the animation loop, deactivates the scene, awaits its timer's one outstanding
`resolveTimestampsAsync()` call, and only then asks Three to dispose the renderer. Installed Three 0.185.1 source shows
that Three owns query-pool buffers and cleanup, while its synchronous renderer disposal does not await asynchronous pool
disposal before destroying the device; the app therefore owns only the ordering around the read it started. Readback
rejections remain observable through the existing renderer error channel. Focused deterministic coverage now holds
timer disposal pending until the read completes and covers failure reporting, while the maintained Presentation probe
records the timer state at the host retirement boundary, requires one pending timestamp read there, and then requires
the retired renderer to be unregistered and the replacement scene to publish glyphs and draws without console warnings
or errors. The [benchmark package reference](../packages/benchmarks.md) records that ownership boundary.

Validation on source commit `a6a13d3124033f65bcb9b08cc316637a4654e7eb` passed both benchmark TypeScript
projects, benchmark-wide Oxlint and Oxfmt checks, all 157 benchmark unit tests, and all 17 workflow metadata tests. The
maintained WebGPU/MTSDF Editorial probe ran against the benchmark's Portless HTTPS origin in Playwright-managed Chromium 149. It initialized WebGPU, rendered Editorial, observed one pending read at retirement, switched through the product UI
to WebGL2, rendered the replacement scene, retained one configured renderer, and reported no console, page, shader, or
validation error.
