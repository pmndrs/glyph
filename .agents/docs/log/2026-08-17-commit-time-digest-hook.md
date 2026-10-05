---
type: Log Entry
title: 'Commit-time digest hook'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Contributors editing package sources repeatedly shipped stale
`source_digest` pins, failing the knowledge-base gate one round-trip later. A committed, dependency-free
hook (`.githooks/okf-digests`, enabled per clone through Git 2.54 config-based hooks documented in the
README) now re-pins affected digests automatically at commit time, refuses when a package's working tree
diverges from the staged commit, and runs the full OKF validation as the gate. A fallback dispatcher
covers `core.hooksPath` clones on older Git.
