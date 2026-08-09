import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text';
import { createFontBaker } from '@pmndrs/text-font-baker';
import { hashParagraphLayout } from '../../../../apps/benchmarks/src/benchmark/paragraph-layout-digest.ts';

const contractUrl = new URL(
  '../../../../apps/benchmarks/fixtures/contracts/paragraph-bidi-layout-v0.json',
  import.meta.url,
);
const contract = JSON.parse(await readFile(contractUrl, 'utf8'));

test('lays out exact mixed-direction Amiri goldens through retained GLB shaping data', async () => {
  const { font, shaper } = await runtime('amiri-1.002/Amiri-Regular.ttf');
  const calls = { shape: 0, reshape: 0 };
  const requests = [];
  const observed = observeShaper(shaper, calls, requests);
  const engine = createParagraphEngine({ shaper: observed });
  let retainedLayout;

  assert.equal(contract.generatedBy, 'apps/benchmarks/scripts/generate-paragraph-bidi-contract.mts');
  assert.equal(font.shapingHash, contract.fonts.amiri.shapingHash);
  for (const fixture of Object.values(contract.bidi)) {
    const paragraph = engine.create({
      text: fixture.text,
      font: font.handle,
      style: fixture.style,
    });
    const layout = paragraph.layout(fixture.constraints);
    assertGoldenLayout(layout, fixture.layout, true);
    assertLineTopology(layout, fixture.text);
    if (retainedLayout === undefined) retainedLayout = layout;
  }

  assert.deepEqual(calls, { shape: 2, reshape: 0 });
  assert.deepEqual(
    requests
      .filter(({ shape }) => shape !== undefined)
      .map(({ shape }) =>
        shape.runs.slice(0, shape.runs.length / 2).map((run) => ({
          text: String.fromCharCode(...shape.textUtf16.slice(run.textStart, run.textEnd)),
          direction: run.direction,
          script: run.script,
        })),
      ),
    [
      [
        { text: 'ABC ', direction: 'ltr', script: 'Latn' },
        { text: 'مرحبا ', direction: 'rtl', script: 'Arab' },
        { text: '123', direction: 'ltr', script: 'Arab' },
        { text: ' ', direction: 'ltr', script: 'Arab' },
        { text: 'DEF', direction: 'ltr', script: 'Latn' },
      ],
      [
        { text: 'مرحبا ', direction: 'rtl', script: 'Arab' },
        { text: 'ABC 123', direction: 'ltr', script: 'Latn' },
        { text: ' ', direction: 'rtl', script: 'Latn' },
        { text: 'عالم', direction: 'rtl', script: 'Arab' },
      ],
    ],
  );
  assert.equal(
    hashParagraphLayout(retainedLayout),
    contract.bidi.ltr.layout.hash,
    'later borrowed Wasm results must not mutate an earlier paragraph layout',
  );
  shaper.dispose();
  font.dispose();
});

test('reuses broad Arabic shaping at safe line boundaries and narrows only unsafe context', async () => {
  const { font, shaper } = await runtime('amiri-1.002/Amiri-Regular.ttf');
  shaper.registerFont(font);
  const text = 'مرحبا بالعالم';
  const textUtf16 = utf16(text);
  const request = {
    textUtf16,
    features: [],
    runs: [
      {
        font: font.handle,
        textStart: 0,
        textEnd: textUtf16.length,
        direction: 'rtl',
        script: 'Arab',
        language: 'ar',
        clusterLevel: 0,
        flags: 0x40,
        featureStart: 0,
        featureCount: 0,
      },
    ],
  };
  const broad = ownShape(shaper.shapeBatch(request));
  const safeBoundary = 6;
  const unsafeBoundary = 7;

  assert.equal(glyphFlagsAtCluster(broad, safeBoundary) & 1, 0, 'word boundary is safe to break');
  assert.equal(glyphFlagsAtCluster(broad, unsafeBoundary) & 1, 1, 'joining boundary is unsafe to break');
  assert.deepEqual(
    shapeRangeSignature(reshapeLine(shaper, request, 0, safeBoundary), 0, safeBoundary),
    shapeRangeSignature(broad, 0, safeBoundary),
    'safe first line is byte-identical to the retained broad shape',
  );
  assert.deepEqual(
    shapeRangeSignature(reshapeLine(shaper, request, safeBoundary, textUtf16.length), safeBoundary, textUtf16.length),
    shapeRangeSignature(broad, safeBoundary, textUtf16.length),
    'safe next line is byte-identical to the retained broad shape',
  );
  assert.notDeepEqual(
    shapeRangeSignature(reshapeLine(shaper, request, 0, unsafeBoundary), 0, unsafeBoundary),
    shapeRangeSignature(broad, 0, unsafeBoundary),
    'forcing an unsafe Arabic boundary changes the line shape',
  );

  shaper.dispose();
  font.dispose();
});

test('applies exact alignment, clipping, max-lines, and ellipsis policies without hidden calls', async () => {
  const { font, shaper } = await runtime('inter-v4.1/Inter-Regular.ttf');
  const calls = { shape: 0, reshape: 0 };
  const requests = [];
  const observed = observeShaper(shaper, calls, requests);
  const paragraph = createParagraphEngine({ shaper: observed }).create({
    text: contract.policies.text,
    font: font.handle,
    style: contract.policies.style,
  });
  assert.equal(calls.shape, 1, 'text and every per-run ellipsis are prepared in one batch');

  // Boundary reshaping requests the whole run as context, which is the context the retained paragraph shape already
  // used, so it can only return the glyphs it already returned. These counts therefore assert that no policy reaches
  // the shaper again: every layout below is produced from the one retained shape. A future narrowed context — a
  // truncated line taking final forms, or a line shaped in isolation — is what should raise them again.
  const expectedCrossings = {
    start: 0,
    center: 0,
    end: 0,
    justify: 0,
    clip: 0,
    maxLines: 0,
    ellipsisOne: 0,
    ellipsisHeightOne: 0,
    ellipsisHeightTwo: 0,
  };
  const layouts = {};
  for (const [id, fixture] of Object.entries(contract.policies.cases)) {
    const measured = paragraph.measure(fixture.constraints);
    assert.deepEqual(measured, fixture.layout.measurement);
    const layout = paragraph.layout(fixture.constraints);
    layouts[id] = layout;
    assertGoldenLayout(layout, fixture.layout, false);
    assertLineTopology(layout, contract.policies.text);
    assert.equal(calls.reshape, expectedCrossings[id], `${id} reshape boundary count`);
  }

  assert.equal(layouts.clip.glyphIds.length, layouts.start.glyphIds.length);
  assert.equal(layouts.clip.height, 60);
  assert.equal(layouts.clip.overflowed, true);
  assert.deepEqual([...layouts.maxLines.lineTextEnds], [8, 19]);
  assert.equal(layouts.maxLines.contentHeight, 160);
  assert.equal(layouts.ellipsisOne.glyphIds.at(-1), 1503);
  assert.equal(layouts.ellipsisOne.clusters.at(-1), 8);
  assert.equal(layouts.ellipsisHeightOne.glyphIds, layouts.ellipsisOne.glyphIds);
  assert.notEqual(layouts.ellipsisHeightTwo.glyphIds, layouts.ellipsisHeightOne.glyphIds);
  assertAlignmentOffsets(layouts.start, layouts.center, layouts.end, 180);
  assert.deepEqual(
    [...layouts.justify.lineAdvances].slice(0, -1),
    Array(layouts.justify.lineAdvances.length - 1).fill(180),
    'justification fills every non-final soft-wrapped line',
  );
  assert.ok(
    (layouts.justify.lineAdvances.at(-1) ?? 180) < 180,
    'justification leaves the final line at its natural advance',
  );
  for (const layout of [layouts.ellipsisOne, layouts.ellipsisHeightOne, layouts.ellipsisHeightTwo]) {
    const end = layout.lineTextEnds.at(-1) ?? contract.policies.text.length;
    assert.ok(end < contract.policies.text.length, 'ellipsis truncates a source range');
    assert.equal(layout.clusters.at(-1), end, 'ellipsis glyph is anchored at the truncation boundary');
  }
  assert.deepEqual(
    requests.filter(({ ranges }) => ranges !== undefined).map(({ ranges }) => ranges.length),
    [],
    'no policy issues a reshape request while the shaping context is the whole run',
  );

  shaper.dispose();
  font.dispose();
});

async function runtime(relativeFontPath) {
  const [source, bakerWasm, shaperWasm] = await Promise.all([
    readFile(new URL(`../../../../apps/benchmarks/fixtures/fonts/${relativeFontPath}`, import.meta.url)),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  ]);
  const baker = await createFontBaker(bakerWasm);
  const artifact = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;
  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm });
  return { font, shaper };
}

function observeShaper(shaper, calls, requests) {
  return {
    registry: shaper.registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (shape) => {
      calls.shape += 1;
      requests.push({ shape });
      return shaper.shapeBatch(shape);
    },
    reshapeRanges: (request) => {
      calls.reshape += 1;
      requests.push({ ranges: request.ranges.map((range) => ({ ...range })) });
      return shaper.reshapeRanges(request);
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  };
}

function reshapeLine(shaper, request, start, end) {
  return ownShape(
    shaper.reshapeRanges({
      ...request,
      ranges: [
        {
          run: 0,
          itemStart: start,
          itemEnd: end,
          contextStart: start,
          contextEnd: end,
          flags: 0x43,
        },
      ],
    }),
  );
}

function ownShape(shape) {
  return {
    glyphIds: [...shape.glyphIds],
    clusters: [...shape.clusters],
    xAdvances: [...shape.xAdvances],
    yAdvances: [...shape.yAdvances],
    xOffsets: [...shape.xOffsets],
    yOffsets: [...shape.yOffsets],
    glyphFlags: [...shape.glyphFlags],
  };
}

function glyphFlagsAtCluster(shape, cluster) {
  const index = shape.clusters.indexOf(cluster);
  assert.notEqual(index, -1, `expected a glyph at cluster ${cluster}`);
  return shape.glyphFlags[index];
}

function shapeRangeSignature(shape, start, end) {
  return shape.glyphIds.flatMap((glyphId, index) =>
    shape.clusters[index] >= start && shape.clusters[index] < end
      ? [
          [
            glyphId,
            shape.clusters[index],
            shape.xAdvances[index],
            shape.yAdvances[index],
            shape.xOffsets[index],
            shape.yOffsets[index],
          ],
        ]
      : [],
  );
}

function utf16(value) {
  return Uint16Array.from({ length: value.length }, (_, index) => value.charCodeAt(index));
}

function assertGoldenLayout(layout, golden, full) {
  assert.deepEqual(
    {
      width: layout.width,
      height: layout.height,
      contentWidth: layout.contentWidth,
      contentHeight: layout.contentHeight,
      firstBaseline: layout.firstBaseline,
      lastBaseline: layout.lastBaseline,
      overflowed: layout.overflowed,
    },
    golden.measurement,
  );
  const fields = full
    ? [
        'glyphFontSlots',
        'glyphIds',
        'clusters',
        'glyphFontSizes',
        'x',
        'y',
        'glyphFlags',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ]
    : [
        'glyphIds',
        'clusters',
        'x',
        'lineTextStarts',
        'lineTextEnds',
        'lineGlyphStarts',
        'lineGlyphCounts',
        'lineBaselines',
        'lineAdvances',
      ];
  for (const field of fields) assert.deepEqual([...layout[field]], golden[field], field);
  assert.equal(hashParagraphLayout(layout), golden.hash);
}

function assertLineTopology(layout, text) {
  assert.equal(layout.lineTextStarts.length, layout.lineTextEnds.length);
  assert.equal(layout.lineTextStarts.length, layout.lineGlyphStarts.length);
  assert.equal(layout.lineTextStarts.length, layout.lineGlyphCounts.length);
  let previousEnd = 0;
  let previousGlyphEnd = 0;
  let previousBaseline = -Infinity;
  for (let index = 0; index < layout.lineTextStarts.length; index += 1) {
    const start = layout.lineTextStarts[index];
    const end = layout.lineTextEnds[index];
    const glyphStart = layout.lineGlyphStarts[index];
    const glyphCount = layout.lineGlyphCounts[index];
    const baseline = layout.lineBaselines[index];
    const advance = layout.lineAdvances[index];
    assert.ok(start >= previousEnd && start <= end && end <= text.length, `line ${index} text range`);
    assert.equal(glyphStart, previousGlyphEnd, `line ${index} glyph range is contiguous`);
    assert.ok(glyphStart + glyphCount <= layout.glyphIds.length, `line ${index} glyph range is bounded`);
    assert.ok(baseline > previousBaseline, `line ${index} baseline is strictly increasing`);
    assert.ok(Number.isFinite(advance) && advance >= 0, `line ${index} advance is finite`);
    previousEnd = end;
    previousGlyphEnd = glyphStart + glyphCount;
    previousBaseline = baseline;
  }
  assert.equal(previousGlyphEnd, layout.glyphIds.length, 'line glyph ranges cover the positioned output');
}

function assertAlignmentOffsets(start, center, end, width) {
  for (let line = 0; line < start.lineGlyphStarts.length; line += 1) {
    const glyph = start.lineGlyphStarts[line];
    if (glyph === undefined || start.lineGlyphCounts[line] === 0) continue;
    const naturalX = start.x[glyph];
    const advance = start.lineAdvances[line];
    assertClose(center.x[glyph] - naturalX, (width - advance) / 2, `center line ${line}`);
    assertClose(end.x[glyph] - naturalX, width - advance, `end line ${line}`);
  }
}

function assertClose(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 0.0001, `${label}: ${actual} != ${expected}`);
}
