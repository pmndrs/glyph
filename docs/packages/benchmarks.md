---
type: Workspace Package
title: "@pmndrs/text-benchmarks"
description: Provides the shared interactive and automated benchmark product surface.
resource: ../../apps/benchmarks
workspace_package: "@pmndrs/text-benchmarks"
documentation_type: reference
source_digest: "sha256:d1fd15993813e95358fbf4c2ecf5808f155b9f3dae2ade9c759b582909627e30"
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
  at: "2026-07-25T01:15:06Z"
---

# Package reference: `@pmndrs/text-benchmarks`

Status: 🟡 usable harness shell; rendering targets not implemented

This application owns the shared target/scenario runner, responsive Figma-backed interface, URL state, validation/report/export views, deterministic synthetic target, and real portable-baker target. React 19, React Compiler, Tailwind semantic tokens, Oxlint, Oxfmt, Vitest, Vitexec, and Playwright form its application and verification stack.

Bitmap, MSDF, and Slug remain explicitly unavailable rather than returning fabricated measurements. The first real rendered font frame must land here after its loader, shaping, paragraph, and bitmap dependencies close.

## Package scripts

| Script | Purpose |
| --- | --- |
| `dev` | Build the baker dependency and start the Vite application. |
| `typecheck` | Build the baker dependency and type-check the application. |
| `test` | Run deterministic Vitest suites. |
| `lint` | Run Oxlint with warnings denied. |
| `format:check` | Verify Oxfmt output. |
| `test:live` | Run the explicit maintainer-local Vitexec and Playwright product probes. |

The [benchmark plan](../planning/benchmark-plan.md) owns target admission, correctness-before-timing, and product-E2E requirements.[^benchmark-plan]

[^benchmark-plan]: Local GPU evidence supplements rather than replaces deterministic CI-safe checks.
