---
type: Log Entry
title: 'Removed the repository-local external-agent router and cleared dependency advisories'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Removed the pinned
`ai-cli-mcp` dependency, project MCP registrations, router skill, operations guide, and its dedicated trace reader.
`pnpm audit --fix update` upgraded compatible vulnerable dependencies; pnpm's generated `brace-expansion` override
closes the remaining transitive advisory. `pnpm audit --audit-level=low` now reports no known vulnerabilities.
