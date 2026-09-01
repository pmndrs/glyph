---
name: resolving-merge-conflicts
description: Use when a rebase or merge reports conflicts, when a branch has fallen behind a base that renamed or restructured files, when conflicts include generated artifacts or checked-in digests, or when a long-lived branch must be brought current before it can land.
---

# Resolving merge conflicts

Let git compute the merge; you make the decisions. The dangerous failure is silent: a change that vanishes without ever producing a marker.

## Procedure

1. Prefer **merge** over rebase for conflict-heavy branches when the repo squash-merges — resolve once, not once per commit, and the history difference never reaches the base branch.
2. Set `diff3` and `rerere` before starting.
3. Triage: outputs → regenerate; digests → re-pin; source → by hand.
4. Write down the transformation vocabulary.
5. Check base/ours/theirs **existence** before content.
6. Resolve one file at a time, reading the base section. **No scripts.**
7. For every deleted or renamed file, hunt the moved code and re-apply the lost edits.
8. Verify by grepping the old vocabulary and diffing net change against the pre-rebase branch.
9. Regenerate outputs from a **freshly built** toolchain, then run the real gate — not a narrower one you chose.

## 2. Configure first

```bash
git config merge.conflictStyle diff3   # show the base
git config rerere.enabled true         # replay resolutions across replayed commits
```

`diff3` is not optional. The two-way view hides who changed what:

```
<<<<<<< HEAD
    timeout: config.timeout,                     # base removed the fallback
||||||| base
    timeout: config.timeout ?? DEFAULT_TIMEOUT,
=======
    timeout: config.timeout ?? DEFAULT_TIMEOUT,  # branch never touched this line
>>>>>>> branch
```

Without the middle section this reads as "two sides disagree, pick one," and picking the branch silently reinstates something the base deliberately deleted. With it: the base wins the line it changed, the branch wins only its own change.

## 3. Triage before resolving anything

| category | how to resolve |
| --- | --- |
| Build outputs — baked artifacts, atlases, size reports, generated manifests | take either side, **regenerate at the end**. The bytes are outputs, not decisions. |
| Generated identity — content digests, checksums, lockfiles | take either, **re-pin at the end** with the repo's own command |
| Real source, tests, docs | by hand, one at a time |

## 4. Name the transformation once

Ask what the branch is actually doing, and write it down:

```
OldType → NewType,  oldField → newField,  oldCall() → newCall(…)
```

Then every conflict follows one rule — **take the base's structure, apply the transformation** — and you stop re-deciding per file.

## 5. Check existence on all three sides

```bash
MB=$(git merge-base BRANCH BASE)
for f in $(git diff --name-only --diff-filter=U); do
  printf '%-60s base=%s ours=%s theirs=%s\n' "$f" \
    "$(git cat-file -e "$MB:$f"    2>/dev/null && echo y || echo N)" \
    "$(git cat-file -e "BASE:$f"   2>/dev/null && echo y || echo N)" \
    "$(git cat-file -e "BRANCH:$f" 2>/dev/null && echo y || echo N)"
done
```

A file missing on one side is a modify/delete conflict. Feed an empty side to a merge tool and *everything* reports as conflicting — which reads as "the content genuinely conflicts" when it means "my inputs are wrong."

## 7. The dangerous case: changes that don't conflict at all

**When one side moves or deletes code and the other side edits it, the edit can vanish with no conflict reported** — silently, green tests, no marker. If the branch *added* behaviour to a file the base deleted, that behaviour is simply gone.

For every deleted or renamed file, trace where the code went:

```bash
git show --diff-filter=D --stat <commit>   # what died
git show --diff-filter=A --stat <commit>   # what was born
git grep -l '<exported symbol>' BASE       # did the API survive, or only the machinery?
git log --oneline -S'<distinctive line>' --all -- <path>
```

**Symbol search beats file search.** An absent export proves an API was removed rather than renamed — `--find-renames` misses this when a file is split rather than moved.

Then diff each side against the **merge base**, not against each other, to see who added what:

```bash
git show "$MB:path/file" | grep -n '<line>'   # absent here ⇒ one side added it
```

## 8. Verify completeness, not cleanliness

A clean rebase proves nothing.

```bash
git grep -nE 'OldType|oldField|oldCall' -- 'packages/*/src'   # vocabulary fully replaced?
git diff $(git merge-base OLD BASE)..OLD -- src               # what the branch did originally
git diff BASE..REBASED -- src                                 # what it does now
```

The two diffs should differ only where the base moved things.

## Red flags

- Reaching for `sed`, `git apply`, or a merge loop across conflicted files. A rename script cannot tell a conflict from a resolution and rewrites both sides.
- **A second scripted attempt after the first failed.** Abort instead — `git rebase --abort` is free, a tree carrying your own edits mixed with git's markers is not recoverable by inspection.
- Resolving without having seen the base section.
- Saying "the other side probably moved that code" instead of running `git show --stat`.
- Hand-editing a generated artifact, digest, or lockfile.
- Treating "rebase completed" or "tests pass" as evidence the branch is intact.
- Regenerating outputs without rebuilding the toolchain first — they reproduce the old behaviour and look correct.
- Running a narrower check than CI because it is faster.
