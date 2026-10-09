import { deepStrictEqual } from 'node:assert';

import { assert, bench, group } from '@pmndrs/labs';

import {
  createLabels,
  createGroupedLabels,
  disposeLabels,
  disposeGroupedLabels,
  glyph,
  inspectDraws,
} from './fixture.ts';

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
  bench(`${String(count)} labels ${position} ${kind} ${boundary} publication ${tag}`, function* () {
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

function editSizedColorPublication(
  count: number,
  position: 'first' | 'last',
  targetIndex: number,
  engineOnly: boolean,
): void {
  const boundary = engineOnly ? 'engine' : 'scene';
  bench(`${String(count)} labels ${position} color-only ${boundary} publication @color-only`, function* () {
    const created = createLabels(count);
    const target = created.labels[targetIndex]!;
    let alternate = false;
    const publish = () => {
      alternate = !alternate;
      target.style = { color: alternate ? '#f97316' : '#38bdf8', fontSize: 16 };
      if (engineOnly) glyph.shape();
      else created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };

    publish();
    const textCount = yield publish;
    assert.equal(textCount, count);
    assert.equal(target.commitState().status, 'committed');
    disposeLabels(created);
  });
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
    bench(`rewrite ${String(count)} labels in one group @batch @publication`, function* () {
      const created = createGroupedLabels(count);
      const initial = inspectDraws(created.scene);
      assert.equal(initial.draws, 1);
      let alternate = false;
      const result = yield () => {
        alternate = !alternate;
        const prefix = alternate ? 'bravo' : 'alpha';
        for (const [index, text] of created.texts.entries()) text.text = `${prefix} ${String(index)}`;
        created.scene.updateMatrixWorld(true);
        if (created.group.error !== undefined) throw created.group.error;
        if (created.nestedGroup.error !== undefined) throw created.nestedGroup.error;
        const draws = inspectDraws(created.scene);
        return draws.draws * 1_000_000 + draws.glyphs;
      };
      assert.equal(Math.floor(result / 1_000_000), initial.draws);
      assert.equal(result % 1_000_000, initial.glyphs);
      disposeGroupedLabels(created);
    });
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
        editSizedColorPublication(count, position, targetIndex, engineOnly);
      }
    }
  }

  for (const count of [100, 1_000]) {
    for (const interleaved of [false, true]) {
      const mode = interleaved ? 'interleaved edit-read' : 'batched edit-read';
      const edits = count === 100 ? '' : ' 100 edits';
      bench(`${String(count)} labels${edits} ${mode} publication @interleaved-read`, function* () {
        const created = createLabels(count);
        const stride = count / 100;
        const edited = created.labels.filter((_, index) => index % stride === 0);
        const untouched = created.labels.filter((_, index) => index % stride !== 0);
        const untouchedSnapshots = untouched.map(committedGlyphSnapshot);
        let alternate = false;
        const publish = () => {
          alternate = !alternate;
          let glyphCount = 0;
          for (const [index, label] of edited.entries()) {
            label.text = alternate
              ? `ticker ${String(index).padStart(3, '0')}`
              : `quote! ${String(index).padStart(3, '0')}`;
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

        publish();
        const first = edited.map(committedGlyphSnapshot);
        publish();
        const second = edited.map(committedGlyphSnapshot);
        assert(
          first.every((snapshot, index) => snapshot !== second[index]),
          'each edited label must change glyph output',
        );
        const glyphCount = yield publish;
        assert(glyphCount > 0, 'published labels must expose glyphs');
        assert.equal(created.textGroup.textCount, count);
        assert.equal(edited.length, 100);
        deepStrictEqual(edited.map(committedGlyphSnapshot), alternate ? first : second);
        deepStrictEqual(untouched.map(committedGlyphSnapshot), untouchedSnapshots);
        disposeLabels(created);
      });
    }
  }
});
