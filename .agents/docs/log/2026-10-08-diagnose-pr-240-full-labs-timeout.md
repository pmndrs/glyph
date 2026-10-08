---
type: Log Entry
title: 'Diagnosed the PR 240 full Labs timeout'
generated:
  by: openai-codex/gpt-6
  at: '2026-10-08T17:49:09Z'
sources:
  - id: performance-job
    resource: https://github.com/pmndrs/glyph/actions/runs/37785945860/job/113346825511
    title: PR 240 full installed-package performance job
  - id: read-publication-suite
    resource: ../../../benches/labs/package/read-publication.bench.ts
    title: Read-publication benchmark matrix
---

The [benchmark package reference](../packages/benchmarks.md) now records why PR #240's 90-minute full Labs job produced
no comparison report. The exact canary baseline completed `read-publication.bench.ts` in 28 minutes 24 seconds, while
the packed `961c852…` candidate remained in the same file for more than 41 minutes 59 seconds until cancellation.
Artifact setup took seconds and the runner clock remained stable, so the evidence localizes the bottleneck to the
read-publication matrix—especially its high-scale cold-copy cases—without inventing a candidate delta from an incomplete
result.[^performance-job] No replacement timing was launched while the separate #247 performance work was active.
