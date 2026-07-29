import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createParagraphEngine, createRuntimeShaper, FontRegistry } from '@pmndrs/text';
import { createFontBaker } from '@pmndrs/text-font-baker';
import { graphemeSegments } from 'unicode-segmenter/grapheme';

import { hashParagraphLayout } from '../../../../apps/benchmarks/src/benchmark/paragraph-layout-digest.ts';

const fixtureRoot = new URL('../../../../apps/benchmarks/fixtures/', import.meta.url);
const fontUrl = new URL('fonts/noto-sans-cjk-2.004/NotoSansCJKjp-Regular.otf', fixtureRoot);
const contractUrl = new URL('contracts/paragraph-cjk-layout-v0.json', fixtureRoot);
const oracleUrl = new URL('shaping/noto-sans-cjk/harfrust.json', fixtureRoot);
const layoutFields = [
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
];

test('proves CJK shaping and paragraph universality through the public pipeline', async () => {
  const [source, contract, oracle, bakerWasm, shaperWasm] = await Promise.all([
    readFile(fontUrl),
    readJson(contractUrl),
    readJson(oracleUrl),
    readFile(new URL('../../../font-baker/dist/font_baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  ]);
  assert.equal(createHash('sha256').update(source).digest('hex'), contract.font.sourceSha256);

  const baker = await createFontBaker(bakerWasm);
  const baked = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  const artifact = baked.artifacts[0];
  assert.ok(artifact);
  assert.equal(artifact.sha256, contract.font.artifactSha256);

  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact.bytes);
  assert.equal(font.shapingHash, contract.font.shapingHash);
  const shaper = await createRuntimeShaper({ registry, wasm: shaperWasm });
  shaper.registerFont(font);

  const localizedGlyphs = assertOracleShaping(shaper, font.handle, oracle);
  assert.notDeepEqual(localizedGlyphs.get('zh-Hans'), localizedGlyphs.get('zh-Hant'));
  assert.notDeepEqual(localizedGlyphs.get('zh-Hans'), localizedGlyphs.get('ja'));
  assert.deepEqual(localizedGlyphs.get('ja'), localizedGlyphs.get('ko'));

  const calls = { shape: 0, reshape: 0 };
  const requests = [];
  const observed = observeShaper(shaper, calls, requests);
  const engine = createParagraphEngine({ shaper: observed });
  const retained = [];

  for (const [caseId, expected] of Object.entries(contract.cases)) {
    const before = { ...calls };
    const requestStart = requests.length;
    const paragraph = engine.create({
      text: expected.text,
      font: font.handle,
      style: expected.style,
    });
    const preparationRequests = requests.slice(requestStart);
    assertContextualRuns(caseId, expected, preparationRequests);

    for (const constraintId of ['natural', 'wide', 'narrow']) {
      const constraints = contract.constraints[constraintId];
      const measurement = paragraph.measure(constraints);
      const layout = paragraph.layout(constraints);
      const golden = expected.layouts[constraintId];
      assert.equal(paragraph.measure(constraints), measurement, `${caseId}.${constraintId} measure`);
      assert.equal(paragraph.layout(constraints), layout, `${caseId}.${constraintId} layout`);
      assertEquivalentMeasurement(measurement, layout, `${caseId}.${constraintId} measurement`);
      assertGoldenLayout(layout, golden, `${caseId}.${constraintId}`);
      assertSafeBoundaries(expected.text, layout, `${caseId}.${constraintId}`);
      retained.push({ label: `${caseId}.${constraintId}`, layout, hash: golden.hash });
    }

    assert.deepEqual(
      { shape: calls.shape - before.shape, reshape: calls.reshape - before.reshape },
      expected.calls,
      `${caseId} boundary calls`,
    );
    paragraph.dispose();
  }

  const boundaryText = '甲\u{2000B}、\u{FE00}。\u{FE01}禰\u{E0100}한';
  const boundaryParagraph = engine.create({
    text: boundaryText,
    font: font.handle,
    style: { fontSize: 32, language: 'ja' },
  });
  const boundaryLayout = boundaryParagraph.layout({
    width: { mode: 'exactly', size: 64 },
    wrap: 'word',
  });
  assertSafeBoundaries(boundaryText, boundaryLayout, 'supplementary/SVS/IVS/Jamo boundary probe');
  boundaryParagraph.dispose();

  const interference = engine.create({
    text: '骨直辺',
    font: font.handle,
    style: { language: 'zh-hant' },
  });
  interference.layout({ width: { mode: 'exactly', size: 40 }, wrap: 'word' });
  for (const { label, layout, hash } of retained) {
    assert.equal(hashParagraphLayout(layout), hash, `${label} owns its positioned result`);
  }

  interference.dispose();
  shaper.dispose();
  font.dispose();
});

function assertOracleShaping(shaper, fontHandle, oracle) {
  const localized = new Map();
  for (const expected of oracle.cases) {
    const textUtf16 = utf16(expected.text);
    const shaped = shaper.shapeBatch({
      textUtf16,
      features: [],
      runs: [
        {
          font: fontHandle,
          textStart: 0,
          textEnd: textUtf16.length,
          direction: expected.segment.direction,
          script: expected.segment.script,
          language: expected.segment.language,
          clusterLevel: 0,
          flags: 0x40,
          featureStart: 0,
          featureCount: 0,
        },
      ],
    });
    assert.deepEqual([...shaped.fontHandles], [fontHandle], expected.id);
    assert.deepEqual([...shaped.runGlyphStarts], [0], expected.id);
    assert.deepEqual([...shaped.runGlyphCounts], [expected.glyphs.length], expected.id);
    assert.deepEqual(
      {
        glyphIds: [...shaped.glyphIds],
        clusters: [...shaped.clusters],
        xAdvances: [...shaped.xAdvances],
        yAdvances: [...shaped.yAdvances],
        xOffsets: [...shaped.xOffsets],
        yOffsets: [...shaped.yOffsets],
        glyphFlags: [...shaped.glyphFlags],
      },
      {
        glyphIds: expected.glyphs.map(({ glyphId }) => glyphId),
        clusters: expected.glyphs.map(({ cluster }) => cluster),
        xAdvances: expected.glyphs.map(({ xAdvance }) => xAdvance),
        yAdvances: expected.glyphs.map(({ yAdvance }) => yAdvance),
        xOffsets: expected.glyphs.map(({ xOffset }) => xOffset),
        yOffsets: expected.glyphs.map(({ yOffset }) => yOffset),
        glyphFlags: expected.glyphs.map(({ flags }) => flags),
      },
      expected.id,
    );
    if (expected.id.startsWith('locl-')) {
      localized.set(expected.segment.language, [...shaped.glyphIds]);
    }
  }
  return localized;
}

function assertContextualRuns(caseId, expected, requests) {
  assert.equal(requests.length, 1, `${caseId} uses one broad shape request`);
  const request = requests[0];
  const boundaries = graphemeBoundaries(expected.text);
  const contentRuns = request.runs.filter(({ textStart }) => textStart < expected.text.length);
  assert.ok(contentRuns.length > 0, `${caseId} has content runs`);
  for (const run of contentRuns) {
    assert.equal(run.language, expected.style.language, `${caseId} language`);
    assert.equal(boundaries.has(run.textStart), true, `${caseId} run start ${run.textStart}`);
    assert.equal(boundaries.has(run.textEnd), true, `${caseId} run end ${run.textEnd}`);
    assert.notEqual(run.script, 'Bopo', `${caseId} must not assign punctuation to Bopomofo`);
  }
  const scripts = new Set(contentRuns.map(({ script }) => script));
  const required = {
    simplified: ['Hani'],
    japanese: ['Hani', 'Hira'],
    korean: ['Hani', 'Hang'],
    mixed: ['Hani', 'Hang', 'Hira', 'Latn'],
  }[caseId];
  assert.deepEqual(scripts, new Set(required), `${caseId} contextual scripts`);
}

function assertGoldenLayout(layout, golden, label) {
  assert.deepEqual(measurementOf(layout), golden.measurement, `${label} layout measurement`);
  for (const field of layoutFields) {
    assert.deepEqual([...layout[field]], golden[field], `${label}.${field}`);
  }
  assert.equal(hashParagraphLayout(layout), golden.hash, `${label} hash`);
  for (const value of [
    layout.width,
    layout.height,
    layout.contentWidth,
    layout.contentHeight,
    layout.firstBaseline,
    layout.lastBaseline,
    ...layout.x,
    ...layout.y,
    ...layout.lineBaselines,
    ...layout.lineAdvances,
  ]) {
    assert.equal(Number.isFinite(value), true, `${label} finite geometry`);
  }
}

function assertSafeBoundaries(text, layout, label) {
  const boundaries = graphemeBoundaries(text);
  for (const [kind, offsets] of [
    ['cluster', layout.clusters],
    ['line start', layout.lineTextStarts],
    ['line end', layout.lineTextEnds],
  ]) {
    for (const offset of offsets) {
      assert.equal(boundaries.has(offset), true, `${label} ${kind} ${offset} is grapheme-safe`);
      assert.equal(isUtf16Boundary(text, offset), true, `${label} ${kind} ${offset} is UTF-16-safe`);
    }
  }
}

function observeShaper(shaper, calls, requests) {
  return {
    registry: shaper.registry,
    registerFont: (font) => shaper.registerFont(font),
    disposeFont: (font) => shaper.disposeFont(font),
    analyzeBidi: (text, direction) => shaper.analyzeBidi(text, direction),
    shapeBatch: (request) => {
      calls.shape += 1;
      requests.push(request);
      return shaper.shapeBatch(request);
    },
    reshapeRanges: (request) => {
      calls.reshape += 1;
      return shaper.reshapeRanges(request);
    },
    memoryReport: () => shaper.memoryReport(),
    dispose: () => shaper.dispose(),
  };
}

function measurementOf(layout) {
  return {
    width: layout.width,
    height: layout.height,
    contentWidth: layout.contentWidth,
    contentHeight: layout.contentHeight,
    firstBaseline: layout.firstBaseline,
    lastBaseline: layout.lastBaseline,
    overflowed: layout.overflowed,
  };
}

function assertEquivalentMeasurement(measurement, layout, label) {
  assert.equal(measurement.overflowed, layout.overflowed, `${label}.overflowed`);
  for (const field of ['width', 'height', 'contentWidth', 'contentHeight', 'firstBaseline', 'lastBaseline']) {
    assert.ok(Math.abs(measurement[field] - layout[field]) < 0.0001, `${label}.${field}`);
  }
}

function graphemeBoundaries(text) {
  const boundaries = new Set([0]);
  for (const segment of graphemeSegments(text)) {
    boundaries.add(segment.index + segment.segment.length);
  }
  return boundaries;
}

function isUtf16Boundary(text, offset) {
  if (offset === 0 || offset === text.length) return true;
  const previous = text.charCodeAt(offset - 1);
  const current = text.charCodeAt(offset);
  return !(previous >= 0xd800 && previous <= 0xdbff && current >= 0xdc00 && current <= 0xdfff);
}

function utf16(text) {
  return Uint16Array.from({ length: text.length }, (_, index) => text.charCodeAt(index));
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
