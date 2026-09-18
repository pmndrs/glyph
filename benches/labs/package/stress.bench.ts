import { assert, bench, group } from '@pmndrs/labs';

import { borrowedGlyphChecksum, createLabels, createTextBatch, disposeLabels, disposeTextBatch } from './fixture.ts';

group('1,000-label stress @stress', () => {
  bench('reorder 1000 unchanged retained labels @publication', function* () {
    const created = createLabels(1_000);
    for (const [index, label] of created.labels.entries()) label.renderOrder = index;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    let reversed = false;
    const textCount = yield () => {
      reversed = !reversed;
      for (const [index, label] of created.labels.entries()) {
        label.renderOrder = reversed ? created.labels.length - index : index;
      }
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, created.labels.length);
    disposeLabels(created);
  });

  bench('reorder then edit one of 1000 retained labels @publication @layout', function* () {
    const created = createLabels(1_000);
    for (const [index, label] of created.labels.entries()) label.renderOrder = index;
    created.scene.updateMatrixWorld(true);
    if (created.textGroup.error !== undefined) throw created.textGroup.error;
    let reversed = false;
    const textCount = yield () => {
      reversed = !reversed;
      for (const [index, label] of created.labels.entries()) {
        label.renderOrder = reversed ? created.labels.length - index : index;
      }
      created.scene.updateMatrixWorld(true);
      created.labels[0]!.text = reversed ? 'edited alpha' : 'edited bravo';
      created.scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, created.labels.length);
    disposeLabels(created);
  });

  bench('measure 1000 unchanged retained labels @cached @measure', function* () {
    const created = createLabels(1_000);
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });

  bench('first sparse borrow from 1000 retained labels @cached @glyphs @api', function* () {
    const created = createLabels(1_000);
    const glyphCount = yield () =>
      created.labels.reduce((total, label) => total + label.withGlyphs((glyphs) => glyphs.glyphCount), 0);
    assert(glyphCount > 0, 'sparse borrows must contain glyphs');
    disposeLabels(created);
  });

  bench('promote 1000 retained label borrows @cached @glyphs @api', function* () {
    const created = createLabels(1_000);
    created.labels.forEach((label) => label.withGlyphs((glyphs) => glyphs.glyphCount));
    const checksum = yield () => borrowedGlyphChecksum(created.labels);
    assert(checksum > 0, 'promoted borrows must contain glyphs');
    disposeLabels(created);
  });

  bench('borrow glyphs from 1000 steadily promoted retained labels @cached @glyphs @api', function* () {
    const created = createLabels(1_000);
    created.labels.forEach((label) => label.withGlyphs((glyphs) => glyphs.glyphCount));
    const expectedChecksum = borrowedGlyphChecksum(created.labels);
    const checksum = yield () => borrowedGlyphChecksum(created.labels);
    assert.equal(checksum, expectedChecksum);
    disposeLabels(created);
  });

  bench('edit and measure one of 1000 retained labels @layout @measure', function* () {
    const created = createLabels(1_000);
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

  bench('edit and sparsely borrow one of 1000 retained labels @layout @glyphs @api', function* () {
    const created = createLabels(1_000);
    const target = created.labels[0]!;
    target.withGlyphs((glyphs) => glyphs.glyphCount);
    target.withGlyphs((glyphs) => glyphs.glyphCount);
    let alternate = false;
    const glyphId = yield () => {
      alternate = !alternate;
      target.text = alternate ? 'edited alpha' : 'edited bravo';
      return target.withGlyphs((glyphs) => glyphs.glyphAt(0).glyphId);
    };
    assert(glyphId > 0, 'edited sparse borrow must contain glyphs');
    disposeLabels(created);
  });

  bench('publish 1024 retained Text instances @batch @publication', function* () {
    const created = createTextBatch(1_024);
    let alternate = false;
    const textCount = yield () => {
      alternate = !alternate;
      const prefix = alternate ? 'bravo' : 'alpha';
      for (const [index, text] of created.texts.entries()) {
        text.text = `${prefix} ${String(index).padStart(4, '0')}`;
      }
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, created.texts.length);
    disposeTextBatch(created);
  });
});
