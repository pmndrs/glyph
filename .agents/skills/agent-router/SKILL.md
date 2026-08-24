---
name: agent-router
description: Route resumable external-model work through the pinned ai-cli-mcp server. Use for adversarial reviews, implementation reviews, research, and one-off delegated tasks when the user names Claude, Opus, Fable, OpenCode, 0x Alpha, Codex, or asks for an external model.
---

# Agent router

Use the repository's pinned `ai-cli-mcp@2.21.0` server for external-model work. Do not launch provider CLIs directly when the MCP server can do the job: the server owns background process tracking, session IDs, result retrieval, and provider-specific argument validation.

Every run is resumable. Start it with `run`, retain the returned PID, use `peek` only for a bounded progress sample, use `wait` or `get_result` for the authoritative outcome, and resume with the returned `session_id` when a provider fails or the user asks for another pass. A one-off task is still started in the background; `wait` immediately afterward is the blocking recipe.

## Setup and health check

Before using a new checkout or machine:

1. Confirm `package.json` pins `ai-cli-mcp` exactly and `pnpm-lock.yaml` contains the same version.
2. Confirm root `.mcp.json` and `.codex/config.toml` invoke workspace-local `pnpm exec ai-cli-mcp`; never substitute an unpinned `npx` download.
3. Run `pnpm exec ai-cli models` and retain the structured output as the model-routing fact for this run.
4. Run `pnpm exec ai-cli doctor` for binary availability. It does not prove login, terms acceptance, quota, or provider health, so check those with the provider's own status command when a run needs them.
5. Reload/restart the MCP client after adding or changing `.mcp.json` or `.codex/config.toml`. Confirm that the `ai-cli` MCP tools (`models`, `run`, `wait`, `get_result`) are present in the active tool registry.
6. Perform a small background smoke run through those MCP tools in an isolated temporary worktree, wait for it, and verify that a non-empty result includes a session ID. Resume that session with a second tiny prompt before declaring the router healthy.

`pnpm exec ai-cli run` is useful for diagnosing the pinned package and provider authentication, but it is only the CLI façade and does not validate the MCP transport. If the MCP server is not visible to the host client, inspect Codex with `codex mcp get ai-cli` and Claude with `claude mcp get ai-cli`, then reload the client. A missing server is a setup failure; do not report the CLI façade as an MCP smoke test or fall back silently to direct provider CLIs.

### CLI fallback while MCP is unavailable

Use the CLI façade temporarily when the host client has not reloaded the server:

```bash
mise exec -- pnpm exec ai-cli models
mise exec -- pnpm exec ai-cli run --cwd /absolute/worktree --model <validated-model> --prompt-file /absolute/prompt.md
mise exec -- pnpm exec ai-cli wait <pid> --timeout 300 --verbose
mise exec -- pnpm exec ai-cli result <pid> --verbose
```

This fallback is resumable and uses the same server-side process state. Capture the returned PID, provider/model, absolute worktree, target commit, and returned `session_id`; resume with `run --session-id <session_id>`. Label the run `transport: cli-fallback` and keep trying to restore MCP visibility. Never replace this with an unpinned provider CLI or claim that MCP is healthy because the fallback succeeded.

## Route from facts, not guesses

An explicit user model choice always wins over a task-based preference. The router may recommend a model when the user leaves it open, but it must not substitute a preferred model after the user names one. It still validates the requested name against the live catalog and reports an unavailable or malformed route instead of silently changing providers.

Before selecting a model, call the server's `models` tool (or run `pnpm exec ai-cli models` while diagnosing the server). Treat its structured response as the catalog. The current `2.21.0` shape is:

```json
{
  "claude": ["sonnet", "sonnet[1m]", "opus", "opusplan", "haiku"],
  "codex": ["gpt-5.4", "gpt-5.5", "gpt-5.4-mini", "gpt-5.3-codex", "gpt-5.3-codex-spark", "gpt-5.2"],
  "opencode": ["opencode"],
  "dynamicModelBackends": {
    "opencode": {
      "explicitPrefix": "oc-",
      "explicitPattern": "oc-<provider/model>",
      "discoveryCommand": "opencode models"
    }
  }
}
```

Apply these mappings only after checking the live catalog:

| User wording | `ai-cli` model | Provider rule |
| --- | --- | --- |
| `0x`, `0x alpha`, `0xAlpha` | `oc-opencode/x-preview-f-free` | OpenCode explicit model; omit `reasoning_effort`. |
| `opus` | `opus` | Claude; `reasoning_effort` may be `low`, `medium`, `high`, `xhigh`, or `max`. |
| `fable` | `fable` | Explicit Claude pass-through accepted by the installed Claude CLI; pair it with `reasoning_effort: max` and do not auto-select it. |
| `claude:<catalog-model>` | the suffix | Claude; validate the suffix against `models`. |
| `codex:<catalog-model>` | the suffix | Codex; validate the suffix against `models`. |
| `opencode:<provider>/<model>` | `oc-<provider>/<model>` | Validate the backend with `opencode models`; omit `reasoning_effort`. |

`fable` is not advertised by `ai-cli models` in version `2.21.0`, but the installed Claude CLI explicitly documents `fable` and `claude-fable-5` model values, and `ai-cli` passes explicit non-OpenCode/non-Codex/non-Gemini names through to Claude. Treat `fable` as an explicit high-rigor intent: use the `fable` model with `reasoning_effort: max`, keep the request direct, never alias it to Opus, and verify it with the host Claude help/auth surface before launching.

The `oc-` prefix is required by `ai-cli-mcp`; `opencode/x-preview-f-free` is the provider-native identifier, not the value passed to `ai-cli`. The router must translate it to `oc-opencode/x-preview-f-free`.

## Review recipe

For an adversarial review:

1. Resolve the model with `models` and choose the requested provider explicitly.
2. Use an absolute isolated worktree as `workFolder`; include the target commit, review scope, acceptance criteria, and the instruction to report evidence with file/line references.
3. Call `run` with the review prompt. Do not give a review agent a mutation mandate. The ai-cli wrapper bypasses provider permissions, so isolation and a clean worktree are the safety boundary.
4. Record PID, session ID, provider, model, worktree, target commit, and status in the ignored `.cache/agent-router/` run manifest.
5. Use `peek` for a short progress sample only. Use `wait` or `get_result` to collect the complete result.
6. On a transient provider failure, call `run` again with the same `session_id` and the same worktree. Do not start a fresh session unless the original session is unrecoverable.
7. After integration changes, run a new review against the new commit; do not ask a stale session to review a different checkout without stating the new target.

For parallel reviews, start all runs first, then wait on their PIDs together. Keep each worktree and manifest distinct. A successful process exit is not proof of a useful review; require a structured report and inspect the cited source.

## Implementation recipe

Use the same lifecycle for delegated implementation, but make the prompt explicitly mutation-authorized and name the exact branch/worktree. Require the agent to preserve repository instructions, run the narrow gate, and commit only its coherent slice. Review and integrate the result locally before running external review or broader checks.

## Configuration

The pinned server is declared in root `.mcp.json` for Claude and `.codex/config.toml` for Codex. Both invoke the workspace-local `pnpm exec ai-cli-mcp`, never an unpinned `npx` download. `tool_timeout_sec` controls the maximum individual MCP call, not server lifetime; the checked-in Codex value is one hour so a long `wait` can remain attached while the server itself stays a normal stdio process.
