import { assert, bench, group } from '@pmndrs/labs';

import { attachToScene, createParagraph, disposeParagraph, fredokaFont, paragraphTextForGlyphs } from './fixture.ts';

const inter = paragraphTextForGlyphs(4_000);
const fredokaSentence =
  'Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end. ';
const fredoka = fredokaSentence.repeat(Math.ceil(inter.length / fredokaSentence.length));

/** Alternately inserts and removes one character in the middle of `text`. */
function typist(text: string) {
  const middle = text.length >> 1;
  let typed = false;
  return () => {
    typed = !typed;
    return typed ? `${text.slice(0, middle)}x${text.slice(middle)}` : text;
  };
}

// One keystroke into a long paragraph, the way a text editor drives the engine.
group('typing into a long paragraph @edit', () => {
  bench('type one character into a long paragraph and measure', function* () {
    const created = createParagraph(inter);
    const next = typist(inter);
    created.paragraph.text = next();
    const expected = created.paragraph.measure().glyphCount;
    const glyphCount = yield () => {
      created.paragraph.text = next();
      return created.paragraph.measure().glyphCount;
    };
    assert(glyphCount > 0 && Math.abs(glyphCount - expected) <= 1, 'one keystroke must change one glyph');
    disposeParagraph(created);
  });

  bench('type one character into a long Fredoka paragraph and measure', function* () {
    const created = createParagraph(fredoka, 600, fredokaFont);
    const next = typist(fredoka);
    created.paragraph.text = next();
    const expected = created.paragraph.measure().glyphCount;
    const glyphCount = yield () => {
      created.paragraph.text = next();
      return created.paragraph.measure().glyphCount;
    };
    assert(glyphCount > 0 && Math.abs(glyphCount - expected) <= 1, 'one keystroke must change one glyph');
    disposeParagraph(created);
  });

  bench('type one character into a long paragraph and publish a frame', function* () {
    const created = createParagraph(inter);
    const next = typist(inter);
    const scene = attachToScene(created.textGroup);
    const publish = () => {
      created.paragraph.text = next();
      scene.updateMatrixWorld(true);
      if (created.textGroup.error !== undefined) throw created.textGroup.error;
      return created.paragraph.commitState().status;
    };
    publish();
    const status = yield publish;
    assert.equal(status, 'committed');
    disposeParagraph(created);
  });
});
