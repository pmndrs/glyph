---
type: API Specification
title: Core API soundness review ledger
description: Live ledger for the in-flight soundness review of the @pmndrs/glyph/core engine-integration surface against PR #120, recording each finding with its evidence, verification method, and status.
documentation_type: explanation
tags: [api, core, soundness, review, ownership, retention, handles]
status: draft
sources:
  - id: pr-120
    resource: https://github.com/pmndrs/glyph/pull/120
    title: 'PR #120 — feat/render technique portability'
  - id: api-surface-audit
    resource: api-surface-audit.md
    title: Public API surface audit and cleanup plan
  - id: decision-register
    resource: decision-register.md
    title: Decision register
  - id: engine-call-contract
    resource: ../../.agents/skills/engine-call-contract/SKILL.md
    title: Engine call contract
  - id: core-entry
    resource: ../../packages/glyph/src/core.ts
    title: Renderer-neutral core entry point
generated:
  by: anthropic-claude/opus-5
  at: '2026-08-26T18:40:00Z'
---

# Core API soundness review ledger

## Why this exists

Working ledger for a soundness review of `@pmndrs/glyph/core` as a standalone contract: the
surface a renderer integrator builds on without our `Object3D`s. The subject is the API. `/three`
and `packages/glyph-example-renderer` appear only as evidence of how the contract behaves in use.

Separate from [`api-surface-audit.md`](api-surface-audit.md), which is a settled audit with
numbered `F` items. This holds in-flight findings not yet accepted, rejected, or folded in. Every
finding records how it was verified so a reader can re-run the claim rather than trust it.

**Baseline: PR [#120](https://github.com/pmndrs/glyph/pull/120)
(`feat/render-technique-portability`) at `b32f5294`**, built from source; live probes ran against
the real `text-shaper.wasm`. That branch is a draft under active work and was force-pushed on
2026-08-26, so every finding below is pinned to that SHA and should be re-checked against the tip
before acting on it.

An earlier pass of this review ran against `main` at `f08a90cf`. Where #120 resolved a finding,
the finding is kept with status **Fixed in #120** rather than deleted, so the review shows what
the branch bought.

## Verification legend

| Mark | Meaning |
| --- | --- |
| **live** | Reproduced by executing the built branch against real Wasm |
| **read** | Established by reading source or Rust, not executed |

## The contract as it stands on #120

```
TextRuntime ──1:1──> RuntimeShaper          one Wasm instance; owns shaping fonts
                          │
                          ├── policies      ┐
                          ├── fontBindings  ├─ handle namespaces live HERE,
                          ├── fontStacks    │  keyed u32, global to the Wasm instance
                          └── sessions      ┘
                          ▲
                          │  constructor argument only; never reassignable
                    TextEngineHost ──1:N──> TextEngineSession
```

Two facts drive most findings:

1. **A host is bound to one shaper for life.** `TextEngineHost` takes a `RuntimeShaper` in its
   constructor and publishes no way to change it; disposal is terminal. (**live**)
2. **A host still does not own the namespaces it manages.** The four namespaces belong to the Wasm
   instance. #120 added real ownership *within* a host (D-281) and branded provenance for the
   values (D-280), but the arbiter of the u32 slot is still the engine, not the host.

Confirmed **sound**; recorded so they are not re-litigated:

- **Frame arenas are per session.** `frames: BTreeMap<u32, FrameTransport>` gives each session its
  own request arena and A/B output pair, so one session publishing cannot overwrite another's
  borrowed bytes. The only cross-session hazard is Wasm memory growth, which `isExpired` catches
  by `ArrayBuffer` identity. (**read** + **live**)
- **The engine validates the wire fields a caller supplies.** A request carrying another session's
  `sessionId`, or a nonexistent one, is refused `invalidRequest` (6); a request acknowledging a
  generation never issued is refused `revisionConflict` (12). (**live**)
- **Cross-runtime mixing is fully guarded** at every entry: `createFontStack`, assigning a `Text` a
  font from another runtime, and a `TextGroup` holding texts from two runtimes all reject.
  (**live**)

## Open findings

### C1 — Branded IDs give provenance, not ownership; two hosts on one shaper still collide

**Severity: high. Status: open. Verified live on #120.**

D-280 brands handles and D-281 makes a host own its bindings and stacks. Both are real
improvements and both stop short of the cross-host case, because **an ID is a content-derived hash
of `(kind, name)` in a module-global registry**
([`core/render-policy.ts:140`](../../packages/glyph/src/core/render-policy.ts)):

```
a.id('session', 'glyph-three/1')  ->  1991730772
b.id('session', 'glyph-three/1')  ->  1991730772      ← same u32, different host
```

Names namespace by *authoring site*, not by host. `ThreeTextEngineCoordinator` derives handles as
`host.id(kind, 'glyph-three/<ordinal>')`
([`three/engine-runtime.ts:467`](../../packages/glyph/src/three/engine-runtime.ts)), so two
coordinators on one shaper produce identical handles by construction.

`assertGlyphId` checks `namedIds.has(key)` — that the value came from the ID utility and is still
live. It cannot check *which host* registered it, so D-280's "every consuming host call still
validates active provenance" is satisfied while the slot conflict remains. Nothing claims the
shaper: `_assertEngineAccess()` still only checks disposal
([`shaper.ts:193`](../../packages/glyph/src/shaper.ts)).

Outcomes, live on #120:

| Collision | Outcome |
| --- | --- |
| Session handle | `sessionConflict` (10) — loud, correct |
| Policy handle, differing bytes | `policyConflict` (8) — loud, correct |
| Policy handle, **identical bytes** | **Accepted.** Both hosts believe they own it |
| Font-stack handle, identical members | **Accepted.** Both hosts believe they own it |

Silent double-ownership is the dangerous half, because it converts into a teardown failure
attributed to the wrong component:

```
B.dispose() after A disposed the shared policy:
  rejected: dispose render policy failed with text-engine status 9   (policyMissing)
```

`B` did nothing wrong. This is D-267's own shape — a value the caller must keep consistent with
engine state, published without the means to keep it consistent — surviving in `/core`.

**Recommendation.** Have the constructor claim the shaper: one live host per `RuntimeShaper`,
second construction throws naming the incumbent. That is the *shape beats check* rule, and it
makes the 1:1 that `/three` already enforces by memoisation true where the namespaces actually
live. If multi-host must stay supported, the namespaces need a host-scoped prefix or a real
allocator, not a shared hash space.

### C2b — Teardown clears bookkeeping before knowing the Wasm side succeeded

**Severity: medium. Status: open (new in #120). Verified live.**

`TextEngineHost.dispose()` is now correctly total and idempotent (see C2). But it clears
`#fontStacks`, `#fontBindings`, `#policies` and disposes `#ids` **unconditionally**, after
`attempt()`-wrapped calls that may have failed
([`core/host.ts:208`](../../packages/glyph/src/core/host.ts)):

```
B.dispose()  -> throws policyMissing, having already cleared its sets and unregistered its IDs
B.dispose()  -> ACCEPTED (no-op)
```

If a Wasm disposal genuinely fails, the entry stays live in the engine while the host forgets it
and `GlyphIdScope.dispose()` removes the ID from `namedIds` — so no caller can name that handle
again to retry. The slot is unreclaimable until the whole shaper dies.

D-281 promises "failed disposal remains retryable" for the Three coordinator's bindings. Host
teardown does not offer the same, and the two are adjacent enough that the difference reads as an
oversight.

**Recommendation.** Retain entries whose disposal failed rather than clearing unconditionally, or
state that host teardown is best-effort and that a failed stage is unrecoverable by design.

### C4 — The plan reader cannot enforce the retention protocol

**Severity: medium. Status: open, unchanged in #120. Sharpens D-267. Verified read.**

`TextEngineRenderPlanView.bind()` accepts a borrowed `TextEnginePublication` and holds no
reference to the session ([`core/plan-view.ts:54`](../../packages/glyph/src/core/plan-view.ts)).
It validates structure thoroughly — buffer identity, header byte length, every table's alignment
and bounds — then cannot re-check liveness on any later read, because it has nothing to ask.

So `assertLive` is a separate, opt-in call the integrator must remember at the right moment every
frame. The protocol is documented four times over; documentation is carrying weight the type
system could carry. The engine call contract's rule is *"Prefer a shape that cannot express the
mistake over a check that catches it."*

Consumer evidence, which is the interesting part:

| Consumer | `assertLive` | `retain` | `acknowledge` |
| --- | --- | --- | --- |
| `glyph-example-renderer` | yes, `engine.ts:157` | yes | via `retain` |
| `/three` | **never called** | only on the failure path | **never called** |

`/three` is not unsafe — it reads the borrow inside the same synchronous frame with no intervening
session call — but its safety rests on a whole-program argument rather than a local one, and it is
the reference integration.

D-267 already records the underlying edge as *"a publication valid only until the next Wasm call,
which no retained host can honour."* This ledger adds the mechanism: the reader is the natural
enforcement point and is not given the means.

**Recommendation.** Let `bind()` take the session, or have `session.update()` return a reader
already bound to itself, so a stale read is impossible rather than merely detectable.

### C5 — `session.acknowledgedGeneration` is a second, non-authoritative source of truth

**Severity: medium. Status: open, unchanged in #120. Verified live.**

Acknowledgement is load-bearing: the engine defers resource retirements until the acknowledged
generation passes. It is tracked in two independent places that nothing reconciles.

- The session maintains `#acknowledgedGeneration`, advanced only by `retain()` or `acknowledge()`,
  and publishes it as a getter ([`core/host.ts:296`](../../packages/glyph/src/core/host.ts)).
- The wire field `acknowledgedPublicationGeneration` is a required argument to
  `compileTextEngineFrameUpdate` ([`core/frame-wire.ts:197`](../../packages/glyph/src/core/frame-wire.ts)),
  supplied by the caller from its own bookkeeping.

`/three` supplies its own and never calls `acknowledge()`, so the getter is dead state in the
reference integration — a session can sit at `0` while the wire it just carried claimed otherwise.

The engine defends itself (acknowledging an unissued generation is refused `revisionConflict`), so
this is not a memory-safety hole. It is a published getter that can disagree with reality, on the
one value the retirement protocol depends on.

**Recommendation.** Pick one authority: either `compileTextEngineFrameUpdate` reads the value off
the session, or the session stops publishing a getter it does not own.

### C6 — The retained brand is forgeable; only the session catches it

**Severity: low. Status: open, unchanged in #120. Refines audit F14. Verified live.**

`retainedPublicationBrand` is exported from `/core`, so `{ ...borrowed, [retainedPublicationBrand]: true }`
satisfies `RetainedTextEnginePublication` at compile time *and* runtime while still pointing into
live Wasm memory:

```
retainedPublicationBrand still exported from /core:  true
forged object satisfies the brand at runtime:        true
forged.bytes is a live Wasm view, not a copy:        true
```

The refinement F14 does not state: the *session* cannot be fooled, because `#issued` is a `WeakMap`
keyed by object identity, so `assertLive(forged)` throws `TypeError`. The exposure is confined to
any API accepting a `RetainedTextEnginePublication` **without** holding the session — precisely the
case the brand exists to serve.

**Recommendation.** Make retained publications a class instance and brand-check by `instanceof`,
or keep a package-private `WeakSet` of genuinely retained objects. Withdrawing the symbol is not
sufficient, since spreading a genuine retained publication reproduces it.

### C7 — Error taxonomy forces integrators to map raw integers

**Severity: low. Status: open, unchanged in #120. Overlaps audit F1. Verified read.**

`TextEngineStatusError.status` is a bare number. An integrator must compare it against
`textShaperAbi.status.*` to learn whether a failure is their arithmetic, a capacity watermark to
grow, or a package defect — the exact distinction the engine call contract turns on.

What this review adds for `/core`: the surface never says which statuses are *recoverable*.
`resultTooLarge` is already retried internally by `update()`; `sessionConflict` is a programming
error; `policyMissing` may be recoverable by re-registering. Integrators must reconstruct that
triage themselves.

**Recommendation.** Fold into F1: expose the class alongside the code so a host can branch on
recoverable-versus-defect without a lookup table.

### C8 — Registration and disposal are still asymmetric

**Severity: low. Status: open (reduced by #120). Verified live.**

#120 added `disposeFontBinding` with a real ownership guard, closing most of the original finding:

```
host.disposeFontBinding exists:  true
host.disposeFontStack exists:    true
host.disposePolicy exists:       false
unowned binding rejected: "font binding 1752141992 is not owned by this text engine host"
```

`disposePolicy` remains absent: a policy is released only when the whole host is disposed, though
the Wasm export exists and host teardown calls it. Four registration calls, three disposals.

**Recommendation.** Publish `disposePolicy`, or state in `core.ts` that policies are
host-lifetime by design.

## Fixed in #120

### C2 — `TextEngineHost.dispose()` is now total and idempotent

**Was: medium, open on `main`. Now: fixed. Verified live.**

On `main`, `dispose()` set `#disposed = true` only after all teardown loops, each using
`requireStatus`, so a mid-teardown throw left the host un-disposed with uncleared sets and the next
`dispose()` re-ran the same failing calls. #120 rewrote it with per-stage `attempt()`,
unconditional clearing, and a single rethrow at the end:

```
first dispose():   ACCEPTED
second dispose():  ACCEPTED
third dispose():   ACCEPTED
```

This now matches `TextRuntimeImpl.dispose()`'s stated policy. See C2b for the residue.

### C3 — Font bindings now have a disposal path

**Was: low, open on `main`. Now: fixed. Verified live.**

On `main`, `dispose_font_binding` existed in Rust but was absent from the ABI with no caller
outside tests; bindings were reclaimed only when the shaping font was unregistered. #120 publishes
`TextEngineHost.disposeFontBinding`, guards it against in-use stacks, and disposes bindings during
host teardown after stacks (D-281). Residual asymmetry tracked as C8.

## Cross-cutting observation

C1, C5, and C6 are one shape: **a value the caller must keep consistent with engine state,
published without the means to keep it consistent.** D-267 names that shape and removed it from the
`/three` reconciler. It survives in `/core` in three places — the handle namespaces, the
acknowledged generation, and the ownership brand. Fixing them individually is possible; recognising
them as one class is what makes the fix consistent.

#120's direction is right on all three: D-280 and D-281 attack exactly this by giving IDs
provenance and hosts ownership. C1 is the observation that the work stops one level short — at the
value's provenance rather than at the slot's owner.

## Corrections to prior documents

- **Audit F6 appears already fixed.** It records late `registerThreeRasterPlanProgram` as *"a legal
  call that silently does nothing."* The code throws, naming the live snapshot count
  ([`three/plan-program-registry.ts:201`](../../packages/glyph/src/three/plan-program-registry.ts)).
  (**read** — a live probe tripped an earlier guard and did not reach this gate.)
- **Audit item 11 is marked ⬜** in the requirements table, but the retention protocol landed in
  [#110](https://github.com/pmndrs/glyph/pull/110) and its own prose entry says *"Landed."*

## Reproduction

Probes live in the review scratchpad, not the repo. Each is a standalone ESM script run from
`packages/glyph` after `node scripts/build.mjs`:

| Probe | Covers |
| --- | --- |
| `probe-120.mjs` | C1, C2, C2b, C3, C6, C8 against #120 |
| `probe-relationships.mjs` | C1, C2 on the `main` baseline |
| `probe-canvas.mjs` | C1 — a `/core` host beside the `/three` coordinator |
| `probe-mixing.mjs` | Cross-runtime guards |
| `probe-wire.mjs` | C5 — `sessionId` and acknowledgement validation |
| `probe-brand.mjs` | C6 — brand forgeability |

If these should live in the repo, `packages/glyph/tests/integration/` is the natural home; several
are close to regression tests as written.
