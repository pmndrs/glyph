---
name: engine-call-contract
description: How every call into the text engine is shaped, and where each entry point's names live. Use before adding, moving, or removing anything on a published surface, before adding an error path or a result type to an engine call, and when deciding whether a failure belongs to the caller or to this package.
---

# The engine call contract

Two rules decide almost every API question in this package. Both were arrived at by getting them wrong first.

## A call answers, or it throws where it was written

An engine call is synchronous and takes no resource that could be missing: a font is required at construction,
text and spans are validated there, and constraints are checked by the call itself. Nothing is left to wait for and
nothing is left for a caller to get wrong, **so there is no failure to hand back**.

- **Return the answer.** `measure()` returns metrics. `layout()` returns the inspection. No `{ ok }` union, no
  nullable, no out-of-band error to consult afterwards.
- **Throw for input the language let them express but which has no meaning.** `{ mode: 'at-most', size: NaN }` is
  well-typed and means nothing; there is no width it could stand for, so there is nothing to return, clamp, or
  guess. Throw from the call, name the axis or the span or the offset, and let the stack point at the caller.
  Silently accepting it turns a wiring bug into wrong text on screen, which is worse than an exception.
- **Never return a failure the caller cannot cause.** A result union for an engine defect makes every caller write
  `if (result.ok)` forever -- inside a flexbox measure callback, many times per layout -- to guard a branch that
  only means this package is broken. That is ceremony for an impossible case. Let the defect throw.
- **Never enter a broken state that outlives the call.** A rejected frame must not leave the engine refusing work,
  recompiling an invalid frame at frame rate, or holding a latch a caller has to clear. Report once, stop, and keep
  the rest of the scene live: transforms, visibility, and render order belong to the last accepted publication and
  never entered the frame that was refused.

The distinction that matters, in one line: **a throw is the caller's arithmetic; a persistent failure is our
defect.** Neither is a return value.

### Making the throw unnecessary

Prefer a shape that cannot express the mistake over a check that catches it.

- Structural authoring beats offsets. `txt` and `span` derive ranges from what was written, so an inverted range, a
  past-end range, and a partial overlap are unrepresentable rather than validated.
- A brand beats a convention. `session.retain()` returns a branded publication, so an API that stores plan data
  across frames demands the retained brand in its parameter and a borrowed one is a compile error.
- Where the language cannot express the domain -- there is no finite-nonnegative number type -- the throw is the
  honest floor. Record it as a known limit rather than defending it as ideal.

## Where a name lives

**A type an application can encounter lives at the root. A thing only an integrator constructs -- and its
arguments and results -- lives in `/core`.**

`ParagraphMeasurement` is at the root because an app reads one off `Text`. `Paragraph` is in `/core` because only
someone implementing a renderer constructs the thing that produces one. The two surfaces share zero names and a
test enforces it.

| entry | holds | audience |
| --- | --- | --- |
| `.` | the vocabulary of text: fonts, authoring, layout and measurement types, technique definition | everyone |
| `./core` | the policy contract, the render plan, the frame wire and its handoff | integrators |
| `./three`, `./react` | one integration's own surface | applications |
| `./tsl`, `./typegpu` | technique shaders, no engine, no scene | any host |

`/core` is **additive to the root, not parallel to it**: an integrator imports both. It is not meant to stand alone,
so "you cannot do X from `/core` alone" is not a finding unless X is engine driving.

An integration may re-export a root name **only when its own signatures use it** -- a caller should be able to name
what `measureLayout()` returns without a second import, and nothing beyond that. Re-exporting more gives the
vocabulary a second home and makes the import site a guess. `entry-point-boundaries.test.mjs` enforces both halves.

A renderer type must not enter the shared vocabulary to make an integration convenient. When an integration needs
per-run renderer state, the span names an abstract selector and the integration resolves it through its own
registry, the way `registerThreeRasterPlanProgram` already maps techniques to programs. Pushing a `THREE.Material`
into a span is the mistake this rule exists to prevent, and it is the reason the raw-offset span array cannot yet
be withdrawn.

## When you are about to add an error path

Ask, in order:

1. Can the type stop this being expressible? Do that instead.
2. Can only a caller cause it? Throw from the call, naming the thing.
3. Can only this package cause it? It is a defect: throw, report once, and do not build a recovery protocol.
4. Is it a policy the caller asked for, like a fixed glyph budget? Then it is not a failure at all. Define the
   behaviour, warn in development, expose it for reporting, and let it self-heal.
