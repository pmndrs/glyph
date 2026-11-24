---
type: Issue Record
title: 'Issue 07: root.onInvalidate does not fire for root.material or TextGroup changes'
description: 'Material and group setters invalidate the planner through ConfiguredHandle.invalidate(), which does not run the invalidated hook, so an on-demand render loop is never asked for a frame.'
status: draft
sources:
  - id: three-text
    resource: ../../../../packages/glyph/src/three/text.ts
    title: Three root and TextGroup
  - id: layout-phase-test
    resource: ../../../../packages/glyph/tests/integration/frame-layout-phase.test.mjs
    title: Frame layout phase tests
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 07: `root.onInvalidate` does not fire for `root.material` or `TextGroup` changes

- **Severity:** should-fix (an on-demand loop shows the old material until something else requests a frame)
- **Status:** fixed — `invalidateMaterial()` notifies the host; the layout-phase test covers all four writes

## What happens

```ts
root.onInvalidate = () => (requested += 1);
root.material = material; // requested unchanged
group.material = material; // requested unchanged
group.batching = 'group'; // requested unchanged
```

Reproduced against the built package after a first frame. `text.text = …` and `text.material = …` do fire it. Found
by the docs site.

## Root cause

`ThreeRootHost.notifyInvalidated()` (`src/three/text.ts:893`) runs only from the planner's dirty observer
(`src/three/internal/define-config.ts:98`, fed by `src/internal/configured-handle.ts:508-511`), which text-state
mutations reach. The root material setter (`:490` → `setMaterial`), `TextGroup.material` (`:1894`),
`TextGroup.batching` (`:1877`) and `TextGroup.dispose` (`retireGroup`) all go through
`ThreeRootHost.invalidateMaterial()` (`:658-661`), which marks the root dirty and calls `ConfiguredHandle.invalidate()`
— a forced re-shape that does not run the `invalidated` hook.

## Options considered

1. **Notify in `invalidateMaterial()`.** One line; covers every path above. Never runs during traversal (only setters
   call it), and `notifyInvalidated` already swallows a throwing callback.
2. **Run the hook inside `ConfiguredHandle.invalidate()`.** Broader, but `requestLayoutPhase` also routes there from
   inside a frame, where asking for another frame would loop an on-demand renderer.

## Chosen fix

Option 1.

## Test that will prove it

`tests/integration/frame-layout-phase.test.mjs` ("a root reports invalidation"): after a frame, `root.material`,
`group.material`, `group.batching` and `group.dispose()` each increase the count.

## Risk

Behaviour: on-demand loops get one more frame request per material/group change. API: none. Performance: none.
`TextGroup.renderOrder` is a plain `Object3D` field Three does not intercept; like any Three property change it
needs the application's own frame request.
