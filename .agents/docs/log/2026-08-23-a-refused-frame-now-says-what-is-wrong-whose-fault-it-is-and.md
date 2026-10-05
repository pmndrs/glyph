---
type: Log Entry
title: 'A refused frame now says what is wrong, whose fault it is, and says it once'
generated:
  by: process:okf-log-split
  at: '2026-10-05T17:40:00Z'
---

Three failure modes a
caller actually hits shared one shape: the caller was told nothing useful, and told it forever.
`EngineError::InvalidRequest` stood for more than twenty causes and reached JavaScript as `status 6`, an
integer naming no paragraph, no span, and no offset, from a `/three` surface that did not export
`textShaperAbi.status` to turn it back into a word. Six caller-actionable causes are now separated from it
and carry the offending paragraph and style in two u32s of the result header's existing tail padding, so the
header size and every prior field offset are unchanged (D-267); `/three` re-raises them as `TextFrameError`
with a discriminated `rejection` resolved onto the `Text` and, where one span owns the cause, that span and
its index in `Text.spans`. A rejected frame never reached `markApplied()`, so the identical frame was
recompiled and rejected on every `updateMatrixWorld` for the life of the scene; it now latches on the
desired revision of every paragraph in render order and resumes only when what it would compile actually
changes (D-269). An inverted or out-of-range span — the one span invariant with no correct answer — throws
from `set()` beside `normalizedColumns` and `normalizeCapacity` instead of travelling to Rust (D-268), while
cluster resolution stays silent and collapsed spans stay in the array. A `registerThreeRasterPlanProgram`
call that arrives after a runtime has read the registry is refused by name rather than applying to nothing
(D-270), and `/three` re-exports the layout types `measure()` and `layout()` return.

**Breaking**: `textShaperAbi.status` gains `styleRangeInvalid` (15), `styleSplitsCluster` (16),
`styleNestingInvalid` (17), `styleRootInvalid` (18), and `fontMetricsMissing` (19); frames that previously
reported `invalidRequest` (6) for those causes now report the new value, and `invalidRequest` no longer
covers them. `textShaperAbi.layouts.engineResult` gains `faultParagraphId` and `faultStyleId` (size
unchanged at 144 bytes). `TextEngineStatusError` gains a `fault`, and `/three` failures that were bare
`TextEngineStatusError` instances are now `TextFrameError`. `Text` construction and `Text.set()` throw
`RangeError` for a span whose offsets are non-integer, negative, inverted, or past the end of the text,
where the frame was previously rejected at synchronize time. `registerThreeRasterPlanProgram` throws for a
new technique once any runtime has read the registry.
