// Labs selects bench files by the tag text they contain; the three-span rows here carry @prepare-spans.
import { assert, group } from '@pmndrs/labs';

import { createLabelsHolding, disposeLabels, endFrame, inspectDraws, replaceLabels } from './fixture.ts';
import {
  assertSpanLayout,
  finishSpan,
  prepareSpans,
  publishedLayout,
  selfTimed,
  spanBench,
  spanRowName,
} from './prepare-spans.ts';

function labelTexts(prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${String(index).padStart(4, '0')}`);
}

function publish(mounted: ReturnType<typeof createLabelsHolding>): void {
  mounted.scene.updateMatrixWorld(true);
  endFrame(mounted.scene);
}

/** An independent published mount of `texts`: each label's layout, and the glyph instances the scene draws. */
function coldMount(texts: readonly string[]) {
  const cold = createLabelsHolding(texts);
  try {
    return { layouts: cold.labels.map(publishedLayout), drawnGlyphs: inspectDraws(cold.scene).glyphs };
  } finally {
    disposeLabels(cold);
  }
}

/** The mounted group must hold and draw exactly what a cold mount of the same texts does. */
function assertDrawn(mounted: ReturnType<typeof createLabelsHolding>, cold: ReturnType<typeof coldMount>): void {
  assert.equal(mounted.textGroup.textCount, cold.layouts.length);
  assert.equal(
    inspectDraws(mounted.scene).glyphs,
    cold.drawnGlyphs,
    'the scene must draw the glyphs of exactly the mounted labels',
  );
}

group('label lifecycle @lifecycle', () => {
  // A handle, a group, a scene and N labels built from nothing. The previous mount is disposed untimed before each call.
  for (const count of [100, 200, 400, 800, 1_600, 2_000]) {
    for (const span of prepareSpans) {
      spanBench(spanRowName(`mount ${String(count)} labels`, span, '@mount', 'construct'), function* () {
        const texts = labelTexts('label', count);
        const cold = coldMount(texts);
        let mounted: ReturnType<typeof createLabelsHolding> | undefined;
        yield selfTimed(
          () => {
            if (mounted !== undefined) disposeLabels(mounted);
            mounted = undefined;
          },
          () => {
            const next = createLabelsHolding(texts, { frame: false });
            mounted = next;
            finishSpan(span, next.labels, () => publish(next));
          },
        );
        if (mounted === undefined) throw new Error('the timed call must leave its mount in place');
        assertSpanLayout(span, mounted.labels, cold.layouts);
        if (span !== 'frame') publish(mounted);
        assertDrawn(mounted, cold);
        disposeLabels(mounted);
      });
    }
  }

  // A mounted, published group whose labels are all disposed and replaced by new ones holding other texts.
  for (const count of [100, 1_000]) {
    for (const span of prepareSpans) {
      spanBench(
        spanRowName(`dispose and recreate ${String(count)} labels`, span, '@recreate', 'recreate'),
        function* () {
          const generations = [labelTexts('label', count), labelTexts('fresh', count)] as const;
          const cold = generations.map(coldMount);
          const mounted = createLabelsHolding(generations[0]);
          const frame = () => publish(mounted);
          let fresh = false;
          const labelCount = yield () => {
            fresh = !fresh;
            replaceLabels(mounted, generations[fresh ? 1 : 0]);
            finishSpan(span, mounted.labels, frame);
            return mounted.labels.length;
          };
          assert.equal(labelCount, count);
          const expected = cold[fresh ? 1 : 0]!;
          assertSpanLayout(span, mounted.labels, expected.layouts);
          if (span !== 'frame') frame();
          assertDrawn(mounted, expected);
          disposeLabels(mounted);
        },
      );
    }
  }
});
