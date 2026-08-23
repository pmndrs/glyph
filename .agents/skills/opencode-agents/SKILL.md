---
name: opencode-agents
description: Run implementation work on opencode agents without losing it. Covers launching, judging liveness, resuming an interrupted session, and the worktree and concurrency constraints that make runs fail. Use whenever delegating a feature, port, or review to opencode, or when an opencode run appears stalled.
---

# opencode agents

`opencode run` delegates a whole feature to a model that is not you. It works, and it fails in ways that look identical to success from the outside. Everything here was paid for once.

## Launch

```bash
cd <worktree>
opencode run --pure --auto --variant high --format json -m <provider>/<model> "$(cat brief.md)" > run.jsonl 2>&1
```

- `--pure` skips external plugins. Without it you inherit whatever is configured globally.
- `--auto` auto-approves permissions. Unattended runs hang forever without it, silently.
- `--variant high` is the reasoning effort.
- `--format json` streams structured events. Use it, but do not trust it as a liveness signal — see below.
- **Set the working directory with `cd`, not `--dir`.** `--dir` is for attaching to a server. Passing it alongside a different cwd made runs bootstrap in the wrong repository and sit idle; the log line `creating instance directory=...` is how that shows up.

## Worktrees must live outside the repository

pnpm walks up from the working directory and finds the parent workspace, so a git worktree nested inside the repo (`.claude/worktrees/...`) installs the wrong dependency graph. Put agent worktrees somewhere else entirely and clean them up afterwards.

A correct install resolves the whole workspace — hundreds of packages — and leaves `node_modules` under each package. A handful of root devDependencies means pnpm resolved the wrong root.

Install dependencies **before** launching and tell the brief they are installed. An agent that spends its first minutes on `pnpm install` produces no output, which is indistinguishable from a stall.

## Judging liveness — the part that costs work

`opencode run` buffers stdout when it is not a TTY. **A zero-byte log file means nothing.** Neither does a clean `git status`: an agent researching a large change writes nothing for a long time.

The reliable signal is the session's own timestamp:

```bash
opencode session list      # the Updated column, and a real title, prove the model answered
```

A session that has a generated title has already had a model response. If its `Updated` time is recent, it is working — leave it alone.

Weaker corroborating signals: accumulating CPU time (`ps -o pid,etime,time`) means it is doing something; elapsed time far exceeding CPU time is normal, because most of the wall clock is waiting on the model.

Do not kill an agent because its log is empty. That mistake destroyed four in-flight sessions in one night, three of which had real work.

## Resuming is always available

Sessions persist. An interrupted, killed, or crashed run resumes with its full context:

```bash
opencode session list                                   # find the id by title
cd <its worktree>
opencode run --session <id> --pure --auto --variant high --format json -m <model> \
  "Continue where you left off. Your session was interrupted, not cancelled. Report what you had
   already completed, then finish the remaining work and commit it."
```

Prefer resuming over relaunching. A relaunch throws away everything the agent learned and pays for the research again.

`--continue` resumes the most recent session in the directory; `--fork` branches instead of continuing.

## The provider goes down, and that is the normal case

The free tiers are under load test. `Upstream request failed: Endpoint is unavailable` and
`Service Unavailable` are the steady state, not the exception — 43 of them in one night, twenty
inside a single fifteen-minute window. They surface in `~/.local/share/opencode/log/opencode.log` as
`level=ERROR message="stream error" ... AI_APICallError`.

Concurrency is **not** the cause. There were no rate-limit or quota errors at all, and the failures
cluster in time rather than by how many agents were running. Reducing concurrency does nothing for a
503; retrying does. Do not conclude "rate limit" from a stalled agent without reading that log.

Use the bundled launcher rather than calling `opencode run` directly:

```bash
node .agents/skills/opencode-agents/scripts/run-agent.mjs \
  --brief brief.md --cwd <worktree> [--attempts 8]
```

It captures the session id from the first stream, and on a transient provider failure it waits with
doubling backoff (5s, capped at two minutes) and **resumes that session** instead of restarting, so
an outage costs waiting rather than work. A failure that is not a provider outage exits immediately
rather than retrying a real defect. The full event trace is retained under `.cache/opencode-agents/`.

## Writing the brief

The brief is the entire specification. The agent cannot ask a question.

- Name the branch and forbid switching it.
- Point at the binding repository instructions and the canonical planning document.
- Give it a **worked example to imitate** when one exists. "Follow the Bitmap port, here are its five files" produces a matching port; "port the shaders" does not.
- State the method when the method is the point. Requiring a shader port to diff against extracted WGSL rather than translate a node graph by eye caught two real defects that eye-translation would have shipped.
- Say what is out of scope, and which neighbouring branches must not be touched.
- Ask it to **say when the specification is wrong** rather than silently deviate. One agent correctly reported that a brief's premise was false — a zero-width measurement is degenerate and cannot yield intrinsic widths — and implemented the correct thing instead. That only happens if invited.
- Define done as the repository's own gate, and require the docs and handoff table to be updated in the same change.

## Integrating the result

The agent branched from a base that has probably moved. Replay only its own commits:

```bash
git rebase --onto <new-base> <the-base-it-branched-from> <its-branch>
```

The old base is the branch's fork point, not its own head — passing its own head replays nothing and silently empties the branch. Verify afterwards that a file only that agent created still exists.

Never resolve its conflicts by taking one side wholesale. Two agents adding fields to the same record is a union that needs comma fixups and struct-literal ordering; blanket resolution has silently dropped a regenerated ABI, decision-register entries, and a document's YAML frontmatter.
