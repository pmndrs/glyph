# ai-cli model catalog

The router does not own a permanent copy of provider availability. Query `models` at the start of a run and treat this page as the interpretation of the `ai-cli-mcp@2.21.0` response shape.

`ai-cli` uses direct names for Claude and Codex. OpenCode has a configured-default name, `opencode`, and dynamic explicit names with the `oc-<provider/model>` prefix. Therefore the provider-native `opencode/x-preview-f-free` becomes `oc-opencode/x-preview-f-free` at the `ai-cli` boundary.

The current package catalog advertises Claude `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, and `haiku`; Codex `gpt-5.4`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, and `gpt-5.2`; and OpenCode's default plus dynamic backends discovered by `opencode models`. The installed Claude CLI additionally documents explicit `fable` and `claude-fable-5` values; these are pass-through choices, not `ai-cli` catalog aliases, so they require an explicit user request, host-CLI verification, and max effort when `fable` is chosen.

Reasoning is provider-specific: Claude accepts `low|medium|high|xhigh|max`, Codex accepts `low|medium|high|xhigh`, and OpenCode does not accept `reasoning_effort` through this integration.
