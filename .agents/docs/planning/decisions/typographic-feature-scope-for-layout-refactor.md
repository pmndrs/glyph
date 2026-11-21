---
type: Decision
title: 'Scope missing typographic features for the layout refactor: editing support now, the rest deferred or dropped'
description: 'Records every missing typographic feature found by the 2026-11 audit with its keep-now, deferred or dropped decision.'
decision_status: Accepted
decided: '2026-11-21'
---

# Scope missing typographic features for the layout refactor

## Decision

The audit behind [the layout refactor plan](../segment-indexed-layout.md) listed every typographic feature the
engine lacks. The owner decided each one on 2026-11-21.

**In scope for the refactor (editing support):**

| Feature                                              | Notes                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Source-to-layout offset map                          | Foundation for the rest of this group                                 |
| Word and sentence boundaries (UAX #29)               | Double-click selection, word-wise movement                            |
| Caret movement, logical and visual, across bidi runs |                                                                       |
| Line-end caret affinity                              |                                                                       |
| Carets inside ligatures                              | From the font's ligature caret data where present, else even division |
| IME composition ranges                               | Marked ranges that survive edits during composition                   |

**Dropped (not planned):**

| Feature                                              | Notes                                           |
| ---------------------------------------------------- | ----------------------------------------------- |
| `rand` (random alternates)                           | No font on Google Fonts uses it (3,923 scanned) |
| Apple AAT shaping tables (`morx`, `kerx`, `trak`, …) | The baker already rejects them                  |

**Deferred to a later effort (not built in the refactor; nothing in the refactor may make them harder):**

| Group                        | Feature                                                                          |
| ---------------------------- | -------------------------------------------------------------------------------- |
| Font formats                 | Graphite tables (rejected by the baker today)                                    |
| Font formats                 | Variable fonts: static instance at bake time (the baker rejects `fvar` today)    |
| Font formats                 | Variable fonts: animated axes at runtime (expected to be Slug only)              |
| Font formats                 | Colour fonts with outlines (COLRv1; bakes as monochrome today)                   |
| Font formats                 | Colour fonts as bitmaps or SVG (CBDT, `SVG `; cannot be baked today)             |
| Line breaking                | Soft hyphen (U+00AD) rendering a hyphen at a break                               |
| Line breaking                | Automatic hyphenation with language dictionaries                                 |
| Line breaking                | CJK break strictness (kinsoku levels, keep-all, break-all)                       |
| Line breaking                | Thai, Lao, Khmer and Burmese dictionary word breaking                            |
| Line breaking                | Balanced or optimal (Knuth–Plass) breaking                                       |
| Line breaking                | Tabs and white-space modes (pre, nowrap, pre-wrap)                               |
| Line breaking                | Treating spaces other than U+0020 as spaces                                      |
| Justification and line edges | CJK inter-character justification                                                |
| Justification and line edges | CJK punctuation trim and compression                                             |
| Justification and line edges | CJK–Latin autospacing                                                            |
| Justification and line edges | Arabic kashida justification                                                     |
| Justification and line edges | Hanging punctuation                                                              |
| Justification and line edges | Line-edge shaping corrections in paragraphs containing RTL text (disabled today) |
| Layout modes                 | Vertical writing                                                                 |
| Layout modes                 | Ruby annotations                                                                 |

**Unchanged:** the legacy `kern` table keeps working; it already survives into the shaping payload.

## Why

The refactor's product requirement is fast, correct mid-paragraph editing, and an editor cannot be built on the
engine without caret, selection and composition support. The other features are real typographic gaps but do
not gate the performance work; listing them here keeps them from being lost.

## Consequences

The refactor's dense layout stages must expose what the editing features need: per-cluster source offsets, bidi
levels and visual order per line, line-end affinity, and ligature component counts. The deferred features need
mechanisms the refactor should not close off: glyph insertion at line edges, break candidates carrying a width
delta and penalty, a pluggable break source, justification classes per cluster, and font-instance identity in
cache keys.
