---
type: Investigation Report
title: Fallow duplication audit for Glyph and Rust
description: Evidence-backed duplication review of the in-progress Glyph API, example renderer, and Rust crates, with refactor candidates ordered against the renderer-neutral integration plan.
documentation_type: explanation
tags: [planning, maintainability, duplication, glyph, rust, threejs, react]
status: draft
sources:
  - id: integration-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral core and engine integration
  - id: glyph-config
    resource: ../../packages/glyph/src/glyph-config.ts
    title: GlyphConfig and publication transaction
  - id: typed-command-buffer
    resource: ../../packages/glyph/src/internal/typed-command-buffer.ts
    title: Canonical typed command-buffer mapper
  - id: three-plan-target
    resource: ../../packages/glyph/src/three/engine-plan-target.ts
    title: Three configured plan target
  - id: example-engine
    resource: ../../packages/glyph-example-renderer/src/engine.ts
    title: Example renderer plan target
  - id: create-engine
    resource: ../../packages/glyph/src/core/create-engine.ts
    title: Renderer-neutral command binding engine
  - id: plan-view
    resource: ../../packages/glyph/src/core/plan-view.ts
    title: Raw render-plan view and semantic record decoders
  - id: example-device
    resource: ../../packages/glyph-example-renderer/src/device.ts
    title: Example renderer recording device
  - id: rust-render-plan
    resource: ../../packages/glyph/rust/shaper/src/engine/render_plan.rs
    title: Rust render-plan record definitions
  - id: rust-render-plan-wire
    resource: ../../packages/glyph/rust/shaper/src/engine/render_plan_wire.rs
    title: Rust render-plan validation and serialization
  - id: fallow-readme
    resource: https://github.com/fallow-rs/fallow/blob/v3.13.0/README.md
    title: Fallow 3.13.0 README
  - id: fallow-schema
    resource: https://github.com/fallow-rs/fallow/blob/v3.13.0/schema.json
    title: Fallow 3.13.0 configuration schema
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-01T22:55:50Z'
---

# Fallow duplication audit for Glyph and Rust

## Agent summary

The current dirty tree has completed all renderer cutovers targeted by the earlier audit. `createEngine` owns the canonical
typed projection and transaction; Three and the example renderer are direct delegates that consume the bound hierarchy.
The example `plan-reader.ts` and `snapshot.ts` are deleted, and no renderer reconstructs raw Rust rows. React now calls the
same descriptor-derived `fontFaceResourceKey()` used by core, closing the second raster-option identity policy.

The fresh signed Fallow 3.13.0 mild scan reports 461 files, 68 clone groups, 1,396 duplicated lines, and 1.491%. That is
three groups and 71 duplicated lines below the post-cutover scan, and 13 groups/332 lines below the first scan. The
example commit swap, Three scene-visibility predicate, repeated admitted-table validation, and trusted resource-reference
read have all been remediated and verified against current source.

The meaningful unresolved work is now narrower:

- Public semantic row readers and their manual types remain an intentionally documented low-level `/core` compatibility
  surface. The normal trusted path now uses cached admitted descriptors and one internal resource-reference accessor.
- The MTSDF and Slug Rust Wasm boundaries still duplicate allocation and segmented-response ownership, while Bitmap,
  MTSDF, and Slug retain byte-identical progress modules. Fallow cannot analyze Rust, so this is manual evidence.
- The three TypeScript baker wrappers and raster validators retain small shared protocol/envelope blocks.
- The current build passes, but `release:size:check` now correctly fails because the dirty tree's committed size report is
  stale. Fresh measurements exceed the existing `/core` and `/three` ceilings; they cannot be attributed solely to these
  four small remediations and require a separate size-accounting decision before release.

Do not extract every repeated material path or typed view constructor. Their parallel structure is the renderer DSL or a
zero-copy typed projection, not competing ownership.

## Scope and evidence

### Repository state

- Repository revision: `924106d7c1823d673237f64622795cc8c24408c5`.
- The audit ran against the dirty working tree, including the uncommitted `FontFace` and
  `internal/typed-command-buffer.ts` work. Findings therefore describe the implementation under review, not only `HEAD`.
- Primary TypeScript scope: workspaces `@pmndrs/glyph` and `@pmndrs/glyph-example-renderer`.
- Manual Rust scope: every `*.rs` file under `packages/glyph/rust`, excluding `target` output. Generated Unicode tables
  under `shaper/src/generated` were inventoried but not treated as refactor candidates.
- No implementation file, public export, dependency manifest, source digest, baseline, or Fallow configuration was
  changed. Machine-readable Fallow results were written only to `/tmp`.

### Tool provenance

The installed tool was the signed npm distribution of Fallow `3.13.0`. Its annotated tag resolves to
`c1c2065e85e1e6a2e0eae3dd238cff8f83bc5331` and peels to commit
`4274c9397ca6a46eb0277bee312baeff96b408c4`. The CLI reported its binary verification sentinel as valid.

Upstream documents Fallow as codebase intelligence for TypeScript/JavaScript and CSS-family stylesheets. The Rust
implementation language of the scanner does not make Rust an input language. Accordingly, Fallow evidence below supports
the TypeScript findings only; the Rust findings use exact hashes, diffs, and direct source inspection.

### Commands

```sh
git ls-remote https://github.com/fallow-rs/fallow.git refs/tags/v3.13.0 refs/tags/v3.13.0^{}
mise exec -- pnpm dlx fallow@3.13.0 --version
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --mode mild \
  --format json --pretty --quiet --no-cache \
  --output-file /tmp/fallow-glyph-mild.json
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --mode weak \
  --format json --pretty --quiet --no-cache \
  --output-file /tmp/fallow-glyph-weak.json
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --mode semantic --min-tokens 30 --min-lines 4 \
  --format json --pretty --quiet --no-cache \
  --output-file /tmp/fallow-glyph-semantic.json
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --mode mild --no-cache --summary --explain-skipped
```

The primary mild run used Fallow's documented defaults of 50 tokens, 5 lines, and two occurrences. Its output was:

| Measurement                           |   Mild |   Weak |
| ------------------------------------- | -----: | -----: |
| Eligible files in the analysis corpus |    450 |    450 |
| Files with reported clones            |     62 |     78 |
| Clone groups                          |     81 |    109 |
| Clone instances                       |    177 |    247 |
| Reported duplicated lines             |  1,728 |  2,651 |
| Reported duplication                  | 1.827% | 2.804% |

Fallow's workspace filter scopes the requested findings but can retain an occurrence outside those workspaces when it is
the counterpart of an in-scope clone. That is why a few benchmark and example-raster paths appear in the raw result.
Fallow's default duplicate ignores skipped 141 `**/*.test.*` files, and module wiring was excluded by the default
`--ignore-imports`. Test support modules whose names do not match `*.test.*` remained eligible.

The semantic sensitivity run produced 1,800 groups and 27.156% reported duplication after identifiers/literals were
blinded and the threshold was lowered. It was useful only to find nearby candidates. Its aggregate percentage and broad
structural matches are not decision evidence; every accepted finding below is supported by the mild or weak result and by
source inspection.

## Accepted findings from the first snapshot

F1 and F2 below preserve what the first Fallow run found before the in-turn `createEngine` migration. Their old binder line
ranges are historical evidence, not descriptions of the current dirty tree. The dated follow-up records which parts were
deleted, which remain, and the current line evidence.

### F1 — Medium: one Rust publication is decoded or reconstructed in three adapter paths

**Current status.** Resolved for Three and for both binder transactions. The example inspection bridge still reconstructs
the raw plan. See F8 and F9.

**Failure mode.** Renderer integrations can disagree about plan trust, ordering, replacement detection, identity reuse,
and retained ownership. They also materialize arrays and maps that the canonical lazy hierarchy was introduced to avoid.
Changing the Rust plan layout or hierarchy currently requires coordinated edits in multiple renderer-shaped classes.

**Evidence.**

- In the pre-migration snapshot, `ThreeCommandBufferBinder.decodeDefault()` opened `resources`, `buffers`, `patches`,
  `primitives`, `draws`, and `retirements`, reconstructed draw membership with slices, and materialized frozen arrays. Its
  retained transaction has since been replaced by `createEngine`.
- In that same snapshot, `ExampleCommandBufferBinder.decodeDefault()` repeated the transaction after `readCandidate()`
  had already copied every raw record and several raw table byte ranges. The transaction is now centralized, while
  `readCandidate` still existed in the then-current `packages/glyph-example-renderer/src/plan-reader.ts:17` snapshot.
- In the pre-migration snapshot, `ThreeTextRenderPlanExecutor.#prepare()` recovered the original candidate from the bound
  frame, opened the same six tables, and reconstructed retained draws and resources again. That path has now been deleted.
- Fallow mild fingerprint `dup:af39b73a` finds the six-table opening and replacement test in both the new mapper and the
  legacy Three executor. Fingerprints `dup:56a8daa9`, `dup:68113b47`, `dup:689218a2`, and `dup:6d11082a` find exact
  source/decode, buffer retention, frame construction, and disposal blocks shared by the Three and example binders.
- The new `TypedCommandBufferMapper.source()` already exposes lazy updates and ordered group children without visiting a
  record during source construction
  ([typed-command-buffer.ts](../../packages/glyph/src/internal/typed-command-buffer.ts#L98)). Its focused test proves
  record-free construction, one-record `at()` access, stable accepted identities, rejected-overlay discard, and borrowed
  expiry ([typed-command-buffer.test.mjs](../../packages/glyph/tests/integration/typed-command-buffer.test.mjs#L10)).

**Smallest credible correction.** The package-internal `createEngine` publication path is now the sole owner of raw-plan
access for Three. Complete the same cutover in the example renderer: consume the bound hierarchy and delete
`readCandidate()` plus the example's raw record loops. Do not extract a generic renderer class shaped like Three, and do
not expose raw tables or numeric IDs to configs.

**Distinguishing proof.** One fixture must produce the same ordered batch/root/span hierarchy in the example and Three
configs while a package-boundary test proves neither imports `readRenderPlan*`, `RenderPlanReader`, or `PlanCandidate`.
Retain the record-read counter test and add an end-to-end assertion that renderer preparation does not increment raw plan
record reads beyond the one canonical decode traversal.

**Impact.** No intended public API change. Expected runtime impact is fewer full passes and fewer copied arrays. Bundle
impact should be measured after deleting the legacy paths rather than estimated from an added helper alone. No generated
artifact should change.

### F2 — Resolved: one resource and buffer transaction now owns the formerly unowned failure edge

**Current status.** Resolved for integrations using `createEngine`; its source-keyed decoded-frame state now reaches the
staged default frame when a wrapping decoder throws. Renderer-specific host preparation still needs its own transactional
commit/discard contract.

**Former failure mode.** Candidate-only resource leases and buffer overlays could be committed or disposed differently
across renderers. Both old binders ignored `source` in `settle()` and returned when `frame` was undefined. A custom decoder
could call `context.decodeDefault(source)`—staging a frame and leases—and then throw before returning it, leaving the
staged default frame unreachable for cleanup.

**Evidence.**

- Fallow mild fingerprints `dup:68113b47` and `dup:6d11082a` cover retained buffer generation and teardown. Weak
  fingerprints `dup:7cca6e1d`, `dup:98909811`, and `dup:195dabf7` additionally cover resolve rollback, settlement, and
  retained lookup.
- In the pre-migration snapshot, Three staged `payload` plus `ResourceLease`, tracked `newResources`, and committed cloned
  maps; the example binder independently implemented the same lifecycle under `fresh`. Both copies are now deleted in
  favor of `createEngine`.
- `createEngine` now records the default frame by source at `create-engine.ts:76-77,340-341`; settlement retrieves that
  frame and state at `:349-373` even when the wrapper never returned it. Both renderer binders delegate to this owner.

**Completed correction.** One source-keyed publication transaction in `createEngine` owns the mapper overlay, every staged
resolve lease, the default bound frame, and settlement. Renderer `prepare()` still owns host-object staging and
commit/discard; resource payload adaptation remains in `GlyphConfig.resolve`.

**Distinguishing proof.** Add fault injection for these boundaries: resolve throws before returning a lease; resolve
returns a lease and later resolve throws; a decoder calls `defaultDecoder` and then throws; renderer prepare throws;
renderer commit throws; and discard itself throws. For every case assert the prior publication remains selected and each
candidate payload, resource lease, and renderer object is released exactly once. Run the same fixture against the example
and Three configs.

**Impact.** No intended public API change. The correction removes two renderer-specific ownership state machines. It may
change internal error timing to the documented transaction boundary; that is a correctness fix, not a new recoverable
Rust-plan validation layer.

### F3 — Medium: React and the loader implement different raster request identity policies

**Failure mode.** `useFont()` can reuse a `FontFace` for renderer options that the technique considers different, or create
two faces for options whose descriptors are equivalent. React recursively serializes raw options while the loader asks the
technique for its canonical JSON descriptor. Custom technique options are not constrained to plain JSON; raw values such
as class instances, cycles, `NaN`, or two input forms normalized by `descriptor()` make the policies diverge. This can
produce the wrong cached declaration before the canonical loader ever runs.

**Evidence.**

- React owns `fontFaceSourceKey()`, `fontFaceFormatKey()`, and `stableOptionKey()`
  ([react.ts](../../packages/glyph/src/react.ts#L510)). `stableOptionKey()` walks arbitrary objects without cycle,
  prototype, depth, or finite-number checks.
- The loader's authoritative identity is
  `` `${technique.id}:${canonicalJson(technique.descriptor(options))}` ``
  ([loader.ts](../../packages/glyph/src/loader.ts#L1363)). `canonicalJson()` is already the validated canonicalization
  owner used by raster loading and validation.
- The React cache and `FontFaceHandleStore` are not otherwise duplicate caches. React retains declaration identity for
  hook/preload/clear semantics; the handle store owns handle-relative loaded selections; `FontLibrary` owns immutable
  content and pending load sharing. Those lifetimes should remain distinct.

**Smallest credible correction.** Extract one package-internal raster-request identity operation beside
`prepareRasterRequest()` and use it for both loader request keys and React declaration keys. It must derive identity from
the technique descriptor, not raw options. Keep source identity and React declaration ownership in React; do not move
React hooks or context into the loader.

**Distinguishing proof.** Define a custom technique whose `descriptor()` normalizes two different option shapes to the
same descriptor and distinguishes two options whose raw serialization collides. Assert `useFont`, `useFont.preload`, and
`useFont.clear` address the same declaration exactly when the loader addresses the same raster identity. Include a cyclic
option case and prove the technique/boundary error is reported synchronously instead of recursive overflow.

**Impact.** Internal helper only; no public export is required. It strengthens third-party technique behavior and removes
one cache-key implementation. No generated artifact impact.

### F4 — Medium: MTSDF and Slug duplicate the safety-critical Wasm artifact-response owner

**Failure mode.** Allocation authenticity, pointer/length ownership, segmented response lifetime, checked response sizing,
and serialization fallback can drift between two Wasm modules that expose the same host protocol. A fix for stale
pointers, partial allocation, or segmented cleanup can land in one baker and leave the other unsafe or leaky.

**Evidence.**

- The `Allocation` type and its `allocate`, `adopt`, and `deallocate` implementation are byte-for-byte identical across
  `mtsdf-baker/src/wasm.rs:327-382` and `slug-baker/src/wasm.rs:266-321` (verified with a zero-diff comparison).
- `PreparedArtifactResponse`, metadata-offset construction, response header encoding, contiguous/segmented retention,
  `owned_bytes`, and singleton `with_state` are structurally the same across
  [MTSDF Wasm](../../packages/glyph/rust/mtsdf-baker/src/wasm.rs#L313) and
  [Slug Wasm](../../packages/glyph/rust/slug-baker/src/wasm.rs#L255); technique types, magic, reports, and errors are the
  meaningful parameters.
- `bitmap-baker`, `mtsdf-baker`, and `slug-baker` have byte-identical 22-line `progress.rs` files (SHA-256
  `77d29a50d685c9e81ee84879d871431edd2afc13e93fa2847dfc8725333995bb`).

**Smallest credible correction.** Add a private `no_std + alloc` Wasm artifact-support module or crate with an owned
allocation registry, generic prepared artifact response, checked header encoder parameterized by magic, segmented access,
and the common progress import. Keep each crate's exported C function names, ABI JSON, domain error construction, report
type, and actual baker operation local. Do not make the three techniques implement a runtime trait hierarchy merely to
share the boundary mechanics.

**Distinguishing proof.** Reuse one conformance suite against all three compiled Wasm modules: forged pointer/length,
double deallocation, contiguous allocation failure falling back to segmented output, every segmented index/offset edge,
release twice, serialization fallback, and progress milestones. Preserve exact exported symbol and ABI JSON snapshots and
run the package size gate because a shared generic can monomorphize into larger artifacts.

**Impact.** No JavaScript or Rust public API change; C/Wasm exports must remain byte-for-byte compatible. Potential binary
size impact is unknown and must be measured. ABI artifacts should regenerate identically.

### F5 — Low: the three TypeScript baker adapters repeat one stable portable wrapper

**Failure mode.** Cancellation checks, progress listener cleanup, default Wasm source loading, and request projection can
drift across Bitmap, MTSDF, and Slug even though they implement the same `RasterBakerModule` contract.

**Evidence.** Fallow mild fingerprint `dup:4b3aae4a` reports the repeated request projection and default Wasm loading in
`bakers/bitmap.ts`, `bakers/msdf.ts`, and `bakers/slug.ts`; fingerprint `dup:92659ced` reports the shared progress-import
wrapper. The source confirms that technique constants, ABI adaptation, and error constructors are the actual varying
parts.

**Smallest credible correction.** Add package-internal functions for `withBakeProgressImport(coreFactory)` and
`createDefaultRasterBakerLoader({ wasmUrl, create, adapt, label })`, plus one request-projection helper if its inferred
types remain readable. Keep `createBitmapBakerFromInstance`, `createMsdfBakerFromInstance`, and
`createSlugBakerFromInstance` as technique-owned ABI adapters.

**Distinguishing proof.** Run the existing direct and worker bake parity tests for all techniques, add a progress-listener
throw/cancellation cleanup probe, and confirm the default loader retries only after failure through the existing successful
Promise cache.

**Impact.** No public API change. Expected small source/bundle reduction; measure because generic helper instantiation may
not reduce minified output.

### F6 — Low: raster validators still duplicate shared envelope invariants

**Failure mode.** The reciprocal shaping hash/glyph-count rules and GLB extension envelope can drift even though
`internal/raster-artifact-validation.ts` already owns the common buffer-view, coverage, external-resource, and KTX rules.

**Evidence.** Fallow mild fingerprint `dup:d0562f8a` reports identical shaping-hash and glyph-count checks across Bitmap,
MTSDF, and Slug. Fingerprint `dup:d67efd84` extends the match into Bitmap/MSDF document extension setup. Direct inspection
shows all three validators already import a substantial common validation module, so this is a missing small invariant in
an existing owner rather than evidence for another abstraction layer.

**Smallest credible correction.** Extend `internal/raster-artifact-validation.ts` with a narrow
`validateRasterBindingIdentity({ shapingHash, glyphCount })` and, only if the call sites remain clearer, a helper that opens
the declared extension and reports whether the GLB is combined. Keep technique descriptor, schema, reciprocal identity,
page, and record validation local.

**Distinguishing proof.** Run each validator's malformed hash and boundary glyph-count fixtures through the helper and
assert the same technique-specific error wrapper and JSON pointer are preserved.

**Impact.** Internal-only and small. No generated artifact or package boundary change.

## Deferred or rejected clone suggestions

### Defer Three-local shader/material scaffolding until after the executor migration

Fallow groups eight clones in `three/engine-plan-target.ts` into a family with 110 reported duplicated lines. They repeat
material cache keys, `runStart`, physical instance addressing, indexed-transform position, and material creation across
Bitmap, decoration, custom, MSDF, and Slug paths. This is real Three/TSL-local repetition, not a renderer-neutral Glyph
utility. Extract it only after F1 removes raw plan preparation; otherwise the refactor will polish code scheduled for
deletion. The eventual component should accept technique-authored shader fields but remain under `src/three`.

### Keep lazy record views explicit while the hierarchy settles

Fallow fingerprints `dup:ecd8dff4` and `dup:fd6dba52` report repeated mapper/state/view/offset constructors in four lazy
record-view classes. Those classes intentionally make each zero-copy layout projection visible. A base class or generic
getter DSL would reduce lines but add inheritance or hide which record owns which field. Reconsider only after the public
typed hierarchy and hot-path measurements stabilize.

### Keep crate-local `reserve` adapters

The shaper has several three-line `Vec::try_reserve` helpers that translate allocation failure into the current module's
error enum. They look alike but preserve local error ownership (`OrderedPlanError`, `StablePlanError`, `GatherError`, and
others), and some reserve capacity while others reserve an additional count. A generic abstraction would couple unrelated
state machines and save no safety knowledge.

### Keep generated and test-side ABI construction separate from production encoders

Fallow finds production `render-policy.ts` fragments in `tests/support/engine-abi.mjs` (`dup:535768b2` and
`dup:f7aac104`). The support module constructs boundary bytes for Wasm integration tests, while generated ABI layout data
is the shared authority. Reusing the production encoder would make those tests less capable of detecting boundary wiring
errors. Preserve the separate constructor and rely on the hand-numbered policy fixture for independent semantic evidence.
Generated Unicode tables and generated ABI output should continue to be reviewed through their generators and
regeneration checks, not line-level clone removal.

### Do not extract four-line build scripts

`mtsdf-baker/build.rs` and `slug-baker/build.rs` are byte-identical four-line Cargo entry points. Their duplication is
intentional crate wiring; sharing it would require more indirection than it removes. The same standard applies to tiny
package-local error message or checked-arithmetic helpers unless a drifted invariant is demonstrated.

## Updated integration order

This is the order in which the accepted findings should enter the active implementation plan:

1. **Completed: stabilize the canonical typed hierarchy and `createEngine`.** `TypedGroup`, lazy sequences, opaque
   identities, accepted/rejected overlays, the source-keyed transaction, and `defaultDecoder` now share one owner.
2. **Completed: migrate Three.** Its raw binder loops, original-candidate escape, and raw executor path are deleted;
   `ThreeTextRenderPlanExecutor` prepares meshes from bound batches and root instances.
3. **Migrate the example renderer.** Delete its raw `plan-reader`, command-record arrays, and local transaction maps. This
   is the remaining proof that the helper is renderer-neutral and not a Three-shaped library utility.
4. **Implement F3 while finalizing FontFace/R3F.** Share descriptor-derived raster identity before treating
   `useFont`/`preload`/`clear` lifecycle tests as final evidence.
5. **Implement F5 and F6 as bounded package cleanup after the API path is green.** They use existing portable owners and
   should not delay the renderer-neutral proof.
6. **Run F4 as a separate Rust boundary milestone.** It is valuable but does not gate the GlyphConfig contract. Require
   ABI, failure-path, artifact-size, and deterministic regeneration evidence before merging it.
7. **Re-run Fallow mild and weak on the same workspaces.** The success criterion is disappearance of the accepted clone
   families and source-backed ownership, not an arbitrary repository-wide percentage. If Fallow is adopted as a recurring
   gate later, add a package-owned workflow and intentionally reviewed exclusions rather than committing this one-off
   command as policy.

## Residual risks and smallest next probes

| Risk or uncertainty                                              | Smallest decisive probe                                                                                                                                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The generic publication owner becomes a Three-shaped abstraction | Compile the example config without importing Three and assert its schema payloads contain no `Object3D`, mesh, material, or Three buffer type.                                             |
| Lazy decoding still performs a hidden second pass                | Instrument raw record reads from candidate creation through renderer `prepare`; assert one indexed traversal of each consumed phase and no record visit for untouched lazy children.       |
| Wrapped decoders leak a hidden default frame                     | Call `defaultDecoder`, throw from the wrapper, and count payload/resolve lease disposal exactly once.                                                                                      |
| Descriptor identity is too expensive in React render             | Benchmark repeated `useFont` renders with a stable request; if material, memoize by technique plus raw input object while retaining descriptor identity as the equality authority.         |
| Shared Rust support increases Wasm size                          | Build each baker before/after through the package workflow and compare authenticated compressed and uncompressed artifacts, not Rust source lines.                                         |
| An apparent clone is an independent oracle                       | Require the proposed extraction's test to retain an independently authored fixture or implementation; reject it if both sides would then derive expected and actual bytes from one helper. |

## Tool limitations

- Fallow did not analyze Rust. Rust findings are manual and do not contribute to the reported duplication percentages.
- Fallow reports syntactic clone ranges, not ownership intent. Overlapping groups cannot be summed as unique removable
  lines, and semantic mode was too broad for direct action.
- The scan did not run type-aware analysis because duplicate-token detection does not need symbol identity. Existing
  TypeScript checks remain the authority for assignability and public-surface correctness.
- The audit did not run application, GPU, Wasm, unit, integration, or full repository checks because no implementation was
  changed. The report itself should be validated with the documentation conformance workflow.

## 2026-09-01 follow-up — trusted Rust output and JavaScript size

This follow-up inspected the dirty tree through `2026-09-01T20:58:18Z`, after both renderer binders moved onto
`createEngine`. It applies one explicit trust rule: Rust render-plan semantics are authoritative after publication
framing, table alignment, and byte bounds have been admitted. JavaScript should still validate user/config/plugin values,
portable resources at their loading boundary, and mutable host objects. It should not reinterpret a Rust-produced row as
untrusted input every time a renderer reads it.

### Snapshot correction and Fallow delta

The first report's F1 and F2 describe the earlier dirty-tree snapshot, not the state at this follow-up:

- `packages/glyph-example-renderer/src/command-buffer.ts:28-74` is now a thin wrapper over `createEngine`. The old
  renderer-local resource/buffer transaction is gone.
- `packages/glyph/src/three/command-buffer.ts:14-49` is also now a thin wrapper. Its old renderer-local mapper and
  resource/buffer transaction are gone.
- `packages/glyph/src/core/create-engine.ts:76-77,340-373` now keys decoded frames by source and disposes a staged frame
  even when a wrapping decoder throws before returning it. This closes F2 for integrations using `createEngine`.
- The example wrapper still records the candidate and calls `readCandidate` at
  `packages/glyph-example-renderer/src/command-buffer.ts:31-52`. That is now the principal example-renderer bridge to
  remove.
- The Three wrapper now delegates directly and has no candidate/frame/resource side map. `engineResourceState`,
  `threeCandidateForBoundFrame`, `threeResourceForBoundFrame`, and `threeResourceForBinding` were all deleted during this
  follow-up.

The refreshed Fallow 3.13.0 mild scan used the same signed tool and workspace scope as the first scan:

```text
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache \
  mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --mode mild --format json --pretty --quiet --no-cache \
  --output-file /tmp/fallow-glyph-followup-final-mild.json
```

The final follow-up run reports 451 files, 77 clone groups, 1,598 duplicated lines, and 1.693% line duplication. The first
mild scan found 81 groups and 1,728 duplicated lines. The 130-line reduction accompanies deletion of both binder state
machines and Three's raw executor rather than extraction of another renderer-shaped helper. Fallow no longer reports
`dup:af39b73a` (canonical mapper versus Three table opening) or `dup:0d974ffa` (wrapper settlement bridges). The remaining
Three clone groups are local TSL/material-realization repetition and the explicit typed-view constructors, not competing
render-plan decoders.

### Follow-up classification

Here, **delete now** means remove the path as the current config migration reaches that file; it does not mean bypass a
still-supported legacy entry point. **Compatibility** means the code is justified only while a named old surface remains
supported. **Experiment** means source evidence identifies a plausible size/allocation cost but a bundle or runtime
measurement must decide it.

| Classification    | Surface                                                                                          | Decision                                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Delete now        | Example config path's `readCandidate`/`ExampleDrawList` bridge and plan semantic validation      | Make the example renderer consume the bound hierarchy; keep no second raw-plan decode behind `defaultRenderer`.                                                                                      |
| Completed         | Three config path's candidate/resource escape and raw executor                                   | The renderer now consumes `BorrowedBoundCommandBuffer`, and host stores use bound object identity.                                                                                                   |
| Delete now        | Per-row semantic validation of an admitted Rust plan                                             | Remove production checks for wire enums, engine IDs, generations, row agreement, duplicates, and Rust-owned spans. Rust construction plus `validate_plan` own soundness; violations are engine bugs. |
| Compatibility     | Raw `PlanTarget`/`ExampleDrawList` APIs                                                          | Inventory and version intentionally supported low-level uses. Three now requires a coordinator with `GlyphConfig`; do not restore the raw executor for compatibility.                                |
| Required boundary | Publication header/version/status, table alignment, table byte bounds, and copied-buffer framing | Keep once at `RenderPlanView.bind`/`bindBytes`; do not repeat it in every accessor.                                                                                                                  |
| Required boundary | `GlyphConfig`, shader/plugin, portable font resource, and mutable Three object checks            | Keep at config construction, `resolve`, asset admission, or host mutation. These values do not become trusted merely because plan rows do.                                                           |
| Experiment        | Materializing bound update arrays and one cached JS view per accessed row                        | Measure after raw bridges are gone. Preserve borrowed lifetime and stable object identity unless evidence shows a material win.                                                                      |

### Validation and state-copy inventory

This inventory makes the trust distinction operational. “Keep” does not mean the check belongs in every renderer path; it
means the named boundary owns it once.

| Category                            | Exact current surface                                                                                                                        | Disposition                                                                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wasm framing/bounds validation      | `plan-view.ts:72-99,184-225` validates buffer ownership, whole-buffer framing, header/version/status, table alignment, and table byte spans. | Keep once at bind. These checks admit bytes from Wasm or a copied realm boundary.                                                                                 |
| Caller-selected byte/index bounds   | `plan-view.ts:119-174` bounds-checks `record`, scalar reads, and byte slices.                                                                | Keep for the low-level compatibility reader because its callers choose offsets and indexes. The canonical mapper may use a smaller trusted internal reader later. |
| Duplicate framing validation        | `plan-view.ts:102-116` repeats every table-descriptor check already completed by `validateResultBytes`.                                      | Delete now by caching admitted descriptors or making `table` a lookup.                                                                                            |
| Trusted Rust semantic validation    | `plan-view.ts:391-575` rechecks row enum membership and nonzero identities.                                                                  | Delete now from the canonical path. Rust construction plus `validate_plan` own soundness; a violation is an engine bug.                                           |
| Trusted Rust semantic validation    | Three's former raw preparation rechecked identities, generations, patch ranges, spans, and row agreement.                                    | Completed: deleted with the raw compatibility path.                                                                                                               |
| Trusted engine/config invariant     | Bound Three checks transform lookup/table capacity at `engine-plan-target.ts:1542-1552`.                                                     | Delete or demote to debug-only after focused proof. The loop reads the same transform map it just enumerated, and capacity was already derived from active IDs.   |
| Trusted Rust semantic validation    | Example plan/device preparation at `device.ts:448-590,790-1159` rechecks the same plan relationships.                                        | Delete from the normal config path. Keep only behind a caller-constructed `ExampleDrawList` compatibility entry if that entry remains.                            |
| User/config input validation        | Example shader admission at `device.ts:1203-1291`; Three material ownership at `engine-plan-target.ts:1458-1467`.                            | Keep. Shader definitions and material factories are integrator inputs.                                                                                            |
| Portable asset/resource validation  | `plan-program-registry.ts:230-306` and Three resource/geometry reads at `engine-plan-target.ts:1765-2070`.                                   | Keep at resolve/asset admission. The plan row is trusted, but referenced GLB/portable resource contents are not Rust-produced plan semantics.                     |
| Mutable host-object assertion       | Instanced-geometry compatibility at `engine-plan-target.ts:1997-2007`.                                                                       | Keep at mutation/use. Application or Three code can replace geometry after plan admission.                                                                        |
| Renderer capability assertion       | Bound Three span selection at `engine-plan-target.ts:803-820` and unknown-technique selection at `:1134`.                                    | Keep one exhaustive capability branch, preferably at schema/config binding. It is not plan validation.                                                            |
| JavaScript ownership/lifetime check | `create-engine.ts:95-100,349-383` and each renderer preparation's single-settlement guard.                                                   | Keep. These checks protect borrowed lifetime, engine ownership, and commit/discard, none of which Rust can prove.                                                 |

The current duplicated state inventory is similarly concrete:

- `createEngine` is the canonical owner: `DecodedState`, `#resourcesById`, and `#buffersById` live at
  `create-engine.ts:26-41,78-79`.
- Three now keys buffers, resources, textures, and pages by `ThreeBufferBinding` or `ThreeResolvedResourceBinding` at
  `engine-plan-target.ts:208-213,255-259`. Its `RetainedBuffer` and `RetainedResource` at `:61-79` now contain only
  Three-host realization state around those bound objects; they are no longer numeric mirrors of Rust plan rows.
- The in-flight synthetic `generation: 1`/`resourceKind: 1` records, `engineResourceState`, and all
  `three*ForBoundFrame`/`threeResourceForBinding` bridges were deleted. `ThreeCommandBufferBinder` is a direct 49-line
  delegate at `three/command-buffer.ts:14-49`.
- The duplicated raw `#prepareDraws` and 117-line Fallow clone were deleted. The remaining `#prepareBoundDraws` uses the
  lazy `BorrowedCommandSequence` through indexed `length`/`at()` access at `engine-plan-target.ts:746-840`; it does not
  spread the hierarchy into an intermediate array.
- The example path retains six record arrays plus four snapshots in `draw-list.ts:24-42`, while `device.ts:592-600` clones
  six resource indexes and `:905-945` clones every retained buffer before rebuilding `activeById`/`activeByName`. These are
  compatibility snapshots, not the config renderer's state model.

At the `2026-09-01T20:35:03Z` in-flight snapshot, Fallow rose to 86 groups, 2,082 duplicated lines, and 2.187% because the
bound Three realization path had been added before the raw path was removed. This is useful migration evidence, not a new
baseline. The post-deletion run reports 77 groups, 1,598 duplicated lines, and 1.693%; both the mapper/Three table-opening
clone and the bound/raw draw-preparation clone are gone.

### F7 — Delete now: JavaScript revalidates semantics Rust already admits

Rust performs semantic validation immediately before publication layout. `render_plan_wire.rs:239-375` rejects zero
resource/buffer/draw identities, invalid actions/opcodes/kinds/scalars/vector widths, zero primitive counts, non-finite
primitive geometry, and out-of-table draw spans. `publication_layout` calls it at `render_plan_wire.rs:163-168` before
serializing any table. The generated ABI then authenticates sizes and field offsets from the Rust records in
`abi_contract.rs:2319-2417`.

The valid JavaScript trust boundary is already present in `plan-view.ts`:

- `RenderPlanView.bind` and `bindBytes` prove ownership/full-buffer shape at `plan-view.ts:72-99`.
- `validateResultBytes` proves header size, declared byte length, ABI version, success status, table alignment, and table
  bounds at `plan-view.ts:184-225`.

Everything after that should be projection or renderer work. Current production code instead repeats the semantic proof:

- `RenderPlanView.table` repeats empty-table, alignment, multiplication, and bounds checks at `plan-view.ts:102-116` even
  though `validateResultBytes` already checked every table descriptor through `validateResultTable` at `:198-225` during
  bind. Fallow reports this exact duplication as `dup:cf36ced0`. Cache the admitted descriptors or make `table` a trusted
  lookup; bounds checks on caller-selected record indexes and byte spans remain valid.
- `readRenderPlanPatch`, `readRenderPlanResource`, `readRenderPlanBuffer`, `readRenderPlanPrimitive`, and
  `readRenderPlanRetirement` branch and throw again for opcode/action/scalar/kind/nonzero identity at
  `plan-view.ts:391-575`. `enumName` also walks `Object.entries` for each enum-bearing row at `plan-view.ts:570-575`.
- Three's raw read/prepare path and its 33 duplicated semantic checks were deleted during this follow-up. The only
  remaining bound-path candidates are the transform-map lookup and table-capacity assertions listed in the inventory
  above; these protect an internal engine/config invariant, not untrusted plan rows.
- The example device treats already-decoded plan records as unknown objects and rechecks them throughout
  `device.ts:448-590,790-1159`: draw spans, program/technique equality, resource generations, buffer shapes, patch
  opcodes, integer ranges, and retirement kinds are all checked again.

The correction is not to remove every throw in those files. Keep these boundaries:

- Portable resource and shader/config admission in `device.ts:686-752,1203-1291` and Three's
  `assertThreeGeometryPayload` calls. Those values originate in assets or integrator code.
- Instanced-geometry compatibility at `engine-plan-target.ts:1997-2007`, because application/Three code can replace host
  geometry after plan admission.
- Foreign borrowed-frame, disposed-owner, and single-settlement checks. They prove JavaScript ownership and lifetime,
  not Rust row semantics.
- `assertDrawList` when an `ExampleRendererDevice` still accepts a caller-constructed `ExampleDrawList` directly. That is
  a compatibility/user-input boundary; the normal config path should not manufacture such a list and then validate it.
- Exhaustive renderer capability selection, but move it to config/schema construction or one binding switch. An
  unsupported primitive is a config/renderer capability mismatch, not evidence that the Rust row is malformed.

Delete the semantic branches from the production config path. Keep mutation coverage in Rust around
`validate_plan`; JavaScript mutation tests should mutate only header length/version/status, table offsets/alignment,
table spans, copied `ArrayBuffer` framing, user config, and host resource values.

### F8 — Completed in this follow-up: Three consumes one bound plan

The canonical path now exists:

1. `TypedCommandBufferMapper.source` opens the six command tables and exposes the lazy hierarchy at
   `internal/typed-command-buffer.ts:135-199`.
2. `createEngine.decodeDefault` resolves resources, binds buffers/programs/materials/transforms, and calls config schema
   hooks at `core/create-engine.ts:95-342`.
3. `BorrowedBoundCommandBuffer.group` preserves authoritative Rust order as batches and root instances.

The completed path is now:

- `ThreeCommandBufferBinder` delegates source, decode, settlement, and disposal directly to `createEngine` at
  `three/command-buffer.ts:14-49`.
- `ThreeTextRenderPlanExecutor.#prepareRendererCommit` enters only `#prepareBound` at
  `engine-plan-target.ts:485-504`; no method in the file imports or calls a raw `readRenderPlan*` reader.
- `#prepareBound` applies bound updates and the ordered group at `engine-plan-target.ts:504-610`.
- Three's retained maps are keyed by `ThreeBufferBinding` and `ThreeResolvedResourceBinding` at
  `engine-plan-target.ts:208-213,255-259`. The remaining `Retained*` objects contain Three host attributes/resources, not
  copied Rust IDs or generations.
- Construction requires `coordinator.config`, creates the binder/default renderer, and selects the configured renderer at
  `engine-plan-target.ts:284-301`; `accept` always publishes through that config at `:323-332`. The old raw fallback was
  not preserved as a compatibility branch.

Three-only state remains correctly local: `StorageInstancedBufferAttribute`, `NodeMaterial`, mesh reuse, update ranges,
GPU texture/page caches, and transform synchronization. The remaining numeric values created by `#bindingId` are private
cache-key tokens for object identity; they are not exposed plan IDs or a second ownership map.

### F9 — Delete now: the example bridge eagerly allocates and copies the raw plan

The example's 74-line binder proves `createEngine` is renderer-neutral, but its remaining bridge defeats the
zero-copy hierarchy:

- `command-buffer.ts:31-50` stores the candidate after the canonical engine has already mapped it; line 52 materializes
  the duplicate list through `readCandidate`.
- `plan-reader.ts:26-70` decodes six complete row arrays and constructs four raw table snapshots.
- Because the synchronous candidate is `delivery === 'borrowed'`, `plan-reader.ts:17-18,47-50,75-87` also copies every
  write payload and the resources, buffers, primitives, and diagnostics table bytes.
- `ExampleDrawList` then retains the six raw arrays and four snapshots at `draw-list.ts:24-42`.
- `ExamplePlanTarget.#prepareBoundFrame` hands that duplicate list back into the legacy acceptance path at
  `engine.ts:409-423`, which rebuilds resource and buffer state in `engine.ts:308-384` and `device.ts:790-1120`.
- Candidate buffer preparation copies every retained buffer's bytes before each replacement publication at
  `device.ts:944-946`, then builds `activeById` and `activeByName` maps over the clones at `:894-920`.

The replacement is direct: the example schema should create meaningful resource, buffer, batch, instance, and span
bindings, and the recording device should apply `frame.updates` and traverse `frame.group.value.children`. Its retained
CPU buffer object may still use copy-on-write for transactional commit, but it should not clone every retained allocation
or recreate raw ID/name indexes when no patch touches it. If `ExampleTextEngine.publish(): ExampleDrawList` remains as an
intentional inspection API, build that snapshot on explicit inspection rather than as a prerequisite for every render.

### F10 — Compatibility boundary: raw public record types shadow the generated Rust contract

There is no second generated TypeScript record schema today. Instead, one hand-authored public semantic mirror repeats a
subset of the generated Rust field inventory:

- Rust owns `ResourceRecord`, `BufferRecord`, `PatchRecord`, `PrimitiveRecord`, `DrawRecord`, and `RetirementRecord` at
  `rust/shaper/src/engine/render_plan.rs:32-141`.
- The ABI generator exports their exact sizes and offsets at `abi_contract.rs:2319-2417` and
  `generated/text-shaper-abi.ts`.
- `core/plan-view.ts:227-382` manually declares branded IDs, enum strings, and six decoded record interfaces, then
  `:384-575` manually projects generated offsets into them.
- The mirror is intentionally partial, which makes drift visible: for example, the Rust resource carries
  `flags/lower_bound/upper_bound/auxiliary*` and the buffer carries `strategy/flags/live_records/order_buffer_id`, while
  the corresponding public TypeScript records omit those fields.
- `core.ts:129-160` publishes the raw view, all six readers, and all raw record types. The private example package then
  aliases them again in `draw-list.ts:1-42`.
- `plan-view.ts:18-26` and `render-planner.ts:87-96` also define two structural `RenderPlanReader` interfaces; the second
  only adds `table`.

The canonical `TypedGroup`/`Typed*Command` types are not another wire mirror. They deliberately remove numeric IDs and
represent renderer meanings and borrowed lifetime. Keep those as the config-facing representation.

| Structure                                                                                     | Ownership/classification                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rust `*Record` structs in `render_plan.rs:32-141`                                             | Authoritative engine semantics and wire field source. Keep.                                                                                                        |
| Generated sizes/offsets in `text-shaper-abi.ts`                                               | Authoritative JavaScript framing/layout inventory. Keep generated; do not hand-edit.                                                                               |
| Public `RenderPlan*Record` interfaces and readers in `plan-view.ts:227-575`                   | Compatibility mirror. Decide explicitly whether `/core` keeps it; otherwise internalize/delete. Do not use in `GlyphConfig`.                                       |
| `TypedGroup`, `TypedBatch`, `TypedRootInstance`, and `TypedInstanceSpan` in `glyph-config.ts` | Canonical semantic projection for integrators. Keep; these are intentionally not one-to-one wire rows.                                                             |
| Three host `RetainedResource`/`RetainedBuffer` in `engine-plan-target.ts:61-79`               | Completed migration. Keep the Three realization metadata around config-bound object identities; it no longer mirrors Rust IDs or generations.                      |
| Example raw aliases and `ExampleDrawList` arrays/snapshots in `draw-list.ts:1-42`             | Compatibility/inspection snapshot only. Remove from normal rendering; construct on explicit inspection if the example's published snapshot API remains.            |
| Two `RenderPlanReader` interfaces in `plan-view.ts:18-26` and `render-planner.ts:87-96`       | Small structural duplicate. Consolidate only with the raw `/core` compatibility decision; do not let it pull the low-level reader into config-facing public types. |

Raw `PlanTarget`, `RenderPlanReader`, and record exports are a compatibility decision because `/core` is a published
integrator surface. They must not remain merely because the in-tree renderers still use them. Inventory external use and
choose one of two explicit contracts:

1. keep a documented low-level raw-plan compatibility subpath, derive its field types from the Rust-generated contract,
   and exclude it from `GlyphConfig`; or
2. move the raw view/readers/types to `internal` in the next breaking surface and expose only the canonical typed command
   buffer to integrators.

Do not generate public row interfaces that ordinary renderer configs never need.

### F11 — Experiment after bridge deletion: measure bound-view allocation and bundle removal

The size concern is real, but the dirty tree has not been rebuilt, so source bytes are only prioritization evidence. The
largest relevant source files are:

| Source                             | Raw source bytes | gzip -9 source bytes | Status                                                                               |
| ---------------------------------- | ---------------: | -------------------: | ------------------------------------------------------------------------------------ |
| `three/engine-plan-target.ts`      |           90,129 |               18,618 | Bound-only Three host realization; raw preparation has been deleted.                 |
| `three/command-buffer.ts`          |            1,885 |                  669 | Direct `createEngine` delegate with no transitional candidate/resource bridge.       |
| `core/plan-view.ts`                |           24,043 |                5,148 | Framing owner plus compatibility raw decoders; only the latter is removable.         |
| `internal/typed-command-buffer.ts` |           31,894 |                5,745 | Canonical lazy mapper; do not replace its explicit views without measurement.        |
| `core/create-engine.ts`            |           19,197 |                4,150 | Canonical transaction/binder; transitional resource-state escape has been deleted.   |
| `glyph-example-renderer/device.ts` |           58,978 |               11,466 | Example device plus a large raw-plan validator/state machine scheduled for deletion. |

The last checked package-size evidence records the Three runtime at 742,195 raw and 119,864 gzip bytes in
`apps/benchmarks/src/generated/package-sizes.json:64-72`, against 743,000 raw and 121,000 gzip ceilings in
`package-size-budgets.ts:84-93`. That evidence predates the unbuilt dirty tree and leaves only 805 raw and 1,136 gzip
bytes of budget. It justifies an immediate before/after size experiment once the tree compiles; it does not prove how
many bundled bytes any one source deletion will save.

The temporary in-flight `engine-plan-target.ts` reached 123,068 raw and 24,008 gzip-compressed source bytes while bound
preparation existed beside raw preparation. After the raw path was deleted it fell to 90,129 raw and 18,618 compressed
bytes: 15,986 raw and 3,310 compressed bytes below the 106,115/21,928 pre-cutover snapshot. These are not bundle
measurements, but they demonstrate that the migration deleted the duplicate rather than leaving a permanent second path.

After F8-F10 are complete, run the package-owned `release:size:check` workflow and record at least these deltas:

- `/core` before/after raw reader exports and semantic decoder removal;
- `/three` before/after candidate/resource bridges and executor raw parsing;
- the example renderer before/after `ExampleDrawList` reconstruction and semantic validators.

Only then evaluate `createEngine`'s eager `Array.from` calls at `create-engine.ts:108-203,230-324`. Resource resolution,
buffer construction, and retirement settlement are intentionally eager before renderer preparation. The returned command
wrapper arrays may be replaceable by cached borrowed views, but that is an **experiment**: instrument row-object counts
and compare minified/gzip/Brotli output plus publish time. Do not sacrifice exactly-once resolve/dispose behavior or stable
object identity for an unmeasured allocation preference.

### Follow-up completion gates

1. A config publication reaches both example and Three renderers with one raw-table projection: the canonical mapper.
2. Neither renderer imports `readRenderPlan*`, `RenderPlan*Record`, `RenderPlanReader`, or `PlanCandidate` for normal
   config rendering.
3. Production JS rejects corrupted framing and user/config/host inputs, but has no second semantic validator for rows
   emitted by Rust.
4. Example and Three tests mutate semantic plans in Rust or an authenticated fixture generator, not by expecting the JS
   renderer to distrust valid engine output.
5. The raw `/core` compatibility decision is explicit and does not leak into `GlyphConfig` types.
6. `release:size:check` is run on the built post-migration tree, with before/after entry measurements retained in the
   change evidence.

## 2026-09-01 post-cutover re-audit

This section supersedes the implementation-status claims in F7-F11 while retaining those snapshots as migration history.
It audits the shared dirty tree after the bound hierarchy, example renderer, FontFace/React, Three executor, and paired
example cutovers. No product source was changed for this audit.

### Current tool run and metrics

The audit reran the signed upstream Fallow 3.13.0 package with the same isolated verification cache and no result cache:

```sh
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes --root . --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' --mode mild --format json --pretty --quiet --no-cache --output-file /tmp/fallow-glyph-post-cutover-mild.json
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes --root . --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' --mode weak --format json --pretty --quiet --no-cache --output-file /tmp/fallow-glyph-post-cutover-weak.json
```

| Mode | Files | Files with clones |  Lines | Duplicated lines |  Tokens | Duplicated tokens | Groups | Instances |    Rate |
| ---- | ----: | ----------------: | -----: | ---------------: | ------: | ----------------: | -----: | --------: | ------: |
| mild |   460 |                60 | 93,637 |            1,467 | 541,171 |            11,286 |     71 |       155 | 1.5667% |
| weak |   460 |                76 | 93,637 |            2,345 | 541,171 |            15,758 |     96 |       219 | 2.5044% |

The mild result improved from 77 groups/1,598 lines/1.693% in the preceding snapshot and from 81 groups/1,728
lines/1.827% in the initial scan. The weak result improved from the initial 109 groups/2,651 lines/2.804% to 96
groups/2,345 lines/2.504%. Fallow still does not parse Rust, so Rust findings below remain source and byte-comparison
evidence rather than Fallow metrics.

### Prior finding resolution matrix

| Prior concern                                    | Current result                                                                                                                                                                                                                                                     | Current evidence                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Example plan reader and snapshot record arrays   | **Resolved.** `plan-reader.ts` and `snapshot.ts` are deleted. The 18-line `ExampleCommandBufferBinder` delegates directly to `createEngine`; `retainDraws()` retains renderer-owned values from `BorrowedBoundCommandBuffer` rather than reconstructing Rust rows. | `glyph-example-renderer/src/command-buffer.ts:1-18`, `device.ts:295-335`, `draw-list.ts:9-45`                                                               |
| Three and external raw-plan reconstruction       | **Resolved for normal config rendering.** `ThreeCommandBufferBinder` is a thin `createEngine` wrapper, and the example target calls decode/bind/renderer without a raw fallback. `PlanCandidate` remains only the planner boundary input.                          | `glyph/src/three/command-buffer.ts:14-48`, `glyph-example-renderer/src/engine.ts:269-277`                                                                   |
| React versus core raster request identity        | **Resolved in implementation.** React preload/load/clear use the same descriptor-derived `fontFaceResourceKey()` as core. The former React-only raw option serializer is gone.                                                                                     | `glyph/src/font-face.ts:249-254,488-514`, `glyph/src/react.ts:529-560`, `tests/package/raster-identity.test.mjs:7-41`                                       |
| Stale semantic validation of trusted Rust output | **Resolved in renderer paths.** Example and Three consume the typed/bound hierarchy. Their remaining checks are config, portable asset, host-resource, or renderer capability assertions.                                                                          | `glyph-example-renderer/src/device.ts:337-555`, `glyph/src/three/internal/draw-realizer.ts:108-249`, `glyph/src/three/internal/material-realizer.ts:75-515` |
| Manual TypeScript ABI shadows                    | **Accepted compatibility boundary, not resolved.** The hand-written raw records/readers remain public and documented under `/core`; ordinary `GlyphConfig` consumers receive `TypedGroup` and do not receive numeric IDs.                                          | `glyph/src/core/plan-view.ts:227-575`, `glyph/src/core.ts:130-161`, `docs/guides/renderer-integration.md:251-315,405-415`                                   |
| Rust Wasm response and progress duplication      | **Unresolved.** MTSDF and Slug still duplicate allocation and segmented-response ownership; three progress modules remain byte-identical.                                                                                                                          | `mtsdf-baker/src/wasm.rs:314-576`, `slug-baker/src/wasm.rs:256-515`, each baker's `src/progress.rs`                                                         |
| JavaScript code volume and release size          | **Improved and passing, but tight.** The Three executor is decomposed and raw bridges are deleted. The built `/three` entry retains only 805 raw and 1,136 gzip bytes of budget headroom.                                                                          | Current source-size table and `release:size:check` results below                                                                                            |

### Trust-boundary classification

| Check or assertion                                                                                   | Classification                                       | Decision                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RenderPlanView.bind()`, `bindBytes()`, `validateResultBytes()`, and record bounds                   | Wasm framing/alignment/bounds or cross-realm input   | Keep. These establish safe JavaScript access to the publication, not semantic distrust of Rust. See `plan-view.ts:72-99,119-125,159-225`.                                                         |
| `RenderPlanView.table()` repeats descriptor alignment and range checks after `validateResultBytes()` | Redundant validation on an already admitted view     | Delete the second implementation by caching admitted descriptors. Fallow mild group `dup:cf36ced0` reports the duplicated blocks at `plan-view.ts:107-113` and `:216-222`.                        |
| Public `readRenderPlan*()` enum and nonzero-ID checks                                                | Compatibility-input validation                       | Keep while `/core` accepts an arbitrary structural `RenderPlanReader`. Removing these without changing that public contract would make externally supplied readers unsafe.                        |
| `RenderPlanner.#resolvePlanPayloads()` calls `readRenderPlanResource()` solely for `referenceId`     | Redundant semantic validation of trusted Rust output | Add one internal trusted reference-ID accessor, or read the generated field through the admitted view. Do not weaken the public compatibility reader. See `render-planner.ts:1187-1205`.          |
| Example shader/schema, geometry, missing binding, and TypeGPU device checks                          | User/config input or renderer capability assertion   | Keep. These validate values constructed outside Rust or declare what the renderer can realize; they do not revalidate plan-row semantics. See `device.ts:337-555` and `webgpu-device.ts:350-546`. |
| Three portable resource, geometry, material factory, and unsupported-span checks                     | User/resource input or renderer capability assertion | Keep. See `three/internal/portable-resource.ts:18-76`, `geometry-realizer.ts:27-114`, `material-realizer.ts:75-515`, and `draw-realizer.ts:108-249`.                                              |
| Three transform lookup/table bounds at `engine-plan-target.ts:641,648`                               | Renderer-owned internal invariant                    | Keep as an assertion unless a focused benchmark proves it material. It guards Three's object store and prepared transform buffer, not raw Rust row validity.                                      |

The result matches the intended trust model: Rust semantics are admitted once; JavaScript still protects memory framing,
user/config values, and host capability boundaries.

### Actionable residual duplication

1. **Delete now — one example commit-state swap.** `device.ts:220-260` duplicates the exact accepted-state map/list swap
   between synchronous and asynchronous publication. Fallow mild group `dup:a7bdfa37` reports the duplicate around
   `:229-240` and `:249-260`. Extract one private commit operation while preserving the async-in-flight guard.
2. **Delete now — one Three scene-tree predicate.** `visibleBelowRoot()` is identical in
   `engine-plan-target.ts:709-715` and `transform-synchronizer.ts:86-92` (Fallow `dup:b36b1cfb`). Move it to one Three
   internal scene-tree utility.
3. **Delete now — repeated admitted table validation.** Cache the descriptor validated by
   `validateResultBytes()` so `RenderPlanView.table()` does not repeat it. Preserve record-index bounds.
4. **Small follow-up — portable baker wrappers.** Fallow groups `dup:92659ced` and `dup:4b3aae4a` still identify the
   stable response envelope in `bakers/bitmap.ts:66-138`, `bakers/msdf.ts:69-171`, and `bakers/slug.ts:65-141`.
   Extract protocol helpers, not technique behavior.
5. **Small follow-up — raster artifact envelopes.** Groups including `dup:d0562f8a`, `dup:d67efd84`, and
   `dup:e9b965a7` remain among technique validators. Extend `internal/raster-artifact-validation.ts`; do not introduce
   a second validation framework.
6. **Rust refactor — shared Wasm response owner.** MTSDF `Allocation` and `allocate/adopt/deallocate` at
   `mtsdf-baker/src/wasm.rs:327-382` match Slug at `slug-baker/src/wasm.rs:266-321`. The broader prepared segmented
   response paths remain structurally duplicated at MTSDF `:408-576` and Slug `:347-515`. Extract a crate-level owner
   with technique-specific metadata/error encoding at the edge.
7. **Rust refactor — shared progress module.** Bitmap, MTSDF, and Slug `src/progress.rs` are byte-identical 22-line
   files with SHA-256 `77d29a50d685c9e81ee84879d871431edd2afc13e93fa2847dfc8725333995bb`. Own this once in a shared crate.

The following repeats are intentionally retained:

- Bitmap/MSDF/Slug material realization has parallel renderer-DSL structure. `MaterialRealizer` already centralizes
  cache keys and reference ownership; a generic per-technique functor would obscure real Three primitives and grow the
  abstraction surface.
- Typed view constructors are explicit zero-copy projections over distinct record shapes.
- `ExampleDrawList` is renderer-owned inspection/output data, not a second command buffer. Its retained scalar snapshot
  is legitimate because the borrowed command buffer expires when publication settles.
- `cloneBuffers()` at `device.ts:363-367` is transactional copy-on-write host state. It is not a raw-plan copy or an ABI
  shadow.
- The public raw `/core` readers are documented compatibility code. Generate or internalize them only as an explicit
  public-contract change; do not leak them into `GlyphConfig` or ordinary renderer consumption.

### Current code-volume and built-size evidence

The executor decomposition replaced the former 90,129-byte bound-only monolith with smaller ownership-focused units:

| Source                                     | Raw source bytes | gzip -9 source bytes |
| ------------------------------------------ | ---------------: | -------------------: |
| `three/engine-plan-target.ts`              |           29,708 |                7,228 |
| `three/internal/draw-realizer.ts`          |           11,594 |                3,263 |
| `three/internal/material-realizer.ts`      |           25,743 |                5,413 |
| `three/internal/render-state.ts`           |            4,386 |                1,212 |
| `three/internal/host-buffer.ts`            |            6,563 |                1,826 |
| `core/plan-view.ts`                        |           24,043 |                5,148 |
| `internal/typed-command-buffer.ts`         |           32,175 |                5,843 |
| `core/create-engine.ts`                    |           18,088 |                4,037 |
| `glyph-example-renderer/device.ts`         |           23,446 |                5,469 |
| `glyph-example-renderer/command-buffer.ts` |              994 |                  381 |

These are source measurements, not bundle attribution. The authoritative built check was rerun after `mise exec -- pnpm
build`:

```text
core-subpath-js  raw 433,145 / 437,000; min 283,507 / 286,000; gzip 70,300 / 71,500; br 58,845 / 60,000
browser-core     raw 453,108 / 456,000; min 292,802 / 295,000; gzip 74,158 / 82,400; br 61,832 / 63,500
three-runtime-js raw 742,195 / 743,000; min 476,120 / 478,000; gzip 119,864 / 121,000; br 98,752 / 100,000
```

`mise exec -- pnpm scripts run release:size:check` passed and the generated sizes match the committed report. The paired
example app also built both dynamically selected entries; Vite still warns about chunks over 500 kB. There is no package
size budget for `glyph-example-renderer`, so its 23,446-byte device remains source-volume evidence only. The `/three`
entry is the release risk: 805 raw, 1,880 minified, 1,136 gzip, and 1,248 Brotli bytes of headroom. Prefer the concrete
deletions above over new generic adapter layers.

### Current conclusion

The renderer-abstraction duplication targeted by F7-F9 is complete: one canonical typed projection feeds one bound
hierarchy, and both in-tree renderers consume renderer-bound objects. Remaining work is localized housekeeping, public
compatibility policy, and Rust Wasm ownership—not a second renderer engine. The smallest high-value sequence is:

1. share the example commit swap and Three visibility predicate;
2. cache admitted table descriptors and add the one trusted internal resource-reference accessor;
3. extract the Rust allocation/segmented-response owner and progress module;
4. consolidate baker envelopes/validators only with focused tests and before/after `release:size:check` evidence;
5. defer any raw `/core` type generation or internalization until its documented compatibility contract is explicitly
   approved.

### Verification result

- `mise exec -- pnpm build`: passed for the monorepo, including the paired imperative Three and R3F example entries;
  Vite emitted its existing greater-than-500-kB chunk warning.
- `mise exec -- pnpm scripts run release:size:check`: passed with the exact built sizes recorded above.
- `mise exec -- pnpm exec oxfmt docs/planning/fallow-duplication-audit.md --write`: passed.
- `git diff --check -- docs/planning/fallow-duplication-audit.md`: passed. The report is an untracked file in this dirty
  tree, so a separate no-index whitespace check was also used for the whole added file.
- `mise exec -- pnpm scripts run docs:check`: OKF conformance passed with zero errors, and the audit has no missing local
  links. The workflow exited 1 for two unrelated producer-profile errors in the concurrently changing tree:
  `docs/packages/benchmarks.md` expects source digest
  `sha256:5efc764e75a5383d1eb5bcae494744ded90a8504da0ebfb27309979940750867`, and
  `docs/packages/examples.md` expects `sha256:0dd0e8d20b53ce47c29b4b5f9b57d714cabc28491e6ba63390bc75361945a51c`.
  This audit did not update package concept digests because it changed no product source and the shared tree's application
  changes belong to the parent task.

## 2026-09-01 post-remediation re-audit

This section supersedes the pending-action and verification status immediately above. It reruns the same signed tool and
repository workflows after the four small TypeScript remediations landed; no product code was changed by this audit.

### Remediation verification

| Target                                       | Result                                                                                                                                                                          | Evidence                                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Example synchronous/asynchronous commit swap | **Resolved.** Both publication paths call one `commitPreparedState()`; the async path still exclusively owns the in-flight guard. Fallow no longer reports `dup:a7bdfa37`.      | `glyph-example-renderer/src/device.ts:219-254`                                                                  |
| Three `visibleBelowRoot()`                   | **Resolved.** One helper is imported by both consumers. Fallow no longer reports `dup:b36b1cfb`.                                                                                | `glyph/src/three/internal/scene-tree.ts:1-11`, `engine-plan-target.ts:38,637`, `transform-synchronizer.ts:3,42` |
| Admitted table descriptors                   | **Resolved.** Bind validation returns frozen descriptors, stores them on the view, and `table()` performs only the bound-state lookup. Fallow no longer reports `dup:cf36ced0`. | `glyph/src/core/plan-view.ts:65-109,179-222`                                                                    |
| Trusted resource reference                   | **Resolved.** The planner uses the internal generated-offset accessor instead of the public semantic decoder.                                                                   | `glyph/src/core/plan-view.ts:224-232`, `glyph/src/core/render-planner.ts:1187-1205`                             |

The trusted accessor retains `plan.record()` and `plan.u32()` bounds checks. Those are framing safety on a borrowed view,
not semantic revalidation of Rust output.

### Fresh Fallow result

The exact rerun was:

```sh
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes --root . --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' --mode mild --format json --pretty --quiet --no-cache --output-file /tmp/fallow-glyph-post-remediation-mild.json
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache mise exec -- pnpm dlx fallow@3.13.0 dupes --root . --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' --mode weak --format json --pretty --quiet --no-cache --output-file /tmp/fallow-glyph-post-remediation-weak.json
```

Fallow 3.13.0 again reported `verified: yes` and `signed`.

| Mode | Files | Files with clones |  Lines | Duplicated lines |  Tokens | Duplicated tokens | Groups | Instances |    Rate |
| ---- | ----: | ----------------: | -----: | ---------------: | ------: | ----------------: | -----: | --------: | ------: |
| mild |   461 |                57 | 93,642 |            1,396 | 541,226 |            10,814 |     68 |       149 | 1.4908% |
| weak |   461 |                73 | 93,642 |            2,274 | 541,226 |            15,286 |     93 |       213 | 2.4284% |

Relative to the immediate post-cutover scan, both modes dropped three groups, six instances, and 71 duplicated lines.
Mild duplicated tokens fell by 472; weak duplicated tokens fell by 472. The four remediated fingerprints are absent.

The only current mild match spanning the typed core and Three is `dup:9b0bd738`: sequential `.clear()` calls in
`internal/typed-command-buffer.ts:362-371` and `three/engine-plan-target.ts:297-306`. This is a false positive. Each
method disposes a different owner's distinct maps after owner-specific cleanup; extracting a cross-boundary “clear these
fields” helper would hide state ownership and provide no reusable semantic operation.

### Remaining actionable findings

The prioritized residual list is unchanged outside the four completed items:

1. MTSDF and Slug still duplicate their Wasm allocation and segmented-response owner; Bitmap, MTSDF, and Slug still have
   byte-identical progress modules.
2. The stable Bitmap/MSDF/Slug TypeScript baker response envelopes remain candidates for small protocol helpers.
3. Raster artifact validators still repeat shared envelope invariants that belong in
   `internal/raster-artifact-validation.ts`.
4. **Resolved by D-313.** The raw `RenderPlan*Record` types/readers and their manual semantic mirror of Rust are deleted.
   `RenderPlanView` now owns framing, alignment, and bounds only; integrators receive the canonical typed
   `CommandBufferView` through `GlyphConfig`.
5. Per-technique Three material DSL branches and zero-copy typed view constructors remain intentional parallel structure.

### Fresh build and size evidence

`mise exec -- pnpm build` passed for all packages and both applications. The paired example again produced separate
imperative Three and R3F entries; Vite emitted only its existing greater-than-500-kB chunk warnings.

`mise exec -- pnpm scripts run release:size:check` now exits 1 because the committed package-size report is stale. The
freshly measured current entries are:

| Entry              | Current raw | Current min | Current gzip | Current Brotli | Existing ceilings                     | Result                                                                    |
| ------------------ | ----------: | ----------: | -----------: | -------------: | ------------------------------------- | ------------------------------------------------------------------------- |
| `core-subpath-js`  |     473,665 |     310,671 |       76,127 |         63,608 | 437,000 / 286,000 / 71,500 / 60,000   | Exceeds by 36,665 / 24,671 / 4,627 / 3,608                                |
| `browser-core`     |     461,134 |     298,220 |       75,665 |         63,028 | 456,000 / 295,000 / 82,400 / 63,500   | Exceeds raw/min by 5,134 / 3,220; gzip/Brotli retain 6,735 / 472 headroom |
| `three-runtime-js` |     786,300 |     505,733 |      126,888 |        104,462 | 743,000 / 478,000 / 121,000 / 100,000 | Exceeds by 43,300 / 27,733 / 5,888 / 4,462                                |

Compared with the committed size report, the dirty tree measures +40,520 raw/+5,827 gzip for `/core`, +8,026
raw/+1,507 gzip for browser core, and +44,105 raw/+7,024 gzip for `/three`. The four remediations themselves reduced
source repetition and are too small to explain those aggregate increases; the shared dirty tree includes broader API and
example changes. Do not re-price the baselines from this audit. First attribute the entry growth, remove dead transitional
surface where possible, then update budgets and the generated report only with maintainer approval.

For source-volume context after remediation, `glyph-example-renderer/src/device.ts` is 23,003 raw/5,464 gzip bytes,
`three/engine-plan-target.ts` is 29,449/7,147, the shared `three/internal/scene-tree.ts` is 423/267, and
`core/plan-view.ts` is 24,241/5,298. These are not bundle attribution.

### Fresh documentation and whitespace evidence

- `mise exec -- pnpm exec oxfmt docs/planning/fallow-duplication-audit.md --write`: passed.
- `git diff --check -- docs/planning/fallow-duplication-audit.md` passed; a no-index check of the complete untracked
  report emitted no whitespace errors.
- The report contains no stale Markdown links to the deleted example `plan-reader.ts` or `snapshot.ts`.
- `mise exec -- pnpm scripts run docs:check`: OKF conformance passed with zero errors and no missing links. The workflow
  exited 1 only because concurrent Glyph source changes left `docs/packages/glyph.md` with a stale `source_digest`; the
  expected value is `sha256:ff85f8d85b22eb9ffaad7696e30adccb3e654aabac52a4309d16103fee7bb0b9`.
- This audit did not update package digests, size baselines, or product source.
