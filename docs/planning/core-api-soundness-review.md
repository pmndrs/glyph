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

### C4 — The two publication flows are correct, but the types cannot tell them apart

**Severity: medium. Status: open, unchanged in #120. Corrected framing. Verified read.**

An earlier revision of this finding treated `/three` not calling `assertLive` as a gap. That was wrong:
**both flows are sanctioned, and `/three` is deliberately taking the zero-copy one.**

There is no async engine API. `update`, `measureParagraph`, `reserve` and the whole plan reader are
synchronous; a grep of `/core`'s engine path finds no `async` and no `Promise`. A borrow expires only
when *its own session* is called again — exactly `update`, `measureParagraph`, `reserve`, `dispose`
([`core/host.ts:358`](../../packages/glyph/src/core/host.ts)) — or when the Wasm heap grows underneath
it, caught by the `memoryBuffer` identity check. Writing to a GPU does not expire anything.

That yields two correct flows:

| Flow | Who | Why |
| --- | --- | --- |
| **Synchronous, zero-copy** | `/three` | Reads the borrow in place and writes lanes straight into its buffers inside one non-reentrant frame. The plan is never copied whole. `retain` appears only on the failure path, to hold a publication for retry. |
| **Deferred, retained** | `glyph-example-renderer` | `await`s a device commit, and its decoded draw list holds *views* over the publication that must outlive the yield. `assertLive` + `retain` is what makes crossing the yield legal. |

The finding is what the two have in common. `TextEngineRenderPlanView.bind()` accepts a borrowed
publication ([`core/plan-view.ts:54`](../../packages/glyph/src/core/plan-view.ts)) because the
synchronous flow requires that — so the deferred flow can pass one too, and nothing objects until the
bytes are gone. The retained brand exists to mark the second mode, but only an API that *demands* the
brand enforces anything, and `bind()` cannot demand it without breaking the first mode.

So this is not "retention is opt-in". It is: **the mode is load-bearing and invisible to the type
system.** D-267 records the underlying edge as "a publication valid only until the next Wasm call,
which no retained host can honour"; the addition here is that the honourable path already exists and is
simply indistinguishable from the dishonourable one at the call site.

**Recommendation.** Give each mode its own entry point rather than making one mandatory. A scoped
borrow — `session.publish(request, view => …)` — cannot escape its callback, making the synchronous
flow safe by construction *and* keeping it copy-free. A separate `updateRetained()` returns the branded
copy for callers crossing a yield. `assertLive` then stops being a discipline and becomes a shape.

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

### C9 — Resource identity is host-scoped; resource realization is not

**Severity: high. Status: open. Verified live.**

`/core` mints resource identities on the host — `host.wireIdentities.resourceId(key)` — so a
`referenceId` in a plan only means anything inside that host. Realization is the integrator's, and
`/core` never says where to keep it. `/three` keeps GPU objects on the per-batch plan executor
([`three/engine-plan-target.ts:216`](../../packages/glyph/src/three/engine-plan-target.ts)), so the
name is scoped to the host and the thing is scoped to the session.

Measured with one 16px Inter bitmap font:

```
two batches, one host, one font  =>  1,391,808 bytes
same two texts inside ONE batch  =>    696,512 bytes   (2.00x)

8 loose <Text>                   =>  gpu 5.31 MB       (8.0x)
one TextGroup of 8               =>  gpu 0.67 MB
```

Nothing violates the stated contract, because there is no stated contract about where resources live.
That is the finding: **the API scopes the identity and declines to scope the object**, and the two
shipped answers disagree.

### Where the flaw sits, by layer

Policies are **not** the problem, and moving them would be the wrong fix. A policy already lives on the
host and many sessions bind to one — `/three` passes `this.#coordinator.policyHandle` from every
session ([`three/text.ts:740`](../../packages/glyph/src/three/text.ts), `:948`, `:1205`). Session to
policy is N:1 and it works. The same is already true of font bindings, font stacks and resource
identities: all host-scoped, all shared.

Both measured multipliers are **`/three` choices**, and either can be fixed there with no core change:

| Multiplier | Cause | Fixable in |
| --- | --- | --- |
| 3.5x Wasm | one session per standalone `Text` rather than a shared batch | `/three` — see C11 |
| 8x GPU | textures cached on the per-batch plan executor rather than on the coordinator | `/three` — the coordinator already holds the decoded payloads in `#resources` |

Nothing in `/core` requires either. A `THREE.DataArrayTexture` is derived deterministically from the
resource payload, so the coordinator could hold it and refcount by session today.

The **core-level flaw is an asymmetry that invites the mistake**. `compileRasterFont` returns
`{ binding, resources, declaredResources }`
([`core/raster-plan-program.ts:52`](../../packages/glyph/src/core/raster-plan-program.ts)). The binding
has a home — `host.registerFontBinding` — and the resources do not: the host exposes
`registerFontBinding`, `registerFontStack` and `registerPolicy`, and nothing for resources. So `/core`
mints a host-scoped *name* for every resource, creates a scope shaped exactly like "shared across
sessions, refcounted, released at teardown", and then hands the payloads back loose for the integrator
to store wherever. Three stored them one level too low.

**Recommendation.** Give resources the same treatment their bindings already get: a host-side
registration that owns the lifetime, refcounted by session and released at teardown, with the
integrator supplying the realized object. That closes C9 and C10 together and removes the slot where
`/three` guessed wrong — without touching policies, which are already correct.

### C10 — No device, scene, or render-pass concept, and the device is the one the GPU enforces

**Severity: medium. Status: open. Verified read + live.**

A grep of `/core` finds no device, canvas, scene, or pass vocabulary. The nearest neighbours:

| GPU concept | What `/core` offers | Gap |
| --- | --- | --- |
| device / canvas | nothing; the host is the only candidate | resource sharing has no boundary |
| scene | `session`, which is one *batch* | a scene holds several |
| render pass | `clipId`, `depthKey`, `orderToken` lanes on every draw | `clipId` is never populated |

`createRasterPolicyProgram` includes `batch.clip` in every program's `drawKeyMask`
([`core/render-policy.ts:539`](../../packages/glyph/src/core/render-policy.ts)) while nothing in the
repository ever sets a nonzero `clipId`. That is a reserved capability rather than a defect — a
constant key never splits a batch — but it means the pass dimension is declared and unused.

The device gap is the substantive one: a texture cannot cross a device, so "a second canvas cannot
reach these resources" is a real constraint with nowhere to live. Making the host device-scoped gives
it a home and resolves C9, C1 and this entry together.

**Verified clean — do not re-investigate.** Three plausible defects in this area were probed and are
correct: repeated `updateMatrixWorld` traversals (21 in a row) re-publish nothing and grow the heap by
zero bytes, so two canvases rendering one scene is not double work; moving a `TextGroup` between scenes
preserves its realized GPU state and republishes cleanly; and `visible = false` hides text in both
paths — by scene-graph culling for a standalone `Text`, and by the zero-transform lane for a grouped
one.

### C11 — A session has a ~2.2 MB floor, and `/three` opens one per standalone `Text`

**Severity: high. Status: open. Verified live.**

`TextEngineSession` carries retained paragraphs, glyph identity across reflow, incremental shaping
state, revision counters and two output slots. That is genuinely session-shaped, and it is expensive.
Per-session Wasm cost, isolated by varying arena size:

```
arenas at ABI minimum      ->  2,248K per session
16K / 64K                  ->  2,400K
Three default (256 glyphs) ->  2,824K
capacity 2048 glyphs       ->  2,952K
```

The floor is ~2.2 MB and arena sizing cannot reduce it. `/three` constructs one binding — hence one
session — per `TextGroup` *and* per standalone `Text`
([`three/text.ts:407`](../../packages/glyph/src/three/text.ts)). Eight paragraphs:

```
8 loose <Text>       wasm +26.75 MB   gpu 5.31 MB
one TextGroup of 8   wasm + 7.69 MB   gpu 0.67 MB
```

This is **not a regression**: `git show 4213dfa6^:packages/text/src/three/text.ts:310` has the
identical construction before the package rename, and no commit in history contains a shared standalone
batch. D-129's "standalone text derives an implicit batch" is ambiguous about how many, and the
implementation has always read it as one per text.

**Latent hazard for whoever changes this.** `#drawRoot()` returns the *first paragraph's* `Text` when
there is no group ([`three/text.ts:1178`](../../packages/glyph/src/three/text.ts)), and
`visibleBelowRoot(object, root)` never checks the root's own `visible` flag. Both are harmless today
because a standalone batch holds exactly one paragraph and its meshes hang under it. In a shared
standalone batch both become wrong: the draw root would be an arbitrary member, and per-text visibility
would have to come from the zero-transform lane rather than scene-graph culling.

**Recommendation.** Resolve D-129's ambiguity and make the code match, per the task prompt written for
this. Either outcome needs a test asserting how many sessions N standalone texts create; none exists.

### C12 — Handle IDs are refcounted by derivation, not by use

**Severity: medium. Status: open (new in #120). Verified live.**

`id(kind, name)` at module scope registers permanently; `host.id(kind, name)` registers refcounted and
releases at host teardown ([`core/render-policy.ts:79`](../../packages/glyph/src/core/render-policy.ts)
and `:90`). `assertGlyphId` checks only that a number is *currently registered* — it cannot check who
registered it. So a host that registers under an id another host minted loses the ability to name its
own live registration when the minting host disposes:

```
b registers a policy under the id a minted:      WORKS
after a.dispose(), b re-validating that same id:
  THROWS: policy handle must come from id('policy', name) or host.id('policy', name)
```

B's registration is still live in the engine and now unaddressable. Following D-280's rule — authored
constants via `id()`, runtime-created via `host.id()` — avoids it, and `/three` does follow it. Nothing
enforces which minter produced a value, and crossing them fails only at teardown.

**Recommendation.** Either refcount by registration rather than derivation, or make the two minters
return distinct types so a permanent-lifetime handle cannot be supplied where a scoped one is expected.

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
