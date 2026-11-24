---
type: Decision
title: 'Render-time failures throw; onError and TextFrameError removed'
description: 'A failure Glyph finds while rendering is thrown once from that render; there is no onError callback and no TextFrameError.'
decision_status: Accepted
decided: '2026-11-23'
generated:
  by: process:docs-new
  at: '2026-11-24T02:15:31Z'
---

# Render-time failures throw; onError and TextFrameError removed

## Decision

Glyph has no error callback. A failure is thrown from the call that found it, and a failure found while rendering
is thrown from that render, the way an exception from an `onBeforeRender` callback leaves Three's
`renderer.render()`. This supersedes the line of
[deferred-never-stale-preparation.md](deferred-never-stale-preparation.md) that kept `onError` for
publication-time failures.

- **What is thrown from a render.** A paragraph the engine refused, a publication the renderer rejected, an engine
  restart, a fixed root capacity exceeded, and an exception thrown by an application's `onLayout` callback.
- **Where.** Three, R3F and Vue: the end of the next render of the root's Scene, from its outermost
  `onAfterRender`, after Three restored its render target and drew the frame. TypeGPU: the root's next `draw()`,
  after it recorded the siblings. An explicit `glyph.shape()` or `glyph.prepare()` keeps throwing what it threw
  (a rejected root, an engine status); PixiJS 3D has no render hook, so `glyph.shape()` is where it throws.
- **Once.** A failure is thrown once. A failure the next frame finds again (the same refusal, the same dead engine)
  is still standing and is not thrown again; a text whose new input fails again is a new failure. Several failures
  of one render are one `AggregateError`.
- **The frame still happens.** Glyph settles its own bookkeeping when it finds the failure. The failed text draws
  nothing until its input changes, its siblings draw, and the next frame renders normally. Every due `onLayout`
  callback runs before the frame publishes; the first frame's exceptions are thrown after it.
- **Calls are unchanged.** Setters, reads and editing calls throw as before (`GlyphInputError`,
  `GlyphLayoutPhaseError`, `TextOffsetError`), and `<GlyphErrorBoundary>` stays for them.
- **GPU errors copy Three's semantics exactly** (confirmed by Justin, 2026-11-23). Where Three only logs (a shader
  that does not compile, a lost device), Glyph logs the same way, through Three, and does not throw: its draws are Three
  draws, so Three reports them, and Glyph adds no throw and no routing of its own. No Glyph code routed GPU or device
  errors to `onError`, so nothing was removed for this rule.
- **Reads stay.** `Text.error`, `TextGroup.error`, `commitState()`, `TypeGpuText.error` and `Pixi3DText.error` name
  which text failed, which the thrown value does not.

Removed: `ThreeRoot.onError`, `Text.onError`, `TextGroup.onError`, the R3F `<Text onError>` and
`<TextGroup onError>` props, the Vue `error` event (a FontFace load failure reaches `onErrorCaptured` and
`app.config.errorHandler` instead), the TypeGPU `onError` option and property, `Pixi3DText.onError`, and the
never-thrown `TextFrameError`, `TextFrameRejection`, `TextFrameSubject` and the `'frame-rejected'` error code.

## Why

- A callback is a second error channel every integration has to wire and every application has to remember to
  set; an unset one swallowed a refused paragraph silently. A throw reaches whatever the application already uses:
  a `try` around `renderer.render()`, the R3F or Vue error handling, `window.onerror`, Sentry.
- Three itself throws an application callback's exception out of `renderer.render()`. Text failing to draw is the
  same kind of event, so it travels the same way.
- The throw comes from the end of the render, not from inside the traversal where Glyph finds it. Three 0.185's
  `_renderScene` sets its internal output render target before it traverses the Scene and restores it only after
  drawing; a throw from the traversal leaves `_renderTarget` set, so `isOutputTarget` stays false and every later
  frame draws into the hidden target instead of the canvas. The outermost `onAfterRender` runs after that restore.
- Throwing a standing failure every frame would make an application's error reporting a per-frame flood and would
  stop a render loop that does not catch, for a condition the application already knows about.
- `TextFrameError` had no caller since the engine status errors replaced it; keeping an exported, documented error
  that nothing throws was open question 16 of the 0.2.0 API review.

## Consequences

- 0.2.0 removes every `onError`; an application that read failures there wraps `renderer.render()` (or `draw()`)
  in `try`, or relies on its global error handler. The migration guide says how.
- A render loop meets a render-time failure the way it meets its own `onBeforeRender` exception: one that does not
  catch stops or reports it however it handles that. How R3F's and TresJS's loops behave was not verified here.
- When the Scene is rendered inside another render (a post-processing pass that renders it from within the outer
  render), the throw leaves the inner render cleanly but unwinds the outer one past its restore, the same as any
  `onAfterRender` exception would.
- Failures found by a traversal outside any render (an application's own `scene.updateMatrixWorld()`) wait for the
  next render of that Scene; a root that never renders never throws them, and its texts' `error` still names them.
- A Scene conflict (one root in two Scenes) still throws from the traversal that meets it, as before; this
  decision does not change it.
