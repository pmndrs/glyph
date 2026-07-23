# Planning index

Status: pre-implementation

The planning set turns the annotated sources in [`RESEARCH.md`](../../RESEARCH.md) and the preserved [design synthesis](DESIGN_SYNTHESIS.md) into an actionable project without committing to production APIs or implementation details prematurely.

- [Project brief](PROJECT_BRIEF.md): product outcome, users, scope, and success criteria.
- [Architecture](ARCHITECTURE.md): proposed system boundaries and data contracts.
- [System design diagram](system-design.excalidraw): editable Excalidraw view of the Node/Worker bake convergence and runtime pipeline.
- [Runtime API shapes](API_SHAPES.md): provisional loader, shared bake, Worker, shaping, paragraph, and presentation contracts.
- [Runtime data design V0](DATA_DESIGN_V0.md): canonical asset, source-local glyph identity, typed buffers, and generated presentation records.
- [One-font vertical-slice roadmap](VERTICAL_SLICE_ROADMAP.md): current execution sequence and evidence gates.
- [Tooling and fixtures](TOOLING_FIXTURES.md): pinned font, oracle, golden asset, layout, visual, corrupt-input, and benchmark artifacts.
- [Phased plan](PHASED_PLAN.md): sequencing, gates, and deliverables.
- [Issue backlog](ISSUE_BACKLOG.md): issue-sized work packages with dependencies and acceptance criteria.
- [Open questions](OPEN_QUESTIONS.md): decisions that need prototypes, measurements, or maintainer input.
- [Decision register](DECISION_REGISTER.md): concise status and evidence for every architectural choice.
- [Three Flatland Slug audit](SLUG_AUDIT.md): file-level inventory of what to port, rewrite, or leave behind.
- [Conformance plan](CONFORMANCE_PLAN.md): reference engines, comparison fields, corpus, and CI tiers.
- [Benchmark plan](BENCHMARK_PLAN.md): reproducible performance, size, memory, and boundary-crossing measurements.
- [Font payload budget](PAYLOAD_BUDGET.md): measured shaping/Slug baselines and modeled bitmap/MSDF/MTSDF storage for common fonts and icon sets.
- [GPU compression and compact Slug storage](GPU_COMPRESSION.md): transport versus resident compression, exact band packing, compressed-curve experiments, and quality gates.
- [Rendering implementation difficulty](IMPLEMENTATION_DIFFICULTY.md): relative effort to make each presentation correct and then performant.
- [Renderer capability matrix](RENDERER_CAPABILITIES.md): game-facing styling, color/font-source support, scale behavior, and limitations by bitmap, MSDF/MTSDF, and Slug.
- [Autoresearch optimization protocol](AUTORESEARCH.md): evidence gates and safety boundaries for agent-driven performance work.
- [Original discussion extraction](DISCUSSION_EXTRACTION.md): comprehensive record of explored designs, estimates, and reasoning before rescoping.
- [Initial design synthesis](DESIGN_SYNTHESIS.md): preserved architecture/manifesto that previously occupied `RESEARCH.md`.
- [Scope lanes](SCOPE_LANES.md): separates what to build now, what V1 must leave possible, and what remains future research.

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
7. Accept agent-discovered optimizations only when repeated A/B evidence shows an end-to-end win with no quality or conformance loss.
