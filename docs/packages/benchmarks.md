---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:7663e62fd22587aa72836f5f523a696f3552b97f3c5a2fdf5f24107d0e51db5e"
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
  at: "2026-07-26T05:05:01Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 usable harness shell; rendering targets not implemented

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, real portable-baker target, real public loader/Worker-fallback target, real HarfRust shaping-conformance target, and real paragraph measurement/positioned-layout/policy/CJK targets. The runner disposes partial target state when loading fails, and the UI retains typed WebGPU availability through label and tone rendering. The interactive UI, browser headless CLI, Vitest, Vitexec, and Playwright all call the same strict registry execution module. Inter 4.1 remains the default fixture; Amiri 1.002 owns complex-script evidence; Noto Sans CJK JP 2.004 owns the maximum-cardinality universality lane. Each is immutable, licensed, hash-authenticated, and paired with checked HarfRust/HarfBuzz evidence. Chromium 149 passes all pre-render targets with three deterministic samples after one warmup. The CJK result fixes thirteen corpus cases, four paragraphs, twelve layouts, eight plans, one direct shape call, four paragraph shape calls, zero reshapes, 10,622 output bytes, and the exact composite hash `a1a833f2:fbe2aa07:922f9a2e:8c977f4d:85a2f640:fd42b9f7:53d8ec89:8cb3050c:bbfd039d:837a2b43:2f450f5e:9900b4af:c49f3e68`; Vitexec repeats it with WebGPU active.

Every measured call receives its actual zero-based sample index; warmups remain outside the reported sample sequence. Controls reject zero/non-integral sample counts and negative/non-integral warmups before target loading. Successful summaries are honest single-state records and include the V0 schema marker plus the exact controls, so headless JSON is self-describing rather than relying on command-line context.

The independent package-size lane measures the initial public browser graph, lazy font validator, runtime Worker boundary, baker and shaper JavaScript/Wasm, and Unicode 17 analysis without zero-byte placeholders. Static entry closures and dynamic chunks are separated from Rollup metadata rather than conflated, and package-owned Wasm URLs are externalized from JavaScript measurements regardless of their owning package. The current browser graph is 211,199 minified bytes; Unicode analysis is independently 139,936 minified / 42,047 gzip / 30,989 Brotli bytes. The validator, runtime host, runtime Worker JavaScript, portable baker JavaScript, baker Wasm, shaper JavaScript, and shaper Wasm report 584,255, 3,861, 9,010, 6,647, 434,251, 30,648, and 693,034 minified/raw bytes respectively. The reviewed Worker increase buys explicit FIFO admission, queued/active cancellation recovery, and entry-side serialization; the reviewed shaper increase buys fallible result assembly, arena publication, and a 64-plan per-font LRU bound. Checked ceilings cover both runtime JavaScript entries and the portable baker JavaScript/Wasm so regenerating the report cannot silently bless a heavy dependency edge. Paragraph layout hashes and the policy composite hash share one implementation over the actual normalized layouts; the generator, benchmark target, unit tests, and Vitexec probes no longer maintain parallel digest logic.

The local Worker-queue Vitexec probe authenticates every output and reports observations rather than asserting machine-sensitive timing. Two Chromium runs measured a three-font queued burst at 30.8–32.0 ms and three separately initialized sequential Workers at 68.3–88.6 ms. The correctness suite separately proves one active post, FIFO completion, queued cancellation, and active-cancellation recovery without timers.

Bitmap, MSDF, and Slug remain explicitly unavailable rather than returning fabricated measurements. Item 5.4 is complete with Node, Chromium, and GPU-enabled Vitexec evidence and no fabricated rendering metrics. The first real rendered font frame must land here in Milestone 6.

The initial deterministic browser probe is admitted with a checked-in record: 100 executions across 10 fresh GPU-friendly Chromium/Vite lifecycles, zero retries/failures, unique causal completion identities, and wrong-expectation plus withheld-completion negative controls. Probe exit status and every parsed lifecycle/environment field are validated before publication. Browser scripts navigate only through DOM readiness and then wait on the product's own completion promise or visible state; they do not use network-idle heuristics. Exact contract comparison rejects non-finite numbers, exotic objects, key-order differences, and missing or additional fields without JSON coercion. The current live probe also executes exact paragraph measurement, positioned-layout, bidi/policy, and CJK scenarios sequentially; the CJK probe fixes its composite hash and reports WebGPU active before the mobile Playwright surface runs on its own strict port. This proves a GPU-capable environment, not a rendered GPU workload before Milestone 6.

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
| `check:size` | Recompute package sizes without writing and reject a stale checked-in report. |
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
