---
type: Implementation Plan
title: Glyph alpha merge and fast-follow handoff
description: Disposable next-agent prompt for closing the GlyphConfig pull request and implementing the deferred Rust and TypeScript production-review findings.
documentation_type: explanation
tags: [glyph, alpha, fast-follow, rust, typescript, review, cleanup]
status: draft
sources:
  - id: glyph-config-contract
    resource: core-api.md
    title: Glyph integration API
  - id: engineering-standard
    resource: ../engineering/code-style.md
    title: Engineering standard
  - id: glyph-config-pr
    resource: https://github.com/pmndrs/glyph/pull/148
    title: GlyphConfig API pull request
  - id: opus-review-target
    resource: https://github.com/pmndrs/glyph/commit/2992aeddf614f4780d7ad56896c248938682110d
    title: Commit reviewed by the TypeScript production-readiness review
  - id: rust-audit
    resource: https://github.com/pmndrs/glyph/blob/64f0f68a55a879523e283e607c1b2c70cde41132/.agents/docs/planning/rust-audit.md
    title: Rust audit findings
  - id: rust-audit-systems
    resource: https://github.com/pmndrs/glyph/tree/64f0f68a55a879523e283e607c1b2c70cde41132/.agents/docs/reports/rust-audit-2026-09/systems
    title: Rust per-system reviews
  - id: rust-audit-measurements
    resource: https://github.com/pmndrs/glyph/blob/64f0f68a55a879523e283e607c1b2c70cde41132/.agents/docs/reports/rust-audit-2026-09/measured-facts.md
    title: Rust audit measurements and inference boundary
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-04T05:11:00Z'
---

# Glyph alpha merge and fast-follow handoff

This file is disposable execution state, not permanent architecture. Delete
`.agents/docs/planning/api-alpha-fast-follow.md`, remove its planning-index entry, and add a completion entry to the OKF
log after every accepted item below is implemented and verified. Do not retain this file as historical guidance.

PR #148 should land the coherent GlyphConfig API before the broader fast-follow work begins. None of the review findings
below are accepted merely because a reviewer reported them. Re-locate every symbol and validate every claim against
remote `main` after #148 merges. Present the validated findings, proposed edits, and verification plan to the maintainer
and wait for approval before changing production code.

## Prompt for the implementation agent

```text
Finish the pmndrs/glyph alpha release work around PR #148, then execute its approved fast follows. First inspect the PR
and remote default branch rather than assuming whether #148 is still open or has merged.

If #148 is still open, finish only these merge checks:

1. Confirm the branch is clean, synchronized with origin, and all three CI checks are green. At commit
   90d8909cf82c4f51b407c5221e3f57d8ae070a09, Static checks, Package size report, and Check were green.
2. Confirm the canonical local `mise exec -- pnpm check` evidence. It completed successfully outside the sandbox at the
   commit above; its Playwright Chromium launch requires macOS Mach bootstrap permission. Do not treat that sandbox
   denial as a product failure.
3. Keep the already-running Portless benchmark available at
   https://glyph-config-api.glyph-benchmarks.localhost:1355/ for the maintainer's final manual pass. Do not launch a
   duplicate server when the hostname is already owned by the existing process.
4. Read the current PR body before editing it. Remove the stale sentence that calls the PR a draft, mention the optional
   Glyph-only error fallback and caller-controlled `dismiss`, and add `Closes #113` because the public Three bounding-box
   behavior and regression tests now prove that issue. Do not claim to close #101, #121, or #154. #121 tracks rich-text
   draw coalescing; #154 tracks long-paragraph reflow cost.
5. If the final manual benchmark is accepted and no diff changes, do not rerun hours of already-green evidence. Leave
   merging to the maintainer unless explicitly asked to merge.

The pre-merge evidence already recorded for this exact branch includes the 54-cell Bitmap/MTSDF/Slug WebGPU/WebGL2
presentation pass, the hardware WebGPU performance pass with zero slow frames, package-size generation and checking,
Knip classification, improved Fallow mild/weak duplication measurements, OKF 0/0/0 validation, and green CI. Preserve
that evidence; rerun a gate only when a subsequent change can invalidate it.

After #148 merges, start the production-readiness fast follow from the current remote default branch. Do not resurrect
any pre-GlyphConfig API, public loader, backend, Policy, planner, decoder-factory, session, FontLibrary, or
renderer-specific core path. The application API remains glyph.init(), glyph.fontFace(), FontFace.load(),
glyph.handle(name, GlyphConfig), glyph.shape(), Text, TextGroup, roots, Codec encode, the trusted internal projection,
CommandBufferView, DisplayList, and renderer decode. Integrators must have the same public GlyphConfig/config-leaf tools
used by Three and the example renderer.

Before editing, read this brief, .agents/docs/engineering/code-style.md, .agents/docs/planning/core-api.md, and the Rust
audit at commit 64f0f68a55a879523e283e607c1b2c70cde41132. Read the audit in this order:

1. .agents/docs/planning/rust-audit.md
2. .agents/docs/reports/rust-audit-2026-09/systems/sys-*.md
3. .agents/docs/reports/rust-audit-2026-09/codex/*.md
4. .agents/docs/reports/rust-audit-2026-09/measured-facts.md

Re-locate findings by symbol because line numbers target an older commit. Treat speculative findings as leads only. Use
the repository AST-facts workflow for structural Rust claims rather than grep. Validate findings against current main,
summarize the exact accepted work and evidence plan for the maintainer, and wait for approval before implementation.

Land Rust work in coherent, reviewable follow-up PRs. Prioritize:

1. R0: prevent baker re-entry across progress callbacks once in a shared Wasm ABI boundary, with an executable
   synchronous re-entry regression test.
2. R3: refuse disposal of an in-use font binding and prove the status mapping.
3. R5: repair the chunk-64 trailing-space accounting and add the missing 63/64 boundary case.
4. R2: first add the D-261 oracle coverage for stable-indirect, then make fallible batch publication transactional.
5. R4: remove unsafe from the sixteen safe ABI exports, document real safety contracts for the remainder, and make the
   Wasm ABI visible to a non-vacuous lint gate.
6. Validate and triage the medium-confidence system findings; do not bulk-apply speculative advice.

Preserve the Rust house laws: data-oriented SoA arenas; no Arc/Rc/RefCell/Cow without measured need; zero steady-state
allocation; no runtime validation in hot loops; iterator-shaped bounds-check elision instead of unchecked indexing;
panic-free production code; the measured per-crate optimization profiles; generated ABI layout; and scalar-only Wasm C
ABI calls. Do not split state.rs for line count, delete stable-indirect for bytes, or compare performance artifacts built
from different sources or flags.

The completed TypeScript production review already fixed GLY-001 (failed Blob reads poisoned the FontFace source cache)
and GLY-002 (speculative nested React font prefetch could reject unobserved). Do not redo them. Revalidate these remaining
findings against post-merge main:

- GLY-003: internal render-planner acceptance may duplicate validation and allocation over trusted package output.
- GLY-004: ThreeCodec may erase its associated resource type and use a runtime authenticity WeakMap to compensate.
- GLY-005: the command buffer may lack an unchanged-draw-list signal, forcing unnecessary replacement work.
- GLY-006: helper signatures may restate SelectedGlyphConfig instead of propagating its associated types.
- GLY-007: measurement may perform repeated ancestor walks or otherwise approach O(N^2).
- GLY-008: an aligned-block Rust invariant may belong in debug/test proof rather than production work.
- GLY-009: Three traversal may swallow glyph.shape() errors.
- GLY-010: exact-denied Three leaves and wildcard exports may need a simpler, documented organization.
- GLY-011: package-size evidence and prose budgets may have unnecessary slack.
- GLY-012: the README quick start may load all raster formats when a narrower example is clearer.
- GLY-013: satisfies-only statements may be tautological rather than useful type tests.
- GLY-014: retired plan/Policy vocabulary may remain in live names, ABI names, tests, or current docs.
- DQ-001: decide whether a rejected glyph.init() is intentionally terminal or explicitly retryable.
- DQ-002: determine whether two private React bridge mechanisms are both necessary.
- DQ-003: bring remaining complexity outliers under the repository ceilings through clearer design, not helper noise.
- DQ-004: remove any React public-component cast that repairs an erased implementation type instead of preserving
  inference through the actual generic function.
- SL-001 through SL-004 were speculative leads; trace them end to end before reporting them as defects.

Type erasure means discarding a known associated type and later recovering it through Any* aliases, unknown-backed
registries, broad casts, authenticity maps, or repair casts. Remove that pattern. Do not misclassify legitimate unknown
values at public error, JSON, Worker, or third-party callback boundaries as type erasure. Types do not add shipped JS
bytes; package and exact config-leaf exports provide runtime boundaries.

Classify validation by author. Validate caller-authored and genuinely external input once. Trust package-owned
TypeScript, Rust, baker, serializer, Worker, and Wasm output after memory-safety and work bounds. Move deep internal
consistency checks into producer, unit, ABI, property, fuzz, and real product tests instead of repeatedly shipping them in
the runtime. Remove one internal check, strengthen the producer proof that makes its invalid state unreachable, run the
focused test, then proceed. Do not add public API merely to satisfy a test or script.

For every accepted change, use a small Conventional Commit whose message names whether the evidence is measured or
reasoned. Run focused tests first. Any command-buffer, display-list, shaping, allocation, or hot-path change requires a
same-session A/B benchmark against identical source and flags; report compressed size deltas, not raw-only numbers. End
with Glyph, declaration/type fixtures, Three/R3F twins, example renderer, benchmark tests and live draw probes, Knip,
Fallow, package size, docs:check, and CI green. Push through gh stack.

When every accepted item is complete, delete this implementation brief, remove its planning-index link, update affected
canonical OKF concepts and the log, run docs:update and docs:check, and commit the deletion with the final evidence.
```

## Exit condition

The fast follow is complete only when the maintainer-approved findings are either fixed with evidence or explicitly
closed with documented counter-evidence, all gates are green, and this disposable brief has been deleted.
