import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { assert, bench, group } from '@pmndrs/labs';
import * as THREE from 'three/webgpu';

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

function createLabels(count = 100) {
  const root = glyph.handle(
    `labs:labels:${String(nextHandle++)}`,
    defineThreeConfig({ capacity: { size: count * 24, policy: 'grow' } }),
  );
  const textGroup = root.createTextGroup();
  const scene = new THREE.Scene();
  const labels = Array.from({ length: count }, (_, index) =>
    root.createText({
      font,
      text: `label ${String(index).padStart(3, '0')}`,
      style: { fontSize: 16 },
      constraints: { width: { mode: 'exact', size: 160 } },
    }),
  );
  textGroup.add(...labels);
  scene.add(textGroup);
  scene.updateMatrixWorld(true);
  if (textGroup.error !== undefined) throw textGroup.error;
  return { labels, root, scene, textGroup };
}

function disposeLabels(created: ReturnType<typeof createLabels>): void {
  created.textGroup.dispose();
  for (const label of created.labels) label.dispose();
  created.root.dispose();
}

function borrowedGlyphChecksum(labels: ReturnType<typeof createLabels>['labels']): number {
  return labels.reduce(
    (total, label) =>
      total +
      label.withGlyphs((glyphs) => {
        let checksum = glyphs.glyphCount;
        for (let index = 0; index < glyphs.glyphCount; index += 1) {
          const record = glyphs.glyphAt(index);
          checksum += record.stableId + record.glyphId + record.x + record.y + record.advance;
        }
        return checksum;
      }),
    0,
  );
}

function editedText(iteration: number): string {
  const leading = String.fromCharCode(65 + (iteration % 26));
  return `${leading}${paragraphText.slice(1)}`;
}

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
});

group('batched text operations @publication', () => {
  bench('measure 100 unchanged labels @cached @measure @smoke', function* () {
    const created = createLabels();
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
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

  bench('edit and measure one of 100 retained labels @layout', function* () {
    const created = createLabels();
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

  bench('publish changes to 128 Text instances @batch', function* () {
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

group('1,000-label stress @publication @stress', () => {
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

  bench('reorder then edit one of 1000 retained labels @publication', function* () {
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

  bench('measure 1000 unchanged retained labels @cached', function* () {
    const created = createLabels(1_000);
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });

  bench('first sparse borrow from 1000 retained labels @cached', function* () {
    const created = createLabels(1_000);
    const glyphCount = yield () =>
      created.labels.reduce((total, label) => total + label.withGlyphs((glyphs) => glyphs.glyphCount), 0);
    assert(glyphCount > 0, 'sparse borrows must contain glyphs');
    disposeLabels(created);
  });

  bench('promote 1000 retained label borrows @cached', function* () {
    const created = createLabels(1_000);
    created.labels.forEach((label) => label.withGlyphs((glyphs) => glyphs.glyphCount));
    const checksum = yield () => borrowedGlyphChecksum(created.labels);
    assert(checksum > 0, 'promoted borrows must contain glyphs');
    disposeLabels(created);
  });

  bench('borrow glyphs from 1000 steadily promoted retained labels @cached', function* () {
    const created = createLabels(1_000);
    created.labels.forEach((label) => label.withGlyphs((glyphs) => glyphs.glyphCount));
    const expectedChecksum = borrowedGlyphChecksum(created.labels);
    const checksum = yield () => borrowedGlyphChecksum(created.labels);
    assert.equal(checksum, expectedChecksum);
    disposeLabels(created);
  });

  bench('edit and measure one of 1000 retained labels @layout', function* () {
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

  bench('edit and sparsely borrow one of 1000 retained labels @layout', function* () {
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

  bench('publish 1024 retained Text instances', function* () {
    const count = 1_024;
    const root = glyph.handle(
      `labs:package:${String(nextHandle++)}`,
      defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
    );
    const textGroup = root.createTextGroup();
    const texts = Array.from({ length: count }, (_, index) =>
      root.createText({
        font,
        text: `alpha ${String(index).padStart(4, '0')}`,
        style: { fontSize: 16 },
        constraints: { width: { mode: 'exact', size: 160 } },
      }),
    );
    textGroup.add(...texts);
    textGroup.updateMatrixWorld(true);
    let alternate = false;
    const textCount = yield () => {
      alternate = !alternate;
      const prefix = alternate ? 'bravo' : 'alpha';
      for (const [index, text] of texts.entries()) text.text = `${prefix} ${String(index).padStart(4, '0')}`;
      textGroup.updateMatrixWorld(true);
      if (textGroup.error !== undefined) throw textGroup.error;
      return textGroup.textCount;
    };
    assert.equal(textCount, count);
    textGroup.dispose();
    texts.forEach((text) => text.dispose());
    root.dispose();
  });
});
