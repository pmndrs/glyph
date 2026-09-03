---
name: maintainability-review
description: Audit and improve repository code milestone by milestone for correctness, clarity, local reasoning, DRY design, explicit state modeling, panic resistance, and trustworthy TypeScript boundaries. Use for deliberate cleanup passes, pre-release maintainability reviews, agent-assisted refactors, or requests invoking Jane Street-style algebraic data types, Rust newtypes, TypeScript discriminated unions, type guards, or evidence-backed simplification without public API churn.
---

# Maintainability Review

Run a two-phase, evidence-led review. Preserve behavior and public boundaries unless correctness, measured performance, or a seriously misleading name provides strong contrary evidence.

Read the canonical [engineering house style](../../../docs/engineering/code-style.md) and the [review rubric](references/review-rubric.md) before auditing or changing code. The engineering standard owns durable code rules; this skill owns the review procedure. Do not restate the standard in findings, plans, or package documentation.

When a review includes complexity ceilings, metric-driven refactoring, or type-erasure/inference concerns, also read the
[complexity and type-integrity guide](references/complexity-and-type-integrity.md). It defines the repository thresholds,
measurement limits, anti-gaming rules, and current evidence-led refactor candidates.

When a review adds, removes, consolidates, or evaluates tests, also read the
[test portfolio guide](references/test-portfolio.md). It defines how to assign one authoritative test to each product
invariant without deleting focused trust-boundary, failure, type-contract, or hot-path evidence.

## 1. Establish the baseline

1. Read repository instructions, canonical plans, package knowledge, ADRs, and recent change logs.
2. Inspect the worktree. Preserve unrelated user changes.
3. Record the milestone/package scope, public API surface, existing tests, generated artifacts, and baseline check results.
4. Treat regenerated goldens as evidence only when an intentional generator change explains them. Never regenerate a golden merely to make a failure disappear.

## 2. Audit in parallel

When the user requests subagents or parallel review, divide work by milestone or independently testable package boundary. Make this phase read-only.

Give every reviewer the rubric, public-API constraint, and exact scope. Require each finding to include:

- severity and concrete failure mode;
- exact file and symbol;
- evidence from code or tests;
- smallest credible correction;
- tests that would distinguish the correction from the current behavior;
- explicit clean findings for areas that do not need change.

Do not accept “more abstraction,” “more types,” “split the file,” or “deduplicate” as findings without a demonstrated reasoning, correctness, or maintenance benefit.

## 3. Reconcile before editing

Classify every validation finding with the engineering standard's value-authority matrix before accepting it. A module,
Worker, language, or Wasm crossing is not itself a trust boundary. Confirm that a production caller can actually author
the rejected value; a test-only import of an internal function does not make that state reachable.

Classify each finding as:

- **accept** — a correctness, safety, determinism, performance, or material clarity problem;
- **defer** — valid but outside the current milestone or lacking enough evidence;
- **reject** — taste-only churn, speculative generalization, blanket newtyping, public-API disruption, or duplication whose removal would couple unrelated concepts.

Prefer the smallest change that restores a clear invariant. Keep domain vocabulary explicit and understandable from the current file.

## 4. Implement bounded changes

When the user requests implementation agents, assign accepted findings in non-overlapping slices and match agent capability to difficulty. Require no commits from subagents; the integrating agent owns review and commits.

Apply the engineering standard to every accepted finding. Begin with a deterministic regression that distinguishes the failure from the intended invariant when behavior changes. Preserve public signatures unless the reconciled evidence justifies a change.

For validation-to-test cleanup, use a narrow loop: remove one redundant package-owned runtime check, add or strengthen the
producer-side unit/property/ABI/product proof, run that focused test, then continue. Do not replace the deleted guard with
another check at a later internal layer. Reject negative tests that forge values no production path can supply.

## 5. Review every delegated diff

Never accept an agent summary as proof. Inspect the diff and trace ownership, failure, cancellation, ordering, cleanup, and overflow paths yourself. Look for newly introduced casts, stale state, partial publication, hidden allocation, forged-handle behavior, and test assertions that only restate the implementation.

Send a bounded correction back to the implementation agent when its design remains unsafe or incomplete. Avoid layering a second workaround over the first.

## 6. Verify from narrow to broad

Run, in order:

1. formatter and static type checks for touched files;
2. focused unit and regression tests;
3. integration and deterministic fuzz-smoke tests;
4. strict Rust linting for touched crates and targets;
5. product-level end-to-end or live GPU tests when the changed behavior reaches a real product;
6. the repository's full check when practical;
7. generated-contract, size, documentation, and knowledge-bundle checks.

Use structural assertions and externally derived invariants. Do not use timers, retries, or sleeps to hide races. If a binary fingerprint changes, prove whether only the generator changed or the produced artifact changed before updating the recorded fingerprint.

## 7. Keep knowledge and history current

Update canonical plans and package knowledge in place. Prefer checkboxes or explicit status cells over shadow plans. Link to the engineering standard instead of copying it. Record accepted changes, rejected tempting alternatives, residual limitations, and verification evidence in the repository's established log format.

Refresh OKF provenance/digests after the final source changes, then validate the bundle. Keep package explanation durable; leave line-level mechanics in code comments only when they explain a non-obvious invariant.

Create small conventional commits whose scope matches one coherent invariant. Run the relevant checks before each commit and finish with a clean worktree.

## 8. Report the result

Lead with outcomes. List accepted improvements, deliberate non-changes, public API impact, verification, residual risks, documentation updates, and commit identifiers. State plainly when a live/manual lane was not run.
