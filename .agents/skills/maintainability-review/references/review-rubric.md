# Maintainability review rubric

Use this rubric to distinguish safer, clearer code from style churn.

## General design

- Prefer explicit data flow, domain names, and invariants visible in the current file.
- Model a closed set of alternatives as an algebraic data type. Make invalid combinations unrepresentable when doing so stays local and inexpensive.
- Keep functions total over their declared domain. Make expected failure explicit.
- Deduplicate stable domain knowledge, not coincidentally similar mechanics.
- Prefer deterministic ordering and transactional publication where callers observe multiple related outputs.
- Optimize after identifying the actual repeated work. Preserve semantics with independent invariants, not only regenerated snapshots.

## Rust

- Do not use `unwrap`, `expect`, `panic!`, unchecked indexing, truncating integer casts, or reconstructed raw ownership on caller-controlled paths.
- Use checked arithmetic and fallible reservation for attacker-controlled sizes. A fixed, one-time runtime allocation may remain when stable Rust offers no proportionate fallible alternative; document the residual limitation.
- Own allocations in the module that releases them. Validate exact pointer/length or handle identity before use or release.
- Use enums with exhaustive matches for exclusive states and failure causes.
- Use `#[repr(transparent)]` newtypes for distinct units, identifiers, generations, or ownership domains when mixing primitive values would be plausible. Convert at C/Wasm ABI edges. Do not wrap primitives solely for visual uniformity.
- Keep `unsafe` blocks small and state the invariant they rely on. Tests must attack forged ranges, repeated release, overflow, and stale state when those paths exist.

## TypeScript

- Prefer discriminated unions for exclusive protocol, lifecycle, and result states. Use exhaustive checks when adding a variant must require code changes.
- Use branded primitives for opaque handles and hashes when values from different domains share a representation.
- Choose the validation tool by purpose:
  - `boolean` for semantic classifiers when callers gain no useful narrowing;
  - `value is T` for reusable runtime checks that truly prove `T`;
  - `asserts value is T` for throwing trust-boundary validation;
  - a parser/normalizer returning `T` when validation also copies, defaults, or canonicalizes.
- An object check does not prove its properties. For unknown values, first prove a non-null non-array object, then prove each property value that will be consumed.
- Use `"key" in value` when presence itself matters. Use `Object.hasOwn(value, "key")` when inherited properties must not satisfy the contract. Neither check proves the property's value type.
- Name object predicates honestly: `isNonArrayObject` for structural object-like input; `isPlainObject` only when prototypes are explicitly restricted.
- Validate deeply at untyped boundaries: parsed JSON, Worker messages, Wasm responses, fetched artifacts, persisted data, and plugin inputs.
- Treat values returned by third-party or plugin callbacks as boundary data even when their TypeScript signature claims a trusted type.
- For JSON contracts, state whether the boundary accepts only materialized JSON values or intentionally applies `JSON.stringify` coercions such as `toJSON`. Programmatic inputs may be cyclic or excessively nested even though parsed JSON cannot be; reject cycles and enforce proportionate resource limits where necessary.
- Fuse validation with unavoidable parsing, copying, or canonicalization when possible instead of adding a second full traversal.
- At public JavaScript APIs, validate only the discriminants and invariants needed to prevent corrupt state or obscure failures. Normalize once.
- Trust normalized internal values. Never place generic schema walks in shaping, layout, render, or other hot loops.
- Remove casts only when control flow or validation genuinely proves the target type. Do not replace a cast with a dishonest predicate.
- Prefer resource-owning classes only for identity, lifecycle, cleanup, or encapsulated mutable state; use data and functions otherwise.

## Tests and evidence

- Unit tests cover local state transitions, arithmetic, parsing, and error variants.
- Integration tests cross real package and ABI boundaries.
- End-to-end tests exercise shipped products and real assets when the behavior is observable there.
- Deterministic fuzzing attacks parsers, wire formats, and boundary state machines. Maintain toolchain exceptions canonically.
- Live GPU/browser probes belong in the documented local lane when CI cannot provide the required environment.
- Prefer official conformance suites, independent oracles, invariant checks, and exact artifact authentication over implementation-shaped assertions.
- Never add sleeps, arbitrary retries, or timer cushions as correctness mechanisms.
