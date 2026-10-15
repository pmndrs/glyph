---
type: Log Entry
title: 'Preserve anchored split local coordinates and pivot'
generated:
  by: process:docs-new
  at: '2026-10-15T12:44:58Z'
---

The anchored split previously copied `Msource * Aanchor` into its container. Initial glyph world positions matched,
but this shifted the container's local origin and pivot. With a public Blob-backed FontFace, matching local rotation,
scale or both on source and sibling split caused visible world drift in direct and indexed modes; omitted-anchor and
translation-only controls stayed aligned. This corrects the implementation described by the
[earlier coordinate clarification](2026-10-15-anchor-coordinate-contract.md).

Detached roots now copy exactly the source local transform. Glyph instance matrices and measurements include the
captured anchor; raw GPU pen pivots remain unchanged for the existing instance setter compensation. Initial instance
GPU matrices apply the anchor once. Decorations apply that same captured offset inside their existing renderer-owned
transform. This adds no child object, draw, query, setter multiply or shader operation. Zero-anchor initialization stays
identity, and later source edits cannot change the captured content.

The [Three contract](../planning/three-api.md#measure-desired-layout-and-inspect-positioned-glyphs) and concise public
TSDoc distinguish paragraph-local (+X right, +Y down, unanchored), native owner-local Three (+X right, +Y up, anchored),
logical Text-local (+X right, +Y down, anchored), and world coordinates. Glyph-local geometry and em-space outlines remain
separate from owner-local measurements. Callers need neither world conversion nor manual anchor handling for a sibling
swap. The new public regression covers local/world transforms, rotation/scale, GPU instance storage, setters,
decorations and source independence; all six anchored variants fail on the previous artifact while all six omitted-anchor
controls pass.

The installed-package `benchmark:labs-package --suite glyphs --blocks 8` comparison used a control rebuilt from the
previous `08e8470a` Three modules with the same pinned emitter and unchanged candidate package/Wasm. Only the four
reviewed runtime JS modules differ; all five Wasm modules are byte-identical. The default one-label split workload was
neutral (p50 1.42 to 1.39 ms); the split among 1,000 labels improved (3.44 to 3.13 ms, -8.8%). Every initialized default
instance GPU matrix remains identity in the direct/indexed regression, and matrix setters add no new work.

The broader twelve-workload sample reported three faster, one slower and eight neutral. Edited sparse borrowing, which
uses none of the changed split/bounds paths, measured 302 to 357 microseconds (+18%). The control CPU clock drifted 47.3%
and the candidate 6.3%; these data support the bounded split result, not an overall performance-improvement claim.

Validation: the focused anchors/placement/bounds lane passed 71 tests. The owning `mise exec -- pnpm --filter
@pmndrs/glyph check` completed successfully, including the 1,026 package/integration Node tests, additional fuzz/baker
suites, generated-artifact checks, Rust tests, public declarations, TypeScript, lint, formatting and strict Rust checks.
The earlier focused negative control failed all six anchored motion variants while all six omitted-anchor variants passed.
