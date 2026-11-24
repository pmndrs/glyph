---
type: Decision
title: 'Overflow visible keeps the straddling line; clip keeps only lines that fit'
description: 'With a fixed height, overflow visible lays out and draws the lines that fit plus the one line straddling the block end, clip lays out and draws only the lines that fit, and no mode lays out a line wholly outside the box or publishes a clip identity.'
decision_status: Accepted
decided: '2026-11-24'
generated:
  by: process:docs-new
  at: '2026-11-24T19:47:57Z'
---

# Overflow visible keeps the straddling line; clip keeps only lines that fit

## Decision

Decided by Justin, 2026-11-24 (issues 01 and 16 in `issues-0.2.0/`).

A line is judged by its line box (`block_start` to `block_start + height`: line height, not ink) against the block end
`foot` of the region it is composed in:

- it **fits** when `block_start + height <= foot`;
- it **straddles** when `block_start < foot < block_start + height`;
- it is **outside** when `block_start >= foot`.

No band is started at or below a region's foot, so no mode lays out or draws an outside line and composition work stays
bounded by the box. In every region but a thread's last, a line that does not fit moves to the next region in every
mode. In the thread's last region (the only region of a plain paragraph, the last column with `columns`, the last
region of a `flow`):

- `'visible'` (default) keeps the straddling line, which spills over the edge;
- `'clip'` drops it: only the lines that fit are laid out, drawn and reported by layout reads;
- `'ellipsis'` is unchanged: it drops it and ends the last fitting line in an ellipsis.

`measure().overflowed` stays `true` whenever text did not fit, and `contentHeight` still reports the extent all of the
text needs (the intrinsic layout). An unconstrained height is how a caller shows all of the text.

No overflow mode marks a clip boundary: composed lines carry clip id zero, so draws and primitives publish
`clip: undefined`, and a clipped multi-column paragraph is no longer split into one draw per column.

## Why

- Issue 16 reported the names inverted. What 0.1.0 and the 0.2.0 branch actually did, measured on the built package
  before this change (Inter bitmap 16, 400 characters, width 200, height 60): `'visible'` and `'clip'` drew the same 52
  instances, the lines that fit, dropping the straddling line (`block_start + height > region_block_end` in
  `flow_composition/band.rs`, unchanged since `v0.1.0`). `'clip'` differed only in that `measure().lines` and
  `glyphs()` reported the full intrinsic layout (18 lines; with two columns 38 lines running on to y ≈ 674 below the
  last column's foot) and in giving each column region its own clip id, which split draws. No renderer drew past the
  box; issue 01's "clip draws every line" was read from the inspection, not from the draws.
- Justin chose no pixel mask: a clip that drops whole lines needs no renderer change and no clip geometry.
- One straddling line under `'visible'` is what a reader expects of visible overflow without letting a small box lay
  out an unbounded amount of text.

## Consequences

- Supersedes the clip sentence of D-216 ("Visible overflow carries clip zero; only an actual clip/ellipsis region forms
  a clip boundary"): no overflow mode forms a clip boundary.
- Default output changes: a fixed-height `'visible'` paragraph whose text does not fit gains its straddling line.
  `'clip'` draws what it drew before; its layout reads lose the lines past the box.
- The full clipped layout inspection (`IntrinsicInspection::Positioned`, its positioned arena and the
  `intrinsic_positioning_preparations` counter) is removed; layout reads always read the drawn layout.
- Open: the clip identity plumbing integrators can see now always carries zero and is left for an API decision:
  `ClipIdentity` (root export), `clip` on the instance-span and draw binding inputs (`config/glyph.ts`), the codec
  `batch.clip` draw-key field (`BATCH_CLIP`), the wire fields `PRIMITIVE_CLIP_ID` and `DRAW_CLIP_ID`, and
  `TextFlowRegion.clip` with the region clip rectangle, which the engine reads only for geometry equality
  (`flow_geometry.rs`).
- Open: the single-line inline leaf (`inline_leaf.rs`) still declines `'clip'`; with no clip id it could admit a
  fitting `'clip'` line as it admits `'visible'`.
