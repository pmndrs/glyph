import { assert, bench, group } from '@pmndrs/labs';

import { createParagraph, disposeParagraph, paragraphTextForGlyphs } from './fixture.ts';

const text = paragraphTextForGlyphs(22_000);

group('public paragraph layout at 22k glyphs @layout @exhaustive', () => {
  bench('cold publication @cold @publication', function* () {
    const textCount = yield () => {
      const created = createParagraph(text);
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      const result = created.textGroup.textCount;
      disposeParagraph(created);
      return result;
    };
    assert.equal(textCount, 1);
  });

  bench('cached measurement @cached @measure', function* () {
    const created = createParagraph(text);
    const expected = created.paragraph.measure().glyphCount;
    const glyphCount = yield () => created.paragraph.measure().glyphCount;
    assert.equal(glyphCount, expected);
    disposeParagraph(created);
  });

  bench('measurement after width change @measure @reflow', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const glyphCount = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 420 + iteration / 64 } };
      return created.paragraph.measure().glyphCount;
    };
    assert(glyphCount > 0, 'measurement must contain glyphs');
    disposeParagraph(created);
  });

  bench('measurement then publication after width change @measure @reflow @publication', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const result = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 420 + iteration / 64 } };
      const glyphCount = created.paragraph.measure().glyphCount;
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return glyphCount + created.textGroup.textCount;
    };
    assert(result > 1, 'measurement and publication must contain text');
    disposeParagraph(created);
  });

  bench('cached per-glyph inspection @cached @glyphs @api', function* () {
    const created = createParagraph(text);
    const expected = created.paragraph.glyphs().glyphCount;
    const glyphCount = yield () => created.paragraph.glyphs().glyphCount;
    assert.equal(glyphCount, expected);
    disposeParagraph(created);
  });

  bench('per-glyph inspection after width change @glyphs @api @reflow', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const glyphCount = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 420 + iteration / 64 } };
      return created.paragraph.glyphs().glyphCount;
    };
    assert(glyphCount > 0, 'inspection must contain glyphs');
    disposeParagraph(created);
  });

  bench('inspection then publication after width change @glyphs @api @reflow @publication', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const result = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 420 + iteration / 64 } };
      const glyphCount = created.paragraph.glyphs().glyphCount;
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return glyphCount + created.textGroup.textCount;
    };
    assert(result > 1, 'inspection and publication must contain text');
    disposeParagraph(created);
  });

  bench('publication after font-size change @style @publication', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const textCount = yield () => {
      iteration += 1;
      created.paragraph.style = { fontSize: 12 + iteration / 256 };
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('publication after width change @reflow @publication', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const textCount = yield () => {
      iteration += 1;
      created.paragraph.constraints = { width: { mode: 'exact', size: 420 + iteration / 64 } };
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });

  bench('publication after text change @publication', function* () {
    const created = createParagraph(text);
    let iteration = 0;
    const textCount = yield () => {
      const leading = String.fromCharCode(65 + (iteration++ % 26));
      created.paragraph.text = `${leading}${text.slice(1)}`;
      created.textGroup.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.textGroup.textCount;
    };
    assert.equal(textCount, 1);
    disposeParagraph(created);
  });
});
