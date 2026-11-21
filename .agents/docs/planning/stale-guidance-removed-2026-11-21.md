---
type: Log
title: 'Stale process guidance removed'
description: 'List of process guidance removed from planning documents on 2026-11-21.'
status: draft
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-21T12:00:00Z'
---

# Stale process guidance removed, 2026-11-21

Removed because it conflicts with the branch rules in `AGENTS.md` (large units, benchmarks as spikes, no gates,
thresholds or arm counts, no per-change attestation). Technical content, designs, measurements and decisions were kept.
Line ranges refer to the files before this change. Each removed block is replaced by one line:
"Process guidance removed 2026-11-21; see the branch rules in AGENTS.md."

## `publication-frontier.md`

- "Roles and bounded context", lines 68-72: prescribed which model and effort tier implements, reviews and runs gates
  (Sol Medium implementors, Luna for gates, fresh Sol High advisors) and the required contents of every implementation
  brief.
- "Execution and completion gates", lines 92-104 (heading and checklist): a checklist of per-step completion gates,
  including final main-and-0.1.0 p50/p95 comparisons, paired timings and declaration/ABI reviews.
- Checklist under "Remaining gates and current action", lines 456-468 (heading at 454 kept): a checkbox list of
  remaining acceptance gates (full comparisons, browser matrix, size-growth reduction, final readiness).

## `session-handoff.md`

Nothing removed. It contains no model tiers, ABBA/ABAB interleaving or per-step gates; it is API-contract
and measurement-semantics history.

## `decisions/retained-prepare-publish.md`

- "Consequences", second half of line 67 through line 70: per-wave measurement requirements (set-only, set/read,
  set/read/publish and set/split at 1/100/1,000 labels; frozen candidate against main and 0.1.0; size records after
  each wave; unexplained size growth blocks readiness). The correctness acceptance sentence before it is kept.
- Added under the title: the "Setter rule superseded by deferred-never-stale-preparation.md" line.

## Candidates left alone

- `publication-frontier.md` lines 60-66 "Mandatory regrounding after every compaction": agent-session procedure mixed
  with pointers to current artifacts; not clearly the same rules.
- `publication-frontier.md` lines 74-90 "User measurement cadence": largely agrees with the branch rules and carries
  technical state (rejected experiments); only its consolidated-gate wording is stale.
- `publication-frontier.md` line 42 onward (22 October checkpoint), lines 108-130, 342-376 (including "Remaining
  final gates" at 364 and the consolidated main-and-0.1.0 comparison at 374), 449-451 (Luna/Sol roles in "Goal and
  ownership"), 536 and 582: chronological records interleaving model roles, arm/block counts and gates with
  measurements and design; separating them needs judgment.
- `decisions/retained-prepare-publish.md` "Why" (lines 54-55) calls
  setter-only, same-value and overwrite-before-render cases "mandatory benchmarks"; a rationale sentence, kept.
- `retained-text-assignment.md` lines 127-129: requires at least six fresh Sol High reduction runs plus cumulative
  validation; process, but inside a design document with a different scope.
- `retained-text-assignment.md` line 1456: "final acceptance gates remain open", a status note.
- `session-handoff.md` "Open work" item 1 ("Benchmarks as a gate", per `benchmark-trust.md`): pre-branch CI
  benchmark-gating proposal; conflicts with the branch rules but is a pending human decision, not plainly stale.
- `vertical-writing.md` (84), `gpu-compression.md` (252), `gpucat-integration.md` (226), `editorial-flow-layout.md`
  (104), `conformance-plan.md`: acceptance gates for unrelated features, not layout or publication performance work.
- `segment-indexed-layout.md` (coordinator-owned, not edited): line 634 already states the no-protocol rule.
