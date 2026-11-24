---
type: Issue Record
title: 'Issue 09: a second shader.coverageAt call floods the console with renamed-declaration warnings'
description: 'Every Slug coverage graph declares the same fixed TSL variable names, so a second coverageAt in one material makes Three rename and warn for each of them.'
status: draft
sources:
  - id: slug-shader
    resource: ../../../../packages/glyph/src/shaders/tsl/slug/shader.ts
    title: Slug TSL shader
  - id: shader-test
    resource: ../../../../packages/glyph/tests/integration/three-shader.test.mjs
    title: Three shader tests
generated:
  by: anthropic/claude-opus-5-5
  at: '2026-11-24T16:05:00Z'
---

# Issue 09: a second `shader.coverageAt` call floods the console with renamed-declaration warnings

- **Severity:** should-fix (correct shader, but dozens of warnings per material build hide real ones)
- **Status:** fixed — each `coverageAt` evaluation after the first gets an `At<n>` name suffix; the shader test compiles three evaluations on both backends with no rename warning

## What happens

A Slug material that evaluates `shader.coverageAt(coordinate)` besides the default `coverage` (the documented way to
sample coverage at a displaced coordinate) logs, per material build, Three's
`TSL: Declaration name 'slugEmsPerPixel' of 'vec2' already in use. Renamed to …` for every named variable of the
coverage graph. Found by the hero.

## Root cause

`src/shaders/tsl/slug/shader.ts:98-115`: `coverageAt` builds a fresh inlined `Fn` per call, and the default `coverage`
is already one call. Every call reaches the same fixed `.toVar(name)` names (`slug-render.ts` `slugEmsPerPixel`,
`slugPixelsPerEm*`, `slugSample`; `slug-band.ts` `slugHorizontal*`/`slugVertical*`, `slugX/YCoverage`;
`solve-quadratic.ts` `…Discriminant`, `…Root*`; `calc-coverage.ts` `slugRawCoverage`, `slugCoverage`;
`slug-texture.ts` `…Header`). Three's `NodeBuilder` keeps one declaration namespace per stage and renames and warns
on each collision (`three@0.185.1/src/nodes/core/NodeBuilder.js:2277-2289`).

## Options considered

1. **Name suffix per call.** The first evaluation keeps the readable names; each later `coverageAt` call of the same
   shader gets `_1`, `_2`, … threaded through `SlugRenderOptions`.
2. **Unnamed variables.** Removes the warnings and the readable WGSL names reviewers use to read the generated shader.
3. **A real WGSL function (`Fn.setLayout`).** One function called N times; but the body reads instance attributes and
   varyings that are not function parameters, which TSL layouts do not capture.
4. **Memoize by coordinate node.** Covers only repeated calls with the same node.

## Chosen fix

Option 1: explicit, keeps the names, and every call is collision-free.

## Test that will prove it

`tests/integration/three-shader.test.mjs`: a Slug material using `coverage` and two `coverageAt` calls compiles on
both backends with no "already in use" warning (captured through Three's console function), and each call's
variables appear with their suffix.

## Risk

Behaviour/API: none. Performance: none (same graph). Size: a few bytes in the shader library.
