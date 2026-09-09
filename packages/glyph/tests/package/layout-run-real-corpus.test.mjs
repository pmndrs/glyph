import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { span, txt } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { loadFont } from '../../dist/loader.js';
import { createThreeTestHandle } from '../support/three-handle.mjs';
import { reconstructPostNarrowRelative, summarizeRealCorpusPlacement } from '../support/layout-run-real-corpus.mjs';

const fixtures = new URL('../../../../apps/benchmarks/fixtures/', import.meta.url);
const renderingFixtures = new URL('rendering/', fixtures);

test('real layouts bound the post-narrow observable-span representability experiment', async (t) => {
  const [latinContract, latinCases, cjkContract, bidiContract] = await Promise.all([
    readJson('contracts/paragraph-layout-v0.json'),
    readJson('shaping/inter-regular/cases.json'),
    readJson('contracts/paragraph-cjk-layout-v0.json'),
    readJson('contracts/paragraph-bidi-layout-v0.json'),
  ]);
  const paragraph = latinCases.cases.find(({ id }) => id === latinContract.shapingCase);
  assert.ok(paragraph, 'the Latin contract must name one pinned shaping case');
  const cjkCoverage = Object.values(cjkContract.cases)
    .map(({ text }) => text)
    .join('')
    .replace(/[\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu, '');

  const [inter, cjk, amiri] = await Promise.all([
    loadFixtureFont('inter-bitmap-16-32.font.glb', [16, 32]),
    loadFixtureFont('noto-sans-cjk-contract-bitmap-16.font.glb', [16], cjkCoverage),
    loadFixtureFont('amiri-bitmap-16-32.font.glb', [16, 32]),
  ]);
  t.after(() => {
    inter.dispose();
    cjk.dispose();
    amiri.dispose();
  });

  const three = await createThreeTestHandle(t);
  const small = span({ fontSize: 16 });
  const large = span({ fontSize: 32 });
  const cases = [
    {
      name: 'latin',
      font: inter,
      text: paragraph.text,
      style: latinContract.style,
      constraints: { width: { mode: 'exact', size: latinContract.constraints[1].width } },
      layout: { wrap: 'word' },
    },
    {
      name: 'cjk',
      font: cjk,
      text: cjkContract.cases.simplified.text,
      style: cjkContract.cases.simplified.style,
      constraints: { width: { mode: 'exact', size: cjkContract.constraints.narrow.width.size } },
      layout: { wrap: 'word' },
    },
    {
      name: 'bidi',
      font: amiri,
      text: bidiContract.bidi.ltr.text,
      style: bidiContract.bidi.ltr.style,
      constraints: { width: { mode: 'exact', size: bidiContract.bidi.ltr.constraints.width.size } },
      layout: { align: 'start', wrap: 'word' },
    },
    {
      name: 'justified',
      font: inter,
      text: paragraph.text,
      style: latinContract.style,
      constraints: { width: { mode: 'exact', size: latinContract.constraints[0].width } },
      layout: { align: 'justify', lastLine: 'justify', wrap: 'word' },
    },
    {
      name: 'combining',
      font: inter,
      text: 'f\u0301',
      style: latinContract.style,
    },
    {
      name: 'mixed-size',
      font: inter,
      text: txt`${small`A`}${large`B`}`,
      style: latinContract.style,
    },
  ];

  const summaries = {};
  for (const entry of cases) {
    const node = three.createText(entry);
    t.after(() => node.dispose());
    const layout = node.glyphs();
    assert.equal(layout.missingGlyphCount, 0, `${entry.name} must shape without .notdef glyphs`);
    if (entry.name === 'combining') assert.deepEqual(Array.from(layout.clusters), [0, 0]);
    summaries[entry.name] = summarizeRealCorpusPlacement(layout);
  }

  assert.deepEqual(summaries, EXPECTED_SUMMARIES);
  assert.equal(reconstructPostNarrowRelative(1, -16_777_216), 0, 'the experiment must detect cancellation');
  assert.throws(() => reconstructPostNarrowRelative(Number.NaN, 0), /must be finite/);
  assert.throws(
    () => reconstructPostNarrowRelative(3.4028234663852886e38, -3.4028234663852886e38),
    /must fit finite f32/,
  );
});

const EXPECTED_SUMMARIES = {
  latin: {
    glyphs: 55,
    clusters: 55,
    lines: 3,
    slices: 3,
    maximumGlyphsPerSlice: 25,
    coordinateRange: {
      minimumX: 0,
      maximumX: 347.546875,
      minimumY: 32.44062423706055,
      maximumY: 115.640625,
    },
    candidates: exactCandidates(110),
  },
  cjk: {
    glyphs: 35,
    clusters: 35,
    lines: 5,
    slices: 5,
    maximumGlyphsPerSlice: 8,
    coordinateRange: {
      minimumX: 0,
      maximumX: 224,
      minimumY: 33.95199966430664,
      maximumY: 193.95199584960938,
    },
    candidates: exactCandidates(70),
  },
  bidi: {
    glyphs: 17,
    clusters: 17,
    lines: 2,
    slices: 5,
    maximumGlyphsPerSlice: 6,
    coordinateRange: {
      minimumX: 0,
      maximumX: 239.16000366210938,
      minimumY: 34.79999923706055,
      maximumY: 84.80000305175781,
    },
    candidates: exactCandidates(34),
  },
  justified: {
    glyphs: 55,
    clusters: 55,
    lines: 2,
    slices: 2,
    maximumGlyphsPerSlice: 46,
    coordinateRange: {
      minimumX: 0,
      maximumX: 720,
      minimumY: 32.44062423706055,
      maximumY: 74.04061889648438,
    },
    candidates: exactCandidates(110),
  },
  combining: {
    glyphs: 2,
    clusters: 1,
    lines: 1,
    slices: 1,
    maximumGlyphsPerSlice: 2,
    coordinateRange: {
      minimumX: 0,
      maximumX: 2.515625,
      minimumY: 25.659374237060547,
      maximumY: 32.44062423706055,
    },
    candidates: exactCandidates(4),
  },
  'mixed-size': {
    glyphs: 2,
    clusters: 2,
    lines: 1,
    slices: 2,
    maximumGlyphsPerSlice: 1,
    coordinateRange: {
      minimumX: 0,
      maximumX: 11.0390625,
      minimumY: 32.44062423706055,
      maximumY: 32.44062423706055,
    },
    candidates: exactCandidates(4),
  },
};

function exactCandidates(coordinates) {
  return {
    postNarrowLineRelative: { coordinates, bitMismatches: 0, maximumAbsoluteError: 0, maximumUlpError: 0 },
    postNarrowSliceRelative: { coordinates, bitMismatches: 0, maximumAbsoluteError: 0, maximumUlpError: 0 },
  };
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, fixtures), 'utf8'));
}

async function loadFixtureFont(file, strikes, coverage) {
  return loadFont(
    { baked: { bytes: await readFile(new URL(file, renderingFixtures)), ownership: 'copy' } },
    bitmap({ strikes, ...(coverage === undefined ? {} : { coverage: { text: coverage } }) }),
  );
}
