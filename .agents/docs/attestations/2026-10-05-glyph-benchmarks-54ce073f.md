---
type: Attestation
title: '@pmndrs/glyph-benchmarks at 54ce073f'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:54ce073fae6665b4edab75a48435d521f835a4bb2ac761a828c7c126697f9633'
generated:
  by: process:docs-attest
  at: '2026-10-05T18:15:55Z'
---

Removed the package-size gate: measure-package-sizes only prints unless --write, the benches test no longer runs --check, and the budget and freshness modules and tests are deleted; workflows.mts also indexes the OKF skill and .agents scripts. Reviewed benchmarks.md against the diff and corrected its claim that package size is a gate.
