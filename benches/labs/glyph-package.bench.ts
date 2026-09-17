import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';

const packageRoot = process.env.GLYPH_LABS_PACKAGE_ROOT;
if (packageRoot === undefined) {
  throw new Error('GLYPH_LABS_PACKAGE_ROOT must identify an installed @pmndrs/glyph package');
}

const glyphPackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/index.js')).href
)) as typeof import('@pmndrs/glyph');
const threePackage = (await import(
  pathToFileURL(resolve(packageRoot, 'dist/three.js')).href
)) as typeof import('@pmndrs/glyph/three');

const { bitmap, glyph } = glyphPackage;
const { defineThreeConfig } = threePackage;
const fontBytes = await readFile(new URL('../fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url));

await glyph.init();
const font = glyph.fontFace(new Blob([new Uint8Array(fontBytes)], { type: 'model/gltf-binary' }), {
  format: bitmap({ strikes: [16] }),
});
await font.load();

const paragraphSource = [
  'Typography is a moving system. AVATAR To Wa Yo repeat familiar kerning pairs while a responsive panel changes the space around them.',
  'A practical interface mixes prose with 0123456789, prices such as 24.50, ranges from 8-512 px, and punctuation.',
  'Repeated office, affine, difficult, and shuffle words retain ff, fi, fl, ffi, and ffl shaping candidates.',
].join(' ');
const paragraphText = Array.from({ length: 18 }, () => paragraphSource).join('\n');
let nextHandle = 1;

function createParagraph(text = paragraphText, width = 600) {
  const root = glyph.handle(
    `labs:package:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: 8192, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const paragraph = root.createText({
    font,
    text,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: width } },
  });
  textGroup.add(paragraph);
  textGroup.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { paragraph, root, textGroup };
}

function disposeParagraph(created: ReturnType<typeof createParagraph>): void {
  created.textGroup.dispose();
  created.paragraph.dispose();
  created.root.dispose();
}

function editedText(iteration: number): string {
  const leading = String.fromCharCode(65 + (iteration % 26));
  return `${leading}${paragraphText.slice(1)}`;
}

group('packaged public API @core', () => {
  bench('measure after equal-size text edit @layout', function* () {
    const created = createParagraph();
    let iteration = 0;
    const glyphCount = yield () => {
      created.paragraph.text = editedText(iteration++);
      return created.paragraph.measure().glyphCount;
    };
    assert(glyphCount > 0, 'measurement must contain glyphs');
    disposeParagraph(created);
  });

  bench('glyphs after equal-size text edit @layout', function* () {
    const created = createParagraph();
    let iteration = 0;
    const glyphCount = yield () => {
      created.paragraph.text = editedText(iteration++);
      return created.paragraph.glyphs().glyphCount;
    };
    assert(glyphCount > 0, 'inspection must contain glyphs');
    disposeParagraph(created);
  });

  bench('Three publication after equal-size text edit @publication', function* () {
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

  bench('column reflow and Three publication @layout', function* () {
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

  bench('font-size relayout and Three publication @layout', function* () {
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
});

group('retained batching @publication', () => {
  bench('publish 128 retained Text instances', function* () {
    const count = 128;
    const root = glyph.handle(
      `labs:package:${String(nextHandle++)}`,
      defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
    );
    const textGroup = root.createTextGroup();
    const texts = Array.from({ length: count }, (_, index) =>
      root.createText({
        font,
        text: `alpha ${String(index).padStart(3, '0')}`,
        style: { fontSize: 16 },
        constraints: { width: { mode: 'exact', size: 160 } },
      }),
    );
    textGroup.add(...texts);
    textGroup.updateMatrixWorld(true);
    if (textGroup.error !== undefined) throw textGroup.error;
    let alternate = false;
    const textCount = yield () => {
      alternate = !alternate;
      const prefix = alternate ? 'bravo' : 'alpha';
      for (const [index, text] of texts.entries()) text.text = `${prefix} ${String(index).padStart(3, '0')}`;
      textGroup.updateMatrixWorld(true);
      if (textGroup.error !== undefined) throw textGroup.error;
      return textGroup.textCount;
    };
    assert.equal(textCount, count);
    textGroup.dispose();
    for (const text of texts) text.dispose();
    root.dispose();
  });
});
