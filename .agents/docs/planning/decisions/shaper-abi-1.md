---
type: Decision
title: 'Reject incompatible shaper Wasm modules before initialization'
description: 'Use an enforced ABI 1 bootstrap for the expanded semantic query record; reject older or newer modules at initialization.'
decision_status: Accepted
decided: '2026-10-15'
generated:
  by: process:docs-new
  at: '2026-10-15T05:43:01Z'
---

# Reject incompatible shaper Wasm modules before initialization

## Decision

The shaper ABI is revision 1. Its fixed bootstrap export `pmndrs_glyph_shaper_abi_version()` returns the same Rust
`ABI_VERSION` that generates the TypeScript wire contract. The module loader checks exact equality before calling
`initialize`, registering fonts, sharing a module for outline decoding, or exposing an engine. Missing version exports
identify an unsupported unversioned module; a different numeric revision is incompatible. Both cases reject the
initialization promise with the expected and observed compatibility information. The existing fatal initialization contract remains: replacing the runtime
module is necessary after a failed `glyph.init()`.

## Why

Typographic references expand semantic query records from 76 to 84 bytes. An older module previously passed
initialization because revision 0 was unchanged and never checked at bootstrap. The new reader could then reject its
shorter query publication after initialization, too late to diagnose the caller-supplied module mismatch clearly.
The [version contract](../version-contract.md) requires a revision, compatibility decision, and old/new fixture evidence.
A real pre-anchor module built from `d7ffcbbdc5a38635604570f76395005e2d195d9a` reproduces the missing rejection;
[compatibility coverage](../../../../packages/glyph/tests/integration/shaper-compatibility.test.mjs) exercises its bytes
and compiled-module forms, a future-version module whose initializer traps, and matched-head measurement/inspection.

## Consequences

Revision 0 modules are deliberately unsupported by the new JavaScript runtime. Consumers overriding `wasm` must
replace the JavaScript and Wasm as a matched pair. No compatibility decoder or negotiation fallback is added.
The revision also appears in existing request/result envelopes, so request parsers continue rejecting mismatched wire
revisions. Font artifact format 0 and all raster-baker ABI versions are unchanged. Render/Codec record sizes do not grow.
The package-owned `glyph:legacy-shaper-fixture` workflow rebuilds the historical fixture and records its source revision
and SHA-256; the current built module supplies the new-version fixture.
