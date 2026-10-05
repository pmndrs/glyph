---
type: Log Entry
title: 'Observable Claude review workflow'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added the repository-local `claude-review` skill for read-only external-model audits. Its launcher keeps tool activity and completed responses visible while retaining the exact prompt, complete structured event stream, final report, diagnostics, commit/model/effort metadata, timing, usage, cost, and exit state under the ignored `.cache/claude-review/` tree. Review results remain probes that require local reproduction before code changes or promotion into canonical knowledge.
