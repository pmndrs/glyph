# Test portfolio guide

Use this reference when a review changes or audits tests. The engineering standard remains authoritative. This guide
helps agents reduce duplicated assertions without replacing useful local evidence with one opaque end-to-end scenario.

## Assign one authority per invariant

Describe each test in product terms before comparing files: the observable invariant, the failure mode it detects, and
the lowest boundary that must be real for the result to count. Prefer the highest-order deterministic test that observes
the whole invariant and still reports a causal failure. Once that test is independently authoritative, remove lower-order
assertions that merely replay the same successful path with mocked collaborators or implementation-shaped snapshots.

Keep a focused test when it owns evidence the higher-order test cannot provide cheaply or precisely:

- validation at a caller-controlled, network, Worker, artifact, or Wasm trust boundary;
- rollback, cancellation, stale completion, repeated release, or another injected failure path;
- a compile-time public type relationship or negative type contract;
- a zero-copy, allocation, exact-byte, conformance, fuzz, or measured hot-path invariant;
- an exact error variant or call-site timing contract;
- a small deterministic oracle that makes a product-test failure diagnosable.

The layers must assert different facts. A public integration test can prove that a configured handle renders and cleans
up; a focused binder test can separately prove that a rejected borrowed publication expires without copying. Two tests
that both assert only the final draw count do not become independent evidence because one constructs more objects.

Package exports define the public surface. A source file under `src/core` or an emitted file under `dist/core` remains a
private implementation detail unless `package.json` exports that subpath. Tests may import such files to own a focused
internal contract, but must not present that evidence as a public integration contract.

Public type evidence needs both boundaries a consumer encounters. A source fixture can exercise fast inference while the
package is being authored; an isolated consumer must also resolve every public package specifier against emitted or packed
declarations. The source fixture does not prove that declaration emit, `stripInternal`, conditional exports, or a missing
declaration dependency preserved that contract. Conversely, loading each JavaScript subpath from a packed archive does not
prove its TypeScript surface. In an inference fixture, let the public factory call infer the value first and assert the
result afterward. An explicit return annotation, `Any*` binding alias, generic argument, or corrective cast can make a
broken inference path look green.

## Prefer product behavior over framework behavior

React and R3F tests should assert Glyph behavior: selected handle/root identity, suspension on a FontFace load, independent
mounted Font leases, invalidation that makes a semantic change visible, transform-only synchronization, scene/portal
placement, and cleanup after unmount. Do not test React's render count, effect ordering, hook internals, or StrictMode replay
for their own sake. One StrictMode scenario is useful when it proves Glyph lease balance; repeating the same mount cycle or
testing several equivalent hook spellings is not.

Browser and GPU tests need causal completion signals. A frame count, sleep, retry cushion, or successful process exit is
not evidence that Glyph committed or the host rendered. Expose an app-owned completion signal tied to the product state,
then assert the scene/draw/pixel result. Diagnostic polling may describe a timeout, but it must not define correctness.

Initialization and transition are different product invariants. A sequential test that first reaches one healthy route
and then switches workload, technique, scene, or font does not prove that a later selection works on a fresh page. Keep one
bounded fresh-load matrix when boot order, lazy loading, or retained caches can affect the result; let a separate transition
test prove reuse and handoff.

## Do not reproduce the implementation in the test

- Derive expectations from authenticated fixtures, independent implementations, public measurements, or explicit
  contracts. Do not copy the production parser, mapper, range builder, or policy table into a helper and compare the two.
- Share fixture construction and observation helpers when they encode no expected result. Keep independent oracles
  separate even when Fallow reports their mechanics as a clone.
- Extract repeated test setup only when it has one stable meaning. A helper that accepts many callbacks and flags can hide
  which lifecycle each test actually owns.
- Keep generated, vendored, built, and authenticated fixture output outside maintained-test duplication decisions.

When several closed variants have the same lifecycle and only their expected metadata differs, prefer one table-driven
test with explicit per-variant expectations. Separate files that repeat the same construction, capability set, and
precondition failure are not independent coverage. Keep a variant-specific test only when it crosses a distinct decoder,
shader, artifact, error, or ownership boundary.

Keep test names accountable to their assertions. A title that claims a value is hidden, a path is public, or a resource is
released must contain an assertion that would fail if that exact contract regressed; otherwise strengthen the test or
rename it before treating it as evidence.

## Review changed code for scaffolding residue

The current `dabit3/deslop` rules are regex review prompts, not a correctness gate. Their useful repository-compatible
ideas are to inspect changed lines first, skip built/vendor output, remove debug or entry/exit logging, replace vague TODOs
with owned follow-up work, remove comments that merely narrate syntax, and reject catch blocks that only log and continue.
See the upstream [diff-first analyzer](https://github.com/dabit3/deslop/blob/a594d94306b44feddba1633ce92082f3820b2a04/lib/analyzer.js)
and [pattern catalog](https://github.com/dabit3/deslop/blob/a594d94306b44feddba1633ce92082f3820b2a04/lib/patterns.js).

Do not import its blanket preferences for truthiness, explicit boolean comparisons, wildcard imports, or try/catch syntax.
In Glyph, empty strings, `false`, ownership cleanup, and package boundaries often carry exact semantics. Judge the
invariant, not the regex match, and do not add an unpinned `deslop` command to repository workflows.

## Consolidation procedure

1. Inventory tests and named product/live workflows in the affected package.
2. Map each test to one observable invariant and one unique failure mode.
3. Nominate the authoritative test and identify which lower assertions it truly subsumes.
4. Strengthen the authority with a causal signal or independent assertion before deleting anything.
5. Keep focused boundary, failure, type, conformance, and hot-path tests; remove only exact semantic duplicates.
6. Extract duplicated setup/inspection separately from changing coverage.
7. Run formatter and type checks, the authoritative focused tests, the affected package suite, the live lane, and then the
   repository check as appropriate. A green result after deletion is necessary but does not prove retained coverage.

For compile-time public API coverage, use public package specifiers and inference assertions. Prove associated
relationships from one runtime witness through schema callbacks, config extensions, `resolve`, renderer construction and
`GlyphRenderer.decode`, handle/root selection, FontFace technique selection, and prepared renderer results. A private
helper may have a separate internal type fixture, but it is not evidence that consumers can import it. TypeScript cannot
prevent a consumer from asserting a false type, so canonical integrations must compile without `Any*`, `unknown`,
explicit generic repair, or corrective casts; static boundary tests may enforce that property in those canonical
examples. Run the same consumer contract against the packed declaration graph so an internal source condition cannot hide
an export or declaration-emit regression.
