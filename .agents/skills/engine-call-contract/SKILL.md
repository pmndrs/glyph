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

- **Return the answer.** `layout()` returns metrics. `glyphs()` returns the inspection. No `{ ok }` union, no
  nullable, no out-of-band error to consult afterwards.
- **Throw for input the language let them express but which has no meaning.** `{ mode: 'at-most', size: NaN }` is
  well-typed and means nothing; there is no width it could stand for, so there is nothing to return, clamp, or
  guess. Throw from the call, name the axis or the span or the offset, and let the stack point at the caller.
  Silently accepting it turns a wiring bug into wrong text on screen, which is worse than an exception.
- **Never return or proactively scan for a failure the caller cannot cause.** A result union for an engine defect makes every caller write
  `if (result.ok)` forever -- inside a flexbox measure callback, many times per layout -- to guard a branch that
  only means this package is broken. A deep runtime validator adds the same ceremony inside Glyph. Prove package-owned
  invariants at their producer; if corruption is encountered naturally, let the operation throw.
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
- A brand beats a convention. `GlyphRenderer.decode()` receives one borrowed `CommandBufferView` whose projected
  sequences expire with that synchronous call; the public API has no owned render-publication escape hatch. Cross-realm
  font movement is instead explicit through `FontFace.clone()`, whose serialized data and transfer list have their own
  versioned contract.
- Where the language cannot express the domain -- there is no finite-nonnegative number type -- the throw is the
  honest floor. Record it as a known limit rather than defending it as ideal.

## Where a name lives

**A value or type an application can encounter lives at the root. A renderer-neutral helper only an integrator
calls lives on the exact `/config/*` leaf that owns it.**

`ParagraphMeasurement` and `GlyphConfig` are at the root because applications encounter them through `Text` and
`glyph.handle()`. `defineGlyphConfig` lives at `/config/glyph` because only an integration author calls it. Codec,
schema, portable-resource, and raster-format construction helpers follow the same exact-leaf rule. Internal engine,
planner, wire, projection, and binding machinery has no public subpath. Boundary and packed-package tests enforce all
three facts.

| entry                    | holds                                                                                                | audience     |
| ------------------------ | ---------------------------------------------------------------------------------------------------- | ------------ |
| `.`                      | `glyph`, fonts, authoring, layout and measurement values, plus application-encountered config types  | everyone     |
| `./config/*`             | exact renderer-neutral construction helpers for config, Codec, schema, resources, and raster formats | integrators  |
| `./three`, `./react`     | one integration's application surface                                                                | applications |
| `./three/*`, `./react/*` | independently importable integration features and raster formats                                     | applications |
| `./tsl/*`, `./typegpu/*` | independently importable technique shaders, with no engine or scene                                  | any host     |

Config leaves are **additive to the root, not parallel to it**: an integrator imports application-encountered types
from the root and construction helpers from their one owning leaf. Do not add a config barrel or re-export those
helpers from the root merely to shorten imports; that charges ordinary applications for the integration DSL and gives
each helper multiple public homes.

An integration may re-export a root name **only when its own signatures use it** -- a caller should be able to name
what `measureLayout()` returns without a second import, and nothing beyond that. Re-exporting more gives the
vocabulary a second home and makes the import site a guess. `entry-point-boundaries.test.mjs` enforces both halves.

A renderer type must not enter shared text vocabulary to make an integration convenient. `GlyphConfig.schema`,
`resolve`, and `renderer` preserve renderer-specific associated types behind that integration's inferred config;
ordinary text state carries renderer-neutral paint, font, hierarchy, and format selection. Pushing a
`THREE.Material` or GPU handle into renderer-neutral spans is the mistake this rule exists to prevent.

## When you are about to add an error path

Ask, in order:

1. Can the type stop this being expressible? Do that instead.
2. Can only a caller cause it? Throw from the call, naming the thing.
3. Can only this package cause it? It is a producer defect: add or strengthen the producer/ABI/property test. Do not add a
   runtime scan merely to detect it. If ordinary consumption encounters it naturally, throw and do not build a recovery
   protocol.
4. Is it a policy the caller asked for, like a fixed glyph budget? Then it is not a failure at all. Define the
   behaviour, warn in development, expose it for reporting, and let it self-heal.
