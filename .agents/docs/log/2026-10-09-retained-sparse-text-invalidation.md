---
type: Log Entry
title: 'Derived sparse text invalidation in the retained Rust engine'
generated:
  by: process:docs-new
  at: '2026-10-09T14:02:17Z'
---

Public `Text.set` assignment continues through the existing one-record scalar-aligned UTF-16 mutation path. The
retained Rust engine now compares a same-length candidate with accepted text in packed two-unit scalar words, preserves
the identities of equal positions (including distant equal islands and repeated characters), and allocates identities
and internal edit ranges only for differing units inside the validated replacement interval. General sequential and
unequal-length mutation batches retain their existing splice semantics.

Those internal ranges allow Unicode reuse for proven ASCII-letter replacements and safe shaping-window splices. Each
window is derived during one logical-order traversal of retained HarfRust `UNSAFE_TO_CONCAT` flags, reshaped with full
source-run context, and accepted only when the new boundaries are also safe. Bounded and whole-run scopes use one
shaping/splice executor, and its pieces collapse back into one canonical shaped run for the next assignment; font
fallback uncertainty retains the full pipeline. Multiple dirty islands do not use the line-layout single-offset
convergence shortcut, avoiding stale suffix reuse.

Evidence includes a scalar oracle for the packed comparison, abort/retry identity checks, one-row public producer
regressions, a real-font test that reshapes five of 62 UTF-16 units for three distant changes, and deterministic warm
versus cold shaping, flow, and positioned output across ligatures, combining marks, concat-safe RTL, missing-glyph
fallback, surrogate pairs, insertions, and deletions. A 128-cluster/64-island regression records exactly 128 retained
cluster visits in LTR and RTL. This is an existing-vector retained delta, not a rope implementation or proof that word
comparison is faster; those decisions remain measurement work. See the
[`@pmndrs/glyph` package reference](../packages/glyph.md).

The public Three regression applies repeated complete strings through `Text.set`, publishes each warm result and a fresh
`Text`, and compares measurements plus every public semantic glyph and line column except retained glyph identities. Its
table covers safe-boundary Arabic RTL, Latin ligatures, combining marks, mixed bidi, surrogate replacements,
Inter-to-Amiri fallback entry and exit, length changes, and return assignments. A separate row rejects renderer material
realization after a sparse assignment, compares the still-queryable semantic result with a fresh publication, explicitly
retries, and compares again.

The public lifecycle regression also drives two sibling `Text` objects through expansion, sparse replacement, shrink,
surrogate, scalar, and layout assignments before measuring the unchanged constrained sibling. A reported stall was
isolated to an invalid test extension: expansion legitimately replaced the draw, and Node's failed object-identity
assertion attempted to format two unequal cyclic Three graphs. Bounded probes proved both sibling measurement and scalar
serialization had already completed; the standalone regression keeps only semantic comparisons and passes normally.

After rebasing onto main `7b845b30`, source revision `79537881` passed the named shaper library lane with 328 tests and
the two public assignment integration files with 85 tests. All four focused TypeScript source and emitted-declaration
projects passed, as did shaper rustfmt, strict all-target Clippy, focused Oxc checks, and all 17
`benchmark:workflow-check` cases including the `assignment` selector. The parent separately reported a successful full
Glyph build at this source revision. No post-rebase source correction was required. Package Labs, browsers, servers, and
profilers were deliberately not run here; the parent owns the serialized assignment benchmark lane.
