# Router lifecycle

`run` returns a managed process PID. Store it with the selected provider/model, absolute worktree, target commit, and prompt identity. The process can finish while the MCP client is disconnected; its result remains queryable through `get_result`.

Use `peek` as an observation window, not as a log reader. It can miss events between calls and deliberately omits raw command output. Use `wait` for one or more PIDs when coordinating a batch, then use `get_result` with `verbose: true` when metadata or the full parsed result is needed.

Resume by passing the returned `session_id` back to `run`. For OpenCode this is an in-place `--session` resume; for Claude and Codex it maps to their provider-specific resume flags. Keep the same model and worktree unless the new prompt explicitly records why either changed.

`kill_process` is cancellation, not failure recovery. Before killing a process, capture its current result and classify the failure. A provider outage is resumable; a bad prompt, invalid model, missing login, or dirty/mis-scoped worktree needs correction before another run.
