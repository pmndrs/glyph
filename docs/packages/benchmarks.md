---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:b594860fefb2e47c9ea70e9e3903f48f3d924154d43e267a94fd2d9d276c4d9c"
tags: [package, benchmarks, react, vite, product-e2e]
sources:
  - id: manifest
    resource: ../../apps/benchmarks/package.json
    title: Package manifest
  - id: benchmark-plan
    resource: ../planning/benchmark-plan.md
    title: Benchmark plan
generated:
  by: openai-codex/gpt-5
  at: "2026-07-25T06:47:06Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 usable harness shell; rendering targets not implemented

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, real portable-baker target, and real public loader/Worker-fallback target. The interactive UI, browser headless CLI, Vitest, Vitexec, and Playwright all call the same strict registry execution module. The baker defaults to the hash-pinned Inter 4.1 fixture in interactive and automated paths; a local font is an explicit override. Before timing loader fallback, the browser target hashes the actual module-Worker GLB against the canonical Node artifact and validates/registers it. Chromium 149 passes synthetic, direct-baker, and loader-Worker scenarios with three deterministic samples after one warmup. Its fixture inventory binds the bitmap strike contract to the executable canonical descriptor and raster key. Its independent package-size lane measures the initial public browser graph, lazy font validator, runtime Worker boundary, baker JavaScript/Wasm, and explicitly unavailable future entries without zero-byte placeholders. Static entry closures and dynamic chunks are separated from Rollup metadata rather than conflated, so the current loader reports 22,355 minified initial bytes; the validator, runtime host, runtime Worker JavaScript, and Wasm report 584,061, 3,371, 5,576, and 430,662 minified/raw bytes respectively. The production app likewise emits separate runtime-host, Worker, validator, and Wasm assets without an ineffective dynamic-import warning.

Bitmap, MSDF, and Slug remain explicitly unavailable rather than returning fabricated measurements. The first real rendered font frame must land here after its loader, shaping, paragraph, and bitmap dependencies close.

The initial deterministic browser probe is admitted with a checked-in record: 100 executions across 10 fresh GPU-friendly Chromium/Vite lifecycles, zero retries/failures, unique causal completion identities, and wrong-expectation plus withheld-completion negative controls. The record reports WebGPU availability while explicitly declining to claim a GPU workload before rendering lands.

## Package scripts

| Script | Purpose |
| --- | --- |
| `dev` | Build the baker dependency and start the Vite application. |
| `typecheck` | Build the baker dependency and type-check browser and Node script projects. |
| `test` | Run deterministic Vitest suites and the shared-registry browser smoke test. |
| `test:unit` | Run deterministic Vitest suites without starting a browser. |
| `test:headless` | Run the synthetic scenario through the browser headless CLI. |
| `lint` | Run Oxlint with warnings denied. |
| `format:check` | Verify Oxfmt output. |
| `size` | Produce deterministic independent package-size JSON for the report UI. |
| `test:live` | Run the explicit maintainer-local Vitexec and Playwright product probes. |
| `admit:live` | Run negative controls plus 100 zero-retry executions across 10 fresh Vitexec lifecycles and write the admission record. |
| `capture:browser-reference` | Regenerate the pinned Chromium HTML/CSS reference and metadata. |
| `generate:harfbuzz-oracle` | Generate JSON with an exact HarfBuzz 13.0.0 `hb-shape` executable. |

The [benchmark plan](../planning/benchmark-plan.md) owns target admission, correctness-before-timing, and product-E2E requirements.[^benchmark-plan]

[^benchmark-plan]: Local GPU evidence supplements rather than replaces deterministic CI-safe checks.
