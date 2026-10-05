---
type: Log Entry
title: 'Renderer failures no longer wait for input churn'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Three now validates and prepares a complete plan candidate before
publication. A material or resource realization failure retains the engine-accepted publication and retries those exact
owned bytes on the next frame without another Wasm call; the prior draw state remains live because the candidate never
committed, not because the renderer restored a stale snapshot. New authored input supersedes an unpublished candidate
and receives a checkpoint from the last consumed plan revision. The former rejection latch decision is superseded by
D-279, and direct coverage proves an unchanged frame recovers as soon as the renderer dependency does.
