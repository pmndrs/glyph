import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, createNestedTextBatch, disposeLabels, disposeNestedTextBatch, inspectDraws } from './fixture.ts';

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
    bench(`publish changes to ${String(count)} nested Text instances @batch @publication`, function* () {
      const created = createNestedTextBatch(count);
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
      disposeNestedTextBatch(created);
    });
  }
});
