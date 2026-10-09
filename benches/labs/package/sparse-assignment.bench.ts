import { assert, bench, group } from '@pmndrs/labs';

import { attachToScene, createParagraph, disposeParagraph, inspectDraws, txt } from './fixture.ts';

// Prepared inputs exclude scene generation, while timing the full public assignment and publication path.
const original = 'ab cd ef gh ij kl '.repeat(1_024);
const characters = original.split('');
for (let offset = 1; offset < characters.length; offset += 1_021) {
  if (characters[offset] !== ' ') characters[offset] = 'x';
}
const sparse = characters.join('');
const broad = original.replaceAll(/[a-z]/gu, 'x');

function formatted(text: string) {
  return {
    ...txt`${text}`,
    spans: Array.from({ length: 8_192 }, (_, index) => ({
      start: Math.floor((text.length * index) / 8_192),
      end: Math.floor((text.length * (index + 1)) / 8_192),
      style: { color: index % 2 === 0 ? '#ff2f00' : '#2f7fff' },
    })),
  };
}

// Stable identities legitimately advance on replacement; compare rendered semantics instead.
function renderedChecksum(paragraph: ReturnType<typeof createParagraph>['paragraph']): number {
  return paragraph.readGlyphs((glyphs) => {
    let checksum = glyphs.glyphCount;
    for (let index = 0; index < glyphs.glyphCount; index++) {
      const glyph = glyphs.glyphAt(index);
      checksum += glyph.glyphId + glyph.x + glyph.y + glyph.advance;
    }
    return checksum;
  });
}

group('large retained assignments @edit @assignment', () => {
  assert.equal(original.length, 18_432);
  for (const [kind, alternate] of [
    ['unchanged', original],
    ['scattered', sparse],
    ['broad', broad],
  ] as const) {
    bench(`${kind} character assignment in one large paragraph with 8192 paint spans`, function* () {
      const created = createParagraph(original);
      const scene = attachToScene(created.textGroup);
      const desired = [formatted(original), formatted(alternate)];
      let selected = 0;
      const publish = () => {
        selected = 1 - selected;
        created.paragraph.set({ text: desired[selected]! });
        scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return created.paragraph.commitState().status;
      };
      publish();
      const expected = desired.map((text) => {
        created.paragraph.set({ text });
        scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return renderedChecksum(created.paragraph);
      });
      const initialDraws = inspectDraws(scene);
      const status = yield publish;
      assert.equal(status, 'committed');
      assert.equal(created.paragraph.text, desired[selected]!.text);
      assert.equal(renderedChecksum(created.paragraph), expected[selected]);
      assert.equal(inspectDraws(scene).glyphs, initialDraws.glyphs);
      if (kind === 'scattered') assert.equal(expected[0] === expected[1], false);
      disposeParagraph(created);
    });
  }
});
