import type {
  GlyphBatchKey,
  ParagraphBatchTarget,
  ParagraphBatchTargetUpdate,
  ParagraphId,
  PreparedGlyphBatch,
  PreparedParagraphBatchRevision,
} from '@pmndrs/text';
import { registerThreeRasterProgram, type ThreeRasterTargetOwner } from '@pmndrs/text/three';
import { add, instanceIndex, min, mul, positionLocal, step, storage, sub, uniform, uv, vec3 } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExample } from './raster.js';

/**
 * A third-party Three program for a third-party technique. It is registered by technique identifier, so nothing in
 * `@pmndrs/text` needs to know this package exists: core packs the canonical storage and this program owns every
 * engine resource — geometry, attributes, material, and the meshes it publishes into the caller's scene.
 */
registerThreeRasterProgram(glyphExample, (owner) => new ThreeGlyphExampleTarget(owner));

interface GlyphExampleResource {
  readonly key: GlyphBatchKey;
  readonly capacity: number;
  readonly gpuBytes: number;
  readonly material: THREE.MeshBasicNodeMaterial;
  update(batch: PreparedGlyphBatch<typeof glyphExample>): void;
  geometry(count: number): THREE.InstancedBufferGeometry;
  dispose(): void;
}

interface RunIdentity {
  readonly paragraph: ParagraphId;
  readonly batch: GlyphBatchKey;
}

/**
 * One committed generation of draws. Retention is the point of this class: while core reports the same batch capacities
 * and the same run topology, a warm revision transfers its meshes and buffers to its successor instead of rebuilding
 * them, which is what keeps object and geometry identity stable across text updates.
 */
class ThreeGlyphExampleRevision {
  readonly sourceRevision: number;
  readonly draws: readonly THREE.Mesh[];
  readonly #resources: ReadonlyMap<GlyphBatchKey, GlyphExampleResource>;
  readonly #runIdentities: readonly RunIdentity[];
  #transferred = false;
  #disposed = false;

  constructor(
    sourceRevision: number,
    draws: readonly THREE.Mesh[],
    resources: ReadonlyMap<GlyphBatchKey, GlyphExampleResource>,
    runIdentities: readonly RunIdentity[],
  ) {
    this.sourceRevision = sourceRevision;
    this.draws = draws;
    this.#resources = resources;
    this.#runIdentities = runIdentities;
  }

  get gpuBytes(): number {
    if (this.#disposed || this.#transferred) return 0;
    let bytes = 0;
    for (const resource of this.#resources.values()) bytes += resource.gpuBytes;
    return bytes;
  }

  setRenderOrderBase(base: number): void {
    for (let index = 0; index < this.draws.length; index += 1) this.draws[index]!.renderOrder = base + index;
  }

  canReuse<Variant>(next: PreparedParagraphBatchRevision<typeof glyphExample, Variant>): boolean {
    if (this.#disposed || this.#transferred || next.glyphBatches.length !== this.#resources.size) return false;
    for (const batch of next.glyphBatches) {
      const resource = this.#resources.get(batch.key);
      if (resource === undefined || resource.capacity !== batch.capacity) return false;
    }
    if (next.glyphRuns.length !== this.#runIdentities.length) return false;
    return next.glyphRuns.every((run, index) => {
      const identity = this.#runIdentities[index];
      return identity?.paragraph === run.paragraph && identity.batch === run.batch;
    });
  }

  transfer<Variant>(
    next: PreparedParagraphBatchRevision<typeof glyphExample, Variant>,
    renderOrderBase: number,
  ): ThreeGlyphExampleRevision {
    if (!this.canReuse(next)) throw new Error('glyph-example revision is not compatible for reuse');
    for (const batch of next.glyphBatches) this.#resources.get(batch.key)!.update(batch);
    for (let index = 0; index < next.glyphRuns.length; index += 1) {
      const run = next.glyphRuns[index]!;
      const draw = this.draws[index]!;
      draw.userData.pmndrsTextRunStart = run.start;
      (draw.geometry as THREE.InstancedBufferGeometry).instanceCount = run.count;
      draw.renderOrder = renderOrderBase + index;
    }
    this.#transferred = true;
    return new ThreeGlyphExampleRevision(next.revision, this.draws, this.#resources, this.#runIdentities);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#transferred) return;
    for (const draw of this.draws) {
      draw.removeFromParent();
      draw.geometry.dispose();
    }
    for (const resource of this.#resources.values()) resource.dispose();
  }
}

class ThreeGlyphExampleTarget<Variant> implements ParagraphBatchTarget<
  typeof glyphExample,
  Variant,
  ThreeGlyphExampleRevision
> {
  readonly technique: typeof glyphExample = glyphExample;
  readonly #owner: ThreeRasterTargetOwner;
  #committed: ThreeGlyphExampleRevision | undefined;
  #disposed = false;

  constructor(owner: ThreeRasterTargetOwner) {
    this.#owner = owner;
  }

  get gpuBytes(): number {
    return this.#committed?.gpuBytes ?? 0;
  }

  stage(
    previous: ThreeGlyphExampleRevision | undefined,
    next: PreparedParagraphBatchRevision<typeof glyphExample, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeGlyphExampleRevision> {
    if (this.#disposed) throw new Error('glyph-example Three target has been disposed');
    if (previous?.canReuse(next) === true) return this.#warmStage(previous, next);
    const resources = new Map<GlyphBatchKey, GlyphExampleResource>();
    const draws: THREE.Mesh[] = [];
    try {
      for (const batch of next.glyphBatches) resources.set(batch.key, createResource(batch));
      for (let index = 0; index < next.glyphRuns.length; index += 1) {
        const run = next.glyphRuns[index]!;
        const resource = resources.get(run.batch);
        if (resource === undefined) throw new Error('glyph-example run references an unknown physical batch');
        const mesh = new THREE.Mesh(resource.geometry(run.count), resource.material);
        mesh.name = 'pmndrs.text.glyph-example';
        mesh.userData.pmndrsTextRunStart = run.start;
        mesh.frustumCulled = false;
        mesh.renderOrder = this.#owner.renderOrderBase + index;
        draws.push(mesh);
      }
    } catch (error) {
      discard(draws, resources.values());
      throw error;
    }
    let finished = false;
    return {
      status: 'ready',
      stage: {
        sourceRevision: next.revision,
        commit: () => {
          if (finished) throw new Error('glyph-example stage is no longer active');
          finished = true;
          for (let index = 0; index < draws.length; index += 1) {
            this.#owner.objectForParagraph(next.glyphRuns[index]!.paragraph).add(draws[index]!);
          }
          this.#committed = new ThreeGlyphExampleRevision(next.revision, draws, resources, runIdentities(next));
          return this.#committed;
        },
        abort: () => {
          if (finished) return;
          finished = true;
          discard(draws, resources.values());
        },
      },
    };
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#committed = undefined;
  }

  #warmStage(
    previous: ThreeGlyphExampleRevision,
    next: PreparedParagraphBatchRevision<typeof glyphExample, Variant>,
  ): ParagraphBatchTargetUpdate<ThreeGlyphExampleRevision> {
    let finished = false;
    return {
      status: 'ready',
      stage: {
        sourceRevision: next.revision,
        commit: () => {
          if (finished) throw new Error('glyph-example stage is no longer active');
          finished = true;
          this.#committed = previous.transfer(next, this.#owner.renderOrderBase);
          return this.#committed;
        },
        abort: () => {
          finished = true;
        },
      },
    };
  }
}

function createResource(batch: PreparedGlyphBatch<typeof glyphExample>): GlyphExampleResource {
  const origins = instanceAttribute(batch.storage.origins, 2);
  const sizes = instanceAttribute(batch.storage.sizes, 2);
  const colors = instanceAttribute(batch.storage.colors, 4);
  const material = createMaterial(origins, sizes, colors);
  return {
    key: batch.key,
    capacity: batch.capacity,
    gpuBytes: origins.array.byteLength + sizes.array.byteLength + colors.array.byteLength,
    material,
    update(next) {
      upload(origins, next.storage.origins, 2, next.dirtyRanges);
      upload(sizes, next.storage.sizes, 2, next.dirtyRanges);
      upload(colors, next.storage.colors, 4, next.dirtyRanges);
    },
    geometry(count) {
      const geometry = unitQuad();
      geometry.instanceCount = count;
      geometry.setAttribute('_glyphExampleOrigins', origins);
      geometry.setAttribute('_glyphExampleSizes', sizes);
      geometry.setAttribute('_glyphExampleColors', colors);
      return geometry;
    },
    dispose() {
      material.dispose();
    },
  };
}

function upload(
  target: THREE.StorageInstancedBufferAttribute,
  source: Float32Array,
  itemSize: number,
  ranges: readonly { readonly start: number; readonly count: number }[],
): void {
  if (ranges.length === 0) return;
  const values = target.array as Float32Array;
  target.clearUpdateRanges();
  for (const range of ranges) {
    const start = range.start * itemSize;
    const count = range.count * itemSize;
    values.set(source.subarray(start, start + count), start);
    target.addUpdateRange(start, count);
  }
  target.needsUpdate = true;
  const pbo = (target as THREE.StorageInstancedBufferAttribute & { pbo?: THREE.DataTexture }).pbo;
  if (pbo !== undefined) pbo.needsUpdate = true;
}

function instanceAttribute(source: Float32Array, itemSize: number): THREE.StorageInstancedBufferAttribute {
  const value = new THREE.StorageInstancedBufferAttribute(new Float32Array(source), itemSize);
  value.setUsage(THREE.DynamicDrawUsage);
  value.needsUpdate = true;
  return value;
}

function runIdentities<Variant>(
  revision: PreparedParagraphBatchRevision<typeof glyphExample, Variant>,
): readonly RunIdentity[] {
  return revision.glyphRuns.map((run) => ({ paragraph: run.paragraph, batch: run.batch }));
}

function discard(draws: readonly THREE.Mesh[], resources: Iterable<GlyphExampleResource>): void {
  for (const draw of draws) {
    draw.removeFromParent();
    draw.geometry.dispose();
  }
  for (const resource of resources) resource.dispose();
}

/**
 * Core packs one physical batch that several runs may share, so each mesh reads its own slice through the run-start
 * uniform rather than assuming its run begins at instance zero.
 */
function createMaterial(
  origins: THREE.StorageInstancedBufferAttribute,
  sizes: THREE.StorageInstancedBufferAttribute,
  colors: THREE.StorageInstancedBufferAttribute,
): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial({
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const runStart = uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData.pmndrsTextRunStart as number | undefined) ?? 0,
  );
  const instance = instanceIndex.add(runStart);
  const origin = storage(origins, 'vec2', origins.count).setPBO(true).element(instance);
  const size = storage(sizes, 'vec2', sizes.count).setPBO(true).element(instance);
  const color = storage(colors, 'vec4', colors.count).setPBO(true).element(instance);
  const unit = uv();
  const edgeDistance = min(min(unit.x, sub(1, unit.x)), min(unit.y, sub(1, unit.y)));
  const frame = sub(1, step(0.08, edgeDistance));
  // Canonical storage is positive-down, so the program negates Y to reach Three's Y-up paragraph space. The technique
  // never states a renderer convention; converting it is exactly the program's job.
  material.positionNode = vec3(
    add(origin.x, mul(positionLocal.x, size.x)),
    add(origin.y, mul(positionLocal.y, size.y)).negate(),
    0,
  );
  material.colorNode = color.rgb;
  material.opacityNode = mul(color.a, frame);
  return material;
}

function unitQuad(): THREE.InstancedBufferGeometry {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 2, 1, 3]);
  return geometry;
}
