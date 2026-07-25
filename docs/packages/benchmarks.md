---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:04600f37fd4786daa2278cd5da2477a57902ad558d4d0ae3a4739af28c881cc3"
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
  at: "2026-07-25T12:12:44Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 usable harness shell; rendering targets not implemented

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, real portable-baker target, real public loader/Worker-fallback target, real HarfRust shaping-conformance target, and real paragraph measurement/positioned-layout/policy targets. The interactive UI, browser headless CLI, Vitest, Vitexec, and Playwright all call the same strict registry execution module. Inter 4.1 remains the default benchmark fixture. Amiri 1.002 is the immutable complex-script fixture: its font, metadata, and OFL bytes are retrieved from one Google Fonts commit by a hash-enforcing synchronizer, and its checked HarfRust oracle matches the exact-version HarfBuzz 13 oracle across every glyph field. A local font is an explicit override only where a fixture oracle exists. Before timing loader fallback, the browser target hashes the actual module-Worker GLB against the canonical Node artifact and validates/registers it. Chromium 149 passes synthetic, direct-baker, loader-Worker, eight-case one-call shaper, paragraph-measurement, positioned-layout, and bidi/policy/uikit scenarios with three deterministic samples after one warmup. The checked shaping result records exact hash `dc30c21c`, 97 glyphs, one boundary crossing, three plans, retained/Wasm memory, and cold/warm timings. Measurement records hash `79874b9d`, exact natural/wide/narrow HarfRust-derived metrics, one preparation shape, zero reflow/reshape calls, and zero positioned-glyph bytes. Positioned layout records normalized hashes `bb15bbcc:4f111a3f:e8c0e9d5`, 165 glyph instances across three layouts, and one batched reshape call for each changed width. The item-5.3 lane fixes two complete Amiri bidi layouts, nine Inter line-policy layouts, and one current-uikit-shaped layout under twelve portable hashes; its aggregate output is 8,098 bytes with four preparation shapes, five batched reshapes, and WebGPU-active Vitexec parity.

The independent package-size lane measures the initial public browser graph, lazy font validator, runtime Worker boundary, baker and shaper JavaScript/Wasm, and Unicode 17 analysis without zero-byte placeholders. Static entry closures and dynamic chunks are separated from Rollup metadata rather than conflated. The current browser graph is 209,191 minified bytes; Unicode analysis is independently 139,752 minified / 41,999 gzip / 31,018 Brotli bytes. The validator, runtime host, runtime Worker JavaScript, baker Wasm, shaper JavaScript, and shaper Wasm report 584,124, 3,506, 5,664, 434,045, 30,406, and 691,484 minified/raw bytes respectively. Paragraph layout hashes and the policy composite hash share one implementation over the actual normalized layouts; the generator, benchmark target, unit tests, and Vitexec probe no longer maintain parallel digest logic.

Bitmap, MSDF, and Slug remain explicitly unavailable rather than returning fabricated measurements. The first real rendered font frame must land here after its loader, shaping, paragraph, and bitmap dependencies close.

The initial deterministic browser probe is admitted with a checked-in record: 100 executions across 10 fresh GPU-friendly Chromium/Vite lifecycles, zero retries/failures, unique causal completion identities, and wrong-expectation plus withheld-completion negative controls. The current live probe also executes exact paragraph measurement and positioned-layout scenarios sequentially, checks portable hashes and boundary-call metrics, and then runs the mobile Playwright surface on its own strict port. The record reports WebGPU availability while explicitly declining to claim a GPU workload before rendering lands.

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
| `sync:amiri-fixture` | Fetch the immutable Amiri font/metadata/license or verify checked-in bytes with `--check`. |
| `generate:paragraph-bidi-contract` | Regenerate the reviewed Amiri/Inter bidi, line-policy, and current-uikit-shaped exact layout contract. |
| `check:paragraph-bidi-contract` | Recompute the contract without writing and fail if any checked-in exact value is stale. |

The [benchmark plan](../planning/benchmark-plan.md) owns target admission, correctness-before-timing, and product-E2E requirements.[^benchmark-plan]

[^benchmark-plan]: Local GPU evidence supplements rather than replaces deterministic CI-safe checks.
