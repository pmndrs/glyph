import { deepStrictEqual } from 'node:assert';

import { assert, bench, group } from '@pmndrs/labs';

import {
  createLabels,
  createMultiOwnerPublication,
  multiOwnerTexts,
  createGroupedLabels,
  disposeLabels,
  disposeGroupedLabels,
  glyph,
  inspectDraws,
  inspectGlyphPaint,
  createLabelsHolding,
} from './fixture.ts';
import {
  assertSpanLayout,
  coldLabelLayouts,
  finishSpan,
  layoutDigest,
  prepareSpans,
  type PrepareSpan,
  publishedLayout,
  spanBench,
  splitRowName,
} from './prepare-spans.ts';

type Label = ReturnType<typeof createLabels>['labels'][number];

function committedGlyphSnapshot(label: Label): string {
  assert.equal(label.commitState().status, 'committed');
  const glyphs = label.measureGlyphs();
  assert(glyphs !== undefined, 'a committed label must expose its current renderer glyphs');
  return `${String(glyphs.length)}:${glyphs.map((measuredGlyph) => measuredGlyph.key).join(',')}`;
}

function editSizedTextPublication(
  count: number,
  position: 'first' | 'last',
  targetIndex: number,
  kind: 'same-length' | 'length-changing',
  texts: readonly [string, string],
  engineOnly: boolean,
): void {
  const tag = kind === 'same-length' ? '@same-length' : '@length-change';
  const boundary = engineOnly ? 'engine' : 'scene';
  const frontier = count === 1000 && position === 'first' && kind === 'same-length' && !engineOnly ? ' @frontier' : '';
  bench(`${String(count)} labels ${position} ${kind} ${boundary} publication ${tag}${frontier}`, function* () {
    const created = createLabels(count);
    const target = created.labels[targetIndex]!;
    let alternate = false;
    const publish = () => {
      alternate = !alternate;
      target.text = texts[alternate ? 0 : 1];
      if (engineOnly) glyph.shape();
      else created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };

    publish();
    const first = committedGlyphSnapshot(target);
    publish();
    const second = committedGlyphSnapshot(target);
    assert(first !== second, 'the two target texts must produce distinguishable renderer glyph output');

    const textCount = yield publish;
    assert.equal(textCount, count);
    assert.equal(committedGlyphSnapshot(target), alternate ? first : second);
    disposeLabels(created);
  });
}

const labelColors = ['#f97316', '#38bdf8'] as const;

/** A cold label created already holding `text` in each colour: its layout, and the paint its published glyphs carry. */
function coldColoredLabels(text: string) {
  return labelColors.map((color) => {
    const cold = createLabelsHolding([text], { style: { color, fontSize: 16 } });
    try {
      return { layout: publishedLayout(cold.labels[0]!), paint: inspectGlyphPaint(cold.scene) };
    } finally {
      disposeLabels(cold);
    }
  });
}

function editSizedColorPublication(
  count: number,
  position: 'first' | 'last',
  targetIndex: number,
  engineOnly: boolean,
  span: PrepareSpan,
): void {
  const boundary = span === 'frame' ? ` ${engineOnly ? 'engine' : 'scene'} publication` : '';
  spanBench(
    splitRowName(`${String(count)} labels ${position} color-only${boundary}`, span, '@color-only @style'),
    function* () {
      const created = createLabels(count);
      const target = created.labels[targetIndex]!;
      const cold = coldColoredLabels(target.text);
      assert(JSON.stringify(cold[0]!.paint) !== JSON.stringify(cold[1]!.paint), 'the two colours must paint apart');
      deepStrictEqual(inspectGlyphPaint(created.scene), { blueDominant: 0, redDominant: 0 });
      const changed = [target];
      const frame = engineOnly ? () => glyph.shape() : () => created.scene.updateMatrixWorld(true);
      let alternate = false;
      const publish = () => {
        alternate = !alternate;
        target.style = { color: labelColors[alternate ? 0 : 1], fontSize: 16 };
        finishSpan(span, changed, frame);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return created.textGroup.textCount;
      };

      publish();
      const textCount = yield publish;
      assert.equal(textCount, count);
      if (span === 'frame') assert.equal(target.commitState().status, 'committed');
      const expected = cold[alternate ? 0 : 1]!;
      assertSpanLayout(span, changed, [expected.layout]);
      // Paint reaches the draw only through a scene traversal, whichever span was timed.
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      deepStrictEqual(inspectGlyphPaint(created.scene), expected.paint, 'the last colour set must be the one drawn');
      disposeLabels(created);
    },
  );
}

group('batched text operations @batch @publication', () => {
  bench('edit and measure one of 100 retained labels @layout @measure', function* () {
    const created = createLabels();
    const target = created.labels[0]!;
    let alternate = false;
    const glyphCount = yield () => {
      alternate = !alternate;
      target.text = alternate ? 'edited alpha' : 'edited bravo';
      return target.measure().glyphCount;
    };
    assert(glyphCount > 0, 'measurement must contain glyphs');
    disposeLabels(created);
  });

  for (const count of [64, 128, 256, 512]) {
    for (const span of prepareSpans) {
      const frontier = count === 512 && span === 'frame' ? ' @frontier' : '';
      spanBench(
        splitRowName(`rewrite ${String(count)} labels in one group`, span, `@batch @publication${frontier}`),
        function* () {
          const cold = (['alpha', 'bravo'] as const).map((prefix) =>
            coldLabelLayouts(
              Array.from({ length: count }, (_, index) => `${prefix} ${String(index)}`),
              { layout: { wrap: 'word' } },
            ),
          );
          const created = createGroupedLabels(count);
          const initial = inspectDraws(created.scene);
          assert.equal(initial.draws, 1);
          let alternate = false;
          const rewrite = () => {
            alternate = !alternate;
            const prefix = alternate ? 'bravo' : 'alpha';
            for (const [index, text] of created.texts.entries()) text.text = `${prefix} ${String(index)}`;
          };
          const result = yield span === 'frame'
            ? () => {
                rewrite();
                created.scene.updateMatrixWorld(true);
                if (created.group.error !== undefined) throw created.group.error;
                if (created.nestedGroup.error !== undefined) throw created.nestedGroup.error;
                const draws = inspectDraws(created.scene);
                return draws.draws * 1_000_000 + draws.glyphs;
              }
            : () => {
                rewrite();
                finishSpan(span, created.texts, () => undefined);
                return initial.draws * 1_000_000 + initial.glyphs;
              };
          assert.equal(Math.floor((result as number) / 1_000_000), initial.draws);
          assert.equal((result as number) % 1_000_000, initial.glyphs);
          assertSpanLayout(span, created.texts, cold[alternate ? 1 : 0]!);
          disposeGroupedLabels(created);
        },
      );
    }
  }
});

group('edit-sized root publication @publication @edit-sized @edit', () => {
  for (const count of [10, 100, 1_000]) {
    bench(`${String(count)} labels no-op scene traversal`, function* () {
      const created = createLabels(count);
      const textCount = yield () => {
        created.scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return created.textGroup.textCount;
      };
      assert.equal(textCount, count);
      disposeLabels(created);
    });
    for (const [position, targetIndex] of [
      ['first', 0],
      ['last', count - 1],
    ] as const) {
      for (const engineOnly of [false, true]) {
        editSizedTextPublication(count, position, targetIndex, 'same-length', ['12,345', '54,321'], engineOnly);
        editSizedTextPublication(count, position, targetIndex, 'length-changing', ['123,456', '12,345'], engineOnly);
        editSizedColorPublication(count, position, targetIndex, engineOnly, 'frame');
      }
      // The setter and read spans cross no publication boundary, so each exists once per label position.
      editSizedColorPublication(count, position, targetIndex, false, 'setter');
      editSizedColorPublication(count, position, targetIndex, false, 'read');
    }
  }

  for (const count of [100, 1_000]) {
    for (const publishRenderer of [false, true]) {
      const boundary = publishRenderer ? 'with publication' : 'without publication';
      bench(`${String(count)} labels 100 edits immediate measurements ${boundary} @interleaved-read`, function* () {
        const texts = ['ticker 000', 'quote! 000'] as const;
        const expected = texts.map((text) => {
          const cold = createLabels(1);
          cold.labels[0]!.text = text;
          if (publishRenderer) glyph.shape();
          const measurement = cold.labels[0]!.measure();
          disposeLabels(cold);
          return measurement;
        });
        assert(
          JSON.stringify(expected[0]) !== JSON.stringify(expected[1]),
          'the edited values must produce distinct measurements',
        );
        const created = createLabels(count);
        const stride = count / 100;
        const edited = created.labels.filter((_, index) => index % stride === 0);
        const untouched = created.labels.filter((_, index) => index % stride !== 0);
        const untouchedMeasurements = untouched.map((label) => JSON.stringify(label.measure()));
        let alternate = false;
        const updateAndRead = () => {
          alternate = !alternate;
          let glyphCount = 0;
          for (const label of edited) {
            label.text = texts[alternate ? 0 : 1];
            if (publishRenderer) glyph.shape();
            glyphCount += label.measure().glyphCount;
          }
          return glyphCount;
        };
        const glyphCount = yield updateAndRead;
        assert(glyphCount > 0, 'immediate measurements must contain glyphs');
        assert.equal(edited.length, 100);
        for (const label of edited) {
          deepStrictEqual(label.measure(), expected[alternate ? 0 : 1]);
        }
        deepStrictEqual(
          untouched.map((label) => JSON.stringify(label.measure())),
          untouchedMeasurements,
        );
        disposeLabels(created);
      });
    }
    for (const interleaved of [false, true]) {
      const mode = interleaved ? 'interleaved edit-read' : 'batched edit-read';
      const edits = count === 100 ? '' : ' 100 edits';
      // Both old rows end at a publication; the interleaved one also gets its setter and setter + read spans.
      for (const span of interleaved ? prepareSpans : (['frame'] as const)) {
        spanBench(
          splitRowName(`${String(count)} labels${edits} ${mode} publication`, span, '@interleaved-read'),
          function* () {
            const textAt = (ticker: boolean, index: number) =>
              `${ticker ? 'ticker' : 'quote!'} ${String(index).padStart(3, '0')}`;
            const cold = [true, false].map((ticker) =>
              coldLabelLayouts(Array.from({ length: 100 }, (_, index) => textAt(ticker, index))),
            );
            const created = createLabels(count);
            const stride = count / 100;
            const edited = created.labels.filter((_, index) => index % stride === 0);
            const untouched = created.labels.filter((_, index) => index % stride !== 0);
            const untouchedSnapshots = untouched.map(committedGlyphSnapshot);
            const untouchedLayouts = untouched.map(layoutDigest);
            let alternate = false;
            const publish = () => {
              alternate = !alternate;
              let glyphCount = 0;
              for (const [index, label] of edited.entries()) {
                label.text = textAt(alternate, index);
                if (interleaved) glyph.shape();
                const glyphs = interleaved ? label.measureGlyphs() : undefined;
                if (interleaved && glyphs === undefined)
                  throw new Error('interleaved read did not observe committed glyphs');
                glyphCount += glyphs?.length ?? 0;
              }
              if (!interleaved) {
                glyph.shape();
                for (const label of edited) {
                  const glyphs = label.measureGlyphs();
                  if (glyphs === undefined) throw new Error('batched read did not observe committed glyphs');
                  glyphCount += glyphs.length;
                }
              }
              if (created.textGroup.error !== undefined) throw created.textGroup.error;
              return glyphCount;
            };
            const editWithoutPublication = () => {
              alternate = !alternate;
              let glyphCount = 0;
              for (const [index, label] of edited.entries()) {
                label.text = textAt(alternate, index);
                glyphCount += span === 'read' ? label.measure().glyphCount : 1;
              }
              return glyphCount;
            };

            let published: readonly (readonly string[])[] | undefined;
            if (span === 'frame') {
              publish();
              const first = edited.map(committedGlyphSnapshot);
              publish();
              const second = edited.map(committedGlyphSnapshot);
              assert(
                first.every((snapshot, index) => snapshot !== second[index]),
                'each edited label must change glyph output',
              );
              published = [first, second];
            }
            const glyphCount = yield span === 'frame' ? publish : editWithoutPublication;
            assert((glyphCount as number) > 0, 'edited labels must expose glyphs');
            assert.equal(created.textGroup.textCount, count);
            assert.equal(edited.length, 100);
            if (published !== undefined) {
              deepStrictEqual(edited.map(committedGlyphSnapshot), published[alternate ? 0 : 1]);
            }
            deepStrictEqual(untouched.map(committedGlyphSnapshot), untouchedSnapshots);
            assertSpanLayout(span, edited, cold[alternate ? 0 : 1]!);
            deepStrictEqual(untouched.map(layoutDigest), untouchedLayouts);
            disposeLabels(created);
          },
        );
      }
    }
  }
});

// Each operation changes separated owners before one submit; clean gaps remain part of the same batch.
group('multiple-owner publication @multi-owner @edit-sized @edit @publication', () => {
  for (const count of [100, 1_000]) {
    for (const balanced of [true, false]) {
      for (const engineOnly of [true, false]) {
        const mode = balanced ? 'balanced' : 'unbalanced';
        const boundary = engineOnly ? 'engine' : 'scene';
        bench(`${String(count)} labels separated ${mode} grow-shrink-space ${boundary} publication`, function* () {
          const texts = multiOwnerTexts(balanced);
          const expected = texts.map((values) =>
            values.map((text) => {
              const cold = createLabels(1);
              try {
                cold.labels[0]!.text = text;
                if (engineOnly) glyph.shape();
                else cold.scene.updateMatrixWorld(true);
                if (cold.textGroup.error !== undefined) throw cold.textGroup.error;
                return cold.labels[0]!.measure();
              } finally {
                disposeLabels(cold);
              }
            }),
          );
          const workload = createMultiOwnerPublication(count, balanced, engineOnly);
          const { created, indices, edited, publish } = workload;
          const untouched = created.labels.filter((_, index) => !indices.includes(index));
          const clean = untouched.map(committedGlyphSnapshot);
          publish();
          publish();
          const textCount = yield publish;
          assert.equal(textCount, count);
          deepStrictEqual(
            edited.map((label) => label.measure()),
            expected[workload.selected],
          );
          deepStrictEqual(untouched.map(committedGlyphSnapshot), clean);
          disposeLabels(created);
        });
      }
    }
  }
});
