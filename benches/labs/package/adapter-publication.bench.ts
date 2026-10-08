import { assert, bench, group } from '@pmndrs/labs';

import { borrowedGlyphChecksum, createLabels, disposeLabels, inspectDraws } from './fixture.ts';

group('allocation-light adapter publication @publication', () => {
  bench('normalize 1000 equivalent retained label updates @cached', function* () {
    const created = createLabels(1_000);
    const expectedChecksum = borrowedGlyphChecksum(created.labels);
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
    assert.equal(borrowedGlyphChecksum(created.labels), expectedChecksum);
    assert.equal(inspectDraws(created.textGroup).glyphs, expectedDraws.glyphs);
    assert.equal(inspectDraws(created.textGroup).draws, expectedDraws.draws);
    disposeLabels(created);
  });
});
