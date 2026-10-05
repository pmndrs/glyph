---
type: Log Entry
title: 'Claude Code agent compatibility'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Added a checked-in root `CLAUDE.md` bootstrap for Claude Desktop plus a startup hook that discovers nested repository `AGENTS.md` files, preserves local Claude-specific guidance while adding sibling `@AGENTS.md` imports, and exposes applicable canonical `.agents/skills` directories through generated Claude project-skill links. The dependency-free erasable-TypeScript synchronizer treats the root bootstrap as an immutable precondition, excludes the Claude-invoking `claude-review` skill, uses directory junctions on Windows, refuses to overwrite non-generated skill directories, prunes only stale links back into the canonical skill root, and has deterministic filesystem contract tests. Generated nested `CLAUDE.md` files and `.claude/skills` links remain local and ignored.
