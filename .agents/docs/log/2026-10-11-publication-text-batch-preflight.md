---
type: Log Entry
title: 'Preflight synchronous text edits and publication commits'
generated:
  by: process:docs-new
  at: '2026-10-11T21:10:31Z'
---

Rust checks each ordered text-mutation batch against its evolving UTF-16 length before touching pending text storage. A regression proves a valid prefix is not applied when a later offset is invalid, while the existing ordered-replacement test covers an offset that becomes valid after an earlier edit.

The ordered render-plan and shared session-placement commits now preflight their complete writes before either mutates accepted output. Batch provenance removes identity searches from commit and validates each batch's patch slice; the session guard checks target generations, writes, and checkpoint allocation snapshots. Regressions cover invalid write ranges, wrong session generations, checkpoint identity preservation, and failure before accepted ordered or placement buffers change. The complete shaper suite, static checks, optimized build, and Node tests pass.

The matched four-block `edit-sized` package A/B reports 0 faster, 1 slower, 45 neutral and 1 clock-confounded skipped workload. Median workload p50 moved from 0.895 to 0.904 ms. The sole slower result was 1,000-label same-length engine publication, 1.75 to 1.89 ms (+0.140 ms, +8.5%; p=.029; 95% interval +2.4..+13.2%). The 1,000-label edit/read cases were neutral. Optimized Wasm grew 1,464 bytes and the package archive 1,099 bytes; this correctness hardening does not establish a speedup.

These are partial implementation slices for [D-373](../planning/decision-register.md) and the [publication frontier](../planning/publication-frontier.md). The Rust-commit/TypeScript-non-adoption boundary now invalidates derived root state and rebuilds accepted authored inputs on the next explicit operation through the same executor; a real-font test verifies unchanged renderer bytes and cold-build parity. Preparation's internal undo lanes and the complete post-write failure proof remain open. The [Glyph package concept](../packages/glyph.md) records the current boundaries.
