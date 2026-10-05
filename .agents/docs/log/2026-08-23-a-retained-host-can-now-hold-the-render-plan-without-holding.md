---
type: Log Entry
title: 'A retained host can now hold the render plan without holding a hazard'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

item 11 of the API surface
audit landed as a retention and ownership protocol on the existing plan surface (`internal/retention.ts`
is its specification; no new draw-batch API). Publications are still borrowed by default, but expiry
is now cheap and loud instead of documented folklore: `session.isExpired` is two integer compares,
`session.assertLive` throws `TextEnginePublicationExpiredError` naming both generations, and a
publication the session never issued is rejected outright. `session.retain` makes one contiguous copy
of the whole encoded result — header, tables, and patch payloads stay consistent by construction — and
brands it `RetainedTextPublication`, so retaining APIs demand it in their types. Retaining or
`acknowledge()`ing advances `session.acknowledgedGeneration`; in-place consumers may carry it in frame requests, while
transactional renderers carry their last device-accepted generation separately. The engine verifies that wire value
monotonically: retirements name the generation that makes release safe, so an
unacknowledging host leaks retired GPU storage rather than reading freed memory.
`readTextEnginePatch` surfaces dirty ranges per `(bufferId, bufferGeneration)`; paragraph ids are
caller-chosen handles, glyph identity rides the policy's stable-id lane, and engine storage is keyed
by `(id, generation)` with retirement as the only release signal. `packages/glyph-example-renderer`
stopped being a defensive-copy stub: it imports the portable technique plan, authors its own host policy through `/core`,
drives real `TextEngineHost` frames over the published Wasm artifact, holds retained plans across
slots and capacity growth, watches stale borrows die loudly, and records the finding that a
`/core`-only host cannot register a shaping font at all (`RuntimeShaper.registerFont` needs
loader-registered state, Rust refuses `registerFontBinding` with `fontMissing` without it, and
`createTextRuntime` lives only on the root entry) — audit item 12's evidence, pinned empirically.

**Additive**: `/core` gains `RetainedTextEnginePublication`, `TextEnginePublicationExpiredError`,
`retainedPublicationBrand`, the four decoded record readers, and four session methods plus one
getter. No behaviour change to shaping, layout, or rasterisation; `/three` keeps passing unchanged.
