---
type: Attestation
title: '@pmndrs/glyph-benchmarks at fbee1126'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:fbee11269a8444d6ce21a9f814b5b4784918019f5e4b92c79a7912dbc190fa6a'
generated:
  by: process:docs-attest
  at: '2026-10-08T13:37:36Z'
---

Reviewed the Benchmarks concept against read-publication/cold workloads and the truncated-name report fix, combined with merged readGlyphs. Workload labels put count and schedule first; ambiguous report prefixes are preserved. Seventeen workflow tests, focused lint and original Labs types pass; combined build/types are running. The first full CI report timed out, so its budget is 90 minutes. Local results showed large edit/read costs but substantial clock drift; no clean full-matrix speed verdict is claimed.
