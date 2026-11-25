/**
 * What a caller's Three material learns about each glyph: `glyphIndex` and `glyphOrigin`. Every record a draw holds
 * must carry the index `Text.glyphs()` reports its glyph at and that glyph's pen origin, for every raster format.
 */
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';

import { createFontLibrary } from '../../dist/loader.js';
import { bitmap, msdf, slug, txt } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig as defineStableThreeConfig, span } from '@pmndrs/glyph/three';
import { defineThreeConfig as defineTypeGpuThreeConfig } from '@pmndrs/glyph/three/typegpu';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { compileNodeMaterialBackends } from '../support/node-material-shaders.mjs';
import { threeSystemBuffers } from '../../dist/three/codec.js';
import { drawnGlyphFacts } from '../support/three-glyph-facts.mjs';
import { createThreeTestHandle } from '../support/three-handle.mjs';
import { assertCommitted } from '../support/three-render.mjs';

const fixtures = new URL('../../../../benches/fixtures/rendering/', import.meta.url);
const baked = async (file) => {
  const bytes = await readFile(new URL(file, fixtures));
  return { baked: { bytes: file.endsWith('.gz') ? gunzipSync(bytes) : bytes } };
};
/** Amiri shapes Arabic and applies `liga` to Latin f-pairs; Inter is the second font of a mixed text. */
const SOURCES = {
  'pmndrs.bitmap': {
    raster: bitmap({ strikes: [16] }),
    amiri: 'amiri-bitmap-16.font.glb',
    inter: 'inter-bitmap-16.font.glb',
  },
  'pmndrs.msdf': { raster: msdf, amiri: 'amiri-mtsdf.font.glb.gz', inter: 'inter-mtsdf.font.glb.gz' },
  'pmndrs.slug': { raster: slug, amiri: 'amiri-slug.font.glb.gz', inter: 'inter-slug.font.glb.gz' },
};
/** One font per fixture for the file's lifetime; the Amiri MSDF artifact is larger than the default loader limit. */
const library = createFontLibrary({ maxArtifactBytes: 128 * 1024 * 1024 });
const loaded = new Map();
after(() => library.dispose());
function fixtureFont(format, name) {
  const key = `${format}:${name}`;
  let cached = loaded.get(key);
  if (cached === undefined) {
    const source = SOURCES[format];
    cached = baked(source[name]).then((input) => library.loadFont(input, source.raster));
    loaded.set(key, cached);
  }
  return cached;
}
const FORMATS = Object.fromEntries(
  Object.keys(SOURCES).map((format) => [
    format,
    { amiri: () => fixtureFont(format, 'amiri'), inter: () => fixtureFont(format, 'inter') },
  ]),
);
/** Glyph facts are published only by a handle that asks for them. */
const FACTS_CONFIG = defineStableThreeConfig({ glyphFacts: true });
const ARABIC = 'سلام عليكم';

/** A material that changes nothing and keeps every context it was given. */
function recordingMaterial() {
  const contexts = [];
  const material = defineTextMaterial((context) => {
    contexts.push(context);
    return context.createDefaultMaterial();
  });
  return { contexts, material };
}

function mount(three, options) {
  const scene = new THREE.Scene();
  const label = three.createText(options);
  scene.add(label);
  scene.updateMatrixWorld();
  assertCommitted(label);
  return { label, scene };
}

/**
 * Holds every drawn record to the inspection: its index is the position of its stable identity in `glyphs()`, and its
 * origin is that glyph's pen origin. Returns the facts in index order with their inspection columns beside them.
 */
function assertFactsMatchInspection(object, contexts, layout, where) {
  const glyphContext = contexts.find((context) => context.kind === 'glyph');
  assert.ok(glyphContext, `${where}: a glyph draw must reach the material factory`);
  const facts = drawnGlyphFacts(object, glyphContext.glyphOrigin);
  const indexOf = new Map([...layout.glyphStableIds].map((stableId, index) => [stableId, index]));
  assert.equal(indexOf.size, layout.glyphCount, `${where}: stable identities are distinct`);
  for (const fact of facts) {
    const expected = indexOf.get(fact.stableId);
    assert.notEqual(expected, undefined, `${where}: record ${fact.stableId} is a glyph of the inspection`);
    assert.equal(fact.index, expected, `${where}: glyph index of stable glyph ${fact.stableId}`);
    assert.ok(Math.abs(fact.x - layout.x[expected]) < 1e-3, `${where}: origin x of glyph ${expected}`);
    assert.ok(Math.abs(fact.y - layout.y[expected]) < 1e-3, `${where}: origin y of glyph ${expected}`);
  }
  const drawn = facts.toSorted((left, right) => left.index - right.index);
  assert.deepEqual(
    drawn.map((fact) => fact.index),
    [...new Set(drawn.map((fact) => fact.index))],
    `${where}: no two records share an index`,
  );
  return drawn.map((fact) => ({
    ...fact,
    cluster: layout.clusters[fact.index],
    level: layout.glyphBidiLevels[fact.index],
  }));
}

for (const [format, fonts] of Object.entries(FORMATS)) {
  test(`${format}: left-to-right glyphs count blanks, so drawn indices skip them`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, { font, material, text: 'To a wave' });
    const layout = label.glyphs();
    assert.equal(layout.glyphCount, 9);
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    // The spaces at 2 and 4 are glyphs of the layout that no draw holds.
    assert.deepEqual(
      drawn.map((fact) => fact.index),
      [0, 1, 3, 5, 6, 7, 8],
    );
    assert.deepEqual(
      drawn.map((fact) => fact.x),
      drawn.map((fact) => fact.x).toSorted((left, right) => left - right),
      'left-to-right indices ascend with x',
    );
    label.dispose();
  });

  test(`${format}: a ligature is one glyph with one index`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, { font, material, text: 'office' });
    const layout = label.glyphs();
    // "ffi" is one glyph over three characters: an index names a glyph, never a character.
    assert.deepEqual([...layout.clusters], [0, 1, 4, 5]);
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    assert.deepEqual(
      drawn.map((fact) => fact.index),
      [0, 1, 2, 3],
    );
    label.dispose();
  });

  test(`${format}: right-to-left glyphs are indexed in the order they are drawn`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, { font, material, text: `ab ${ARABIC} cd` });
    const layout = label.glyphs();
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    const arabic = drawn.filter((fact) => fact.level === 1);
    assert.ok(arabic.length >= 6, 'the Arabic run draws its letters');
    // Visual order: indices ascend left to right across the whole line, through the right-to-left run...
    assert.deepEqual(
      drawn.map((fact) => fact.x),
      drawn.map((fact) => fact.x).toSorted((left, right) => left - right),
    );
    // ...whose text therefore runs backwards against them.
    assert.deepEqual(
      arabic.map((fact) => fact.cluster),
      arabic.map((fact) => fact.cluster).toSorted((left, right) => right - left),
    );
    label.dispose();
  });

  test(`${format}: indices continue across lines`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, { font, material, text: `one two\n${ARABIC}\nsix` });
    const layout = label.glyphs();
    assert.equal(layout.lineCount, 3);
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    for (let line = 0; line < layout.lineCount; line += 1) {
      const start = layout.lineGlyphStarts[line];
      const end = start + layout.lineGlyphCounts[line];
      const onLine = drawn.filter((fact) => fact.index >= start && fact.index < end);
      assert.ok(onLine.length > 0, `line ${line} draws glyphs`);
      for (const fact of onLine) {
        assert.ok(Math.abs(fact.y - layout.lineBaselines[line]) < 1e-3, `glyph ${fact.index} sits on line ${line}`);
      }
    }
    label.dispose();
  });

  test(`${format}: indices continue from one column into the next`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const text = Array.from({ length: 12 }, (_, index) => `word${index}`).join(' ');
    const { label } = mount(three, {
      font,
      material,
      text,
      constraints: { width: { mode: 'exact', size: 240 }, height: { mode: 'exact', size: 80 } },
      layout: { columns: { count: 2, gap: 20 } },
    });
    const layout = label.glyphs();
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    // The second column starts to the right of the first and above where the first ended.
    const columnStart = drawn.findIndex((fact, index) => index > 0 && fact.y < drawn[index - 1].y - 1e-3);
    assert.ok(columnStart > 0, 'the text flows into a second column');
    assert.ok(drawn[columnStart].x > drawn[0].x + 100, 'the second column sits beside the first');
    assert.equal(drawn[columnStart].index, drawn[columnStart - 1].index + 2, 'only the blank between them is skipped');
    label.dispose();
  });

  test(`${format}: fonts that draw in separate batches share one index sequence`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const amiri = await fonts.amiri();
    const inter = await fonts.inter();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, { font: amiri, material, text: txt`ab${span(inter)`cd`}ef` });
    const layout = label.glyphs();
    const drawn = assertFactsMatchInspection(label.parent, contexts, layout, format);
    assert.deepEqual(
      drawn.map((fact) => fact.index),
      [0, 1, 2, 3, 4, 5],
    );
    // Each font is its own draw, so a draw's records are not a contiguous index range.
    assert.deepEqual(
      drawn.map((fact) => fact.draw),
      [drawn[0].draw, drawn[0].draw, drawn[2].draw, drawn[2].draw, drawn[0].draw, drawn[0].draw],
    );
    assert.notEqual(drawn[0].draw, drawn[2].draw);
    label.dispose();
  });

  test(`${format}: an edit that shifts later glyphs republishes their indices`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const lines = ['first line', 'second line', 'third line', 'fourth line'];
    const { label, scene } = mount(three, { font, material, text: lines.join('\n') });
    const { glyphCount } = label.glyphs();
    assertFactsMatchInspection(label.parent, contexts, label.glyphs(), `${format} before`);
    // One more blank on the first line: every later glyph keeps its record and its place but moves one index on.
    label.set({ text: ['first  line', ...lines.slice(1)].join('\n') });
    scene.updateMatrixWorld();
    assertCommitted(label);
    const spaced = label.glyphs();
    assert.equal(spaced.glyphCount, glyphCount + 1);
    assertFactsMatchInspection(label.parent, contexts, spaced, `${format} after a blank`);
    label.replace(0, 6, '');
    scene.updateMatrixWorld();
    assertCommitted(label);
    assertFactsMatchInspection(label.parent, contexts, label.glyphs(), `${format} after a deletion`);
    label.dispose();
  });

  test(`${format}: a decoration draw has no glyph facts`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label } = mount(three, {
      font,
      material,
      text: 'Ab',
      style: { decoration: { underline: true, color: '#ff0088' } },
    });
    const decoration = contexts.find((context) => context.kind === 'decoration');
    assert.ok(decoration, 'the underline reaches the material factory');
    assert.equal('glyphIndex' in decoration, false);
    assert.equal('glyphOrigin' in decoration, false);
    assertFactsMatchInspection(label.parent, contexts, label.glyphs(), format);
    label.dispose();
  });

  test(`${format}: split() glyphs keep the index and origin they had in their text`, async (t) => {
    const three = await createThreeTestHandle(t, FACTS_CONFIG);
    const font = await fonts.amiri();
    const { contexts, material } = recordingMaterial();
    const { label, scene } = mount(three, { font, material, text: `To a ${ARABIC}` });
    const layout = label.glyphs();
    const source = contexts.length;
    const [glyphs] = label.split();
    scene.add(glyphs);
    scene.updateMatrixWorld();
    // The copy realizes its own materials, so its contexts read its own lanes and placement table.
    const copied = contexts.slice(source);
    const drawn = assertFactsMatchInspection(glyphs, copied, layout, `${format} split`);
    assert.equal(drawn.length, glyphs.count);
    // A later edit of the source moves nothing in the copy.
    label.set({ text: 'changed' });
    scene.updateMatrixWorld();
    assertCommitted(label);
    assertFactsMatchInspection(glyphs, copied, layout, `${format} split after its source changed`);
    glyphs.dispose();
    label.dispose();
  });
}

test('a handle that does not ask for glyph facts publishes neither lane and refuses a material that reads one', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await FORMATS['pmndrs.bitmap'].amiri();
  const { contexts, material } = recordingMaterial();
  const { label, scene } = mount(three, { font, material, text: 'Ab' });
  const draw = scene.getObjectByName('@pmndrs/glyph:anonymous').children.find((child) => child.isMesh);
  assert.equal(draw.geometry.getAttribute(`_pmndrsGlyph_${threeSystemBuffers.glyphFacts.id}`), undefined);
  const [context] = contexts;
  assert.equal(context.kind, 'glyph');
  assert.throws(() => context.glyphIndex, /glyphIndex.*defineThreeConfig\(\{ glyphFacts: true \}\)/);
  assert.throws(() => context.glyphOrigin, /glyphOrigin.*defineThreeConfig\(\{ glyphFacts: true \}\)/);
  assert.throws(() => defineStableThreeConfig({ glyphFacts: 1 }), /glyphFacts must be a boolean/);
  label.dispose();
});

const shaderConfigs = { stable: defineStableThreeConfig, typegpu: defineTypeGpuThreeConfig };

for (const shaders of ['stable', 'typegpu']) {
  for (const transformMode of ['direct', 'indexed']) {
    test(`glyph facts compile from either stage: ${shaders} shaders, ${transformMode} transforms`, async (t) => {
      const three = await createThreeTestHandle(t, shaderConfigs[shaders]({ transformMode, glyphFacts: true }));
      for (const [format, fonts] of Object.entries(FORMATS)) {
        const font = await fonts.amiri();
        const material = defineTextMaterial((context) => {
          const value = context.createDefaultMaterial();
          if (context.kind !== 'glyph') return value;
          const { glyphIndex, glyphOrigin, paragraphPosition, position } = context;
          // A per-glyph wave about each glyph's own origin in the vertex stage...
          const offset = paragraphPosition.sub(glyphOrigin);
          const phase = TSL.float(glyphIndex).mul(0.4);
          value.positionNode = position.add(offset.mul(phase.sin().mul(0.25)));
          // ...and both facts again in the fragment stage.
          value.colorNode = TSL.vec3(TSL.float(glyphIndex.mod(4)).div(4), glyphOrigin.x.fract(), glyphOrigin.y.fract());
          return value;
        });
        const scene = new THREE.Scene();
        const label = three.createText({ font, material, text: 'Ab' });
        scene.add(label);
        scene.updateMatrixWorld();
        assertCommitted(label);
        const draws = scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
        assert.equal(draws.length, 1);
        const stages = compileNodeMaterialBackends(draws[0], { scene });
        const where = `${format} ${shaders} ${transformMode}`;
        // The fragment stage receives the index as a flat integer varying on both backends.
        assert.match(stages.webgpu.fragment, /@interpolate\(\s*flat[^)]*\)[^;]*:\s*u32/, `${where} WGSL flat index`);
        assert.match(stages.webgl2.fragment, /flat in uint /, `${where} GLSL flat index`);
        for (const [backend, { vertex, fragment }] of Object.entries(stages)) {
          for (const source of [vertex, fragment]) {
            assert.doesNotMatch(source, /null\./, `${where} ${backend} lowered a builtin to null`);
            assert.doesNotMatch(source, /,\s*\)/, `${where} ${backend} lowered a builtin to an empty argument`);
          }
        }
        label.dispose();
      }
    });
  }
}

for (const shaders of ['stable', 'typegpu']) {
  for (const transformMode of ['direct', 'indexed']) {
    test(`a displacement by position moves a decoration with its glyphs: ${shaders} shaders, ${transformMode} transforms`, async (t) => {
      const three = await createThreeTestHandle(t, shaderConfigs[shaders]({ transformMode }));
      for (const [format, fonts] of Object.entries(FORMATS)) {
        const font = await fonts.amiri();
        const kinds = [];
        // One function of position, written once, for whatever the factory is asked to draw.
        const displaced = defineTextMaterial((context) => {
          kinds.push(context.kind);
          const value = context.createDefaultMaterial();
          value.positionNode = context.position.add(TSL.vec3(0, context.position.x.mul(0.4375).sin().mul(3.25), 0));
          return value;
        });
        const scene = new THREE.Scene();
        const options = { font, text: 'Ab', style: { decoration: { underline: true, color: '#ff0088' } } };
        const label = three.createText({ ...options, material: displaced });
        const plain = three.createText(options);
        scene.add(label, plain);
        scene.updateMatrixWorld();
        assertCommitted(label);
        assert.deepEqual(kinds.toSorted(), ['decoration', 'glyph'], `${format}: the factory draws both`);
        const draws = scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
        assert.equal(draws.length, 4, `${format}: a glyph and a decoration draw per text`);
        let moved = 0;
        for (const draw of draws) {
          const { webgpu, webgl2 } = compileNodeMaterialBackends(draw, { scene });
          // The displacement's two constants reach the vertex stage of exactly the draws the factory made.
          const carries = [webgpu.vertex, webgl2.vertex].map(
            (source) => source.includes('0.4375') && source.includes('3.25') && /sin\s*\(/.test(source),
          );
          assert.equal(carries[0], carries[1], `${format}: both backends agree`);
          moved += carries[0] ? 1 : 0;
        }
        assert.equal(moved, 2, `${format}: the glyph draw and the decoration draw carry the same displacement`);
        label.dispose();
        plain.dispose();
      }
    });
  }
}
