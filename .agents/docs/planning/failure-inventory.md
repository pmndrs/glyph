---
type: Reference
title: 'Failure inventory and dispositions'
description: 'Every way the text pipeline can fail, who can cause it, where it surfaces, what state remains, how it recovers, and the test that scripts it.'
documentation_type: reference
tags: [errors, failure, preparation, publication, testing]
status: stable
sources:
  - id: inventory-test
    resource: ../../../packages/glyph/tests/integration/failure-inventory.test.mjs
    title: Scripted failure inventory
  - id: containment-test
    resource: ../../../packages/glyph/tests/integration/engine-failure-containment.test.mjs
    title: Engine failure containment
  - id: interleaving-fuzz
    resource: ../../../packages/glyph/tests/integration/preparation-interleaving-fuzz.test.mjs
    title: Seeded interleaving fuzz
  - id: three-api
    resource: three-api.md
    title: Three.js text API
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-22T02:00:00Z'
---

# Failure inventory and dispositions

The model has three kinds of failure. A **caller error** throws from the call that made it and changes nothing. A
**paragraph failure** belongs to one text: the text keeps the error as `text.error` and draws nothing, and its
siblings are unaffected. A **frame failure** belongs to one frame of one root: the previous frame stays drawn, and
the next frame retries without a setter. Paragraph and frame failures found while rendering are thrown from that
render, once: from the end of `renderer.render()` for Three, R3F and Vue, from the root's next `draw()` for TypeGPU,
and from `glyph.shape()` for PixiJS 3D. A failure the next frame finds again is not thrown again
([decision](decisions/render-time-errors-throw.md)). Nothing takes a root down permanently, and no setter fails for a
layout reason.

Rows with an `id` are scripted in `failure-inventory.test.mjs` under that name. The others name the test that covers
them.

| Failure                                                                  | Caused by                                       | Surfaces at                                                                                                             | State afterwards                                                                                                 | Recovery                                                 | Test                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| A value a setter cannot accept                                           | Caller                                          | `GlyphInputError` from the setter, `path` naming the property                                                           | Previous value, the update's valid properties included                                                           | Assign a valid value                                     | `input-invalid-value`                                                                                             |
| Text longer than `maxTextUnits`                                          | Caller                                          | `GlyphInputError` at `['text']`                                                                                         | Previous value                                                                                                   | Shorter text, or raise the limit in the config           | `input-text-too-long`                                                                                             |
| A font disposed while a text names it                                    | Caller (fonts outlive their texts)              | Nothing at the frame or a read. The next setter other than a plain-string `text` throws `GlyphInputError` at `['font']` | Text keeps drawing with its own lease                                                                            | Assign a live font                                       | `input-disposed-font`                                                                                             |
| A layout input written in a layout callback                              | Caller                                          | `GlyphLayoutPhaseError` from that setter                                                                                | Previous value; the frame publishes                                                                              | Write it outside the callback                            | `layout-phase-write`                                                                                              |
| A layout callback throws                                                 | Caller                                          | Thrown from the render after the frame, once                                                                            | Other callbacks run; the frame publishes; `text.error` stays unset                                               | None needed                                              | `layout-callback-throws`                                                                                          |
| Use of a disposed text                                                   | Caller                                          | `Error` from the call                                                                                                   | Siblings unaffected                                                                                              | None                                                     | `use-after-dispose`                                                                                               |
| Engine trap during a read                                                | Engine defect or exhausted memory               | Nowhere: the engine is replaced and the read answers                                                                    | Every text restated on the new instance                                                                          | Automatic                                                | `engine-trap-in-read`                                                                                             |
| Engine trap during a frame                                               | Engine defect or exhausted memory               | Thrown from the render, once; `text.error`; `commitState()` is `failed` for that frame                                  | Previous frame stays drawn                                                                                       | The next frame, automatically                            | `engine-trap-in-frame`                                                                                            |
| An input the engine cannot hold (traps or runs out of memory every time) | That paragraph's content                        | Thrown from the render, once; that text's `error`                                                                       | The text draws nothing and keeps its value; siblings publish                                                     | New input for that text                                  | `engine-refuses-one-paragraph`; memory: `engine-failure-containment` "at N pages of memory…" (500 pages and up)   |
| A publication the result arena cannot hold                               | The root's total content under a memory cap     | One failed frame for the root's texts                                                                                   | The largest paragraph is withheld: `failed`, draws nothing, cannot be read. Siblings publish from the next frame | New input for the withheld text                          | `engine-failure-containment` "at 300 pages of memory…"                                                            |
| Engine instance cannot be made synchronously after a trap                | Host policy (large-module sync compile refused) | Reads throw until the new instance lands, a render throws it once; setters still work                                   | Texts restated when it lands                                                                                     | Automatic                                                | `engine-failure-containment` "where an instance cannot be made synchronously…"                                    |
| Renderer rejects a publication                                           | Renderer or material                            | Thrown from the render (or an explicit `glyph.shape()`), once; `text.error`/`group.error`                               | Engine state kept; last accepted frame stays drawn                                                               | The next renderer-relevant change publishes a checkpoint | `three-v1` "pending copy survives a rejected publication…", `glyph-placements` "warm sibling placements recover…" |
| Fixed capacity exceeded                                                  | Config (`policy: 'fixed'`) and content          | A `RangeError` thrown from the render, once per excess; texts stay `pending`                                            | Last accepted frame stays drawn                                                                                  | Remove text or raise the capacity                        | `three-v1` "a rejected fixed-capacity candidate…"                                                                 |
| GPU device loss                                                          | Platform                                        | Not detected by this package                                                                                            | Unknown                                                                                                          | The host observes `device.lost` and rebuilds             | None                                                                                                              |

## What is asserted without a script

`preparation-interleaving-fuzz.test.mjs` runs seeded interleavings of setters, reads, frames, `glyph.prepare()`,
mounts and unmounts, reparenting, layout callbacks and fonts disposed right after their setter. It asserts that no
batch crossing returns a status other than OK (the call's own status and every root's entry), no read or frame
throws, no text reports an error, the engine is never replaced, and every frame leaves every text committed with
the glyphs of a cold text of the same value. It runs 64 seeds of 200 steps by default;
`GLYPH_INTERLEAVING_SEEDS` and `GLYPH_INTERLEAVING_STEPS` scale it.

## Known limits

- On a publication that does not fit, the engine still discards the root, so the recovery frame lays out the root's
  other paragraphs again. A discard-free path needs a rollback of the staged lifecycle, gather and plan in the engine
  that does not exist yet.
- The frame in which a publication does not fit reports the error on every text of the root, not only on the one
  later withheld.
- The withheld paragraph is chosen by text length, not by measured contribution to the result.
- On Three r185/r186, storage is freed only through a renderer that encountered the draw. A root's draws register
  the renderer when it draws them and when `compileAsync` runs on their Scene. A detached glyph object (`split()`)
  registers only when drawn, so one compiled and never rendered can keep its storage until that renderer is
  disposed.
- A root tells `compileAsync` from a render by Three's private `_compilationPromises`. `three-v1` "the installed Three
  still marks compileAsync…" fails if an upgrade changes that, before a compile can stop the root publishing.
