import { assert, bench, group } from '@pmndrs/labs';

import { createTrailingSpanPublicationWorkload } from './adapter-publication-workload.ts';
import { borrowedChecksum, createLabels, disposeLabels, inspectDraws } from './fixture.ts';

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
    const workload = createTrailingSpanPublicationWorkload();
    workload.update();
    const expected = workload.inspect();
    const textCount = yield workload.update;
    const actual = workload.inspect();
    assert.equal(textCount, 1_000);
    assert.equal(actual.checksum, expected.checksum);
    assert.equal(actual.draws.glyphs, expected.draws.glyphs);
    assert.equal(actual.draws.draws, expected.draws.draws);
    assert.equal(actual.paintMatchesSelected, true);

    workload.dispose();
  });
});
