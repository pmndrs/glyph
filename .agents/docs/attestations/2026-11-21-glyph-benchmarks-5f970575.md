---
type: Attestation
title: '@pmndrs/glyph-benchmarks at 5f970575'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:5f9705750e5bdd3c6a16d31a119499714198156e22c91334ac6ea751b19411e0'
generated:
  by: process:docs-attest
  at: '2026-11-21T18:06:09Z'
---

Benchmark Vite config scans only top-level \*.html for optimizeDeps so a stray nested tree cannot pre-bundle a second Glyph/Three. Checked: benchmark:typegpu-parity and benchmark:v1-bitmap (both backends, --typegpu) pass on a fresh dependency cache; pnpm check.
