import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadFont } from '../../dist/loader.js';
import { bitmap, msdf, slug } from '@pmndrs/glyph';
import { defineTextMaterial, defineThreeConfig as defineStableThreeConfig } from '@pmndrs/glyph/three';
import { defineThreeConfig as defineTypeGpuThreeConfig } from '@pmndrs/glyph/three/typegpu';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';
import { compileNodeMaterialBackends, compiledNodeMaterialTextures } from '../support/node-material-shaders.mjs';
import { assertCommitted } from '../support/three-render.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const msdfFontUrl = new URL('../../../../benches/fixtures/rendering/inter-mtsdf.font.glb.gz', import.meta.url);
const slugFontUrl = new URL('../../../../benches/fixtures/rendering/inter-slug.font.glb.gz', import.meta.url);

const loadFormatFont = {
  'pmndrs.bitmap': async () => loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] })),
  'pmndrs.msdf': async () => loadFont({ baked: { bytes: gunzipSync(await readFile(msdfFontUrl)) } }, msdf),
  'pmndrs.slug': async () => loadFont({ baked: { bytes: gunzipSync(await readFile(slugFontUrl)) } }, slug),
};
const shaderConfigs = { stable: defineStableThreeConfig, typegpu: defineTypeGpuThreeConfig };

test('Slug material positions stay vertex-computed when a composed fragment reads both coordinate spaces', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFormatFont['pmndrs.slug']();
  const contexts = [];
  const material = defineTextMaterial((context) => {
    contexts.push(context);
    const composed = context.createDefaultMaterial();
    composed.colorNode = TSL.vec3(context.position.x, context.paragraphPosition.y, 0);
    return composed;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'A' });
  scene.add(label);
  scene.updateMatrixWorld();

  assertCommitted(label);
  assert.equal(contexts.length, 1);
  const draw = rootDraws(scene)[0];
  assert.ok(draw, 'a real Slug draw must reach material realization');
  for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(draw, { scene }))) {
    assert.match(stages.vertex, /pmndrsSlugRenderCoordinate/);
    assert.match(stages.fragment, /pmndrsSlugRenderCoordinate/);
    assert.doesNotMatch(
      stages.fragment,
      /pmndrsSlugRenderCoordinate\s*=/,
      `${backend} must consume Slug's interpolated coordinate without assigning a fragment input`,
    );
  }

  label.dispose();
  font.dispose();
});

test('Slug coverageAt evaluated beside the default coverage declares each variable once', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFormatFont['pmndrs.slug']();
  const material = defineTextMaterial((context) => {
    const composed = context.createDefaultMaterial();
    const { shader } = context;
    const shifted = shader.coverageAt(shader.renderCoordinate.add(TSL.vec2(0.01, 0)));
    const lifted = shader.coverageAt(shader.renderCoordinate.add(TSL.vec2(0, 0.01)));
    composed.opacityNode = shader.coverage.add(shifted).add(lifted).div(3);
    return composed;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'A' });
  scene.add(label);
  scene.updateMatrixWorld();
  assertCommitted(label);
  const draw = rootDraws(scene)[0];
  assert.ok(draw, 'a real Slug draw must reach material realization');

  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  let stages;
  try {
    stages = compileNodeMaterialBackends(draw, { scene });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(
    warnings.filter((message) => message.includes('already in use')),
    [],
    'three coverage evaluations must not collide on declaration names',
  );
  for (const [backend, { fragment }] of Object.entries(stages)) {
    for (const name of ['slugSample', 'slugSampleAt1', 'slugSampleAt2']) {
      assert.match(fragment, new RegExp(`\\b${name}\\b`), `${backend} keeps a readable name for each evaluation`);
    }
  }

  label.dispose();
  font.dispose();
});

// Each built-in glyph format with an underline, so the decoration program is realized beside it.
for (const shaders of ['stable', 'typegpu']) {
  for (const transformMode of ['direct', 'indexed']) {
    test(`custom material positions compile from either stage: ${shaders} shaders, ${transformMode} transforms`, async (t) => {
      const three = await createThreeTestHandle(t, shaderConfigs[shaders]({ transformMode }));
      for (const [format, load] of Object.entries(loadFormatFont)) {
        const font = await load();
        const realized = [];
        const material = defineTextMaterial((context) => {
          realized.push(context.kind === 'glyph' ? context.format : context.kind);
          const value = context.createDefaultMaterial();
          const { position, paragraphPosition } = context;
          // A displacement reads the draw-local position twice in the vertex stage...
          value.positionNode = position.add(TSL.vec3(position.y.sin().mul(0.12), 0, 0));
          // ...while the colour reads both spaces in the fragment stage.
          value.colorNode = TSL.vec3(position.x.fract(), paragraphPosition.y.fract(), paragraphPosition.x.fract());
          return value;
        });
        const scene = new THREE.Scene();
        const label = three.createText({
          font,
          material,
          text: 'Ab',
          style: { decoration: { underline: true, color: '#ff0088' } },
        });
        scene.add(label);
        scene.updateMatrixWorld();
        assertCommitted(label);
        assert.deepEqual(realized.sort(), ['decoration', format]);
        const draws = rootDraws(scene);
        assert.equal(draws.length, 2);
        for (const draw of draws) {
          for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(draw, { scene }))) {
            const where = `${format} ${backend}`;
            assert.doesNotMatch(stages.fragment, /pmndrsSlugRenderCoordinate\s*=/, `${where} assigns a fragment input`);
            for (const source of [stages.vertex, stages.fragment]) {
              // A TypeGPU builtin lost across the stage boundary lowers to `null` or an empty argument in GLSL.
              assert.doesNotMatch(source, /null\./, `${where} lowered a builtin to null`);
              assert.doesNotMatch(source, /,\s*\)/, `${where} lowered a builtin to an empty argument`);
            }
          }
        }
        label.dispose();
        font.dispose();
      }
    });
  }
}

test('TypeGPU-backed default Bitmap and decoration positions compile for both Three backends', async (t) => {
  const font = await loadFormatFont['pmndrs.bitmap']();
  try {
    for (const transformMode of ['direct', 'indexed']) {
      await t.test(transformMode, async (subtest) => {
        const three = await createThreeTestHandle(subtest, defineTypeGpuThreeConfig({ transformMode }));
        const scene = new THREE.Scene();
        const label = three.createText({
          font,
          text: 'Default',
          style: { decoration: { underline: true, color: '#ff0088' } },
        });
        scene.add(label);
        scene.updateMatrixWorld();
        assertCommitted(label);
        const draws = rootDraws(scene);
        assert.equal(draws.length, 2);
        const vertices = draws.map((draw) => {
          const stages = compileNodeMaterialBackends(draw, { scene });
          assert.ok(stages.webgpu.vertex.length > 0);
          return stages.webgl2.vertex;
        });
        assert.ok(vertices.some((vertex) => vertex.includes('bitmapQuadPosition')));
        assert.ok(vertices.some((vertex) => vertex.includes('decorationPosition')));
        for (const vertex of vertices) {
          assert.doesNotMatch(vertex, /null\./, 'a vertex builtin must not lower to null');
          assert.doesNotMatch(vertex, /,\s*\)/, 'a vertex builtin must not lower to an empty argument');
        }
        label.dispose();
      });
    }
  } finally {
    font.dispose();
  }
});

test('Bitmap page filtering is a handle-wide texture filter that leaves the default programs unchanged', async (t) => {
  const font = await loadFormatFont['pmndrs.bitmap']();
  try {
    for (const [name, defineConfig] of Object.entries(shaderConfigs)) {
      await t.test(name, async (subtest) => {
        assert.throws(() => defineConfig({ bitmapFilter: 'point' }), /bitmapFilter must be "linear" or "nearest"/);
        const realize = async (options) => {
          const three = await createThreeTestHandle(subtest, defineConfig(options));
          const scene = new THREE.Scene();
          // A scaled strike: 24 px drawn from the 16 px page, where the two filters read different texels.
          const label = three.createText({ font, text: 'Ag', style: { fontSize: 24 } });
          scene.add(label);
          scene.updateMatrixWorld();
          assertCommitted(label);
          subtest.after(() => label.dispose());
          const draws = rootDraws(scene);
          assert.equal(draws.length, 1);
          const pages = (backend) =>
            compiledNodeMaterialTextures(draws[0], { scene, backend }).filter(
              (texture) => texture.format === THREE.RedFormat,
            );
          const page = pages('webgpu');
          assert.equal(page.length, 1, 'the program binds one Bitmap page texture');
          assert.deepEqual(pages('webgl2'), page);
          return { page: page[0], stages: compileNodeMaterialBackends(draws[0], { scene }) };
        };
        const implicit = await realize({});
        const linear = await realize({ bitmapFilter: 'linear' });
        const nearest = await realize({ bitmapFilter: 'nearest' });

        for (const { page } of [implicit, linear]) {
          assert.equal(page.magFilter, THREE.LinearFilter);
          assert.equal(page.minFilter, THREE.LinearFilter);
        }
        assert.equal(nearest.page.magFilter, THREE.NearestFilter);
        assert.equal(nearest.page.minFilter, THREE.NearestFilter);
        for (const { page } of [implicit, linear, nearest]) assert.equal(page.generateMipmaps, false);
        // The same baked page under two filters is two textures over the same bytes: a Three texture owns its sampler.
        assert.notEqual(nearest.page, implicit.page);
        assert.deepEqual(nearest.page.image.data, implicit.page.image.data);
        // Node ids count every node the process has built, so they are numbered apart from the program text.
        const program = (source) => source.replaceAll(/(NodeBuffer|nodeUniform|nodeVar|nodeVarying)_?\d+/g, '$1#');
        for (const backend of ['webgpu', 'webgl2']) {
          for (const stage of ['vertex', 'fragment']) {
            const expected = program(implicit.stages[backend][stage]);
            assert.equal(program(linear.stages[backend][stage]), expected, `${backend} ${stage}`);
          }
        }
        // WebGL2 reads a nearest texture through its sampler with the same program.
        for (const stage of ['vertex', 'fragment']) {
          assert.equal(program(nearest.stages.webgl2[stage]), program(implicit.stages.webgl2[stage]), stage);
        }
        // WebGPU: Three loads the texel of a texture filtered nearest both ways, at floor(clamped uv * size).
        const pageSample = /textureSample\(\s*nodeUniform\d+,\s*nodeUniform\d+_sampler/g;
        assert.equal(implicit.stages.webgpu.fragment.match(pageSample)?.length, 1);
        assert.doesNotMatch(implicit.stages.webgpu.fragment, /textureLoad\(/);
        assert.doesNotMatch(nearest.stages.webgpu.fragment, pageSample);
        assert.match(nearest.stages.webgpu.fragment, /textureLoad\(\s*nodeUniform\d+,[^;]*floor\(/);
      });
    }
  } finally {
    font.dispose();
  }
});

test('an undefined custom material result falls back to one retained default material', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFormatFont['pmndrs.bitmap']();
  let attempts = 0;
  const material = defineTextMaterial((context) => {
    attempts++;
    assert.equal(context.format, bitmap.id);
    assert.ok(context.paragraphPosition?.isNode);
    assert.ok(context.position?.isNode);
    return undefined;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'Fallback' });
  scene.add(label);
  scene.updateMatrixWorld();

  assertCommitted(label);
  const draw = rootDraws(scene)[0];
  assert.ok(draw?.material?.isNodeMaterial);
  assert.equal(attempts, 1);
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0]?.material, draw.material);
  assert.equal(attempts, 1);

  label.dispose();
  font.dispose();
});

test('a custom Three material composes over the Bitmap shader in the Rust command-buffer draw path', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const built = [];
  const material = defineTextMaterial((context) => {
    const composed = context.createDefaultMaterial();
    composed.colorNode = TSL.vec3(context.shader.color.r, 0, context.shader.color.b);
    built.push({ context, material: composed });
    return composed;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'Composed' });
  scene.add(label);
  scene.updateMatrixWorld();

  assertCommitted(label);
  const draws = rootDraws(scene);
  assert.equal(draws.length, 1, 'the Rust publication must produce one real custom-material draw');
  assert.equal(built.length, 1, 'the material factory must run once for one retained realization');
  const { context, material: realized } = built[0];
  assert.equal(context.kind, 'glyph');
  assert.equal(context.format, bitmap.id);
  assert.deepEqual(Object.keys(context.shader).sort(), [
    'atlasUv',
    'clipPosition',
    'color',
    'coverage',
    'opacity',
    'position',
  ]);
  for (const [name, node] of Object.entries(context.shader)) {
    assert.ok(node?.isNode === true, `canonical Bitmap output "${name}" must be a TSL node`);
  }
  assert.equal(draws[0].material, realized);

  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0], draws[0], 'an unchanged frame must retain the draw and material realization');
  assert.equal(built.length, 1);

  label.removeFromParent();
  label.dispose();
  font.dispose();
});

test('the same custom material factory may override a separate decoration realization', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const realizations = [];
  const material = defineTextMaterial((context) => {
    realizations.push(context.kind === 'glyph' ? context.format : context.kind);
    const realized = context.createDefaultMaterial();
    if (context.kind === 'decoration') realized.colorNode = context.shader.color.mul(0.5);
    return realized;
  });
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    material,
    text: 'Decorated',
    style: { decoration: { underline: true, color: '#ff0088' } },
  });
  scene.add(label);
  scene.updateMatrixWorld();

  assertCommitted(label);
  assert.deepEqual(realizations.sort(), ['decoration', 'pmndrs.bitmap']);
  const draws = rootDraws(scene);
  assert.equal(draws.length, 2, 'decoration and glyph programs retain separate material realizations');
  assert.equal(new Set(draws.map((draw) => draw.material)).size, 2);

  label.dispose();
  font.dispose();
});

test('Bitmap pixel snapping is an explicit opt-in graph specialization', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const clipPositions = [];
  const material = defineTextMaterial((context) => {
    clipPositions.push(context.shader.clipPosition);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const unsnapped = three.createText({ font, material, text: 'A' });
  const snapped = three.createText({ font, material, pixelSnapping: true, text: 'B' });
  scene.add(unsnapped, snapped);
  scene.updateMatrixWorld();

  assert.equal(clipPositions[0], TSL.modelViewProjection);
  assert.notEqual(clipPositions[1], TSL.modelViewProjection);

  unsnapped.dispose();
  snapped.dispose();
  font.dispose();
});

for (const [shaders, defineConfig] of Object.entries(shaderConfigs)) {
  test(`${shaders} decorations of a pixel-snapped text snap by their glyphs' rule; unsnapped ones are untouched`, async (t) => {
    const three = await createThreeTestHandle(t, defineConfig());
    const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
    const style = { decoration: { underline: true, color: '#ff0088' } };
    const compiled = (pixelSnapping) => {
      const scene = new THREE.Scene();
      const label = three.createText({ font, text: 'Decorated', style, pixelSnapping });
      scene.add(label);
      scene.updateMatrixWorld();
      assertCommitted(label);
      const draws = rootDraws(scene);
      const kinds = draws.map((draw) => draw.userData.pmndrsGlyphPrimitiveKind);
      const decoration = draws[kinds.indexOf('decoration')];
      const glyphs = draws[kinds.indexOf('glyph')];
      const result = {
        decorationVertexNode: decoration.material.vertexNode,
        decoration: compileNodeMaterialBackends(decoration, { scene }),
        glyphs: compileNodeMaterialBackends(glyphs, { scene }),
      };
      label.dispose();
      return result;
    };
    const unsnapped = compiled(undefined);
    const unsnappedFalse = compiled(false);
    const snapped = compiled(true);
    // Unsnapped decorations keep Three's default projection: the program they compiled before snapping reached them.
    assert.equal(unsnapped.decorationVertexNode, null);
    assert.equal(unsnappedFalse.decorationVertexNode, null);
    for (const [backend, stages] of Object.entries(unsnapped.decoration)) {
      assert.doesNotMatch(unsnappedFalse.decoration[backend].vertex, /floor\(/, `${backend} pixelSnapping: false`);
      assert.doesNotMatch(stages.vertex, /floor\(/, `${backend} unsnapped decoration`);
    }
    for (const [backend, stages] of Object.entries(snapped.decoration)) {
      assert.match(stages.vertex, /floor\(/, `${backend} snapped decoration rounds its corners`);
      assert.match(stages.vertex, /0\.49609375/, `${backend} snapped decoration uses the glyphs' halfway rule`);
      assert.match(snapped.glyphs[backend].vertex, /0\.49609375/, `${backend} snapped glyphs use the same rule`);
    }
    font.dispose();
  });
}

function rootDraws(scene) {
  return scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
}
