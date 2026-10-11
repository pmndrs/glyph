import { assert, bench, group } from '@pmndrs/labs';

import { attachToScene, createParagraph, disposeParagraph, inspectDraws, txt } from './fixture.ts';

// Authored inputs exclude scene generation. Every timed assignment still includes public setter
// normalization, UTF-16 request encoding, and synchronous Rust preparation.
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
    bench(`${kind} setter preparation in one large paragraph with 8192 paint spans @preparation @encoding`, function* () {
      const created = createParagraph(original);
      const desired = [formatted(original), formatted(alternate)];
      let selected = 0;
      const glyphCount = yield () => {
        selected = 1 - selected;
        created.paragraph.set({ text: desired[selected]! });
        return created.paragraph.measure().glyphCount;
      };
      assert(glyphCount > 0, 'setter-owned preparation must be immediately measurable');
      assert.equal(created.paragraph.text, desired[selected]!.text);
      disposeParagraph(created);
    });

    bench(`${kind} end-to-end setter and publication with 8192 paint spans @preparation @encoding @publication`, function* () {
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
