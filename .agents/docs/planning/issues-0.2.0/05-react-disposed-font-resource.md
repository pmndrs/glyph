---
type: Issue Record
title: 'Issue 05: React can hand a disposed font resource to a mounting component'
description: 'A render-phase useFont read is pinned only when no component retains the resource, so a render that captured a retained resource can commit after its last retainer released and disposed it.'
status: draft
sources:
  - id: react
    resource: ../../../../packages/glyph/src/react.ts
    title: React font resources
  - id: lease-test
    resource: ../../../../packages/glyph/tests/integration/react-lease-lifecycle.test.mjs
    title: React lease lifecycle tests
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 05: React can hand a disposed font resource to a mounting component

- **Severity:** should-fix
- **Status:** not reproduced deterministically; hazard confirmed by reading; fix planned, not applied

## What happens

The docs site pooled several R3F roots. Swapping a root's scene with `flushSync(() => root.render(null))` and then
`root.render(next)` sometimes threw `React cannot retain a disposed font resource` when the scenes shared a `useFont`
source. The site worked around it by swapping in one commit (`experiments/sil-docs-site` 4e75df11f).

## Reproduction attempts

All in `@react-three/test-renderer` with the package build; none threw:

- one root, unmount then mount in two commits (each under `act`);
- two roots, the second mounting while the first unmounts inside one `act`;
- two raw roots without `act`, the second rendering inside `startTransition` and held by a sibling suspended on a
  gate promise while the first unmounts — React restarted the held render instead of resuming it, so the second render
  looked the resource up again.

React flushes pending passive effects before every render and commit, which closes most interleavings. The remaining
one needs a render that read the resource while another root retained it and whose commit lands in a later task than
that root's release, which an act-driven harness cannot schedule.

## Root cause (by reading)

`src/react.ts:886-891`: `useFontHook` reads the cached resource during render and calls `markPendingMount()`, then
retains it only in the store's `subscribe` (`:1163`), after commit. `markPendingMount` (`:994-996`) pins only when
`references === 0`. A render that reads the resource while another component holds it is therefore unpinned; if
that holder releases (`:1009-1017`, disposal one microtask later) before this render commits, `subscribe` calls
`retain()` on a disposed resource and throws (`:1001`). The memoized store (`:890`) still holds the old resource, so the
hook never looks it up again.

## Options considered

1. **Pin unconditionally in `markPendingMount`** (drop the `references === 0` guard). Smallest; a render that never
   commits keeps the resource until the next retain or `clear()`, the behaviour the zero-reference case already has.
2. **Recover in `subscribe`:** if the resource was disposed, look a fresh one up, publish to listeners, and let the
   next render suspend on its load. Robust to any interleaving, but needs the hook input in the store and turns a
   commit into a suspended re-render.
3. **Count pending renders.** Wrong under StrictMode and discarded renders: the count never returns to zero.

## Chosen fix (planned)

Option 1, with option 2 as the follow-up if a reproduction shows option 1 is not enough. It is held until a
deterministic failing test exists: the repository rule is a failing test first, and a guess at a scheduling race
should not land without one. The test needs a harness that holds one root's render across another root's release
(for example a custom reconciler host or React's internal `Scheduler` mock driving two concurrent roots).

## Risk

Option 1 can keep a font's GPU resources alive after an abandoned render until another consumer mounts or the app
calls `useFont.clear`; no API change.
