import { assert, bench, group } from '@pmndrs/labs';

import {
  borrowedGlyphChecksum,
  createLabels,
  createParagraph,
  disposeLabels,
  disposeParagraph,
  editedText,
} from './fixture.ts';

group('per-glyph inspection @glyphs @api', () => {
  bench('copy per-glyph metrics after text change @layout @glyphs @api', function* () {
    const created = createParagraph();
    let iteration = 0;
    const glyphCount = yield () => {
      created.paragraph.text = editedText(iteration++);
      return created.paragraph.glyphs().glyphCount;
    };
    assert(glyphCount > 0, 'inspection must contain glyphs');
    disposeParagraph(created);
  });

  bench('copy per-glyph metrics from 100 unchanged labels @cached @glyphs @api', function* () {
    const created = createLabels();
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });

  bench('borrow per-glyph metrics from 100 promoted labels @cached @glyphs @api', function* () {
    const created = createLabels();
    created.labels.forEach((label) => label.withGlyphs((glyphs) => glyphs.glyphCount));
    const readGlyphs = () => borrowedGlyphChecksum(created.labels);
    const expectedChecksum = readGlyphs();
    const checksum = yield readGlyphs;
    assert.equal(checksum, expectedChecksum);
    disposeLabels(created);
  });
});
