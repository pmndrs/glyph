# Complexity and type-integrity guide

Use this reference when a task sets complexity ceilings, asks for metric-driven cleanup, or questions `Any*`, `unknown`,
explicit generic arguments, or corrective casts. The engineering standard remains authoritative. This guide turns its
rules into a repeatable audit and refactoring procedure.

## Hard ceilings

Every maintained function must satisfy all three inequalities:

| Metric                | Required value |
| --------------------- | -------------: |
| Cyclomatic Complexity |         `< 22` |
| Cognitive Complexity  |         `< 22` |
| Halstead Difficulty   |         `< 80` |

The comparisons are strict. A value of exactly 22 or 80 fails. For Fallow, pass `21` as the maximum cyclomatic and
cognitive value so the report includes functions at 22.

Metrics are triage evidence, not permission to change an invariant. A correction succeeds only when it lowers the amount
of state and control flow a maintainer must reason about locally while preserving behavior, ownership, error timing, and
the zero-copy synchronous paths.

## Decide before editing

For each reported function:

1. Classify the file as maintained production, test/oracle, generated, vendored, migration tooling, or benchmark support.
   Do not spend a production refactor budget on generated output or a dated one-off recipe.
2. Name the function's actual obligations. If they belong to different phases, owners, lifetimes, or trust boundaries,
   split on that seam. If they are one ordered algorithm, keep them together unless a helper can state a real sub-rule.
3. Identify the value authority. A Worker, Rust, or Wasm crossing does not create a trust boundary when both producer and
   consumer belong to this package. Validate public caller input, third-party callback returns, and external bytes once;
   retain memory-safety bounds for raw pointers and lengths. Trust package-produced requests, messages, and publications.
4. Identify the transaction owner. The object that stages resources or host objects must also commit, discard, and release
   them. Move branches with that ownership instead of moving individual statements.
5. Identify runtime witnesses before changing types. Preserve the associated schema, bindings, resources, handle, font
   techniques, root, and renderer result inferred from one `GlyphConfig`. Do not erase them to cross a module boundary.
6. Predict the proof: focused invariant tests, fault injection, generated-contract checks, hot-path measurements, and the
   strict metric rerun. Do not edit until a check can distinguish a semantic improvement from metric shuffling.

## Patterns that reduce reasoning cost

### Split by phase and return a named result

Use phase-specific helpers when a public-input compiler validates input, derives a Codec, computes offsets, and writes
output. For example:

```ts
const codec = normalizeCodec(descriptor); // caller boundary; validates once
const layout = layoutCodecTables(codec);
const bytes = allocateCodecBytes(layout);
writeCodecHeader(bytes, codec, layout);
writeCodecTables(bytes, codec, layout);
return bytes;
```

`normalizeCodec` should return the already-needed normalized capability sets, per-program capability IDs, row starts,
and counts. Later phases consume those values; they must not walk and validate the descriptor again. Keep indexed writers
as ordinary loops when they are the cheapest representation.

### Use discriminated state for exclusive lifecycle states

Replace combinations such as `prepared?`, `committed`, and `disposed` when their combinations are not all valid:

```ts
type PublicationState<Result> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'prepared'; readonly result: Result; discard(): void }
  | { readonly kind: 'committed'; readonly result: Result }
  | { readonly kind: 'disposed' };
```

The variants must correspond to actual transitions and force exhaustive review. Do not introduce a union merely to wrap
one boolean, and do not copy the same state into a second controller.

### Give a transaction its cleanup

When a function accumulates resources in several arrays/maps and has a catch block that knows which values are new, make
one preparation object own those collections. For `prepareDrawReplacement`, a `DrawPreparation` can own new meshes,
reused meshes, origin segments, transform membership, rollback, and `finish()`. It can delegate one child/span realization
at a time while the outer indexed loop stays allocation-conscious. This is an ownership extraction, not a thin wrapper.

### Flatten nesting with guards and explicit outcomes

Prefer early rejection and `continue` when later work needs a proven condition. For multi-step decisions, return a small
discriminated outcome such as `reuse | create | unsupported` rather than stacking ternaries. Do not move branches into
anonymous callbacks or chains of `some`, `filter`, and `map`; Fallow may score the caller lower while readers still have
to reconstruct the same control flow and the hot path may allocate more.

### Dispatch closed variants where the operation is genuinely uniform

A discriminated `switch` or typed dispatch table is useful when every variant has the same input/output and independent
behavior. Resource-schema kinds can delegate to named `normalizeBufferResource`, `normalizeGeometryResource`,
`normalizeGroupResource`, and `normalizeTextureResource` operations. Opcode interpretation can use a table only when the
entries share the same register and error contract. Keep an explicit ordered chain for algorithms whose rule order is
semantic, such as Unicode line breaking.

### Keep trusted hot loops direct

The built-in decoder, Rust-plan mapper, buffer patcher, and transform synchronizer should retain indexed loops and borrowed
views. Extract loop-independent setup or a named row operation only when the call does not allocate, duplicate the plan,
or hide mutation. Do not build a map or intermediate tree merely to iterate it once. Do not add validation for typed data
returned by the Rust engine; a malformed internal plan is a bug, not a recoverable user-input case.

### Preserve associated types instead of recovering them

Follow the engineering standard's type-erasure rule. `unknown` is correct for untrusted data. A private heterogeneous
registry may erase a value only when registration packages the complete common operation surface while the concrete type
is still known. The registry invokes those operations; it never reconstructs the erased associated type.

The following do not justify erasure:

- passing a `GlyphConfig` through the root Glyph runtime;
- moving a config between core and an adapter;
- selecting a schema, root, decoder, resolver, or renderer from the same config;
- selecting a Font technique from a typed FontFace selection;
- making a helper reusable across integrations.

Do not expose `AnyGlyphConfig` or another existential as the consumer's inference surface. Do not rebuild a concrete type
with `as unknown as`, a caller-chosen generic, an explicit six-parameter `GlyphConfig<...>`, or a consumer cast. Instead,
carry the config type parameter or project its associated types:

```ts
type ConfigBindings<Config> = Config extends { readonly schema: GlyphSchema<infer Bindings, infer _Boundary> }
  ? Bindings
  : never;
type ConfigHandle<Config> = Config extends { createHandle(...args: never[]): infer Handle } ? Handle : never;
```

The exact projectors may differ, but one runtime witness must remain the source of every associated type. `AnyGlyphBindings`
is acceptable as a constraint when a single `Bindings` parameter still carries the linked fields. A private
`Map<string, GlyphHandle>` is also reasonable when the runtime only needs the common dispose/name operations and never
casts a stored handle back into an adapter type.

## What not to do

- Do not add thin wrappers, one-line adapters, or forwarding classes to lower a caller's score.
- Do not move branches into anonymous callbacks or generated lookup code.
- Do not copy an optimized Rust table into TypeScript or materialize a second command hierarchy.
- Do not split an ordered standards algorithm by arbitrary line count; extract named rule ranges only when their state and
  precedence remain explicit.
- Do not replace a direct hot loop with generators, iterator-result allocation, or array combinators without measurement.
- Do not suppress a metric because the function is difficult. Generated code and authenticated fixtures may be excluded
  at discovery; maintained exceptions require explicit user approval and a documented invariant.
- Do not use type erasure to make a helper compile. If inference fails, repair the producer signature.

## Current measured snapshot

Snapshot date: 2026-09-02. Source was the dirty Glyph API refactor tree. Measurements are triage evidence and must be
rerun before editing because line numbers and scores can change with concurrent work.

Fallow 3.13.0, signed npm distribution, production-mode result:

- `@pmndrs/glyph` plus `@pmndrs/glyph-example-renderer`: 49 functions fail at least one strict Fallow ceiling; 34 fail
  cyclomatic and 43 fail cognitive.
- Repository-wide maintained production discovery: 95 functions fail at least one ceiling; 63 fail cyclomatic and 76
  fail cognitive.

Top focused production findings:

| Rank | Function                                                  | Cyclomatic | Cognitive | Lines | Dominant shape                                           |
| ---: | --------------------------------------------------------- | ---------: | --------: | ----: | -------------------------------------------------------- |
|    1 | `core/render-policy.ts: compileRenderPolicy`              |         63 |       106 |   282 | validation, planning, layout, and five table writers     |
|    2 | `three/internal/draw-realizer.ts: prepareDrawReplacement` |         51 |       102 |   172 | nested child/span realization plus reuse and rollback    |
|    3 | `bakers/bitmap-validator.ts: validateBitmapSemantics`     |         48 |        65 |   210 | strike/page/variant validation and budget ownership      |
|    4 | `node/cli.ts: parseBakeArguments`                         |         46 |        52 |   105 | option dispatch mixed with cross-option validation       |
|    5 | `core/technique-schema.ts: defineTechniqueSchema`         |         42 |        53 |   137 | declaration copy, resource/render normalization, freeze  |
|    6 | `font-baker/validator.ts: validateShapingSfnt`            |         41 |        47 |    99 | independent SFNT table checks in one function            |
|    7 | `discovery.ts: staticString`                              |         40 |        46 |    57 | recursive syntax evaluator with nested variants          |
|    8 | `bakers/msdf-validator.ts: validateMsdfSemantics`         |         39 |        32 |   197 | page/variant validation and resource claiming            |
|    9 | `core/render-policy.ts: preflightOperation`               |         38 |        29 |    67 | opcode-specific register semantics                       |
|   10 | `core/policy-program.ts: policyProgram`                   |         36 |        37 |   237 | public builder, validation, compilation, and cache state |

Repository-wide findings above this list include maintained benchmark application code:
`comparisonViewportEvidence` (123/30), `PayloadInspector` (67/56), `FiniteConformanceSurface` (60/95), and the comparison
workload `renderFrame` (51/50). The dated codemod `2026-08-28-id-factory/transform.mjs` scores 73/152 but is migration
tooling, not shipped runtime code; review it only when that recipe itself changes. Production mode excludes ordinary tests,
and Fallow's configured discovery excludes built output. Generated Rust Unicode tables are likewise not refactor targets.

### Type-integrity findings adjacent to the Glyph refactor

Resolved evidence in the current shared tree:

- `core/glyph-config.ts` now gives `createHandle` a `GlyphHandleFactoryContext<SelectedGlyphConfig<...>>`. The selected
  config retains its schema, fonts, encode, decode, resolve, renderer hooks, and inferred extension fields. The context's
  `create()` also preserves the callable root selector's inferred extension fields.
- `defineGlyphConfig` now packages a common handle-construction operation while the exact config type is known.
  `AnyGlyphConfig` exposes only that operation to the heterogeneous root Glyph registry; `glyph.ts` invokes it without
  reconstructing or casting the config type. The private handle map uses only the common name/dispose lifecycle.
- `ThreeHandleDomain` no longer accepts `AnyGlyphConfig`; its config type comes from `ThreeTextEngineCoordinator`.
- Three and the example renderer call `defineGlyphConfig({...})` without explicit generic arguments.

Remaining review targets are not permission to change public contracts without the owning task's approval:

- `core/create-engine.ts` and `core/glyph-plan-target.ts`: helper inputs rebuild a partial `GlyphConfig` with a generic
  `GlyphHandle`, `unknown` renderer result, and `Record<string, AnyRasterTechnique>` instead of projecting the associated
  schema/root/resource types from the supplied config.
- `GlyphHandleFonts.acquire` and `FontFaceHandleStore.acquire`: the caller currently chooses `Technique` independently of
  an erased `AnyFontFaceSelection`; Three repairs the relationship with an explicit generic argument. The selection should
  determine the returned Font technique.
- The exported Three and example config aliases still enumerate the complete `GlyphConfig` type tuple, and both factory
  functions annotate that alias as their return type. The object-literal calls are inferred now; review whether the aliases
  are intentional public contracts or should derive from an inferred factory value so they cannot mask an inference
  regression.
- React's Text/useFont bridge contains `AnyRasterTechnique` projections and corrective casts. Audit whether each is a
  private heterogeneous store or a lost selection/handle association before accepting it. In particular,
  `useHandleFontFace<Technique>(selection: AnyFontFaceSelection)` still lets its caller choose the result technique and
  casts the mounted store snapshot to that choice.

Legitimate `unknown` checks remain for public JavaScript input, third-party callback output, external artifacts, and
externally authored messages. Do not infer untrusted authorship from a filename such as `frame-wire.ts` or from crossing a
Worker/Wasm boundary: package-compiled frames, package Worker messages, bound command buffers, and typed Rust publications
are trusted internal values. Only their raw pointer/range/capacity envelope retains memory-safety checks.

## Recommended current refactor slices

1. `compileRenderPolicy`: fuse input validation and plan derivation into one `ValidatedPolicyPlan`; then separate layout,
   header emission, capability/program row emission, and program-body row emission. Keep a single descriptor traversal.
2. `prepareDrawReplacement`: introduce one preparation transaction with rollback; extract indexed-transform setup,
   child draw bindings, span realization, and final direct-transform grouping. Preserve the single ordered traversal and
   reuse map.
3. Bitmap/MSDF validators: extract one schema level at a time (`strike`, `page`, `variant`) and pass one mutable validation
   budget/claim owner. These are user/artifact boundaries, so retain validation and exact error paths.
4. Technique schema: normalize each closed resource kind in a named function and assemble/freeze once. Keep the public
   declaration generic intact; do not return an erased schema and cast it back.
5. CLI arguments: parse each option into a discriminated draft, then run one cross-option normalization pass. Do not build
   a plugin framework for a fixed CLI.
6. Rust shaping: measurement is not yet authoritative. Direct inspection suggests `line_break::decide`,
   `layout_next_line_integer`, `EngineState::prepare_update_inner`, and `position_fragment` deserve focused review. Preserve
   Unicode rule order and hot indexed loops; extract named rule ranges, revision preflight, speculative adoption, and
   transaction stages only when conformance and benchmark lanes prove parity.

## Verification

Discover named workflows first:

```sh
mise exec -- pnpm scripts list
```

The current pinned exploratory Fallow command is:

```sh
FALLOW_VERIFY_CACHE_DIR=/tmp/fallow-verify-cache \
  mise exec -- pnpm dlx fallow@3.13.0 health \
  --root . \
  --workspace '@pmndrs/glyph,@pmndrs/glyph-example-renderer' \
  --production \
  --max-cyclomatic 21 \
  --max-cognitive 21 \
  --complexity \
  --complexity-breakdown \
  --top 500 \
  --format json \
  --pretty \
  --quiet \
  --no-cache \
  --output-file /tmp/fallow-glyph-production-complexity.json
```

Fallow exits nonzero when findings exist. Keep the JSON in `/tmp`; use bounded `jq` projections or the repository's
append-log reader rather than loading the report wholesale. Run the same command without `--workspace` for repository-wide
regression evidence. Use focused tests and the relevant live/size lanes before the broad repository check.

### Tooling gap

Fallow 3.13.0 analyzes TypeScript/JavaScript cyclomatic and cognitive complexity. It does not emit Halstead Difficulty and
does not parse Rust. Therefore the `<80` Halstead ceiling and all three Rust ceilings are not yet an enforceable repository
gate. A one-off, exact-pinned `ts-complex@1.0.0` probe found no focused TypeScript function at or above 80 (its highest was
`compileRenderPolicy` at 53.32), but that old analyzer misclassifies some modern TypeScript constructs and is not canonical
evidence. A one-off Kimun 0.25.0 probe covered Rust, but its Halstead values are file-level and its Rust function parser
misidentified large implementations such as `semantic_wire.rs`; its scores are unsuitable for these function ceilings.

Before claiming full compliance, add or approve one package-owned, exact-pinned workflow that measures per-function
Halstead Difficulty and the same three per-function metrics for Rust, records tool/formula versions, excludes generated
and vendored code explicitly, and has fixtures proving how exact-threshold values are gated. Until then, report the gap;
do not substitute hand-counted or incomparable scores.
