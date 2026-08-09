---
type: Engineering Standard
title: Engineering house style
description: Defines the durable Rust, TypeScript, React, boundary, testing, and maintenance conventions for pmndrs/text.
documentation_type: reference
tags: [engineering, rust, typescript, react, wasm, testing, maintainability]
sources:
  - id: review-workflow
    resource: ../../.agents/skills/maintainability-review/SKILL.md
    title: Maintainability review workflow
  - id: font-baker-wasm
    resource: ../../packages/font-baker/rust/src/wasm.rs
    title: Portable font-baker Wasm boundary
  - id: font-baker-typescript
    resource: ../../packages/font-baker/src/index.ts
    title: Portable font-baker TypeScript boundary
  - id: runtime-protocol
    resource: ../../packages/text/src/internal/runtime-bake-protocol.ts
    title: Runtime bake protocol
  - id: paragraph
    resource: ../../packages/text/src/three/text.ts
    title: Retained paragraph and Three.js synchronization boundary
  - id: benchmark-runner
    resource: ../../apps/benchmarks/src/benchmark/runner.ts
    title: Shared benchmark lifecycle
generated:
  by: openai-codex/gpt-5.6
  at: '2026-07-26T03:32:25Z'
---

# Engineering house style

This standard is the canonical code-quality policy for `pmndrs/text`. It supports code that humans and agents can understand locally, change without hidden coupling, and verify with independent evidence. Apply it to new work and evidence-backed cleanup; do not churn stable code or public APIs merely to make syntax uniform.

## Design for local reasoning

- Prefer explicit data flow, domain vocabulary, and invariants visible in the current file.
- Model a closed set of alternatives with an enum or discriminated union. Make invalid combinations unrepresentable when the model stays local and inexpensive.
- Keep functions total over their declared domain and make expected failure explicit.
- Retain typed semantic state until the presentation edge. Never recover state by parsing labels, messages, class names, or other display strings.
- Use classes only for identity, lifecycle, cleanup, encapsulated mutation, or stateful caches. Prefer data and functions otherwise; do not introduce inheritance for variant modeling.
- Optimize measured repeated work. Preserve behavior with independent invariants and oracles, not snapshots derived only from the implementation being changed.

## Share durable knowledge, not coincidental mechanics

- Deduplicate stable domain rules and safety invariants that would be dangerous to let drift.
- Extract the shared portion when two techniques implement the same invariant with different package-specific codecs or adapters.
- Do not couple unrelated packages merely because a few lines look alike. Measure dependency, tree-shaking, and compressed-size effects before moving code into a runtime boundary.
- Keep one canonical optimized artifact and one owner for generated contracts. Consumers reference that owner instead of copying bytes or offsets.

## Rust

- Keep portable Wasm crates `no_std + alloc` where their capability permits it. Host-only tools, compression, fixture inspection, and oracle generation stay behind explicit features or binaries.
- Use maintained font, shaping, raster, Unicode, and container libraries instead of project-owned parsers when a suitable implementation exists. Project code owns policy and serialization, not a shadow specification implementation.
- Use error enums and exhaustive matches for operational failure and closed state. Convert enums and newtypes to C/Serde primitives only at the boundary.
- Add `#[repr(transparent)]` newtypes when primitive values from distinct units, identities, generations, ownership domains, or coordinate spaces could plausibly be mixed. Do not wrap values solely for visual consistency.
- Do not use `unwrap`, `expect`, `panic!`, unchecked indexing, or truncating casts as error control flow on reusable production or caller-controlled paths. Direct indexing is acceptable after a nearby range invariant proves it safe.
- Tests may use fail-fast assertions for authenticated fixture preconditions. Build scripts may use a precise `expect` when a violated build invariant means no valid artifact can be emitted. An aborting Wasm panic handler is a last resort, not an error API.
- Treat checked size arithmetic and fallible allocation as separate obligations. Use checked aggregation and `try_reserve`/`try_reserve_exact` before caller-derived growth where stable Rust permits it; publish state only after all fallible work succeeds.
- Keep `unsafe` blocks small and adjacent to a `SAFETY` explanation covering ownership, range, lifetime, reentrancy, and concurrency assumptions. A build that enables Wasm shared memory or threads must re-audit single-threaded singleton proofs.
- Own allocations in the module that releases them. Validate exact pointer/length or handle identity and test forged ranges, repeated release, overflow, and stale ownership.

## TypeScript

- Repository-authored TypeScript and JavaScript use the single root Oxfmt configuration: 120-column width, semicolons, single quotes, and trailing commas. Package-local formatter policies are not allowed; generated source and authenticated fixtures remain excluded from hand-formatting.
- Prefer discriminated unions for protocol, lifecycle, result, and exclusive option states. Use exhaustive checks when a new variant must force downstream review.
- Use branded primitives for opaque handles and hashes when equal representations have different identities.
- Keep untyped boundary data `unknown`. A cast, `as Partial<T>`, object check, or property-presence check is not validation.
- Choose a boundary tool by what it proves:
  - return `boolean` for a semantic classifier that provides no useful narrowing;
  - return `value is T` only when every promised part of `T` is proven;
  - use `asserts value is T` for throwing validation;
  - return a normalized `T` when validation also copies, defaults, or canonicalizes.
- For an unknown object, first prove it is a non-null, non-array object, then prove every property the returned type promises or the caller consumes. Use `"key" in value` when presence matters and `Object.hasOwn(value, "key")` when inherited properties must not satisfy the contract; neither proves the value type.
- Name structural predicates honestly. `isNonArrayObject` is appropriate for the one fact it proves. Use `isPlainObject` only when prototypes are restricted. Do not introduce a generic `isRecord` that implies domain properties exist.
- If a consumer needs only part of a wire value, define a narrower wire type. Do not make a predicate promise a richer public or domain type than it validates.
- Validate and normalize parsed JSON, Worker messages, Wasm metadata, fetched artifacts, persisted data, public JavaScript inputs, and plugin returns once at their trust boundary. Treat third-party callbacks as boundaries even when their declared TypeScript types look trusted.
- State whether JSON-facing APIs accept only materialized JSON or intentionally apply `JSON.stringify` coercions. Bound depth and size, reject cycles and invalid values where programmatic input can exceed parsed-JSON guarantees, and fuse validation with unavoidable canonicalization when possible.
- Trust normalized internal values. Do not put generic schema walks or repeated defensive validation in shaping, layout, rendering, or other hot loops.
- Begin cleanup scope before the first resource acquisition. Track each successful allocation, listener, Worker, handle, or publication independently and release it after any later failure. Either make initialization transactional or make cleanup safe for partial initialization.

## React

- Use React 19 async primitives and let the React Compiler optimize ordinary component code.
- Derive values during render when they are pure. Do not use an effect to mirror props/state, repair event flow, or implement derivation.
- Use `useEffectEvent` for non-reactive effect callbacks that need current values. Do not use render-time refs as an effect dependency workaround.
- Preserve semantic values as typed props through the component boundary; derive labels and visual tone together at the final render site.
- Keep the React layer thin. Core lifecycle and capability state belong in the framework-neutral package rather than a parallel component-only model.

## Determinism, tests, and evidence

- Encode repeatable development, build, check, test, profile, capture, and generation workflows as package-owned `pnpm` scripts. Expose maintainer-facing application workflows through short root aliases so humans, agents, and CI invoke the same command from a clean checkout; do not treat a temporary probe or shell recipe as durable evidence.
- Unit tests cover local state transitions, parsing, arithmetic, and error variants.
- Integration tests cross actual package, Worker, ABI, filesystem, and artifact boundaries.
- End-to-end tests exercise a shipped product surface with real, licensed assets when behavior is observable there.
- Use deterministic fuzzing for parsers, wire formats, and boundary state machines. Keep the root Rust version stable and the cargo-fuzz nightly isolated and exactly pinned.
- Prefer official conformance suites, independent implementations, exact artifact authentication, and externally derived invariants over implementation-shaped assertions.
- Do not use sleeps, timer cushions, arbitrary retries, frame counts, or random luck as correctness mechanisms. A live browser/GPU lane must use causal completion signals and negative controls.
- Regenerate a golden only when an intentional source or generator change explains it. A changed fingerprint is evidence to investigate, not permission to accept new output.
- Verify formatter and static checks first, then focused tests, integration/fuzz lanes, strict Rust linting, product-level browser/GPU evidence when applicable, repository checks, generated contracts, size gates, and OKF validation.

## Generated code, comments, and documentation

- Review generated outputs through their generator, inputs, provenance, deterministic regeneration check, and conformance suite. Do not hand-style generated source.
- Prefer names and types that make ordinary code self-explanatory. Add comments for non-obvious ownership, safety, protocol, performance, or mathematical invariants; match surrounding comment density instead of applying a blanket comment rule.
- Keep line-level mechanics in code. Put durable package ownership and constraints in package reference, decisions in the decision register, milestone status in the checkbox roadmap, and chronology in the OKF log.
- Update affected canonical documentation with source changes. Do not create shadow plans, duplicate package histories, or a second copy of this standard.
- Keep configured lint and formatting checks in the root `pnpm check` lane so local and CI verification enforce the same React, TypeScript, and presentation rules.
- Preserve public signatures unless correctness, measured performance, or a seriously misleading name supplies strong evidence for a change.

## Deliberate non-rules

This standard does not require a newtype for every primitive, an abstraction for every repeated expression, a type guard for every object check, `.get()` for every proven index, classes to model alternatives, zero allocations, or zero comments. It does require the author or reviewer to identify the invariant, choose a proportionate representation, and provide evidence when a change affects correctness, ownership, performance, or a public boundary.
