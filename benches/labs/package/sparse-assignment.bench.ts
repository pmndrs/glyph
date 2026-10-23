import { deepStrictEqual } from 'node:assert';

import { assert, bench, group } from '@pmndrs/labs';

import {
  attachToScene,
  createParagraph,
  createParagraphWithPaint,
  disposeParagraph,
  inspectDraws,
  inspectGlyphPaint,
  monoFont,
  sharedTextMaterial,
  txt,
} from './fixture.ts';

// Authored inputs exclude scene generation. Every timed assignment still includes public setter
// normalization, UTF-16 request encoding, and synchronous Rust preparation.
const original = 'ab cd ef gh ij kl '.repeat(1_024);
const characters = original.split('');
for (let offset = 1; offset < characters.length; offset += 1_021) {
  if (characters[offset] !== ' ') characters[offset] = 'x';
}
const sparse = characters.join('');
const broad = original.replaceAll(/[a-z]/gu, 'x');

function formatted(text: string, material?: typeof sharedTextMaterial) {
  const spans = Array.from({ length: 8_192 }, (_, index) => ({
    start: Math.floor((text.length * index) / 8_192),
    end: Math.floor((text.length * (index + 1)) / 8_192),
    ...(material === undefined ? {} : { material }),
    style: { color: index % 2 === 0 ? '#ff2f00' : '#2f7fff' },
  }));
  if (material !== undefined) assert(spans.every((span) => span.material === material));
  return {
    ...txt`${text}`,
    spans,
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

const paintPartitions = [
  {
    ...txt`${original}`,
    spans: [{ start: 0, end: original.length >> 1, style: { color: '#ff2f00' } }],
  },
  {
    ...txt`${original}`,
    spans: [{ start: original.length >> 2, end: (original.length * 3) >> 2, style: { color: '#2f7fff' } }],
  },
  txt`${original}`,
] as const;

function visiblePaintState(
  paragraph: ReturnType<typeof createParagraph>['paragraph'],
  scene: ReturnType<typeof createParagraph>['scene'],
) {
  return {
    geometry: renderedChecksum(paragraph),
    glyphs: inspectDraws(scene).glyphs,
    measuredGlyphs: paragraph.measure().glyphCount,
    paint: inspectGlyphPaint(scene),
  };
}

function coldPaintStates() {
  return paintPartitions.map((text) => {
    const cold = createParagraphWithPaint(text);
    try {
      return visiblePaintState(cold.paragraph, cold.scene);
    } finally {
      disposeParagraph(cold);
    }
  });
}

type AssignmentKind = 'unchanged' | 'scattered' | 'broad';

function coldAssignmentStates(texts: readonly ReturnType<typeof formatted>[], fontFace: typeof monoFont | undefined) {
  return texts.map((text) => {
    const cold = createParagraphWithPaint(text, 600, fontFace);
    try {
      return visiblePaintState(cold.paragraph, cold.scene);
    } finally {
      disposeParagraph(cold);
    }
  });
}

function registerAssignments(
  options: {
    fontFace?: typeof monoFont;
    benchmarkNamePrefix?: string;
    broadPreparationTag?: string;
    material?: typeof sharedTextMaterial;
    kinds?: readonly AssignmentKind[];
  } = {},
) {
  assert.equal(original.length, 18_432);
  const kinds = options.kinds ?? (['unchanged', 'scattered', 'broad'] as const);
  for (const kind of kinds) {
    const alternate = kind === 'unchanged' ? original : kind === 'scattered' ? sparse : broad;
    const namePrefix = options.benchmarkNamePrefix ?? '';
    const materialTag = options.material === undefined ? '' : ' @material-lease';
    const unchangedPreparationTag =
      kind === 'unchanged' && options.fontFace === undefined && options.material === undefined
        ? ' @unchanged-span-preparation'
        : '';
    bench(`${namePrefix}${kind} setter preparation in one large paragraph with 8192 paint spans @preparation @encoding${kind === 'broad' && options.broadPreparationTag !== undefined ? ` ${options.broadPreparationTag}` : ''}${materialTag}${unchangedPreparationTag}`, function* () {
      const created = createParagraph(original, 600, options.fontFace);
      const desired = [formatted(original, options.material), formatted(alternate, options.material)];
      const expected = options.material === undefined ? undefined : coldAssignmentStates(desired, options.fontFace);
      let selected = 0;
      const glyphCount = yield () => {
        selected = 1 - selected;
        created.paragraph.set({ text: desired[selected]! });
        return created.paragraph.measure().glyphCount;
      };
      assert(glyphCount > 0, 'setter-owned preparation must be immediately measurable');
      assert.equal(created.paragraph.text, desired[selected]!.text);
      if (expected !== undefined) {
        assert.equal(glyphCount, expected[selected]!.measuredGlyphs);
        created.scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        deepStrictEqual(
          visiblePaintState(created.paragraph, created.scene),
          expected[selected],
          'shared-material measured assignment must match a fresh paragraph',
        );
      }
      disposeParagraph(created);
    });

    bench(`${namePrefix}${kind} end-to-end setter and publication with 8192 paint spans @preparation @encoding @publication${materialTag}`, function* () {
      const created = createParagraph(original, 600, options.fontFace);
      const scene = attachToScene(created.textGroup);
      const desired = [formatted(original, options.material), formatted(alternate, options.material)];
      const expectedPaint =
        options.material === undefined ? undefined : coldAssignmentStates(desired, options.fontFace);
      let selected = 0;
      const publish = () => {
        selected = 1 - selected;
        created.paragraph.set({ text: desired[selected]! });
        scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        return created.paragraph.commitState().status;
      };
      publish();
      const expected =
        expectedPaint?.map((state) => state.geometry) ??
        desired.map((text) => {
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
      if (expectedPaint !== undefined) {
        deepStrictEqual(
          visiblePaintState(created.paragraph, scene),
          expectedPaint[selected],
          'shared-material published assignment must match a fresh paragraph',
        );
      }
      if (kind === 'scattered') assert.equal(expected[0] === expected[1], false);
      disposeParagraph(created);
    });
  }
}

group('large retained assignments @edit @assignment', () => {
  registerAssignments();
});

group('monospaced retained assignments @edit @assignment @monospace', () => {
  registerAssignments({
    fontFace: monoFont,
    benchmarkNamePrefix: 'monospaced ',
    broadPreparationTag: '@mono-broad-preparation',
  });
});

group('shared material large retained assignments @edit @assignment @material-lease', () => {
  registerAssignments({
    benchmarkNamePrefix: 'shared-material ',
    material: sharedTextMaterial,
    kinds: ['scattered'],
  });
});

group('paint-only style partition assignments @style', () => {
  const expected = coldPaintStates();
  assert(expected.every((state) => state.geometry === expected[0]!.geometry));
  assert(expected.every((state) => state.glyphs === expected[0]!.glyphs));
  assert.equal(new Set(expected.map((state) => JSON.stringify(state.paint))).size, paintPartitions.length);

  for (const publish of [false, true]) {
    const boundary = publish ? 'publication' : 'preparation only';
    bench(`split move and merge paint boundaries ${boundary} @preparation @style${publish ? ' @publication' : ''}`, function* () {
      const created = createParagraph(original);
      let selected = paintPartitions.length - 1;
      const update = () => {
        selected = (selected + 1) % paintPartitions.length;
        created.paragraph.set({ text: paintPartitions[selected]! });
        if (publish) {
          created.scene.updateMatrixWorld(true);
          if (created.textGroup.error !== undefined) throw created.textGroup.error;
        }
        return created.paragraph.measure().glyphCount;
      };
      const glyphCount = yield update;
      assert.equal(glyphCount, expected[0]!.measuredGlyphs);
      if (publish) assert.equal(created.paragraph.commitState().status, 'committed');

      for (let index = 0; index < paintPartitions.length; index += 1) {
        created.paragraph.set({ text: paintPartitions[index]! });
        assert.equal(created.paragraph.measure().glyphCount, expected[index]!.measuredGlyphs);
        created.scene.updateMatrixWorld(true);
        if (created.textGroup.error !== undefined) throw created.textGroup.error;
        deepStrictEqual(
          visiblePaintState(created.paragraph, created.scene),
          expected[index],
          `paint partition ${String(index)} must match independently initialized glyph geometry and paint`,
        );
      }
      disposeParagraph(created);
    });
  }
});
