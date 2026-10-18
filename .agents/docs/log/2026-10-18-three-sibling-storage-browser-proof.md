---
type: Log Entry
title: 'Direct browser proof of Three sibling storage survival'
generated:
  by: process:docs-new
  at: '2026-10-18T17:18:29Z'
---

The [Three integration](../packages/glyph.md#ownership) keeps Codec and transform storage shared across automatic sibling
`TextGroup` draws. Published Three 0.186.1 can destroy a live sibling's GPU buffer when it disposes the geometry of a
removed group. PR #317 detaches storage still owned by the root before that geometry disposal; the existing Node test
checks the attachment topology. The named `benchmark:three-storage-lifetime` browser workflow now also has a direct
`--scenario=sibling` regression proof through the packaged Glyph runtime.

The proof uses two real automatic groups in one scene and one persistent Chromium renderer. It renders B alone to an
RGBA reference, reveals and renders A+B, proves two draw meshes share a `_pmndrsGlyph*` attribute, then removes only A.
It records A's geometry-disposal event, verifies B keeps the same draw and attribute, and renders B again. `renderAsync`
and render-target readback establish completion without frame delays. The pre-fix negative mode accepts only a diagnostic
about destroyed buffer/storage or changed readback after the shared-draw checks; unrelated browser and render errors fail.

On exact base `4e25a96a57462fef5ad0d19065a822695b480f60`, packaged Glyph SHA-256
`bbb3375c08fb3db8186ec10e4b766b7170632f7601eb1ec0e90be0197f22eb20`, published Three 0.186.1 WebGPU
reported `[Buffer (unlabeled)] used in submit while destroyed` after A retired with the shared attribute still
attached. B's 2,721-lit-pixel reference did not return: the stale framebuffer still showed the 5,493-lit-pixel A+B
image. With the current PR runtime at `391aebd920870afd17529d610974902cd7407b53`, packaged SHA-256
`926aee67b36ea35e0814a5b2f59576e56ec6a40b5155be0ad5962fba635c65be`, A's attribute was detached at
disposal, B kept its draw and shared attribute, its 2,721-pixel RGBA image matched byte-for-byte, and browser errors
were zero. WebGL2 returned the same B image for both packages. The exact published Three archive SHA-256 was
`8cd068708ea44f2c73c944b1cead2ba2f0d5c15c8fc194e5700f4e4f4a033fe7` in both runs.

The two harness files passed targeted Oxfmt, both benchmark TypeScript projects, Oxlint, and the named browser workflow
for both packages. This is correctness evidence for the original sibling failure and its repair; it is not a timing or
full-suite performance measurement. The [final-owner compatibility repair](./2026-10-18-three-final-owner-storage-compatibility.md)
has a separate persistent-renderer lifecycle proof. No production API, dependency, fixture, or golden changed here.
