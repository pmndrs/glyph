---
type: Investigation Report
title: Glyph API test coverage and duplication audit
description: Evidence-backed review of the Glyph, Three, R3F, and custom-renderer test portfolio, with consolidation decisions and compile-time inference gaps.
documentation_type: explanation
tags: [planning, maintainability, testing, duplication, glyph, threejs, react, typescript]
status: draft
sources:
  - id: engineering-standard
    resource: ../engineering/code-style.md
    title: Engineering house style
  - id: glyph-api-types
    resource: ../../packages/glyph/tests/types/glyph-api.test.ts
    title: GlyphConfig compile-time fixture
  - id: three-integration
    resource: ../../packages/glyph/tests/integration/three-v1.test.mjs
    title: Public Three integration suite
  - id: react-lifecycle
    resource: ../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs
    title: React and R3F lifecycle suite
  - id: font-face-handle
    resource: ../../packages/glyph/tests/integration/font-face-handle.test.mjs
    title: FontFace and configured-handle integration suite
  - id: typed-command-buffer
    resource: ../../packages/glyph/tests/integration/typed-command-buffer.test.mjs
    title: Lazy typed command-buffer projection test
  - id: r3f-live-probe
    resource: ../../apps/r3f-hello-world/scripts/live-check.probe.ts
    title: R3F browser probe
  - id: three-live-probe
    resource: ../../apps/r3f-hello-world/scripts/three-live-check.probe.ts
    title: Imperative Three browser probe
  - id: example-renderer-tests
    resource: ../../packages/glyph-example-renderer/tests/example-render.test.ts
    title: Public custom-renderer product test
  - id: deslop-readme
    resource: https://github.com/dabit3/deslop/blob/a594d94306b44feddba1633ce92082f3820b2a04/README.md
    title: deslop README at audited revision
  - id: deslop-analyzer
    resource: https://github.com/dabit3/deslop/blob/a594d94306b44feddba1633ce92082f3820b2a04/lib/analyzer.js
    title: deslop diff-first analyzer
  - id: deslop-patterns
    resource: https://github.com/dabit3/deslop/blob/a594d94306b44feddba1633ce92082f3820b2a04/lib/patterns.js
    title: deslop pattern catalog
generated:
  by: openai-codex/gpt-5.6
  at: '2026-09-02T00:00:00-04:00'
---

# Glyph API test coverage and duplication audit

## Agent summary

The refactor is not short of tests. `packages/glyph` currently declares 455 top-level Node tests, 20 TypeScript fixture
files, and 322 Rust `#[test]` functions. The five new-API runtime files alone contain 57 top-level tests. The primary
problem is authority: some behavior is asserted repeatedly at adjacent layers, while the highest-order R3F probe does not
measure the per-technique counts it reports and uses an arbitrary 600-frame loop as its completion condition.

The best evidence should remain:

- `font-face-handle.test.mjs` exercises FontFace loading through both renderer-neutral and Three handles using public
  imports, including stable promises, handle-relative defaults, hidden Text leases, aliases, and Blob input.
- `three-v1.test.mjs` exercises the complete public Three lifecycle, named roots, scene boundaries, config wrapping,
  semantic publication, transform-only synchronization, batching, hierarchy, and cleanup.
- `react-lease-lifecycle.test.mjs` exercises actual R3F construction, provider-free defaults, providers, portals, FontFace
  suspension, and unmount ownership.
- `typed-command-buffer.test.mjs` owns the distinct internal zero-copy/lazy-projection and identity-settlement invariant.
  A browser test cannot replace it, but the private import is not evidence of a public entry point.
- `root-registry.test.mjs` owns the private root registry's disposal and invalid-factory state machine.
- `glyph-example-renderer` proves a non-Three integration can compile and render through public package entry points.

The portfolio can become smaller without losing those boundaries. Seven overlapping React success cases can collapse
into two product lifecycle scenarios, one named-root test can fold into the portal scenario, and repeated live-probe
inspection should be one helper. No conformance, fuzz, exact-byte, failure-injection, or type-contract test should be
removed merely because a demo also renders text.

## Scope and evidence

This audit inspected `packages/glyph/tests`, the root-exported integration vocabulary plus the private `src/core` and
`src/internal` fixture surfaces relevant to the new GlyphConfig API, both `apps/r3f-hello-world` live probes, and the
custom renderer's public boundary tests. The package has no public `/core` export. The keep/consolidate decisions below
come from the current files and their asserted failure modes rather than volatile branch-wide line counts.

The exact-pinned duplication probe was:

```sh
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache \
  mise exec -- pnpm dlx fallow@3.13.0 dupes \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-examples' \
  --no-production \
  --mode mild \
  --min-tokens 50 \
  --min-lines 5 \
  --top 100 \
  --format json \
  --pretty \
  --quiet \
  --no-cache \
  --output-file /tmp/fallow-glyph-tests-dupes.json
```

Fallow 3.13.0 reported 464 eligible files, 70 clone groups, 1,446 duplicated lines, and 1.529%. Its default duplicate
discovery skipped all 142 `**/*.test.*` files even with `--no-production`; therefore those aggregate numbers do **not**
measure semantic test duplication. They are useful only for test support modules and the `.probe.ts` files. The overlap
decisions below come from exact test-name/source inspection, not from treating the Fallow percentage as coverage evidence.

The upstream `dabit3/deslop` repository was inspected at its current sole revision,
`a594d94306b44feddba1633ce92082f3820b2a04` (`deslop` 1.0.0). It is a diff-scoped regex scanner, not a test-coverage or
clone-analysis tool. The useful rules imported into maintainability guidance are limited to changed-line review,
excluding built/vendor output, removing debug or entry/exit logging, replacing vague TODOs, removing syntax-narrating
comments, and rejecting catch-and-log continuation. Its truthiness, boolean-comparison, wildcard-import, and generic
try/catch preferences are not sound Glyph rules, and its `async-no-await` rule is not executed by its analyzer. No
dependency or repository workflow should be added for it.

## Findings

### F1 — High: the R3F live probe reports values it does not measure

`apps/r3f-hello-world/scripts/live-check.probe.ts:26` asks `waitForTechnique()` for per-technique draw and record counts,
then asserts `2` draws and `11` records. `waitForTechnique()` actually measures the entire shared draw root and waits for
`7` draws and `47` records. On success it returns the constants `{ draws: 2, records: 11 }` rather than deriving them from
the selected Text or its planned batches. The outer assertion therefore cannot fail independently once the aggregate
condition has passed.

The same file uses 600 `requestAnimationFrame` iterations in both `waitForCanvas()` and `waitForTechnique()`. That is a
timer/frame cushion forbidden by the engineering standard, not a causal signal that FontFace loading, React commit,
Glyph publication, or host rendering completed.

**Correction.** Give the app a package-private inspection/completion surface analogous to `inspectThreeExample()`. Resolve
one stable promise or emit one event when the selected Text has a committed Glyph revision after the state change. Return
the actual aggregate facts the probe observes, or add an engine-owned paragraph/batch association that can derive the
selected Text's draw count. Let `vitexec` own the external timeout. Do not retain a hard-coded successful return.

### F2 — Medium: neither live probe proves visible host output

`three-live-check.probe.ts` verifies that a canvas is connected, a Text and draw root are attached, the commit state is
committed, and one planned mesh contains ten instances. The R3F probe verifies analogous scene state. Those are strong
publication checks, but neither reads pixels or captures a rendered negative control. A shader/material/backend defect
that leaves the canvas at its background color can pass if host scene objects still exist.

**Correction.** Keep both route probes, because imperative Three and R3F are separate public products. Add one tolerant
browser-level visible-output assertion per route: compare non-background pixels in a stable text region, then hide the
Glyph draw root and require the signal to disappear. Use the browser/backend actually selected and report it. Do not use
an exact cross-backend image hash as the only oracle.

### F3 — Medium: five React Font lifecycle tests assert one ownership story

These tests overlap substantially:

- `R3F-cached React consumers receive independent Font leases under StrictMode`;
- `clearing a React font resource leaves its mounted consumer lease live`;
- `the generic useFont cache survives StrictMode replay and releases its runtime domain`;
- `technique convenience preload and hook share the R3F resource`;
- `clearing a loaded R3F font resource permits a later preload and mount`.

All construct the same hook-backed FontFace resource, mount one or two Text consumers, observe lease identity/disposal,
clear the cache, and unmount. The separate `mounting and unmounting a React Text returns every paragraph lease` also
repeats the successful teardown path later covered by `StrictMode remount cycles balance their paragraph leases`; the
three-cycle loop adds repetition without a new transition.

**Correction.** Replace the five cache/lease cases with one StrictMode product scenario: convenience preload; two mounted
consumers with independent leases; remove one; clear while the other remains live; unmount; preload again and require a
new operation; remount successfully. Keep `a rejected preload is evicted so the next call creates a new operation` as a
separate failure-path test. Fold the basic Text teardown assertion into one StrictMode mount rather than repeating three
whole cycles.

This removes five tests while retaining every state transition. It tests Glyph ownership under React, not React's render
count or effect ordering.

### F4 — Medium: R3F root selection has one removable duplicate

`GlyphProvider selects one terminal named root without rebinding the anonymous root` and `an R3F portal selects a distinct
terminal root for its target Scene` both create a named root, inject it through `GlyphProvider`, mount Text, and assert the
selected root owns the Text. The portal case is the higher-order product boundary.

**Correction.** Add the named-root idempotency and anonymous-root `textCount === 0` assertions to the portal case, then
remove the smaller named-root test. Keep `provider-free R3F roots isolate independent Canvas stores`: it uniquely proves
that two unprovided R3F stores do not accidentally share the default root.

### F5 — Medium: the public Three authority also imports private implementation state

`three-v1.test.mjs` is the right high-order authority for public Three behavior, but the same file imports
`PlanTransport`, three internal schema/domain helpers, internal policy buffers, and the generated ABI from `dist`. Tests
such as `one initialized Glyph runtime creates independent named Three handles over immutable root fonts` use public
imports, while later instrumentation and exact buffer assertions use private internals. A green file therefore does not
make it obvious that the public lifecycle still compiles and works without package internals.

**Correction.** Keep the high-order public tests, but move implementation instrumentation into an explicitly internal
contract file. Add a package-boundary assertion for the public Three fixture, equivalent to the custom renderer's
`package-boundary.test.ts`, so the canonical lifecycle imports only `@pmndrs/glyph`, `@pmndrs/glyph/three`, technique
subpaths, and Three. Do not delete exact ABI/buffer tests; reclassify them as focused internal/hot-path evidence.

### F6 — Medium: the GlyphConfig type fixture proves handle identity but not the full associated graph

`packages/glyph/tests/types/glyph-api.test.ts` currently proves:

- `GlyphConfig` produces the exact `RecordingHandle`;
- the root recipe sees the selected config and inferred `adapterLabel` extension;
- `renderer.decode` is contextually compatible with `CommandBufferView<RecordingBindings>`;
- handle invocation needs a name;
- the handle result cannot be assigned to an unrelated kind.

It imports `../../src/index.js` rather than the public package self-reference, aliases `RecordingBindings` to the broad
`AnyGlyphBindings`, and returns mostly anonymous `{}` binding values. The current public contract has no standalone
`defineDecoder`, `defaultDecoder`, or config-level `prepare` hook: `GlyphRenderer.decode()` receives the bound
`CommandBufferView` and returns a `PreparedRendererCommit`. `RendererContext.defaultRenderer` is an optional complete
built-in renderer that a wrapper may delegate to, not a separate default decoder. Consequently the fixture does not fail
if individual schema/resource/result associations are widened or if config callback contextual inference regresses.

The detailed nonduplicative additions are in the type matrix below. Keep specialized private core/internal fixtures where
they already own branded IDs, the Codec DSL, technique schema, portable resources, and raw planner contracts; do not copy
those assertions into `glyph-api.test.ts` or describe their relative `dist/core` imports as public API.

### F7 — Low: probe and fuzz-support mechanics have real clones

Fallow identifies two accepted helper extractions:

- `drawCounts()` is duplicated between the R3F and imperative Three probes. One app-owned `inspectGlyphDraws(root)` helper
  should return draw count, record count, and diagnostic object names for both.
- The R3F probe repeats root/scene/world/draw-root lookup in its success loop and timeout report. One read-only snapshot
  helper should feed both the predicate and diagnostic.

Fallow also finds nearly identical seeded mutation engines in `tests/support/artifact-mutations.mjs` and
`tests/font-baker/support/font-artifact-mutations.mjs`. They differ primarily in whether mutation offsets are capped to
the first 64 KiB. A shared deterministic mutation primitive with an explicit maximum span can remove the copied PRNG and
mutation modes while keeping separate font and raster wrappers/seeds.

### F8 — Clean finding: duplicated ABI writers are an independent oracle

Fallow matches policy buffer/operation serialization in `src/core/render-policy.ts` and
`tests/support/engine-abi.mjs`. Do not deduplicate this pair. The support encoder drives Rust boundary and fuzz tests and
must remain independent of the production compiler; sharing production serialization would let the same offset bug
generate both the value and its expected result. The authenticated hand-numbered policy fixture and equivalence tests are
the correct additional authority.

## Keep, consolidate, and remove decisions

| Surface                                                            | Decision                                             | Reason                                                                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `package/root-registry.test.mjs`                                   | Keep both tests                                      | Private root-registry state machine; disposal and invalid-factory paths are distinct.                                                      |
| `integration/typed-command-buffer.test.mjs`                        | Keep                                                 | Unique internal zero-copy, lazy record access, borrowed lifetime, and identity settlement evidence.                                        |
| `integration/font-face-handle.test.mjs`                            | Keep all five                                        | Each owns a different public boundary: non-Three config, factory rollback, Three Text lease, handle-relative default, or alias/Blob input. |
| `integration/three-v1.test.mjs`                                    | Keep product cases; separate private instrumentation | Highest-order Three authority, but public and internal imports should not share one claimed surface.                                       |
| React default/provider/store/error cases                           | Keep                                                 | They prove distinct public selection and JavaScript-input boundaries.                                                                      |
| React named-root-only case                                         | Consolidate into portal case, then remove            | Portal case subsumes provider selection and adds separate Scene placement.                                                                 |
| React basic unmount plus three-cycle StrictMode case               | Consolidate to one StrictMode lease-balance case     | Repeating cycles does not add a state transition.                                                                                          |
| Five React successful Font cache/lease cases                       | Consolidate to one state-transition scenario         | Same resource, ownership, clear, and remount story.                                                                                        |
| React rejected preload retry                                       | Keep separate                                        | Unique failure eviction and promise replacement path.                                                                                      |
| Both hello-world routes                                            | Keep and strengthen                                  | Separate shipped imperative and declarative products; current checks need causal/pixel evidence.                                           |
| Production policy encoder and test ABI encoder                     | Keep independent                                     | Test oracle must not call the implementation it verifies.                                                                                  |
| Fuzz mutation engines                                              | Share mechanics; keep domain wrappers                | PRNG/modes are copied, while mutation spans and domain fixtures remain distinct.                                                           |
| Conformance, fuzz, exact-byte, artifact validation, and Rust tests | Keep unless separately proven redundant              | They isolate trust boundaries and independent oracles not observable in hello-world.                                                       |

## Compile-time contract matrix

| Required relationship                                              | Current evidence                                                                                                          | Smallest nonduplicative addition                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema boundary to every binding output                            | `glyph-api.test.ts` declares `RecordingBindings`, but callbacks return mostly `{}`                                        | Give every binding a unique literal/tag and assert each schema callback's input and return type.                                                                                                                                                                                                                                               |
| Draw-root type follows the schema into renderer context            | Not asserted                                                                                                              | Make `drawRoot` a distinct object and require `context.drawRoot` to satisfy that exact type.                                                                                                                                                                                                                                                   |
| Portable resource and previous resolved resource remain associated | Not asserted; `payload` is wrapped without a type claim                                                                   | Use a distinct portable payload and resource type; assert `resolve` gets the exact payload, companion map value, and exact previous resource.                                                                                                                                                                                                  |
| Renderer decode source and binding association                     | `renderer.decode` assigns its argument to `CommandBufferView<RecordingBindings>`, but `RecordingBindings` is broad        | Give the config distinct binding tags and assert the contextually inferred `CommandBufferView` exposes those exact tags without a repair generic. There is no separate public decoder helper to test.                                                                                                                                          |
| Prepared renderer result inference                                 | The fixture returns `void`; runtime counters do not assert an exact result type                                           | Return a tagged `PreparedRendererCommit` from `renderer.decode`; expose `services.shape()` through the fixture root and assert that exact result survives to the public root method. Do not invent a config-level `prepare` callback.                                                                                                          |
| `defineGlyphConfig` extension fields reach the root recipe         | Covered by `adapterLabel satisfies 'recording'`                                                                           | Keep; add a negative unknown-extension lookup only once (already present).                                                                                                                                                                                                                                                                     |
| Spread config preserves exact handle/hooks                         | Runtime Three wrapper covers delegation; the type fixture has no spread/wrapped config case                               | Add one compile-time spread wrapper whose `encode`, `resolve`, and `renderer` callbacks remain inferred from the selected config.                                                                                                                                                                                                              |
| Generic wrapped config preserves exact associations                | Not covered                                                                                                               | Add one small wrapper fixture. If it needs `AnyGlyphConfig`, explicit six-parameter generics, or a corrective cast, treat that as an API inference failure rather than fixing the test.                                                                                                                                                        |
| FontFace format selection determines technique                     | Covered in `three-v1-api.test.ts`: default/slug identity, bitmap property, missing MSDF, typed `load`, typed `createText` | Keep; add only an option-bearing bitmap selection assertion if its exact options-to-technique relation changes.                                                                                                                                                                                                                                |
| Omitted FontFace format remains handle-relative                    | Runtime covered by two differently configured Three handles                                                               | Do not claim one static technique for omitted format; its broad type is intentional.                                                                                                                                                                                                                                                           |
| Anonymous handle has root operations; named root is terminal       | Covered by `three-v1-api.test.ts` and partially by `glyph-api.test.ts`                                                    | Keep the no-argument handle error and terminal `hud('nested')` error; no third fixture needed.                                                                                                                                                                                                                                                 |
| Custom integration uses public imports only                        | `packages/glyph-example-renderer/tests/package-boundary.test.ts` and package compilation cover runtime source             | Change the canonical GlyphConfig type fixture to package self-imports, and keep the example boundary scan.                                                                                                                                                                                                                                     |
| Canonical integrations need no corrective casts/generics           | Three and example `defineGlyphConfig` calls infer their arguments; no static source check enforces that property          | Add a static boundary check for `AnyGlyphConfig`, `as unknown as`, explicit `defineGlyphConfig<...>`, and `glyph.handle<...>` in canonical public integration sources. Named config aliases such as `ThreeGlyphConfig` are documentation, not repair generics. `defineGlyphSchema<Bindings>()` is a designed witness and should not be banned. |

TypeScript cannot make an arbitrary consumer `as` assertion fail. The negative contract is therefore: repository-owned
canonical integrations compile from public imports with inferred associations and a static boundary test prevents
corrective escape hatches from being introduced there. `@ts-expect-error` remains appropriate for misuse the declared API
can actually reject, such as nesting a terminal root or selecting an undeclared FontFace technique.

`createEngine` and `createGlyphPlanTarget` are private implementation helpers, not root exports and not members of a
public `/core` subpath. If their association graph merits compile-time regression coverage, keep it in one explicitly
internal fixture that imports the source implementation and asserts exact binding/root/resource/result flow without
repair generics. Do not add those helpers to a public-import fixture or treat that internal coverage as an integrator
contract.

## Smallest green-preserving sequence

1. Fix live-test authority before deleting anything: replace frame-count completion, return measured facts, and add a
   visible-output negative control. Run both hello-world routes.
2. Extract the probe snapshot/draw observer and the configurable deterministic mutation primitive. This changes no
   coverage decisions; run the affected live and fuzz-smoke lanes.
3. Strengthen `glyph-api.test.ts` with the exact inference matrix and public self-imports. Let failures identify config
   projection defects; do not add explicit generic or cast repairs.
4. Add the public Three fixture boundary check, then move private ABI/instrumentation cases to an internal file without
   changing their assertions.
5. Consolidate the React successful lifecycle tests into the two proposed scenarios. Run the new authoritative cases
   before removing the six superseded cases, then run the complete Glyph package test.
6. Fold named-root assertions into the portal test and remove the smaller duplicate only after the portal case fails when
   its root selection is intentionally broken.
7. Run `@pmndrs/glyph`, `@pmndrs/glyph-example-renderer`, and `@pmndrs/glyph-examples` checks, then `npx knip` through the
   repository-approved pinned/package workflow once that workflow is identified, followed by the repository check and
   size gate.

## Verification and gaps

This audit ran `mise exec -- pnpm scripts list`, Fallow 3.13.0 mild duplicate discovery, its skipped-pattern explanation,
the Glyph TypeScript fixture compiler, both hello-world browser probes, Oxfmt, the skill validator, and `docs:check`. The
type fixture and both live probes pass. The first sandboxed live attempt could not launch Chromium; the identical
repository command passed outside the process sandbox and printed both success markers. That pass proves the current
probe conditions, not the missing causal/per-technique/pixel assertions identified above.

The full Glyph package and Rust suites were not rerun merely to write this read-only audit. Fallow cannot discover clones
inside `*.test.*` under its current defaults, and deslop provides no semantic duplication or test coverage analysis. No
coverage-instrumentation report currently shows which lower-order tests are subsumed by a live route; the removal sequence
therefore requires deliberate mutation/negative controls before each deletion rather than relying on line coverage.

The current reconciliation reran Oxfmt successfully. `docs:check` reported zero OKF conformance errors but remained
nonzero because of unrelated producer-profile status and source-digest errors elsewhere in the shared worktree. The
bundled skill validator could not start in the pinned environment because its unpinned Python dependency on `PyYAML` was
absent; the unchanged skill frontmatter and reference routing were checked directly instead.
