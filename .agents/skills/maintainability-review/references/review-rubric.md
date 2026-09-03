# Maintainability review rubric

Use the canonical [engineering house style](../../../../.agents/docs/engineering/code-style.md) to judge code. This rubric defines the evidence a review must return; it intentionally does not copy the standard.

## Finding contract

For every finding, provide:

- severity and a concrete failure mode;
- exact file and symbol;
- evidence from code, tests, generated output, or an independent contract;
- the smallest credible correction;
- a test or check that distinguishes the correction from current behavior;
- public API, runtime-size, dependency, and generated-artifact impact.

Report important clean findings as well as defects. Distinguish reusable production paths from tests, build scripts, oracle tools, and generated source before calling something a panic, allocation, validation, or style violation.

## Severity

- **High** — corrupt output or state, memory/ownership unsafety, security boundary failure, data loss, nondeterminism that invalidates artifacts, or a public contract that promises a shape it does not prove.
- **Medium** — realistic lifecycle leak, overflow/trap, drift-prone duplicated safety knowledge, misleading state model, material hot-path waste, or reasoning cost likely to cause incorrect maintenance.
- **Low** — bounded clarity, naming, or evidence weakness with a concrete maintenance consequence.

Do not report taste-only preferences as findings.

## Reconciliation

Classify each finding before editing:

- **accept** when evidence establishes a correctness, safety, determinism, performance, or material local-reasoning problem;
- **defer** when the issue is valid but outside scope, lacks a safe bounded correction, or needs measurement first;
- **reject** when it asks for speculative abstraction, blanket newtyping, mechanical cast removal, unrelated deduplication, public-API churn, or conformity without a failure mode.

When multiple corrections work, prefer the smallest one that restores a visible invariant and admits a deterministic regression test.

## Anti-overfitting checks

Before accepting a recommendation, ask:

1. Does the proposed type or abstraction prevent a plausible mix-up, or only add ceremony?
2. Is duplicated domain knowledge likely to drift, or are only local mechanics similar?
3. Does validation prove a boundary contract, or merely move a cast into a dishonest predicate?
4. Is added validation outside hot loops and fused with work already required?
5. Does cleanup cover partial acquisition, cancellation, stale completion, and repeated release?
6. Does the test use an independent invariant, or restate the implementation?
7. Would a generated file be better reviewed through its generator and conformance evidence?
8. Does an `Any*`, `unknown`, or erased registry type represent genuinely untrusted or heterogeneous data, or did it discard
   an associated type relationship that a config, schema, technique, handle, or other runtime witness already proved?
