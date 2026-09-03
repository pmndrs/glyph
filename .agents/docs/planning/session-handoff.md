---
type: Explanation
title: Session handoff
description: The decisions, corrections, and open questions from the API hardening session, recorded so the reasoning survives the context that produced it.
tags: [handoff, api, measurement, benchmarks, contract]
sources:
  - id: audit
    resource: api-surface-audit.md
    title: API surface audit
  - id: contract
    resource: ../../../.agents/skills/engine-call-contract/SKILL.md
    title: Engine call contract
  - id: benchmarks
    resource: benchmark-trust.md
    title: Benchmarks we can trust
generated:
  by: openai-codex/gpt-5
  at: '2026-08-24T03:12:27Z'
---

# Session handoff

Written because the reasoning below cost a long session to reach and is worth more than the diffs it produced. The plan of record is the [API surface audit](api-surface-audit.md); this page holds what that document assumes.

## The contract every engine call follows

Codified in `.agents/skills/engine-call-contract/SKILL.md`. Two rules:

**A call answers, or it throws where it was written.** No result union for a failure the caller cannot cause, no persistent broken state that outlives the call. A throw is the caller's arithmetic; a persistent failure is our defect; neither is a return value. This was reached by getting it wrong twice — a latch that made a rejected frame recompile forever, and a `{ ok }` union on measurement that made every caller guard a branch meaning "glyph is broken."

**A type an application can encounter lives at the root; a thing only an integrator constructs lives in `/core`.** `ParagraphMeasurement` at the root, `Paragraph` in `/core`. The two surfaces share zero names and `entry-point-boundaries.test.mjs` enforces it.

## Why measurement is two calls, and what they should be named

**Do not merge them again.** `measure()` takes the paragraph-scoped engine query: synchronous, no publication flip, no revision advance, no checkpoint. `glyphs()` makes the engine emit a record per glyph and per line and copies those arrays out of Wasm.

Merging them was tried in this session and regressed the fast path from **0 engine crossings to 4** on a constraint sweep. `three-v1.test.mjs`, "repeated layout under changing constraints stays on the paragraph query path", is the test that caught it and is the guard against it happening again. Skia and Flutter separate the same way and for the same reason: `getRectsForRange` and `getBoxesForSelection` are on-demand rather than part of laying out.

**The naming is settled and shipped.** Ours:

| ours | does | Skia's equivalent |
| --- | --- | --- |
| `measure(constraints)` | shaping and line breaking, returns metrics | `layout(width)` |
| `glyphs()` | queries the finished result, emits and copies columns | `getRectsForRange()` |

`ParagraphLayout` is authored paragraph flow configuration; `measure(constraints)` is the action that answers aggregate metrics. Positioned columns remain an explicit `glyphs(constraints)` query. Both renderer-free Paragraph and retained renderer text carry the same verbs.

## What measurement guarantees

`Paragraph` needs no scene, renderer, world matrix, or committed frame — verified, and pinned by "measurement is complete and available before anything is rendered". Every value is paragraph-local: origin at the box top-left, +X right, +Y down. Scale and placement belong to the host.

Compute-or-cached is inherent and not a wart. The first query pays shaping; it is retained as a speculative transaction (`state.rs:188`) so a second query at a different constraint re-runs only geometry, flow, and positioning, and the next ordinary frame committing the same inputs adopts that work rather than redoing it.

The fast `measure()` path may return `inkBounds: undefined` because it does not position glyphs. Advance-based placement works from `measure()`; visual placement against exact ink calls `glyphs()`, which returns the authoritative positioned ink bounds. This split is deliberate: callers pay the positioned-column cost only when they ask for it.

## Corrections this session paid for

- `/core` and `/tsl` stay published. The "no consumers" finding that demoted them was false: `@pmndrs/glyph/three` imports `/core` directly. `/core` is **additive to the root**, not standalone, so "you cannot do X from `/core` alone" is not a finding unless X is engine driving.
- `capacity.policy: 'fixed'` is not a failure. A caller declaring a hard glyph budget asked for rejection over growth; the update does not apply, the last complete revision stays visible, development warns once, `capacityExceeded` carries it for reporting, and it self-heals.
- Every caller-reachable path to a frame rejection is closed at `set()` — span ranges, nesting, feature ranges, unpaired surrogates. What remains is our own invariant violations.
- `FontLoader` names **two different classes** at the root and in `/three`. Four call sites use the first, nine the second. Rename `/three`'s to `ThreeFontLoader`. **Not done.**
- A span carrying a `ThreeTextMaterial` puts a renderer type in the authoring vocabulary. The engine only ever sees the `materialId` `/three` resolves it to, and `programVariant` is a font-binding field, not the caller-facing slot. The clean shape is a span naming an abstract selector the renderer resolves through a registry. **Not done, and it is why the raw-offset span array cannot yet be withdrawn — that array is the only carrier with a material slot.**

## Three API defects the renderer guide surfaced

Found while writing `.agents/docs/guides/renderer-integration.md`; each is a place the API needs changing rather than documenting.

1. **A technique schema mixes wire declarations with host-only metadata.** Buffers and binding order lower to wire records; `resources` and `glyphOrigin` never reach the wire. Nothing in the type says which is which, so an author has to already know. Make the boundary structural.
2. **Identity is spread across five concepts** — technique strings, scoped wire ids, policy handles, program ids, and font-binding-owned program variants — with the relationships implicit. A branded compiled-registration object would state them.
3. **The patch opcode named `retire` is not release authority.** Retirement records are. One word, two meanings, and an integrator cannot tell which they hold — the same defect as two classes both named `FontLoader`.

## Open work

1. **Benchmarks as a gate**, per [benchmark-trust.md](benchmark-trust.md). Four decisions need a human: CI compares base and head in one job with no stored baseline; `blocks: 16` rather than the default 8; the anti-laundering rule forbids re-running to flip a verdict; and four existing "benchmarks" get deleted, most pointedly a test comparing two checked-in JSON files that measures nothing and passes forever. The premise was half wrong — the problem is not only noisy numbers, it is that **nothing was ever gated on them**.
2. **A golden-path audit** for the Rust engine: that changes stay data-oriented and on the SIMD compute path rather than inventing a new way to do the same thing. Not designed yet.
3. **Implementor documentation for writing a policy and consuming a plan.** There is none, and a renderer integrator needs it more than anything else in the docs.
4. The `ThreeFontLoader` rename, the material selector, and the `layout`/`glyphs` naming above.
