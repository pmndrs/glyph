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

// Compare application flows that need fresh layout in scenes with 100 or 1,000 labels.
// A deferred artifact publishes during a frame. A synchronous artifact publishes on the read.
// Deferred artifacts batch per-object reads because each read needs a completed frame.
// Timings include scene traversal but exclude GPU work.
type Label = ReturnType<typeof createLabels>['labels'][number];
type LabelScene = Pick<ReturnType<typeof createLabels>, 'root' | 'scene' | 'textGroup'>;

const layoutReadsPublish = probeLayoutReadsPublish();

/** Untimed capability probe: does a layout read publish a pending paragraph without a frame? */
function probeLayoutReadsPublish(): boolean {
  const probe = createLabels(1);
  try {
    const label = probe.labels[0]!;
    label.text = 'WWWWWWWWWWWW';
    label.measureGlyphs();
    return label.commitState().status === 'committed';
  } finally {
    disposeLabels(probe);
  }
}

/** Glyph's share of `renderer.render(scene)`: the scene traversal that publishes pending layout. */
function renderFrame({ scene, textGroup }: LabelScene): void {
  scene.updateMatrixWorld();
  if (textGroup.error !== undefined) throw textGroup.error;
}

/** A deferred caller's wait: render the frame that publishes, then confirm it did before reading. */
function renderUntilPublished(scene: LabelScene, texts: readonly Label[]): void {
  renderFrame(scene);
  for (const text of texts) {
    if (text.commitState().status !== 'committed') throw new Error('deferred layout was not published by one frame');
  }
}

/** Rejects a read that answered for the text before the latest write. */
function requireFresh(actual: number, expected: number): number {
  if (actual !== expected) {
    throw new Error(`layout read answered for stale text (${String(actual)}, not ${String(expected)})`);
  }
  return actual;
}

/**
 * Writes each object and then reads it, either all writes before the reads or each object in turn, and renders the
 * result. Returns the sum of the reads.
 */
function updateThenRead(
  scene: LabelScene,
  objects: readonly Label[],
  write: (object: Label, index: number) => void,
  read: (object: Label) => number,
  eachInTurn: boolean,
): number {
  let total = 0;
  if (layoutReadsPublish && eachInTurn) {
    for (const [index, object] of objects.entries()) {
      write(object, index);
      total += read(object);
    }
  } else {
    for (const [index, object] of objects.entries()) write(object, index);
    if (!layoutReadsPublish) renderUntilPublished(scene, objects);
    for (const object of objects) total += read(object);
  }
  renderFrame(scene);
  return total;
}

/** Spawns and breaks apart each string, then renders and returns the glyph count and cleanup. */
function spawnAndBreakApart(scene: LabelScene, texts: readonly string[], eachInTurn: boolean) {
  const spawned = texts.map((text) => scene.root.createText({ font, text, style: { fontSize: 16 } }));
  const copies: ReturnType<Label['breakApart']>[0][] = [];
  const copied = updateThenRead(
    scene,
    spawned,
    (object) => {
      scene.textGroup.add(object);
    },
    (object) => {
      const [glyphs, decorations] = object.breakApart();
      decorations?.dispose();
      object.visible = false;
      scene.scene.add(glyphs);
      copies.push(glyphs);
      return requireFresh(glyphs.count, object.text.length);
    },
    eachInTurn,
  );
  return {
    copied,
    unmount() {
      for (const copy of copies) {
        copy.removeFromParent();
        copy.dispose();
      }
      for (const object of spawned) {
        object.removeFromParent();
        object.dispose();
      }
    },
  };
}

/** Untimed outcome check: every object is committed and measures the glyphs of its current text. */
function freshSnapshot(objects: readonly Label[]) {
  let fresh = 0;
  for (const object of objects) {
    if (object.commitState().status === 'committed' && object.measureGlyphs()?.length === object.text.length) {
      fresh += 1;
    }
  }
  assert.equal(fresh, objects.length);
  return fresh;
}

for (const count of [100, 1_000]) {
  group(`in a scene of ${String(count)} labels @read-publication`, () => {
    bench('break a title into letters', function* () {
      const created = createLabels(count);
      let copied = 0;
      try {
        yield {
          bench: () => {
            const title = spawnAndBreakApart(created, ['Glyph'], false);
            copied = title.copied;
            title.unmount();
            return copied;
          },
          snapshot: () => copied,
        };
      } finally {
        disposeLabels(created);
      }
    });

    bench('type in a text field', function* () {
      const created = createLabels(count);
      const field = created.root.createText({ font, text: 'Search: glyph', style: { fontSize: 16 } });
      created.textGroup.add(field);
      renderFrame(created);
      let typed = false;
      let selection = 0;
      try {
        yield {
          bench: () => {
            typed = !typed;
            return updateThenRead(
              created,
              [field],
              (object) => {
                object.text = typed ? 'Search: glyphs' : 'Search: glyph';
              },
              (object) => {
                const caret = requireFresh(object.caretAt(10_000, 0)?.offset ?? -1, object.text.length);
                selection = object.selectionRects(8, object.text.length)?.length ?? 0;
                return caret + selection;
              },
              false,
            );
          },
          snapshot: () => selection,
        };
      } finally {
        field.dispose();
        disposeLabels(created);
      }
    });

    bench('click to place the caret', function* () {
      const created = createLabels(count);
      const field = created.root.createText({ font, text: 'Search: glyph', style: { fontSize: 16 } });
      created.textGroup.add(field);
      renderFrame(created);
      let pointer = 0;
      try {
        yield {
          bench: () => {
            pointer = (pointer + 7) % 120;
            const caret = field.caretAt(pointer, 0)?.offset ?? -1;
            renderFrame(created);
            return caret;
          },
          snapshot: () => field.caretAt(10_000, 0)?.offset,
        };
      } finally {
        field.dispose();
        disposeLabels(created);
      }
    });

    for (const [schedule, eachInTurn] of [
      ['all, then read each', false],
      ['each in turn', true],
    ] as const) {
      bench(`floating combat text, 30 numbers: ${schedule}`, function* () {
        const created = createLabels(count);
        const damage = Array.from({ length: 30 }, (_, hit) => String(1_000 + hit * 37));
        let copied = 0;
        try {
          yield {
            bench: () => {
              const burst = spawnAndBreakApart(created, damage, eachInTurn);
              copied = burst.copied;
              // The numbers expire, so every burst spawns into the same scene.
              burst.unmount();
              return copied;
            },
            snapshot: () => copied,
          };
        } finally {
          disposeLabels(created);
        }
      });

      bench(`edit 50 lines and place carets: ${schedule}`, function* () {
        const created = createLabels(count);
        const lines = Array.from({ length: 50 }, (_, line) =>
          created.root.createText({ font, text: `let item${String(line)} = 0`, style: { fontSize: 16 } }),
        );
        created.textGroup.add(...lines);
        renderFrame(created);
        let typed = false;
        try {
          yield {
            bench: () => {
              typed = !typed;
              return updateThenRead(
                created,
                lines,
                (line, index) => {
                  line.text = `let item${String(index)} = 0${typed ? ';' : ''}`;
                },
                (line) => {
                  const caret = requireFresh(line.caretAt(10_000, 0)?.offset ?? -1, line.text.length);
                  return caret + (line.selectionRects(line.text.length - 2, line.text.length)?.length ?? 0);
                },
                eachInTurn,
              );
            },
            snapshot: () => lines.map((line) => line.caretAt(10_000, 0)?.offset === line.text.length),
          };
        } finally {
          for (const line of lines) line.dispose();
          disposeLabels(created);
        }
      });

      bench(`dashboard, 100 tickers rolling digits: ${schedule}`, function* () {
        const created = createLabels(count);
        const tickers = created.labels.slice(0, 100);
        for (const ticker of tickers) ticker.text = '12,345';
        renderFrame(created);
        let tick = false;
        try {
          yield {
            bench: () => {
              tick = !tick;
              const value = tick ? '123,456' : '12,345';
              return updateThenRead(
                created,
                tickers,
                (ticker) => {
                  ticker.text = value;
                },
                (ticker) => requireFresh(ticker.measureGlyphs()?.length ?? 0, value.length),
                eachInTurn,
              );
            },
            snapshot: () => freshSnapshot(tickers),
          };
        } finally {
          disposeLabels(created);
        }
      });

      bench(`load the scene and break every label apart: ${schedule}`, function* () {
        const texts = Array.from({ length: count }, () => 'WWWWWWWWWWWW');
        const copied = yield () => {
          const root = glyph.handle(
            `labs:load:${String(nextHandle++)}`,
            defineThreeConfig({ capacity: { size: count * 16, policy: 'grow' } }),
          );
          const textGroup = root.createTextGroup();
          const scene = new THREE.Scene();
          scene.add(textGroup);
          try {
            const loaded = spawnAndBreakApart({ root, scene, textGroup }, texts, eachInTurn);
            loaded.unmount();
            return loaded.copied;
          } finally {
            textGroup.dispose();
            root.dispose();
          }
        };
        assert.equal(copied, count * 12);
        return copied;
      });
    }

    bench('dashboard, 100 tickers without reading layout', function* () {
      const created = createLabels(count);
      const tickers = created.labels.slice(0, 100);
      for (const ticker of tickers) ticker.text = '12,345';
      renderFrame(created);
      let tick = false;
      try {
        yield {
          bench: () => {
            tick = !tick;
            for (const ticker of tickers) ticker.text = tick ? '123,456' : '12,345';
            renderFrame(created);
            return tickers.length;
          },
          snapshot: () => freshSnapshot(tickers),
        };
      } finally {
        disposeLabels(created);
      }
    });
  });
}
