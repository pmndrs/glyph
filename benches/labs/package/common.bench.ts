import { assert, bench, group } from '@pmndrs/labs';

import { createLabels, createParagraph, disposeLabels, disposeParagraph, editedText } from './fixture.ts';

group('common text operations @core', () => {
  bench('measure after text change @layout @measure @smoke', function* () {
    const created = createParagraph();
    let iteration = 0;
    const glyphCount = yield () => {
      created.paragraph.text = editedText(iteration++);
      return created.paragraph.measure().glyphCount;
    };
    assert(glyphCount > 0, 'measurement must contain glyphs');
    disposeParagraph(created);
  });

  bench('publish after text change @layout @publication @smoke', function* () {
    const created = createParagraph();
    let iteration = 0;
    const textCount = yield () => {
      created.paragraph.text = editedText(iteration++);
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('reflow after width change @layout @reflow @publication @smoke', function* () {
    const created = createParagraph();
    let iteration = 0;
    const textCount = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 520 + iteration / 64 } };
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('publish after color change @style @publication @smoke', function* () {
    const created = createParagraph();
    let alternate = false;
    const textCount = yield () => {
      alternate = !alternate;
      created.paragraph.style = { color: alternate ? '#f97316' : '#38bdf8', fontSize: 24 };
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('relayout after font-size change @layout @style @publication @smoke', function* () {
    const created = createParagraph();
    let iteration = 0;
    const textCount = yield () => {
      iteration += 1;
      created.paragraph.style = { fontSize: 20 + iteration / 1024 };
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('measure 100 unchanged labels @cached @measure @smoke', function* () {
    const created = createLabels();
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });
});
