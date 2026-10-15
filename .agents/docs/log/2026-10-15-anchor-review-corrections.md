---
type: Log Entry
title: 'Correct anchor publication, Wasm compatibility, and drop-cap references'
generated:
  by: process:docs-new
  at: '2026-10-15T05:43:01Z'
---

The follow-up source review of PR #308 identified gaps missed by the earlier green suite. Real regressions reproduced
inherited material rejection moving an accepted anchor (root/group, direct/indexed, same-frame/already-rejected/query-staged)
and the public initializer accepting a historical ABI 0 module with 76-byte semantic query records.

Three now records accepted presentation and order alongside the accepted anchor. The placement-only shortcut requires
those values to remain accepted and unchanged; failed candidates retain prior placement while live host transforms still
work. [Shaper ABI 1](../planning/decisions/shaper-abi-1.md) adds an enforced version bootstrap before initialization,
rejects historical/future revisions and shares only accepted modules for outline decoding. Its existing fatal
module-lifetime initialization contract is preserved. The `glyph:legacy-shaper-fixture` workflow records source revision and hash for the historical fixture.

The [layout-query contract](../planning/core-api.md#layout-query-values) now explicitly includes a dropped initial's
cap/x-height dimensions and provenance in its first logical line. Absolute top references use the initial's baseline;
body strut metrics and baseline spacing remain unchanged. The text-top dimension regression failed on the old build;
both text-top and baseline alignment are now checked. An obsolete raw-ABI test key `semanticsCount` had silently read
byte zero while the ABI version was zero; revision 1 exposed it, and the assertion now reads `semanticViewCount`.

The owning Glyph `check` passed with 1,010 package/integration tests, three core fuzz tests, the font-baker lanes,
Rust tests, strict source/emitted declaration checks, formatting, lint and Clippy. An independent four-file Node run
passed 41 tests covering anchoring, TypeGPU acceptance, module compatibility and drop-cap references. Docs validation
reported zero errors/warnings, and `git diff --check` passed. Exact-head GitHub CI remains the separate merge gate;
the older pasted review's dependency-cache failure had already been fixed before these correctness corrections.
