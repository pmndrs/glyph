---
type: Attestation
title: '@pmndrs/glyph-benchmarks at 8050b562'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:8050b56203e2c12930f12c566fb73c22ce4f6ebf1a0001cdaa33663d2694011d'
generated:
  by: process:docs-attest
  at: '2026-10-09T04:51:52Z'
---

Removed the agent-only Portless requirement from retained-upload verification. Package code now optionally detects PORTLESS_URL and otherwise preserves the existing local-origin flow, with no Portless dependency. Changed script types, lint and format pass; this only changes server-origin selection.
