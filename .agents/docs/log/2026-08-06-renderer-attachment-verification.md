---
type: Log Entry
title: 'Renderer attachment verification'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Kept `ParagraphBatch.attach(target)` as the standard batch-scoped lifecycle coordinator while proving it needs no private shaping or allocation state. The public batch observer now replays the current revision, reports later publications, and completes on disposal, allowing custom publication policy to be built from the same contract. Defined dirty ranges as adjacent-revision deltas; late, skipped, or superseded target revisions initialize the live ranges already named by the current submission plan, while adjacent revisions retain the narrow upload path. Target staging failures remain observable without replacing the live target, and pending engine work must copy canonical ranges during the synchronous stage call rather than retaining mutable views across later publications. Added `attach()` to the complete core surface and removed an undefined revision-delta placeholder from the engine contract.
