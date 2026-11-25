---
type: Attestation
title: '@pmndrs/glyph-benchmarks at 466a82ac'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:466a82ac56b54ae596f875775b37ae2410fc10d6b1de84ca69937e1e2fa5d707'
generated:
  by: process:docs-attest
  at: '2026-11-25T02:17:59Z'
---

Removed HarfBuzz provisioning, vendoring, bundle tests, hb-shape oracle generator, LFS bundles and the CI step; froze the Japanese showcase subset behind an authentication check (bytes unchanged); corrected the TypeGPU Bitmap parity rationale. Checked: benches package tests, benchmark:bake-check, fixture:japanese-showcase:check (plus two negative controls), fixture:paragraph-contracts:check, benchmark:typegpu-parity, benchmark:pixi3d-parity, benchmark:v1-bitmap (and --typegpu), all with trap hb-\* executables first on PATH that were never invoked.
