import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRuntimeShaper, createTextRuntime, defineRasterTechnique, FontRegistry } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';
import { bitmapShader, mtsdfShader, registerThreeRasterProgram, slugShader, Text } from '@pmndrs/text/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

test('the canonical technique shaders are exported as callable node builders', () => {
  assert.equal(typeof bitmapShader, 'function');
  assert.equal(typeof mtsdfShader, 'function');
  assert.equal(typeof slugShader, 'function');
});

test('a custom Three program composes over the exported Bitmap shader in the real draw path', async () => {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const composedBitmap = defineRasterTechnique({ ...bitmap, id: 'tests.composed-bitmap' });
  const built = [];
  registerThreeRasterProgram(composedBitmap, (owner) => new ComposedTarget(owner, composedBitmap, built));

  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: composedBitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const label = new Text({ font, text: 'Composed' });
  scene.add(label);
  scene.updateMatrixWorld();

  const draws = label.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'the custom program must produce a real draw through the retained lifecycle');
  assert.equal(built.length, 1, 'the custom program must build exactly one composed material');
  const { shader, material } = built[0];

  assert.deepEqual(
    Object.keys(shader).sort(),
    ['atlasUv', 'clipPosition', 'color', 'coverage', 'opacity', 'position'],
    'the canonical Bitmap shader must return its documented named outputs',
  );
  for (const [name, node] of Object.entries(shader)) {
    assert.ok(node?.isNode === true, `canonical Bitmap output "${name}" must be a TSL node`);
  }

  assert.equal(draws[0].material, material);
  assert.equal(material.positionNode, shader.position, 'the program must reuse the canonical vertex placement');
  assert.equal(material.vertexNode, shader.clipPosition, 'the program must inherit the canonical pixel snapping');
  assert.equal(material.opacityNode, shader.opacity, 'the program must reuse the canonical coverage and paint alpha');
  assert.notEqual(material.colorNode, shader.color, 'the program must be free to emit its own final colour');

  label.removeFromParent();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

class ComposedTarget {
  #owner;
  #built;
  #textures = new Map();

  constructor(owner, technique, built) {
    this.technique = technique;
    this.#owner = owner;
    this.#built = built;
  }

  stage(_previous, next) {
    const resources = new Map();
    for (const batch of next.glyphBatches) resources.set(batch.key, this.#createResource(batch));
    const draws = [];
    for (let index = 0; index < next.glyphRuns.length; index += 1) {
      const run = next.glyphRuns[index];
      const resource = resources.get(run.batch);
      const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
      mesh.userData.pmndrsTextRunStart = run.start;
      mesh.frustumCulled = false;
      mesh.renderOrder = this.#owner.renderOrderBase + index;
      draws.push({ mesh, paragraph: run.paragraph });
    }
    const dispose = () => {
      for (const { mesh } of draws) {
        mesh.removeFromParent();
        mesh.geometry.dispose();
      }
      for (const resource of resources.values()) resource.material.dispose();
    };
    return {
      status: 'ready',
      stage: {
        sourceRevision: next.revision,
        commit: () => {
          for (const { mesh, paragraph } of draws) this.#owner.objectForParagraph(paragraph).add(mesh);
          return { sourceRevision: next.revision, dispose };
        },
        abort: dispose,
      },
    };
  }

  dispose() {
    for (const texture of this.#textures.values()) texture.dispose();
    this.#textures.clear();
  }

  #createResource(batch) {
    const page = batch.font.data.strikes[batch.binding.strike].pages[batch.binding.page];
    const attributes = {
      origins: storageAttribute(batch.storage.origins, 2),
      sizes: storageAttribute(batch.storage.sizes, 2),
      uvOrigins: storageAttribute(batch.storage.uvOrigins, 2),
      uvSizes: storageAttribute(batch.storage.uvSizes, 2),
      colors: storageAttribute(batch.storage.colors, 4),
    };
    const instance = TSL.instanceIndex.add(TSL.uniform(0, 'uint'));
    const shader = bitmapShader(
      {
        origin: TSL.storage(attributes.origins, 'vec2', attributes.origins.count).element(instance),
        size: TSL.storage(attributes.sizes, 'vec2', attributes.sizes.count).element(instance),
        uvOrigin: TSL.storage(attributes.uvOrigins, 'vec2', attributes.uvOrigins.count).element(instance),
        uvSize: TSL.storage(attributes.uvSizes, 'vec2', attributes.uvSizes.count).element(instance),
        color: TSL.storage(attributes.colors, 'vec4', attributes.colors.count).element(instance),
      },
      { page: this.#texture(page) },
    );
    const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
    material.positionNode = shader.position;
    material.vertexNode = shader.clipPosition;
    material.colorNode = shader.color.mul(TSL.vec3(1, 0, 0));
    material.opacityNode = shader.opacity;
    this.#built.push({ shader, material });
    return {
      material,
      geometry(count) {
        const geometry = new THREE.InstancedBufferGeometry();
        geometry.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3),
        );
        geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        geometry.instanceCount = count;
        return geometry;
      },
    };
  }

  #texture(page) {
    let texture = this.#textures.get(page.resource);
    if (texture !== undefined) return texture;
    texture = new THREE.DataTexture(page.bytes, page.width, page.height, THREE.RedFormat, THREE.UnsignedByteType);
    texture.needsUpdate = true;
    this.#textures.set(page.resource, texture);
    return texture;
  }
}

function storageAttribute(array, itemSize) {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(array), itemSize);
  attribute.needsUpdate = true;
  return attribute;
}

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
