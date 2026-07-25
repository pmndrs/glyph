---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:5ee2555f16b658142e62dca2ea8be08369705fb4f84ef4b6072b0de721c0f06d"
tags: [package, benchmarks, react, vite, product-e2e]
sources:
  - id: manifest
    resource: ../../apps/benchmarks/package.json
    title: Package manifest
  - id: benchmark-plan
    resource: ../planning/benchmark-plan.md
    title: Benchmark plan
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-25T16:20:00Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 usable harness shell; rendering targets not implemented

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, real portable-baker target, real public loader/Worker-fallback target, real HarfRust shaping-conformance target, and real paragraph measurement/positioned-layout/policy/CJK targets. The runner disposes partial target state when loading fails, and the UI retains typed WebGPU availability through label and tone rendering. The interactive UI, browser headless CLI, Vitest, Vitexec, and Playwright all call the same strict registry execution module. Inter 4.1 remains the default fixture; Amiri 1.002 owns complex-script evidence; Noto Sans CJK JP 2.004 owns the maximum-cardinality universality lane. Each is immutable, licensed, hash-authenticated, and paired with checked HarfRust/HarfBuzz evidence. Chromium 149 passes all pre-render targets with three deterministic samples after one warmup. The CJK result fixes thirteen corpus cases, four paragraphs, twelve layouts, eight plans, one direct shape call, four paragraph shape calls, zero reshapes, 10,622 output bytes, and the exact composite hash `a1a833f2:fbe2aa07:922f9a2e:8c977f4d:85a2f640:fd42b9f7:53d8ec89:8cb3050c:bbfd039d:837a2b43:2f450f5e:9900b4af:c49f3e68`; Vitexec repeats it with WebGPU active.

The independent package-size lane measures the initial public browser graph, lazy font validator, runtime Worker boundary, baker and shaper JavaScript/Wasm, and Unicode 17 analysis without zero-byte placeholders. Static entry closures and dynamic chunks are separated from Rollup metadata rather than conflated, and package-owned Wasm URLs are externalized from JavaScript measurements regardless of their owning package. The current browser graph is 209,375 minified bytes; Unicode analysis is independently 139,936 minified / 42,047 gzip / 30,989 Brotli bytes. The validator, runtime host, runtime Worker JavaScript, portable baker JavaScript, baker Wasm, shaper JavaScript, and shaper Wasm report 584,164, 3,498, 8,952, 6,581, 434,285, 30,406, and 692,018 minified/raw bytes respectively. The reviewed 0.61 KiB Brotli increase in the lazy Worker buys one-time exact ABI/result validation and allocation rollback; it does not enter the initial browser graph or a shaping/layout/rendering loop. Checked ceilings cover both runtime JavaScript entries and the portable baker JavaScript/Wasm so regenerating the report cannot silently bless a heavy dependency edge. Paragraph layout hashes and the policy composite hash share one implementation over the actual normalized layouts; the generator, benchmark target, unit tests, and Vitexec probe no longer maintain parallel digest logic.

Bitmap, MSDF, and Slug remain explicitly unavailable rather than returning fabricated measurements. Item 5.4 is complete with Node, Chromium, and GPU-enabled Vitexec evidence and no fabricated rendering metrics. The first real rendered font frame must land here in Milestone 6.

The initial deterministic browser probe is admitted with a checked-in record: 100 executions across 10 fresh GPU-friendly Chromium/Vite lifecycles, zero retries/failures, unique causal completion identities, and wrong-expectation plus withheld-completion negative controls. The current live probe also executes exact paragraph measurement, positioned-layout, bidi/policy, and CJK scenarios sequentially; the CJK probe fixes its composite hash and reports WebGPU active before the mobile Playwright surface runs on its own strict port. This proves a GPU-capable environment, not a rendered GPU workload before Milestone 6.

## Package scripts

| Script | Purpose |
| --- | --- |
| `dev` | Build the baker dependency and start the Vite application. |
| `typecheck` | Build the baker dependency and type-check browser and Node script projects. |
| `test` | Run deterministic Vitest suites and the shared-registry browser smoke test. |
| `test:unit` | Run deterministic Vitest suites without starting a browser. |
| `test:headless` | Run synthetic, direct-baker, loader/Worker, exact shaping, paragraph measurement, positioned-layout, and bidi/policy/uikit scenarios through the browser CLI. |
| `lint` | Run Oxlint with warnings denied. |
| `format:check` | Verify Oxfmt output. |
| `size` | Produce deterministic independent package-size JSON for the report UI. |
| `test:live` | Run the explicit maintainer-local Vitexec and Playwright product probes. |
| `admit:live` | Run negative controls plus 100 zero-retry executions across 10 fresh Vitexec lifecycles and write the admission record. |
| `capture:browser-reference` | Regenerate the pinned Chromium HTML/CSS reference and metadata. |
| `generate:harfbuzz-oracle` | Generate JSON with an exact HarfBuzz 13.0.0 `hb-shape` executable. |
| `provision:harfbuzz` | Authenticate and build exact HarfBuzz 13.0.0 into the app-local ignored cache; `--check` never downloads. |
| `sync:amiri-fixture` | Fetch the immutable Amiri font/metadata/license or verify checked-in bytes with `--check`. |
| `sync:cjk-fixture` | Fetch the immutable Noto CJK font/license or verify checked-in bytes with `--check`. |
| `generate:paragraph-bidi-contract` | Regenerate the reviewed Amiri/Inter bidi, line-policy, and current-uikit-shaped exact layout contract. |
| `check:paragraph-bidi-contract` | Recompute the contract without writing and fail if any checked-in exact value is stale. |
| `generate:paragraph-cjk-contract` | Regenerate the reviewed Noto CJK natural/wide/narrow exact layout contract. |
| `check:paragraph-cjk-contract` | Recompute CJK semantics without writing and fail if any checked-in value is stale. |

The [benchmark plan](../planning/benchmark-plan.md) owns target admission, correctness-before-timing, and product-E2E requirements.[^benchmark-plan]

[^benchmark-plan]: Local GPU evidence supplements rather than replaces deterministic CI-safe checks.
