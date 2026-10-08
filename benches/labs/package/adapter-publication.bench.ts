import { assert, bench, group } from '@pmndrs/labs';

import { borrowedChecksum, createLabels, disposeLabels, inspectDraws, span, txt } from './fixture.ts';

function formattedLabel(text: string) {
  return txt`${span({ color: '#ffffff', decoration: { underline: true } })`${text.slice(0, 5)}`}${text.slice(5)}`;
}

function trailingSpanLabel(text: string, trailingColor: string): ReturnType<typeof formattedLabel> {
  const content = `${text} alpha beta gamma delta epsilon`;
  const literal = formattedLabel(content);
  const spanCount = 8;
  return {
    ...literal,
    spans: Array.from({ length: spanCount }, (_, index) => ({
      start: Math.floor((content.length * index) / spanCount),
      end: Math.floor((content.length * (index + 1)) / spanCount),
      style: { color: index === spanCount - 1 ? trailingColor : '#ffffff' },
    })),
  };
}

group('allocation-light adapter publication @publication', () => {
  bench('normalize 1000 equivalent retained label updates @cached', function* () {
    const created = createLabels(1_000);
    const expectedChecksum = borrowedChecksum(created.labels);
    const expectedDraws = inspectDraws(created.textGroup);

    const update = () => {
      for (const label of created.labels) {
        label.style = { ...label.style };
        label.layout = { ...label.layout };
        label.constraints = { ...label.constraints };
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    update();
    const textCount = yield update;
    assert.equal(textCount, created.labels.length);
    assert.equal(borrowedChecksum(created.labels), expectedChecksum);
    assert.equal(inspectDraws(created.textGroup).glyphs, expectedDraws.glyphs);
    assert.equal(inspectDraws(created.textGroup).draws, expectedDraws.draws);
    disposeLabels(created);
  });

  bench('mutate one trailing span across 1000 formatted labels @spans', function* () {
    const count = 1_000;
    const created = createLabels(count);
    const desired = ['#ff2f00', '#2f7fff'].map((trailingColor) =>
      created.labels.map((label) => ({ text: trailingSpanLabel(label.text, trailingColor) })),
    );
    let selected = 0;

    const update = () => {
      selected = selected === 0 ? 1 : 0;
      const next = desired[selected]!;
      for (let index = 0; index < created.labels.length; index++) {
        created.labels[index]!.set(next[index]!);
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    update();
    const expectedChecksum = borrowedChecksum(created.labels);
    const expectedDraws = inspectDraws(created.textGroup);
    const textCount = yield update;
    assert.equal(textCount, count);
    assert.equal(borrowedChecksum(created.labels), expectedChecksum);
    assert.equal(inspectDraws(created.textGroup).glyphs, expectedDraws.glyphs);
    assert.equal(inspectDraws(created.textGroup).draws, expectedDraws.draws);

    disposeLabels(created);
  });
});
