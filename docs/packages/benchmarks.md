---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:0b6d6835f06023d70221f4296b8c7833a7510befb46940cb21d603e13891106b"
tags: [package, benchmarks, react, vite, product-e2e]
sources:
  - id: manifest
    resource: ../../apps/benchmarks/package.json
    title: Package manifest
  - id: benchmark-plan
    resource: ../planning/benchmark-plan.md
    title: Benchmark plan
  - id: benchmark-ipsum
    resource: ../../apps/benchmarks/src/benchmark/benchmark-ipsum.ts
    title: Canonical benchmark ipsum corpus
generated:
  by: openai-codex/gpt-5.6
  at: "2026-07-26T11:15:30Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 first real bitmap font frame complete; framework-neutral Text object active

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, real portable-baker target, real public loader/Worker-fallback target, real HarfRust shaping-conformance target, real paragraph measurement/positioned-layout/policy/CJK targets, and the dual-backend TSL shader baseline. The runner disposes partial target state when loading fails, and the UI retains typed WebGPU availability through label and tone rendering. The interactive UI, browser headless CLI, Vitest, Vitexec, and Playwright all call the same strict registry execution module. Inter 4.1 remains the default fixture; Amiri 1.002 owns complex-script evidence; Noto Sans CJK JP 2.004 owns the maximum-cardinality universality lane. Each is immutable, licensed, hash-authenticated, and paired with checked HarfRust/HarfBuzz evidence. Chromium 149 passes all pre-render targets plus forced WebGL2 TSL compilation/readback with three deterministic samples after one warmup. The CJK result fixes thirteen corpus cases, four paragraphs, twelve layouts, eight plans, one direct shape call, four paragraph shape calls, zero reshapes, 10,622 output bytes, and the exact composite hash `a1a833f2:fbe2aa07:922f9a2e:8c977f4d:85a2f640:fd42b9f7:53d8ec89:8cb3050c:bbfd039d:837a2b43:2f450f5e:9900b4af:c49f3e68`; Vitexec repeats it with WebGPU active.

Roadmap item 6.0 uses only `WebGPURenderer` and the `three/webgpu` plus `three/tsl` exports. Direct calls to the installed public scalar TSL operators keep clean TypeScript 7.0.2 package and application checks at 0.18 and 0.17 seconds without type erasure or a dependency patch; method chaining and assigning the overloaded operator to a custom function signature are rejected as measured declaration-expansion hazards. The same graph produces the exact SHA-256 `fec0f57de0b19bc7dacb5b0fc3de7b56fc68dfdbeeebc8f9f4c506bf6e821c77` through an asserted WebGPU backend and forced WebGL2 fallback, three measured runs each after one warmup. The oracle rejects any non-red pixel, carries an intentional wrong-pixel negative control, and compacts the 256-byte row alignment retained by Three.js's WebGPU readback before comparing it with WebGL2's compact bytes. This is a real dual-backend shader workload, but the synthetic plane is intentionally not mislabeled as the first rendered font frame; item 6.1 owns that claim.

Every measured call receives its actual zero-based sample index; warmups remain outside the reported sample sequence. Controls reject invalid sample/warmup counts and non-finite, non-positive, or greater-than-4 DPR before target loading. The existing 1×/2× scene buttons now select the actual renderer density, initialize from the user's display class, and invalidate stale results. Automated probes and the headless CLI always pass DPR explicitly. Successful summaries include the V0 schema marker and exact controls, so timings, framebuffer bytes, and pixels cannot be compared without their density. The deterministic headless lane runs its cases sequentially through one Chromium/Vite session while opening an isolated page for each case; explicit readiness, launch, navigation, and execution deadlines identify a stalled lifecycle without using time as a readiness signal.

The independent package-size lane measures the initial public browser graph, lazy font validator, runtime Worker boundary, baker and shaper JavaScript/Wasm, and Unicode 17 analysis without zero-byte placeholders. Static entry closures and dynamic chunks are separated from Rollup metadata rather than conflated, and package-owned Wasm URLs are externalized from JavaScript measurements regardless of their owning package. The report records its measurement platform and architecture. Same-host regeneration is exact; every foreign-host raw/minified/gzip/Brotli result must satisfy the shared reviewed budget table because native Rust/Binaryen and Rolldown output has small cross-architecture byte variance. The current Darwin arm64 record reports a 211,127 minified / 62,751 gzip / 47,995 Brotli browser graph and an independently measured 139,912 / 42,042 / 31,048 Unicode analysis graph. The validator, runtime host, runtime Worker JavaScript, portable baker JavaScript, baker Wasm, shaper JavaScript, and shaper Wasm report 584,255, 3,831, 8,968, 6,641, 433,755, 30,630, and 692,114 minified/raw bytes respectively. The reviewed Worker increase buys explicit FIFO admission, queued/active cancellation recovery, and entry-side serialization; the reviewed shaper increase buys fallible result assembly, arena publication, and a 64-plan per-font LRU bound. Paragraph layout hashes and the policy composite hash share one implementation over the actual normalized layouts; the generator, benchmark target, unit tests, and Vitexec probes no longer maintain parallel digest logic.

The local Worker-queue Vitexec probe authenticates every output and reports observations rather than asserting machine-sensitive timing. Two Chromium runs measured a three-font queued burst at 30.8–32.0 ms and three separately initialized sequential Workers at 68.3–88.6 ms. The correctness suite separately proves one active post, FIFO completion, queued cancellation, and active-cancellation recovery without timers.

Item 6.1 replaces the bitmap placeholder with the harness's first real rendered font frame. A checked-in 927,148-byte composed Inter GLB loads through the public registry, shapes and positions the canonical benchmark ipsum through HarfRust and the paragraph engine, decodes its embedded R8 KTX2 page, uploads 695,296 atlas bytes, and renders 120 visible glyphs in one instanced draw. The selected 16 px strike is now public batch metadata. Both the live viewport and captured target distinguish CSS size from physical render size and hold the image at `renderedPpem / strikePpem = 1`; at 2× DPR this means 8 CSS px produces 16 device pixels. The screen-space ladder owns intentionally scaled samples and must label both sizes and the resulting quality-loss ratio. The canvas stays transparent over the optional design-token grid, while grid-off reveals the solid design-token panel. The shared readback normalizer removes WebGPU row padding and reverses WebGL's bottom-left row order. A fresh GPU Vitexec pass produced 2,659 half-coverage ink pixels on both backends at both DPRs; 1× bounds were `[69, 20, 313, 110]` and 2× bounds were `[261, 84, 505, 174]` in their respective physical framebuffers. WebGPU/WebGL2 edge coverage differed by only 16 pixels, within the two-percent environment-qualified tolerance. Framebuffer bytes are 196,608 at 1× and 786,432 at 2×; total tracked bytes are 891,904 and 1,481,728. Determinism, zero missing glyphs, exact strike/scale, clipping rejection, empty-output rejection, draw count, and GPU-memory contracts remain hard gates. Item 6.2 now owns the framework-neutral `Text` object; MSDF and Slug remain explicitly unavailable.

### Benchmark ipsum corpus

The corpus is an executable fixture, not display copy. Its five lines isolate ordinary Latin rhythm, numerals, kerning pairs, punctuation, standard ligature candidates, and compact mathematical notation. Inter must shape every scalar without glyph 0; the renderer rejects the corpus before upload if coverage regresses.

| Lane | Canonical text | Primary signal |
| --- | --- | --- |
| Latin | `Lorem ipsum dolor sit amet.` | Common word rhythm and spacing |
| Numerals | `Hamburgefontsiv 0123456789.` | Mixed round/stem forms and tabular sequence |
| Kerning | `AVATAR To Wa Yo — “quotes”.` | Strong kerning pairs and punctuation |
| Ligatures | `ff fi fl ffi ffl; (brackets).` | Standard Latin ligature substitutions |
| Mathematics | `x²+y²≈z²; 0≤α≤1; ±×÷∞√∑π→←.` | Superscripts, Greek, relations, operators, and arrows |

Milestone 7.2 owns a product-facing advanced-shaping showcase over this same rendering path. It will make Arabic joining, Indic reordering, bidi, ligatures and marks, and CJK line breaking visible while text streams in and the container continuously reflows. Glyphs may interpolate between proven layouts, but shaping and line breaking remain discrete authoritative states. Pause, step, and scrub controls provide deterministic transition points for Vitest, Vitexec, and visual evidence without sleeps or timer tolerances.

The initial deterministic browser probe is admitted with a checked-in record: 100 executions across 10 fresh GPU-friendly Chromium/Vite lifecycles, zero retries/failures, unique causal completion identities, and wrong-expectation plus withheld-completion negative controls. Probe exit status and every parsed lifecycle/environment field are validated before publication. Browser scripts navigate only through DOM readiness and then wait on the product's own completion promise or visible state; they do not use network-idle heuristics. Exact contract comparison rejects non-finite numbers, exotic objects, key-order differences, and missing or additional fields without JSON coercion. The current live probe executes the exact TSL graph on asserted WebGPU and forced WebGL2 backends before paragraph measurement, positioned-layout, bidi/policy, CJK, and mobile Playwright flows. This proves a real GPU shader workload while reserving the rendered-font claim for item 6.1.

## Package scripts

| Script | Purpose |
| --- | --- |
| `dev` | Build the baker dependency and start the Vite application. |
| `typecheck` | Build the baker dependency and type-check browser and Node script projects. |
| `test` | Run deterministic Vitest suites and the shared-registry browser smoke test. |
| `test:unit` | Run deterministic Vitest suites without starting a browser. |
| `test:headless` | Run synthetic, forced-WebGL2 TSL, direct-baker, loader/Worker, exact shaping, paragraph measurement, positioned-layout, bidi/policy/uikit, and CJK scenarios through one bounded browser conformance session. |
| `lint` | Run Oxlint with warnings denied. |
| `format:check` | Verify Oxfmt output. |
| `size` | Produce deterministic independent package-size JSON for the report UI. |
| `check:size` | Recompute package sizes without writing; require exact same-host freshness and enforce complete reviewed foreign-host budgets. |
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
