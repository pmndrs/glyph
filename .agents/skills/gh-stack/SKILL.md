---
description: |
  Manage dependent branches and pull requests with the gh-stack GitHub CLI extension. Use for stacked diffs, dependent pull requests, branch chains, stack navigation, rebasing, submission, synchronization, or merging.
metadata:
  author: github
  github-path: skills/gh-stack
  github-ref: refs/tags/v0.1.0
  github-repo: https://github.com/github/gh-stack
  github-tree-sha: c95c8b5b4dd850f3fef007b304428f5684f2fb87
  version: 0.0.9
name: gh-stack
---

# gh-stack

A stack is a linear dependency chain rooted on the repository's remote default branch. Each branch maps to one PR whose
base is the branch below it. Use gh stack for the whole lifecycle; ordinary push, PR creation, and PR merge commands do
not preserve stack state.

## Invariants

- Run every command non-interactively. Pass branch, PR, stack, remote, and mode arguments explicitly.
- Root a new stack on the current remote default branch. Inspect rather than guessing it.
- Use deliberate git add and Conventional Commits. A branch may contain several commits, but one coherent review concern.
- Use gh stack submit --auto; add --remote when the remote is not unambiguous.
- Use gh stack view --json; the unflagged command opens a TUI.
- Use gh stack merge with --yes; never substitute gh pr merge.
- Foundational work belongs below dependent work. Modify the lowest branch that owns an invariant, then rebase upward.
- Do not share a branch across stacks. Disambiguation failures are structural errors, not prompts to bypass the tool.
- Never destroy or rewrite user work to recover a stack. Resolve conflicts deliberately or abort the stack operation.

The installed CLI is the authority for exact flags. Before an unfamiliar or destructive operation, run
gh stack <command> --help rather than relying on copied command documentation.

## Inspect first

    git remote -v
    git branch --show-current
    git symbolic-ref --short refs/remotes/origin/HEAD
    gh stack view --json

An existing checkout may already be tracked by a stack even when it contains only one feature branch. Preserve that state
and submit through the stack instead of recreating the PR.

## Common workflows

### Commit and submit the current stack

    git add <exact paths>
    git commit -m "type(scope): coherent invariant"
    gh stack submit --auto --remote origin
    gh stack view --json

Verify the remote branch after submission:

    git rev-list --left-right --count origin/<branch>...HEAD

### Create or extend a stack

    gh stack init --base <remote-default-branch> <bottom-branch>
    gh stack add <next-branch>

init, add, and checkout require explicit positional arguments. Choose branch names relevant to the actual concern; the CLI
uses them verbatim.

### Change a lower layer

    gh stack checkout <branch-or-pr>
    # edit, verify, git add, git commit
    gh stack rebase --upstack --remote origin
    gh stack submit --auto --remote origin
    gh stack view --json

On a rebase conflict, inspect and resolve the named files, stage the resolutions, then run gh stack rebase --continue. If
the intended resolution is not clear, abort with gh stack rebase --abort and ask the user rather than guessing.

### Synchronize after merges

    gh stack sync --remote origin
    gh stack view --json

Use --prune only when removing merged local branches is in scope. A stack restructure or local tracking reset requires an
explicit target and a read of gh stack unstack --help; --local preserves GitHub state.

### Merge

    gh stack merge <stack-or-pr-number> --yes --squash

Resolve the exact stack or PR number with view --json first. Stack merge is all-or-nothing where repository rules permit
it; merge queues may enqueue the PRs instead.

## Failure handling

- Exit 2: the checkout is not in a stack; inspect before initializing or adopting one.
- Exit 3: resolve the reported rebase conflicts, then continue or abort.
- Exit 6: a branch belongs to multiple stacks; check out an unambiguous branch explicitly.
- Exit 7: finish or abort the existing rebase before another stack operation.
- Exit 8: another process owns the stack lock; confirm it is still running, then retry after it releases the lock.
- Authentication, API, or repository-feature failures need their stated prerequisite fixed; do not fall back to ordinary
  GitHub PR commands.

Report the branch chain, PR URLs or numbers, and verification result. Do not dump raw JSON when a concise status answers
the user's question.
