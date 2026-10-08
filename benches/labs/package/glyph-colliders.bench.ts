import { assert, bench, group } from '@pmndrs/labs';

import {
  buildGlyphCollider,
  buildParagraphColliders,
  flattenToleranceEm,
} from '../../src/workloads/glyph-physics/glyph-colliders.ts';
import {
  attachToScene,
  createParagraph,
  disposeParagraph,
  loadOutlinedFont,
  paragraphTextForGlyphs,
} from './fixture.ts';

const outlinedFont = await loadOutlinedFont();
const FONT_SIZE = 24;
const TOLERANCE_EM = flattenToleranceEm(FONT_SIZE);
const PARAGRAPH_GLYPHS = 2_000;

/** Commits a paragraph on the outlined font and breaks it apart, so `Glyphs` addresses everything by one index. */
function breakApart(text: string) {
  const created = createParagraph(text, 600, outlinedFont);
  const scene = attachToScene(created.textGroup);
  scene.updateMatrixWorld(true);
  const [glyphs] = created.paragraph.breakApart();
  scene.add(glyphs);
  scene.updateMatrixWorld(true);
  return {
    dispose() {
      glyphs.dispose();
      disposeParagraph(created);
    },
    glyphs,
  };
}

// Registered only when the package under test reads outlines and names each detached glyph's shape by fontId and
// glyphId, so a baseline without them skips these benches instead of timing a different job under their names.
const probe = outlinedFont === undefined ? undefined : breakApart('Probe');
const supported = probe !== undefined && typeof probe.glyphs.glyphAt(0).fontId === 'number';
probe?.dispose();

if (supported) {
  group('glyph collider build @glyphs @api', () => {
    bench('build the convex collider of one glyph with a counter @glyphs @api', function* () {
      const single = breakApart('g');
      const outline = single.glyphs.outlineAt(0);
      const pieces = yield () => buildGlyphCollider(outline, TOLERANCE_EM).pieces.length;
      assert(pieces > 1, 'g must split into several convex pieces');
      single.dispose();
    });

    for (const dedupe of [true, false]) {
      bench(`build the colliders of a ${String(PARAGRAPH_GLYPHS)}-glyph paragraph with dedupe ${dedupe ? 'on' : 'off'} @glyphs @api @stress`, function* () {
        const paragraph = breakApart(paragraphTextForGlyphs(PARAGRAPH_GLYPHS));
        const { glyphs } = paragraph;
        const drawn = Array.from({ length: glyphs.count }, (_, index) => glyphs.glyphAt(index)).filter(
          (glyph) => glyph.drawn,
        ).length;
        assert(drawn > PARAGRAPH_GLYPHS / 2, 'the paragraph must hold about the requested glyph count');
        const built = yield () => buildParagraphColliders(glyphs, TOLERANCE_EM, dedupe).built;
        assert(dedupe ? built < 120 : built === drawn, 'dedupe must collapse repeats and its absence must not');
        paragraph.dispose();
      });
    }
  });
}
