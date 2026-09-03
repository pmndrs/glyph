---
type: How-to guide
title: Route resumable external-agent work
description: Sets up and operates the pinned ai-cli-mcp router for resumable Claude, Codex, and OpenCode reviews and delegated work.
tags: [agents, review, claude, codex, opencode, mcp]
sources:
  - id: router-skill
    resource: ../../../.agents/skills/agent-router/SKILL.md
    title: Agent router operating contract
  - id: model-catalog
    resource: ../../../.agents/skills/agent-router/references/model-catalog.md
    title: Model catalog interpretation
  - id: mcp-config
    resource: ../../../.mcp.json
    title: Project MCP configuration
  - id: codex-config
    resource: ../../../.codex/config.toml
    title: Project Codex configuration
  - id: claude-sync
    resource: ../../../.claude/hooks/sync-agent-config.ts
    title: Claude project-context synchronization hook
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-26T00:00:00Z'
---

# Route resumable external-agent work

This repository routes Claude, Codex, and OpenCode work through one pinned `ai-cli-mcp` installation. Every task starts
as a resumable background process, including a one-off review. The process id lets the caller observe progress without
loading the whole trace, retrieve the authoritative result, and resume the provider session after a transient failure or
for a later pass.

## Set up a checkout

The root package pins `ai-cli-mcp` exactly. Both project clients execute that workspace copy through mise:

- `.mcp.json` configures Claude-compatible clients;
- `.codex/config.toml` configures Codex and gives an individual MCP call a one-hour timeout;
- `.claude/hooks/sync-agent-config.ts` links repository skills into `.claude/skills` when Claude starts.

Run the Claude sync hook manually after adding a skill or when startup hooks did not run:

```bash
node .claude/hooks/sync-agent-config.ts
```

Reload the client after changing MCP configuration. A working `ai-cli` command proves the pinned package and provider
CLIs are reachable; it does not prove that the client loaded the MCP transport.

## Prove the router is healthy

1. Confirm the package pin, `.mcp.json`, and `.codex/config.toml` all point to the workspace installation.
2. Query the live model catalog; provider availability is not a permanent fact in the skill.
3. Run the diagnostic command and resolve any missing provider CLI or authentication.
4. Confirm the client exposes the MCP `models`, `run`, `wait`, and `get_result` tools.
5. Start a small background task through MCP, retrieve a nonempty result and session id, then resume that session once.

The local diagnostic commands are:

```bash
mise exec -- pnpm exec ai-cli models
mise exec -- pnpm exec ai-cli doctor
codex mcp get ai-cli
claude mcp get ai-cli
```

The first two inspect the pinned package. The last two inspect client configuration. Only a successful run through the
visible MCP tools proves end-to-end transport health.

## Select a model

An explicit user choice always wins. Query `models` before routing; do not silently replace an unavailable choice.

| User request                  | Router model                         | Effort                         |
| ----------------------------- | ------------------------------------ | ------------------------------ |
| `0x`, `0x alpha`, `0xAlpha`   | `oc-opencode/x-preview-f-free`       | Omit for OpenCode              |
| `opus`                        | `opus`                               | `high`                         |
| `fable`                       | `fable`                              | `high`; explicit requests only |
| `luna`                        | `gpt-5.6-luna`                       | `high`                         |
| `tera` or `terra`             | `gpt-5.6-terra`                      | `high`                         |
| `sol`                         | `gpt-5.6-sol`                        | `high`                         |
| `claude:<model>`              | Validated Claude suffix              | `high`                         |
| `codex:<model>`               | Validated Codex suffix               | `high`                         |
| `opencode:<provider>/<model>` | `oc-<provider>/<model>`              | Omit for OpenCode              |

Claude and Codex never exceed `high` unless the user explicitly requests a higher effort. Choosing Fable, asking for an
adversarial review, or describing a hard task does not imply Max or Extra effort. Fable and the Luna/Terra/Sol Codex
models are advertised by the pinned 2.22.0 catalog. Do not use the catalog's `claude-ultra` or `codex-ultra` aliases unless
the user explicitly requests their higher effort. OpenCode explicit models require the `oc-` router prefix.

## Run a resumable adversarial review

Use a clean, isolated worktree and name the exact target commit. A review prompt grants read-only analysis, states the
acceptance criteria, and asks for evidence with file and line references. Start the process, retain its PID, and record
the eventual provider session id with the model, worktree, target, and transport in ignored `.cache/agent-router/`
metadata.

```text
run(model=opus, reasoning_effort=high, workFolder=/absolute/review-worktree, prompt=...)
peek(pid, bounded progress window)
wait(pid)
get_result(pid)
```

`peek` is a progress sample, never the final finding set. `wait` or `get_result` supplies the authoritative result. If the
provider fails transiently, launch the follow-up with the returned `session_id` and same worktree. After code changes,
state the new target commit explicitly; a cached session does not make its earlier source view current.

To block on a one-off review, use the same recipe and call `wait` immediately. To run independent reviews in parallel,
start every process first and then wait on their PIDs.

## Delegate implementation safely

Implementation uses the same process lifecycle but requires a mutation-authorized prompt and one isolated worktree per
agent. Name the exact branch, scope, repository rules, focused gate, and commit requirement. Review and integrate the
agent's commit locally before treating it as project work. Never point two mutation-capable agents at one checkout.

## Use the temporary CLI fallback

When the client cannot see the MCP server and cannot be reloaded until current work finishes, use the pinned CLI facade:

```bash
mise exec -- pnpm exec ai-cli models
mise exec -- pnpm exec ai-cli run --cwd /absolute/worktree --model <validated-model> --prompt-file /absolute/prompt.md
mise exec -- pnpm exec ai-cli peek <pid>
mise exec -- pnpm exec ai-cli wait <pid> --timeout 300 --verbose
mise exec -- pnpm exec ai-cli result <pid> --verbose
```

Record `transport: cli-fallback`, the PID, model, worktree, target commit, and returned session id. This path uses the
same resumable process state but is not evidence that MCP is loaded. Do not substitute `npx`, an unpinned provider CLI,
or a direct system `claude`, `codex`, or `opencode` process.

## Keep traces bounded

Raw provider JSONL and rolling process logs belong in ignored `.cache/` storage. Inspect only a bounded delta:

```bash
node .agents/tools/read-append-log.mjs .cache/agent-router/<run>/trace.jsonl --delta
node .agents/tools/read-append-log.mjs .cache/agent-router/<run>/trace.jsonl --lines 80 --bytes 12000
```

Use `get_result` for the complete finding set. If the result changes repository knowledge, write a concise human summary
to the relevant canonical document and `.agents/docs/log.md`; never append raw trace records to the OKF bundle.

## Recover or stop a run

- Use `ps` to rediscover tracked PIDs after an interruption.
- Use `result` to retrieve a completed or failed outcome without replaying its trace.
- Resume a recoverable provider session with its `session_id`; do not start over merely because one process failed.
- Use `kill` only when the task is obsolete or the provider is irrecoverably stuck, then record that outcome.
- Use `cleanup` after authoritative results and session metadata have been captured.

The PID is process identity; the session id is provider-context identity. Preserving both is what avoids losing work or
paying repeatedly to rebuild the same review context.
