# Text-engine lifecycle migration

This migration changes the TypeScript ownership vocabulary and the pre-alpha Rust/Wasm ABI together.

- Construct a `GlyphEngine` with `createGlyphEngine()`.
- Create a renderer integration owner with `glyphEngine.createBackend()`; it returns a `GlyphBackend`.
- Create retained text and its publication frontier with `backend.createRetainedPlan()`.
- The private JavaScript request/result owner is `PlanTransport`.
- ABI functions, fields, statuses, capacities, and handles use `retainedPlan` / `RetainedPlan` names. Rust exports use
  `pmndrs_glyph_engine_*_retained_plan`; no session-named Wasm aliases remain.
- Policy-program builders use an internal `authoringScope`; the public `scope` option still selects an input table.
- Replace local `runtime` and `session` names when they refer to the renamed public owners; unrelated renderer sessions stay unchanged.

The transform is symbol-aware and refuses ambiguous `.createSession()` calls. Repository-owned ABI literals are scoped
to `packages/glyph`; unrelated consumer `sessionId` properties and strings remain untouched. Review non-code prose after
the TypeScript residual inventory is clean.
