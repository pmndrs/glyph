---
type: Attestation
title: '@pmndrs/glyph-benchmarks at c67d088e'
description: 'Contributor intent for @pmndrs/glyph-benchmarks, awaiting verification.'
package: '@pmndrs/glyph-benchmarks'
concept: 'packages/benchmarks.md'
source: 'sha256:c67d088e2c2e2177918aff8d30e6c299d19877d6c426774359c29b63cc814530'
generated:
  by: process:docs-attest
  at: '2026-10-08T11:54:33Z'
---

CI reached example live checks after passing the core package and browser conformance, then failed because Vitexec attempted a Playwright browser download denied by the CDN with regional HTTP 403. Added benchmark:with-browser and wrapped the example CI check so Vitexec connects to the already selected system Chromium. Verified script TypeScript, lint/format, 16 workflow registry tests, and a real Chrome connection/cleanup through the wrapper. Browser automation infrastructure is separate from the project server.
