# Planning index

Status: pre-implementation

The planning set turns the findings in [`RESEARCH.md`](../../RESEARCH.md) into an actionable project without committing to production APIs or implementation details prematurely.

- [Project brief](PROJECT_BRIEF.md): product outcome, users, scope, and success criteria.
- [Architecture](ARCHITECTURE.md): proposed system boundaries and data contracts.
- [Phased plan](PHASED_PLAN.md): sequencing, gates, and deliverables.
- [Issue backlog](ISSUE_BACKLOG.md): issue-sized work packages with dependencies and acceptance criteria.
- [Open questions](OPEN_QUESTIONS.md): decisions that need prototypes, measurements, or maintainer input.

## Document states

- **Research**: sourced fact, prior art, or hypothesis.
- **Proposed**: recommended design awaiting maintainer acceptance.
- **Accepted**: recorded in an ADR once implementation begins.
- **Measured**: supported by a checked-in benchmark artifact.

## Planning principles

1. Preserve a HarfRust reference path until optimized paths are proven equivalent.
2. Keep shaping and presentation independent.
3. Prefer flat binary contracts over object graphs.
4. Make offline and worker baking use the same compiler core.
5. Treat worker fallback, Unicode correctness, and accessibility-related cluster semantics as product requirements.
6. Do not optimize from estimates; add the benchmark or fixture first.
