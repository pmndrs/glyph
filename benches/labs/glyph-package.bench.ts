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
  bench('measure 100 unchanged retained labels @cached', function* () {
    const created = createLabels();
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.measure().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });

  bench('copy glyphs from 100 unchanged retained labels @cached', function* () {
    const created = createLabels();
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
    assert.equal(glyphCount, expectedGlyphs);
    disposeLabels(created);
  });

  bench('borrow glyphs from 100 steadily promoted retained labels @cached', function* () {
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

group('retained batching at 1,000 labels @publication', () => {
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

  bench('copy glyphs from 1000 unchanged retained labels @cached', function* () {
    const created = createLabels(1_000);
    const expectedGlyphs = created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
    const glyphCount = yield () => created.labels.reduce((total, label) => total + label.glyphs().glyphCount, 0);
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

// These are same-call comparisons: older artifacts may return stale/absent intermediate reads.
// Every iteration includes the final traversal; the untimed snapshot proves fresh committed output.
const publicationReads = [
  ['measureGlyphs', (label: ReturnType<typeof createLabels>['labels'][number]) => label.measureGlyphs()?.length ?? 0],
  ['caretAt', (label: ReturnType<typeof createLabels>['labels'][number]) => label.caretAt(30, 0)?.offset ?? 0],
  [
    'selectionRects',
    (label: ReturnType<typeof createLabels>['labels'][number]) => label.selectionRects(0, 4)?.length ?? 0,
  ],
] as const;

for (const count of [100, 1_000]) {
  group(`public layout reads at ${String(count)} labels @read-publication`, () => {
    for (const [name, read] of publicationReads) {
      for (const schedule of ['unchanged', 'writes then reads', 'alternating writes and reads'] as const) {
        bench(`${name}: ${schedule}`, function* () {
          const created = createLabels(count);
          try {
            for (const label of created.labels) label.text = schedule === 'unchanged' ? 'WWWWWWWWWWWW' : 'iiiiiiii';
            created.scene.updateMatrixWorld(true);
            let alternate = false;
            yield {
              bench: () => {
                alternate = !alternate;
                const text = alternate ? 'WWWWWWWWWWWW' : 'iiiiiiii';
                let observed = 0;
                if (schedule === 'writes then reads') {
                  for (const label of created.labels) label.text = text;
                }
                for (const label of created.labels) {
                  if (schedule === 'alternating writes and reads') label.text = text;
                  observed += read(label);
                }
                // Include deferred work on both artifacts, even when a read did not publish it.
                if (schedule !== 'unchanged') created.scene.updateMatrixWorld(true);
                if (created.textGroup.error !== undefined) throw created.textGroup.error;
                return observed;
              },
              snapshot: () => committedReadSnapshot(created, count),
            };
          } finally {
            disposeLabels(created);
          }
        });
      }
    }

    bench('writes then traversal (no layout reads)', function* () {
      const created = createLabels(count);
      try {
        let alternate = false;
        yield {
          bench: () => {
            alternate = !alternate;
            for (const label of created.labels) label.text = alternate ? 'WWWWWWWWWWWW' : 'iiiiiiii';
            created.scene.updateMatrixWorld(true);
            if (created.textGroup.error !== undefined) throw created.textGroup.error;
            return created.textGroup.textCount;
          },
          snapshot: () => committedReadSnapshot(created, count),
        };
      } finally {
        disposeLabels(created);
      }
    });

    for (const schedule of ['mount all then split', 'mount and split each'] as const) {
      bench(schedule, function* () {
        // Detect the public behavior outside timing; do not use exception-driven retries in the benchmark.
        const probe = createLabels(1);
        let commitsOnRead: boolean;
        try {
          probe.labels[0]!.text = 'WWWWWWWWWWWW';
          probe.labels[0]!.measureGlyphs();
          commitsOnRead = probe.labels[0]!.commitState().status === 'committed';
        } finally {
          disposeLabels(probe);
        }
        const copied = yield () => {
          const root = glyph.handle(
            `labs:mount:${String(nextHandle++)}`,
            defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
          );
          const textGroup = root.createTextGroup();
          const scene = new THREE.Scene();
          const labels: ReturnType<typeof createLabels>['labels'] = [];
          let glyphCount = 0;
          try {
            scene.add(textGroup);
            const split = (label: (typeof labels)[number]) => {
              const [copy, decorations] = label.breakApart();
              try {
                glyphCount += copy.count;
              } finally {
                copy.dispose();
                decorations?.dispose();
              }
            };
            for (let index = 0; index < count; index += 1) {
              const label = root.createText({ font, text: 'WWWWWWWWWWWW', style: { fontSize: 16 } });
              labels.push(label);
              textGroup.add(label);
              if (schedule === 'mount and split each') {
                if (!commitsOnRead) scene.updateMatrixWorld(true);
                split(label);
              }
            }
            if (schedule === 'mount all then split') {
              if (!commitsOnRead) scene.updateMatrixWorld(true);
              for (const label of labels) split(label);
            }
            scene.updateMatrixWorld(true);
            if (textGroup.error !== undefined) throw textGroup.error;
            return glyphCount;
          } finally {
            textGroup.dispose();
            for (const label of labels) label.dispose();
            root.dispose();
          }
        };
        assert.equal(copied, count * 12);
        return copied;
      });
    }
  });
}

function committedReadSnapshot(created: ReturnType<typeof createLabels>, count: number) {
  let glyphs = 0;
  let endX = 0;
  let committed = 0;
  for (const label of created.labels) {
    if (label.commitState().status === 'committed') committed += 1;
    const measurements = label.measureGlyphs();
    glyphs += measurements?.length ?? 0;
    endX += measurements?.at(-1)?.shapedOrigin.x ?? 0;
  }
  assert.equal(glyphs, count * 12);
  assert.equal(committed, count);
  assert(endX > 0, 'fresh output must contain positioned glyphs');
  return { glyphs, endX, committed };
}
