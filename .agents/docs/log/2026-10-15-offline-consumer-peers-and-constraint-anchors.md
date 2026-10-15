---
type: Log Entry
title: 'Pin offline consumer peers and verify constrained anchors'
generated:
  by: process:docs-new
  at: '2026-10-15T04:50:50Z'
---

The isolated packed-consumer install no longer lets `suspend-react`'s broad required React peer resolve to a version
absent from the frozen workspace cache. CI selected React 19.2.9 from registry metadata while the lock provisions
19.2.8. Its generated dependency manifest now requests that exact provisioned version. Installed-package Labs shares
the same core dependency manifest. The install remains offline; there is no retry, peer-disable switch, or online
fallback. The tooling test checks that the peer pin matches the installed workspace React version. See the
[benchmark contract](../packages/benchmarks.md).

Focused anchor regressions prove at-most shrink-to-content centering uses the resolved width, wrapping updates the
last-baseline reference, and an exact-height box retains paragraph spacing in its content metrics while geometric
anchors use the fixed box. This extends the [anchor decision](../planning/decisions/typographic-references-and-box-anchors.md)
without changing source or shallow composition semantics.

The focused anchor/tooling suite passes 31 tests, and the offline packed consumer passes real Chromium Worker artifact
parity. Script TypeScript, lint and formatting checks also pass.
