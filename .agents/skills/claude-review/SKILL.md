---
name: claude-review
description: Launch read-only Claude Code adversarial reviews with visible live progress and a complete structured trace retained in an ignored repository cache. Use when the user asks Codex to run Claude, Opus, an external-model code review, an adversarial technique review, or to preserve and inspect Claude CLI review evidence.
---

# Claude review

Use the bundled launcher instead of invoking `claude -p` directly. It keeps the review observable and retains enough evidence to audit or resume the human handoff.

## Prepare the review

- Ground the prompt in the current commit, diff, canonical repository knowledge, and applicable project skills.
- Give one bounded review subject per run. Launch independent subjects separately when their contracts or evidence differ.
- Ask for prioritized findings with exact paths and lines, observed versus inferred claims, clean layers, and not-verified gaps.
- Keep review runs read-only. Use the ordinary implementation workflow after reviewing findings; do not let the review process mutate the worktree.
- Write the complete prompt to a temporary Markdown file. Do not squeeze a large review brief through shell quoting.

## Launch and observe

From the repository root, run:

```sh
node .agents/skills/claude-review/scripts/run-review.mjs \
  --name <short-run-name> \
  --prompt-file <absolute-prompt-path>
```

The launcher defaults to the `opus` alias at `high` effort, Claude plan mode, and read-oriented `Read,Grep,Glob,Bash` tools. Pass a higher `--effort` only when the user explicitly requests that effort; a model name or difficult task never implies it.

Let the terminal output remain visible while the process runs. Tool activity and completed assistant messages are progress evidence; do not replace observation with periodic guesses about the process.

If authentication fails, compare `claude auth status` in the launch environment with the user's interactive environment. A sandbox can hide an otherwise valid macOS Keychain session. Report that distinction before asking the user to log in again.

## Retained evidence

Each run creates `.cache/claude-review/<timestamp>-<name>/` with:

- `prompt.md` — exact submitted brief;
- `events.jsonl` — complete Claude stream events;
- `report.md` — final reusable review;
- `stderr.log` — CLI diagnostics;
- `run.json` — commit, model, effort, timing, status, exit code, session, usage, and cost metadata.

The cache is intentionally ignored by Git. Cite the run directory in the handoff, but commit durable findings only after independently validating them and placing them in the canonical package, decision, roadmap, or chronology document that owns them.

## Interpret the result

- Treat the external review as a probe, not authority. Reproduce actionable findings at the lowest honest layer before changing code.
- Separate defects from design questions and unsupported claims.
- Do not hide a nonzero exit, missing final report, permission denial, or unverified layer behind a summary.
- Apply `evidence-first` to the human report. Apply TSL, maintainability, Diátaxis, or OKF guidance according to the artifact being reviewed or updated.
