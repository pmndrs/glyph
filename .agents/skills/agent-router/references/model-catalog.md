# ai-cli model catalog

The router does not own a permanent copy of provider availability. Query `models` at the start of a run and treat this page as the interpretation of the `ai-cli-mcp@2.22.0` response shape.

`ai-cli` uses direct names for Claude and Codex. OpenCode has a configured-default name, `opencode`, and dynamic explicit names with the `oc-<provider/model>` prefix. Therefore the provider-native `opencode/x-preview-f-free` becomes `oc-opencode/x-preview-f-free` at the `ai-cli` boundary.

The current package catalog advertises Claude `sonnet`, `sonnet[1m]`, `opus`, `opusplan`, `fable`, and `haiku`; Codex `gpt-5.4`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4-mini`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, and `gpt-5.2`; and OpenCode's default plus dynamic backends discovered by `opencode models`.

Reasoning is provider-specific: Claude accepts `low|medium|high|xhigh|max`, Codex accepts `low|medium|high|xhigh`, and OpenCode does not accept `reasoning_effort` through this integration.

Router policy defaults every Claude and Codex model to `high`, including Fable, Luna, Tera/Terra, and Sol. The user-facing shorthand maps to `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. A higher tier is valid only when the user explicitly requests that effort and the selected provider accepts it; model choice alone never raises effort. The `claude-ultra` and `codex-ultra` aliases are therefore forbidden unless higher effort was explicit. OpenCode routes omit the effort field.
