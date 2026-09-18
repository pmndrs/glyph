import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, createTextBatch, disposeLabels, disposeTextBatch } from './fixture.ts';

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

  bench('publish changes to 128 Text instances @batch @publication', function* () {
    const created = createTextBatch(128);
    let alternate = false;
    const textCount = yield () => {
      alternate = !alternate;
      const prefix = alternate ? 'bravo' : 'alpha';
      for (const [index, text] of created.texts.entries()) {
        text.text = `${prefix} ${String(index).padStart(3, '0')}`;
      }
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, created.texts.length);
    disposeTextBatch(created);
  });
});
