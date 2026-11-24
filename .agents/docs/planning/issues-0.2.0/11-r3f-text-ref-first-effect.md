---
type: Issue Record
title: "Issue 11: R3F Text ref is null in the consumer's first effect"
description: 'Text and TextGroup forward their ref from a layout effect over React state set by the host ref, so the first commit assigns null and the object only arrives in a second commit.'
status: draft
sources:
  - id: react
    resource: ../../../../packages/glyph/src/react.ts
    title: React Text and TextGroup
  - id: react-test
    resource: ../../../../packages/glyph/tests/integration/react-adapter-behavior.test.mjs
    title: React adapter behaviour
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 11: R3F `<Text ref>` is null in the consumer's first effect

- **Severity:** should-fix (the documented way to reach the `Text` for `split()`, carets or `measure()`)
- **Status:** open

## What happens

```tsx
function Label() {
  const ref = useRef<Text>(null);
  useLayoutEffect(() => console.log(ref.current), []); // null
  useEffect(() => console.log(ref.current), []); // null
  return (
    <Text ref={ref} font={font}>
      Hello
    </Text>
  );
}
```

The hero had to read the ref from `useFrame`.

## Root cause

`src/react.ts:552-553`: `Text` keeps the host object in `useState`, set by the host element's ref callback
(`publishObject` in `ResolvedTextObject`), and forwards it with
`useLayoutEffect(() => assignRef(forwardedRef, object ?? undefined), [forwardedRef, object])`. In the first commit the
host ref fires and schedules a state update, but the layout effect still sees `null` and assigns it; the consumer's
layout and passive effects for that commit run with `null`. The object reaches the ref only in the follow-up commit.
`TextGroup` (`:796-797`) has the same shape.

## Options considered

1. **Assign the forwarded ref from the host ref callback.** Host refs attach in the layout phase before parent layout
   effects, so the consumer's first effects see the object. Removes the state and the effect.
2. **`useImperativeHandle`.** Still needs the object at the child's layout phase; adds nothing over option 1.

## Chosen fix

Option 1 for `Text` and `TextGroup`: the memoized host ref callback publishes to the internal store and assigns the
forwarded ref (and clears it on detach).

## Test that will prove it

`tests/integration/react-adapter-behavior.test.mjs`: a consumer's first `useLayoutEffect` and `useEffect` see the
mounted `Text` and `TextGroup` through their refs; unmount clears them.

## Risk

Behaviour: one fewer commit per mounted `Text`/`TextGroup`; a callback ref is called once with the object instead of
`null` then the object. API: none.
