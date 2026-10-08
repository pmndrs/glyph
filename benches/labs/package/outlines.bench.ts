import { assert, bench, group } from '@pmndrs/labs';

import { createParagraph, disposeParagraph, editedText, loadOutlinedFont } from './fixture.ts';

const outlinedFont = await loadOutlinedFont();

// Registered only when the package under test reads outlines; compare with "copy per-glyph metrics after text change"
// in inspection.bench.ts, the same paragraph on a font baked without outlines.
if (outlinedFont !== undefined) {
  group('glyph outlines @glyphs @api', () => {
    bench('copy per-glyph metrics with outlines after text change @layout @glyphs @api', function* () {
      const created = createParagraph(undefined, undefined, outlinedFont);
      let iteration = 0;
      const glyphCount = yield () => {
        created.paragraph.text = editedText(iteration++);
        return created.paragraph.glyphs().glyphCount;
      };
      assert(glyphCount > 0, 'inspection must contain glyphs');
      disposeParagraph(created);
    });

    bench('read every outline from an unchanged copy @cached @glyphs @api', function* () {
      const created = createParagraph(undefined, undefined, outlinedFont);
      const layout = created.paragraph.glyphs();
      const readOutlines = () => {
        let curves = 0;
        for (let index = 0; index < layout.glyphCount; index += 1) {
          for (const contour of layout.outlineAt(index)) curves += contour.length;
        }
        return curves;
      };
      const expected = readOutlines();
      const curves = yield readOutlines;
      assert.equal(curves, expected);
      assert(curves > 0, 'the outlined paragraph must have curves');
      disposeParagraph(created);
    });
  });
}
