---
type: Decision
title: 'A read that needs the committed layout commits a pending paragraph itself'
description: 'A read that needs the committed layout commits a pending paragraph itself instead of waiting for a draw.'
decision_status: Accepted
decided: '2026-09-24'
generated:
  by: process:docs-new
  at: '2026-10-05T20:05:31Z'
---

# A read that needs the committed layout commits a pending paragraph itself

## Decision

A read that needs the committed layout commits a pending paragraph itself instead of waiting for a draw: the frame
decides when pixels appear, not when data exists. When a Three `Text` is `pending` and inside a Scene, `breakApart()`,
`measureGlyphs()`, `caretAt()`, and `selectionRects()` run its root's ordinary commit, through the same engine-wide
`glyph.shape()` batch a traversal runs, and then answer. Before this, every caller that broke apart a newly mounted
paragraph polled `commitState()` from a frame callback.

## Why

The read keeps D-312's single publication path rather than adding the per-paragraph realization path D-319 and D-339
removed. Unchanged roots stay out of the batch, so the next draw does not repeat the work; the cost is at most one extra
batch crossing in a frame where other roots become dirty after the read.

## Consequences

A paragraph outside any Scene, a failed paragraph, and a root over its fixed capacity still do not commit, and
`breakApart()` keeps its throw for them. A read-triggered publication failure throws from the read. An unchanged failed
paragraph does not retry, including when read inside `onError`; explicit desired-text or root/group presentation changes
allow the next read to retry. Staging a repair keeps publication pending even if an intervening layout query reconciles
the desired state, and successful publication clears the retained errors. The R3F `Text` and `TextGroup` refs follow
React 19: a callback ref receives only the mounted host, and a cleanup it returns replaces its `null` call, so a
callback ref can break a paragraph apart on attach and release the copy on detach. Integration tests cover a pending
paragraph read before any traversal and an R3F callback ref breaking apart on attach without a rendered frame.

Status when recorded: Accepted; implemented; supersedes D-292's committed-only `breakApart()` precondition. Recorded in pull request #240 as a second register row D-369 (main's D-369 is the Vue entry);
the register froze at D-372 before it merged, so the decision lives here instead.
