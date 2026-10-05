---
type: Decision
title: 'Agents locate docs before reading them'
description: 'Agents find docs with search and outline commands that report a section and line range, then read only that range.'
decision_status: Accepted
decided: '2026-10-05'
generated:
  by: human:thejustinwalsh
  at: '2026-10-05T17:42:31Z'
---

# Agents locate docs before reading them

## Decision

An agent never reads a whole doc to find something. `docs:search -- <terms>` returns each matching paragraph, the
smallest Markdown block, under its location `path › Heading › Subheading  [start-end]`; table rows and top-level list
items count as their own blocks. A single path-like term also lists the concepts that cite or link that file, after
resolving their relative `sources` and links to repository paths. `docs:outline -- <path>` prints the heading tree with
line ranges, `-- <path>:<line>` the sections containing a line, and a directory one line per file. `docs:decision -- D-123`
prints one register row with its section and any superseding decision file. `docs:list -- log` prints the 20 newest
entries by default and filters with `--since` and `--mentions`. Every answer is capped and says how to narrow or widen it.
AGENTS.md states the rule once.

## Why

The bundle is 2.4 MB across about 80 concepts and 645 log entries. Single files run to 462 KB (the decision register,
whose padded tables make one row cost a whole table), 164 KB (`packages/glyph.md`), and 146 KB (the roadmap), and the
log was one 431 KB file. OKF defines no query system, and AGENTS.md named these files as canonical without a reading
rule, so following it literally meant loading them whole. Measured on this bundle, `outline packages/glyph.md` is 925
bytes, `outline packages/glyph.md:600` is 87 bytes, a capped search is about 1–4 KB, and one decision is under 4 KB.

## Consequences

Agents spend context on the section they need rather than the file that holds it. The location format is the same in
every command, so a reader always knows which section a line belongs to. Matching is literal and case-insensitive,
with no ranking beyond concept summaries first, then sections in path order; questions about which commits changed a
file stay with `git log -- <path>`.
