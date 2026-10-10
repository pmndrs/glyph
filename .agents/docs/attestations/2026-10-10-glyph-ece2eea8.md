---
type: Attestation
title: '@pmndrs/glyph at ece2eea8'
description: 'Contributor intent for @pmndrs/glyph, awaiting verification.'
package: '@pmndrs/glyph'
concept: 'packages/glyph.md'
source: 'sha256:ece2eea82c64200f600a34f70e37fc5e839ba195f40188393f9e2709efd724df'
generated:
  by: process:docs-attest
  at: '2026-10-10T22:24:21Z'
---

Reviewed #299 query-first placement and independent-copy lifecycle. Shared copy selection and detached metadata use the same prepared identities across sibling queries; pending copies use desired draw order with retained batch offsets. Warm semantic reads reuse their controller. Build, types, lint and 970 Node tests pass; exact-head CI/Labs and external review remain gates before merge.
