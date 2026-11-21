---
type: Decision
title: 'Deferred, never-stale preparation supersedes synchronous setter preparation'
description: 'Setters validate and mark dirty; reads prepare on demand; the frame batch-prepares; preparation cannot fail.'
decision_status: Accepted
decided: '2026-11-21'
---

# Deferred, never-stale preparation supersedes synchronous setter preparation

## Decision

This supersedes the setter rule in [retained-prepare-publish.md](retained-prepare-publish.md), which required
a bound `set()` or property assignment to prepare synchronously and offered no public `prepare()`. The rest of
that decision stands: one retained pipeline, publication that never repeats layout for a prepared revision,
and reads, copies and publication sharing one prepared revision.

- A setter validates its input and marks the paragraph dirty. It does not shape or lay out.
- Any read (`measure()`, glyph inspection, carets, selections, `split()`) prepares that paragraph on demand
  before answering, so no read is ever stale.
- The frame batch-prepares every remaining dirty paragraph in one engine call, then publishes.
- Applications that own their pipeline may call `prepare()` explicitly. There is no eager per-setter mode.
- A per-text `onLayout` callback property runs after preparation and before the first render, so an author can
  position from measurements with an exact first frame. A callback that changes text or layout input during
  its own layout phase throws immediately.
- Invalid input throws from the setter. In react-three-fiber the throw reaches the nearest error boundary;
  `<Text>` does not catch it.
- Preparation cannot fail: failures are made unrepresentable or confined to one paragraph. No rollback copy is
  kept. `onError` reports only publication-time failures.

## Why

Measured on 2026-11-21: synchronous setter preparation costs three engine calls per setter and makes the first
set of a label three times slower than main, discards a whole preparation when a value is overwritten before
publication, and runs layout for a colour change. Batch preparation removes those costs while a read still
gets a current answer. The earlier design was chosen so authors could measure immediately after setting; the
read-prepares rule keeps that guarantee.

## Consequences

Setter-only benchmark rows stop measuring layout, so complete-operation rows are added before the change.
Errors that used to surface at the setter for layout reasons no longer exist by construction. The Three
integration gains a prepare step ahead of publication in the frame.
