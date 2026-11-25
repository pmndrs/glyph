import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { CodecBufferDeclaration, CodecBufferDeclarations, TechniqueSchemaMetadata } from '../../config/schema.js';
import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../config/resources.js';
import { bitmapSchema, bitmap } from '../../raster/bitmap.js';
import { MSDF_GLYPH_TABLE_LAYER_STEP, msdfSchema } from '../../raster/msdf.js';
import { msdf } from '../../raster/msdf.js';
import { slugSchema } from '../../raster/slug.js';
import { slug } from '../../raster/slug.js';
import type { RetainedSlugPage, ThreeRendererResources } from './renderer-resources.js';
import { createMsdfAtlas, type RetainedMsdfAtlas } from './msdf-atlas.js';
import { slugGlyphRow } from './slug-glyph-table.js';
import { createSlugPage, registerSlugPageUse } from './slug-residency.js';
import { registerMsdfAtlasUse, registerMsdfEffectVariants } from './msdf-draws.js';
import type { TslMsdfEffects } from '../../shaders/tsl/index.js';
import { atlasTextureArray } from './portable-resource.js';
import type { ThreeRootContext, ThreeTextMaterialContextMap } from '../material.js';
import type { ThreeRasterProgramBuffer } from '../raster-program.js';
import { decorationSchema, threeSystemBuffers } from '../codec.js';
import type { ThreeBufferBinding, ThreeResolvedMaterialBinding, ThreeResolvedResourceBinding } from '../schema.js';
import type { RetainedBuffer, ThreeBufferBindingId } from './host-buffer.js';
import { resourceGroup, textureArrayResource } from './portable-resource.js';
import type {
  MaterialRealization,
  MaterialStorageNode,
  PreparationContext,
  RetainedResource,
  ThreeHostResource,
  TransformRealization,
} from './render-state.js';

type MaterialSelection = ThreeResolvedMaterialBinding | undefined;
type BuiltinMaterialContextKey = 'decoration' | 'pmndrs.bitmap' | 'pmndrs.msdf' | 'pmndrs.slug';
/** A built-in context before its stage-safe nodes; the open map's external augmentations are not built here. */
type RawMaterialContext = {
  [Key in BuiltinMaterialContextKey]: Omit<
    ThreeTextMaterialContextMap[Key],
    'paragraphPosition' | 'position' | 'glyphIndex' | 'glyphOrigin'
  >;
}[BuiltinMaterialContextKey];
/**
 * One draw's raw vertex graphs: the paragraph-local and final draw-local positions, and the draw's glyph facts. A
 * glyph's index is its own; a decoration's runs from its first glyph's to its last along the rectangle.
 */
interface RawMaterialNodes {
  readonly paragraph: THREE.Node<'vec3'>;
  readonly draw: THREE.Node<'vec3'>;
  readonly glyph:
    | Readonly<{ index: THREE.Node<'uint'>; origin: THREE.Node<'vec2'> }>
    | Readonly<{ span: THREE.Node<'float'>; origin: THREE.Node<'vec2'> }>
    | undefined;
}
/**
 * The lane behind a caller material's `glyphIndex` and `glyphOrigin`: origin x and y, then the index. A decoration
 * record's fourth float is the index of the last glyph its rectangle runs under.
 */
interface GlyphFactLanes {
  readonly facts: RetainedBuffer;
  readonly buffers: readonly RetainedBuffer[];
}

interface ThreeMaterialOwner {
  readonly renderObject: THREE.Object3D;
  readonly pixelSnapping?: boolean;
  readonly root?: ThreeRootContext;
  glyphStorage?(storageKey: string):
    | Readonly<{
        transforms: THREE.StorageInstancedBufferAttribute;
      }>
    | undefined;
}

interface ThreeMaterialRealizerOptions {
  readonly coordinator: ThreeRendererResources;
  readonly owner: ThreeMaterialOwner;
  readonly context: PreparationContext;
  readonly ownedMaterials: WeakSet<THREE.NodeMaterial>;
  readonly bindingId: (value: object) => number;
  /** Buffers the display list being realized still draws from; a material reading any of them cannot move on. */
  readonly liveBuffers: ReadonlySet<ThreeBufferBinding>;
}

/** Realizes program-specific Three materials and GPU resources inside one publication transaction. */
export class ThreeMaterialRealizer {
  readonly #coordinator: ThreeRendererResources;
  readonly #owner: ThreeMaterialOwner;
  readonly #context: PreparationContext;
  readonly #ownedMaterials: WeakSet<THREE.NodeMaterial>;
  readonly #bindingId: (value: object) => number;
  readonly #liveBuffers: ReadonlySet<ThreeBufferBinding>;

  constructor(options: ThreeMaterialRealizerOptions) {
    this.#coordinator = options.coordinator;
    this.#owner = options.owner;
    this.#context = options.context;
    this.#ownedMaterials = options.ownedMaterials;
    this.#bindingId = options.bindingId;
    this.#liveBuffers = options.liveBuffers;
  }

  key(material: MaterialSelection): string {
    if (material === undefined) return 'default:snap=0';
    const factory = material.material;
    return `${factory === undefined ? 'default' : `material:${this.#bindingId(factory)}`}:snap=${
      material.pixelSnapping ? 1 : 0
    }`;
  }

  decoration(
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const rect = buffers.get(decorationSchema.buffers.rect.id);
    const packed = buffers.get(decorationSchema.buffers.packed.id);
    if (rect === undefined || packed === undefined) {
      throw new Error('decoration draw is missing its rectangle or packed Codec buffer');
    }
    const facts = this.#glyphFactLanes(buffers, selection);
    const lanes = materialBuffers([rect, packed, ...(facts?.buffers ?? [])], transform);
    const factsKey = facts === undefined ? '' : `:facts:${facts.facts.storageKey}`;
    // A decoration follows the snapping of the glyphs it runs under, resolved exactly as their Bitmap draw resolves it.
    const pixelSnapping = this.#owner.pixelSnapping ?? selection?.pixelSnapping ?? false;
    const snapKey = `:snap=${String(pixelSnapping)}`;
    const key = `decoration:${this.key(selection)}:${rect.storageKey}:${packed.storageKey}${factsKey}${snapKey}:${transformProgramKey(
      transform,
      this.#context.transformGeneration,
    )}`;
    const shape = `decoration:${this.key(selection)}${facts === undefined ? '' : ':facts'}${snapKey}:${this.#transformShape(transform)}`;
    const cached = this.#cached(key, shape, lanes);
    if (cached !== undefined) return cached;
    const instance = runInstance();
    const shaders = this.#coordinator.shaders;
    const shader = shaders.decorationShader({
      rect: storageVec4(rect, instance),
      packed: storageUvec2(packed, instance),
    });
    const position = this.#position(shader.position, instance, buffers, transform);
    const material = this.#createMaterial(
      selection,
      {
        root: this.#root(selection),
        kind: 'decoration',
        shader,
        createDefaultMaterial: () => {
          const created = coverageMaterial(shader, position);
          // The rule a snapped Bitmap quad follows: each corner rounded onto whole physical pixels after projection.
          if (pixelSnapping) created.vertexNode = shaders.pixelSnappedClipPosition();
          return created;
        },
      },
      { paragraph: shader.position, draw: position, glyph: decorationFacts(facts, instance) },
    );
    this.#retain(key, material, undefined, lanes, transform.kind, shape);
    return material;
  }

  glyph(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const resolved = resource.resolved;
    if (resolved.format === bitmap.id) return this.#bitmap(resource, buffers, selection, transform);
    if (resolved.format === msdf.id) return this.#msdf(resource, buffers, selection, transform);
    if (resolved.format === slug.id) return this.#slug(resource, buffers, selection, transform);
    if (resolved.program !== undefined) {
      return this.#external(resource, { ...resolved, program: resolved.program }, buffers, selection, transform);
    }
    throw new Error('this Three command-buffer renderer does not recognize the draw technique');
  }

  #bitmap(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const part = schemaDrawBuffers(bitmapSchema, buffers, 'Bitmap');
    const required = [part.origin, part.size, part.uvOrigin, part.uvSize, part.color, part.page];
    const placement = this.#placementSources(buffers);
    const facts = this.#glyphFactLanes(buffers, selection);
    const retained = [...required, ...placement.buffers, ...(facts?.buffers ?? [])];
    const lanes = materialBuffers(retained, transform);
    const key = this.#cacheKey('bitmap', resource, selection, retained, buffers, transform, [
      `snap=${String(this.#owner.pixelSnapping ?? selection?.pixelSnapping ?? false)}`,
    ]);
    const shape = this.#cacheShape('bitmap', resource, selection, retained, buffers, transform, [
      `snap=${String(this.#owner.pixelSnapping ?? selection?.pixelSnapping ?? false)}`,
    ]);
    const cached = this.#cached(key, shape, lanes);
    if (cached !== undefined) return cached;
    const atlas = textureArrayResource(resource.resolved, 'atlas', 'r8unorm', 'Bitmap');
    const instance = runInstance();
    const placementOffset = this.#placementOffset(instance, placement);
    const texture = this.#bitmapPages(resource.binding, atlas);
    const shader = this.#coordinator.shaders.bitmapShader(
      {
        origin: storageVec2(part.origin, instance).add(placementOffset),
        size: storageVec2(part.size, instance),
        uvOrigin: storageVec2(part.uvOrigin, instance),
        uvSize: storageVec2(part.uvSize, instance),
        color: storageVec4(part.color, instance),
        pageIndex: storageUint(part.page, instance),
      },
      { page: texture },
      { pixelSnapping: this.#owner.pixelSnapping ?? selection?.pixelSnapping ?? false },
    );
    const position = this.#position(shader.position, instance, buffers, transform);
    const material = this.#createMaterial(
      selection,
      {
        root: this.#root(selection),
        kind: 'glyph',
        format: bitmap.id,
        shader,
        createDefaultMaterial: () => bitmapMaterial(shader, position),
      },
      { paragraph: shader.position, draw: position, glyph: glyphFacts(facts, instance, placementOffset) },
    );
    this.#retain(key, material, resource, lanes, transform.kind, shape);
    return material;
  }

  #msdf(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const part = schemaDrawBuffers(msdfSchema, buffers, 'MSDF');
    const required = [part.rect, part.color, part.effectColor, part.effect];
    const placement = this.#placementSources(buffers);
    const facts = this.#glyphFactLanes(buffers, selection);
    const retained = [...required, ...placement.buffers, ...(facts?.buffers ?? [])];
    const lanes = materialBuffers(retained, transform);
    const key = this.#cacheKey('msdf', resource, selection, retained, buffers, transform);
    const shape = this.#cacheShape('msdf', resource, selection, retained, buffers, transform);
    const cached = this.#cached(key, shape, lanes);
    if (cached !== undefined) return cached;
    const atlas = this.#msdfAtlas(resource.binding, resourceGroup(resource.resolved, 'atlas', 'MSDF'));
    const instance = runInstance();
    const placementOffset = this.#placementOffset(instance, placement);
    const rect = storageVec4(part.rect, instance);
    const effect = storageVec4(part.effect, instance);
    // Atlas extent and field range are uniforms, not literals, so every MSDF font compiles to the same program.
    const metrics = TSL.uniform(atlas.metrics);
    const atlasSize = metrics.xy;
    // What every drawing of a glyph shares is read once per vertex from the font's glyph table.
    const glyph = TSL.int(effect.w);
    const cell = TSL.textureLoad(
      atlas.glyphs,
      TSL.ivec2(glyph.mod(TSL.int(atlas.glyphsWidth)), glyph.div(TSL.int(atlas.glyphsWidth))),
    );
    const layer = TSL.floor(cell.w.div(MSDF_GLYPH_TABLE_LAYER_STEP));
    const uvOrigin = cell.xy.div(atlasSize);
    const uvSize = TSL.vec2(cell.z, cell.w.sub(layer.mul(MSDF_GLYPH_TABLE_LAYER_STEP))).div(atlasSize);
    const place = this.#positionTransform(instance, buffers, transform);
    const modelViewProjection = TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix);
    const instanceNodes = {
      origin: rect.xy.add(placementOffset),
      size: rect.zw,
      uvOrigin,
      uvSize,
      uvBounds: TSL.vec4(uvOrigin, uvOrigin.add(uvSize)),
      fillColor: storageVec4(part.color, instance),
      effectColor: storageUvec2(part.effectColor, instance),
      shadowOffset: effect.xy.mul(metrics.w).mul(metrics.z).div(atlasSize),
      outlineWidth: effect.z.mul(metrics.w),
      pageIndex: layer,
    };
    const graph = (effects: TslMsdfEffects) => {
      const shader = this.#coordinator.shaders.msdfShader(instanceNodes, {
        atlas: atlas.texture,
        atlasWidth: metrics.x,
        atlasHeight: metrics.y,
        pixelRange: metrics.z,
        // A caller's material may draw anywhere in the cell (a glow from the true distance, say), so only the
        // default material, whose reach is known, gets trimmed quads.
        ...(selection?.material === undefined
          ? {
              trim: {
                project: (position: THREE.Node<'vec3'>) => modelViewProjection.mul(TSL.vec4(place(position), 1)),
              },
            }
          : {}),
        effects,
        singleChannel: atlas.singleChannel,
      });
      return { shader, position: place(shader.position) };
    };
    const { shader, position } = graph({ outline: true, shadow: true });
    const material = this.#createMaterial(
      selection,
      {
        root: this.#root(selection),
        kind: 'glyph',
        format: msdf.id,
        shader,
        createDefaultMaterial: () => coverageMaterial(shader, position),
      },
      { paragraph: shader.position, draw: position, glyph: glyphFacts(facts, instance, placementOffset) },
    );
    registerMsdfAtlasUse(material, atlas);
    // A caller's material is theirs to keep, so only the default material is exchanged for effect specializations.
    if (selection?.material === undefined) {
      registerMsdfEffectVariants(material, (effects) => {
        const variant = graph(effects);
        return coverageMaterial(variant.shader, variant.position);
      });
    }
    this.#retain(key, material, resource, lanes, transform.kind, shape);
    return material;
  }

  #slug(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const part = schemaDrawBuffers(slugSchema, buffers, 'Slug');
    const required = [part.rect, part.color, part.glyph];
    const placementTable = this.#placementTable();
    const facts = this.#glyphFactLanes(buffers, selection);
    const retained = [...required, placementTable, ...(facts?.buffers ?? [])];
    const lanes = materialBuffers(retained, transform);
    const key = this.#cacheKey('slug', resource, selection, retained, buffers, transform);
    const shape = this.#cacheShape('slug', resource, selection, retained, buffers, transform);
    const cached = this.#cached(key, shape, lanes);
    if (cached !== undefined) return cached;
    const page = this.#slugPage(resource.binding, resourceGroup(resource.resolved, 'page', 'Slug'));
    const instance = runInstance();
    const rect = storageVec4(part.rect, instance);
    const glyph = storageUvec2(part.glyph, instance);
    const placementOffset = storageVec2(placementTable, glyph.y);
    // What every drawing of a glyph shares is read once per vertex from the page's glyph table; the fragment receives
    // it as varyings and reads no instance storage.
    const row = slugGlyphRow(page.glyphTable, glyph.x);
    const emSize = row.quad.zw;
    // Em units per layout unit. The quad is the em quad scaled by the font size, so either axis gives it; their sum
    // keeps a quad that is flat on one axis exact.
    const inverseScale = emSize.x.add(emSize.y).div(TSL.max(rect.z.add(rect.w), 1e-30));
    const starts = TSL.varying(row.starts);
    const counts = TSL.varying(row.counts);
    const indexed =
      transform.kind === 'indexed'
        ? indexedTransformNodes(transform.indices, this.#context.transformAttribute, instance)
        : undefined;
    const modelViewProjection =
      indexed === undefined
        ? TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix)
        : TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix).mul(indexed.matrix);
    const viewport = TSL.uniform(new THREE.Vector2(1, 1)).onRenderUpdate(({ renderer }, self) =>
      renderer?.getDrawingBufferSize(self.value),
    );
    const shader = this.#coordinator.shaders.slugShader(
      {
        origin: rect.xy.add(placementOffset),
        size: rect.zw,
        emOrigin: row.quad.xy,
        emSize,
        bandTransform: TSL.varying(row.band),
        color: TSL.varying(storageVec4(part.color, instance)),
        inverseScale,
        curveBaseTexel: starts.x,
        horizontalHeaderBase: starts.y,
        verticalHeaderBase: starts.z,
        referenceBase: starts.w,
        horizontalBandCount: counts.x,
        verticalBandCount: counts.y,
      },
      { page, viewport, modelViewProjection },
    );
    const glyphPosition = this.#glyphPosition(shader.position, instance, buffers);
    const position = indexed?.position(glyphPosition) ?? glyphPosition;
    const material = this.#createMaterial(
      selection,
      {
        root: this.#root(selection),
        kind: 'glyph',
        format: slug.id,
        shader,
        createDefaultMaterial: () => coverageMaterial(shader, position),
      },
      { paragraph: shader.position, draw: position, glyph: glyphFacts(facts, instance, placementOffset) },
    );
    registerSlugPageUse(material, page);
    this.#retain(key, material, resource, lanes, transform.kind, shape);
    return material;
  }

  #external(
    resource: RetainedResource,
    resolved: ThreeHostResource & { readonly program: NonNullable<ThreeHostResource['program']> },
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
  ): THREE.NodeMaterial {
    const placement = this.#placementSources(buffers);
    const required = [...buffers.values(), ...placement.buffers];
    const key = this.#cacheKey('external', resource, selection, required, buffers, transform);
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const instance = runInstance();
    const placementOffset = this.#placementOffset(instance, placement);
    const namedBuffers = new Map<string, ThreeRasterProgramBuffer>();
    for (const [name, declaration] of Object.entries(resolved.program.schema.buffers)) {
      const source = buffers.get(declaration.id);
      if (source === undefined) throw new Error(`Three draw is missing declared Codec buffer "${name}"`);
      namedBuffers.set(name, {
        scalarType: source.scalarType,
        vectorWidth: source.vectorWidth,
        attribute: source.attribute,
      });
    }
    const material = this.#own(
      resolved.program.createMaterial({
        raster: resolved.program.raster,
        schema: resolved.program.schema,
        variantId: resolved.program.variant.id,
        language: resolved.program.variant.language,
        namedBuffers,
        namedResources: resolved.resources,
        outputTypes: resolved.program.variant.outputs,
        resourceName: resolved.resourceName,
        instance,
        material: selection?.material,
        root: this.#root(selection),
        transformPosition: (position) =>
          this.#position(position.add(TSL.vec3(placementOffset, 0)), instance, buffers, transform),
      }),
    );
    this.#retain(key, material, resource, materialBuffers(required, transform), transform.kind);
    return material;
  }

  #cacheKey(
    kind: string,
    resource: RetainedResource,
    material: MaterialSelection,
    required: readonly RetainedBuffer[],
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
    extra: readonly string[] = [],
  ): string {
    return [
      kind,
      this.#bindingId(resource.binding),
      this.key(material),
      ...extra,
      required.map((buffer) => `${buffer.codecBufferId}:${buffer.storageKey}`).join(','),
      glyphStorageProgramKey(buffers),
      transformProgramKey(transform, this.#context.transformGeneration),
    ].join(':');
  }

  /** The cache key with every buffer reduced to its lane: equal for a material and its successor after growth. */
  #cacheShape(
    kind: string,
    resource: RetainedResource,
    material: MaterialSelection,
    required: readonly RetainedBuffer[],
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
    extra: readonly string[] = [],
  ): string {
    return [
      kind,
      this.#bindingId(resource.binding),
      this.key(material),
      ...extra,
      required.map((buffer) => buffer.codecBufferId).join(','),
      // A detached branch's graph captures its per-glyph transform table, which no successor shares.
      this.#owner.glyphStorage === undefined ? 'glyph-storage:none' : glyphStorageProgramKey(buffers),
      this.#transformShape(transform),
    ].join(':');
  }

  #transformShape(transform: TransformRealization): string {
    return transform.kind === 'direct' ? 'direct' : `indexed:table:${this.#context.transformGeneration}`;
  }

  /**
   * The material for `key`, or one whose buffers were all replaced by successors.
   *
   * When instance storage outgrows its capacity the engine publishes new buffers under new identities. A material
   * that read the old ones, and that no draw of the new display list still needs for them, keeps its graph (and so
   * its shader modules and pipeline): its storage nodes are pointed at the successors when the publication commits.
   */
  #cached(key: string, shape: string, lanes: readonly RetainedBuffer[]): THREE.NodeMaterial | undefined {
    const exact = this.#context.materials.get(key);
    if (exact !== undefined) return exact.material;
    const requested = new Set(lanes.map(({ binding }) => binding));
    for (const [previousKey, previous] of this.#context.materials) {
      if (previous.shape !== shape || previous.storage === undefined) continue;
      // Lanes the successor shares are not replaced; every other one must have left the display list.
      if (previous.buffers.some((binding) => !requested.has(binding) && this.#liveBuffers.has(binding))) continue;
      const pendingStorage = successorStorage(previous.storage, lanes);
      if (pendingStorage === undefined) continue;
      this.#context.materials.delete(previousKey);
      this.#context.materials.set(key, {
        ...previous,
        buffers: lanes.map(({ binding }) => binding),
        pendingStorage,
      });
      return previous.material;
    }
    return undefined;
  }

  #position(
    position: THREE.Node<'vec3'>,
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
  ): THREE.Node<'vec3'> {
    return this.#positionTransform(instance, buffers, transform)(position);
  }

  /** The glyph-local to object-local map of one draw; every use shares the same storage reads. */
  #positionTransform(
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
  ): (position: THREE.Node<'vec3'>) => THREE.Node<'vec3'> {
    const glyph = this.#glyphTransform(instance, buffers);
    const indexed =
      transform.kind === 'indexed'
        ? indexedTransformNodes(transform.indices, this.#context.transformAttribute, instance)
        : undefined;
    return (position) => {
      const placed = glyph === undefined ? position : glyph(position);
      return indexed === undefined ? placed : indexed.position(placed);
    };
  }

  #placementSources(
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  ): Readonly<{ slots: RetainedBuffer; table: RetainedBuffer; buffers: readonly RetainedBuffer[] }> {
    const slots = buffers.get(threeSystemBuffers.placementSlot.id);
    if (slots === undefined || slots.scalarType !== 'u32' || slots.vectorWidth !== 1) {
      throw new Error('glyph draw is missing its placement-slot lane or session x/y table');
    }
    const table = this.#placementTable();
    return { slots, table, buffers: [slots, table] };
  }

  /** The glyph fact lanes of a draw a caller's material renders, when its handle publishes them. */
  #glyphFactLanes(
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
  ): GlyphFactLanes | undefined {
    if (selection?.material === undefined) return undefined;
    const facts = buffers.get(threeSystemBuffers.glyphFacts.id);
    // A handle created without `glyphFacts` does not publish the lane.
    if (facts === undefined) return undefined;
    return { facts, buffers: [facts] };
  }

  #placementTable(): RetainedBuffer {
    const table = this.#context.placementTable;
    if (table === undefined || table.scalarType !== 'f32' || table.vectorWidth !== 2) {
      throw new Error('glyph draw is missing its session x/y placement table');
    }
    return table;
  }

  #placementOffset(
    instance: THREE.Node<'uint'>,
    source: Readonly<{ slots: RetainedBuffer; table: RetainedBuffer }>,
  ): THREE.Node<'vec2'> {
    return storageVec2(source.table, storageUint(source.slots, instance));
  }

  #glyphPosition(
    position: THREE.Node<'vec3'>,
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  ): THREE.Node<'vec3'> {
    return this.#glyphTransform(instance, buffers)?.(position) ?? position;
  }

  #glyphTransform(
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  ): ((position: THREE.Node<'vec3'>) => THREE.Node<'vec3'>) | undefined {
    const stableIds = buffers.get(threeSystemBuffers.stableGlyphId.id);
    const retained = stableIds === undefined ? undefined : this.#owner.glyphStorage?.(glyphStorageKey(stableIds));
    if (retained === undefined) return undefined;
    return affineColumns(retained.transforms, instance.mul(4)).position;
  }

  #bitmapPages(binding: ThreeResolvedResourceBinding, data: PortableTextureArrayPayload): THREE.DataArrayTexture {
    let lease = this.#context.bitmapTextures.get(binding);
    if (lease !== undefined) return lease.resource;
    lease = this.#coordinator.acquireTextureArrayResource(data, () =>
      atlasTextureArray(
        data.bytes,
        data.width,
        data.height,
        data.layers,
        THREE.RedFormat,
        this.#coordinator.bitmapFilter,
      ),
    );
    this.#context.newTextures.add(lease);
    this.#context.bitmapTextures.set(binding, lease);
    return lease.resource;
  }

  #msdfAtlas(binding: ThreeResolvedResourceBinding, group: PortableResourceGroupPayload): RetainedMsdfAtlas {
    let lease = this.#context.msdfAtlases.get(binding);
    if (lease !== undefined) return lease.resource;
    lease = this.#coordinator.acquireMsdfAtlasResource(group, () =>
      createMsdfAtlas(group, this.#coordinator.msdfSingleChannel),
    );
    this.#context.newTextures.add(lease);
    this.#context.msdfAtlases.set(binding, lease);
    return lease.resource;
  }

  #slugPage(binding: ThreeResolvedResourceBinding, data: PortableResourceGroupPayload): RetainedSlugPage {
    let lease = this.#context.slugPages.get(binding);
    if (lease !== undefined) return lease.resource;
    lease = this.#coordinator.acquireSlugPageResource(data, () => createSlugPage(data));
    this.#context.newTextures.add(lease);
    this.#context.slugPages.set(binding, lease);
    return lease.resource;
  }

  /**
   * The default material drives its raw vertex graphs directly and builds nothing more. A caller's factory receives
   * each position and glyph fact as a stage-safe node, which any node of either stage may read any number of times.
   */
  #createMaterial(
    selection: MaterialSelection,
    context: RawMaterialContext,
    nodes: RawMaterialNodes,
  ): THREE.NodeMaterial {
    const factory = selection?.material;
    if (factory === undefined) return this.#own(context.createDefaultMaterial());
    const positions = {
      paragraphPosition: stageNode(nodes.paragraph, 'vec3'),
      position: stageNode(nodes.draw, 'vec3'),
    };
    const glyph = nodes.glyph;
    const glyphOrigin =
      glyph === undefined ? undefined : stageNode(TSL.vec3(glyph.origin.x, glyph.origin.y.negate(), 0), 'vec3');
    let created: THREE.NodeMaterial | undefined;
    if (context.kind === 'decoration') {
      const placed = { ...context, ...positions };
      created = factory.create(
        glyph === undefined || glyphOrigin === undefined || !('span' in glyph)
          ? withoutGlyphFacts(placed)
          : { ...placed, glyphIndex: stageNode(glyph.span, 'float'), glyphOrigin },
      );
    } else {
      const placed = { ...context, ...positions };
      created = factory.create(
        glyph === undefined || glyphOrigin === undefined || !('index' in glyph)
          ? withoutGlyphFacts(placed)
          : { ...placed, glyphIndex: stageNode(glyph.index, 'uint'), glyphOrigin },
      );
    }
    return this.#own(created ?? context.createDefaultMaterial());
  }

  #root(selection: MaterialSelection): ThreeRootContext {
    return (
      selection?.root ??
      this.#owner.root ??
      Object.freeze({ name: undefined, scene: undefined, renderObject: this.#owner.renderObject })
    );
  }

  #own(material: THREE.NodeMaterial): THREE.NodeMaterial {
    if (material?.isNodeMaterial !== true)
      throw new TypeError('text material factory must return a Three NodeMaterial');
    if (this.#ownedMaterials.has(material) || this.#context.newMaterials.has(material)) {
      throw new TypeError('text material factory must return a fresh unowned NodeMaterial');
    }
    this.#context.newMaterials.add(material);
    return material;
  }

  #retain(
    key: string,
    material: THREE.NodeMaterial,
    resource: RetainedResource | undefined,
    buffers: readonly RetainedBuffer[],
    transformKind: TransformRealization['kind'],
    shape?: string,
  ): void {
    const storage = takeStorageNodes();
    this.#context.materials.set(key, {
      material,
      resource: resource?.binding,
      buffers: buffers.map(({ binding }) => binding),
      indexedTransform: transformKind === 'indexed',
      ...(shape === undefined ? {} : { shape, storage }),
    });
  }
}

const techniqueSchemas: ReadonlyMap<string, TechniqueSchemaMetadata> = new Map<string, TechniqueSchemaMetadata>([
  [bitmap.id, bitmapSchema],
  [msdf.id, msdfSchema],
  [slug.id, slugSchema],
]);

export function glyphOriginBuffer(resource: ThreeHostResource): CodecBufferDeclaration | undefined {
  const schema = resource.program?.schema ?? techniqueSchemas.get(resource.format);
  if (schema?.glyphOrigin === undefined) return undefined;
  return schema.buffers[schema.glyphOrigin.buffer];
}

export function glyphStorageKey(stableIds: RetainedBuffer): string {
  return stableIds.storageKey;
}

export function transformProgramKey(transform: TransformRealization, generation: number): string {
  return transform.kind === 'direct' ? 'direct' : `indexed:${transform.indices.storageKey}:table:${generation}`;
}

function schemaDrawBuffers<Buffers extends CodecBufferDeclarations>(
  schema: { readonly buffers: Buffers },
  buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  label: string,
): { readonly [Name in keyof Buffers]: RetainedBuffer } {
  const resolved: Record<string, RetainedBuffer> = {};
  for (const [name, declaration] of Object.entries(schema.buffers)) {
    const buffer = buffers.get(declaration.id);
    if (buffer === undefined) throw new Error(`${label} draw is missing its "${name}" Codec buffer`);
    resolved[name] = buffer;
  }
  return resolved as { readonly [Name in keyof Buffers]: RetainedBuffer };
}

function runInstance(): THREE.Node<'uint'> {
  const runStart = TSL.uniform(0, 'uint').onObjectUpdate(
    ({ object }) => (object?.userData.pmndrsGlyphRunStart as number | undefined) ?? 0,
  );
  return TSL.instanceIndex.add(runStart);
}

/** Storage nodes created since the last realization was retained; realization is synchronous and not re-entrant. */
let createdStorageNodes: MaterialStorageNode[] = [];

function takeStorageNodes(): readonly MaterialStorageNode[] {
  const taken = createdStorageNodes;
  createdStorageNodes = [];
  return taken;
}

function storageLane<Type extends 'vec2' | 'vec4' | 'uvec2' | 'uint'>(buffer: RetainedBuffer, type: Type) {
  const node = TSL.storage(buffer.attribute, type, buffer.attribute.count).setPBO(true);
  createdStorageNodes.push({ node, lane: buffer.codecBufferId });
  return node;
}

/**
 * The successor attribute for each storage node, or `undefined` when the graph cannot move: a lane has no successor,
 * or the node was compiled for WebGL2, where Three bakes a storage attribute into a texture at build time.
 */
function successorStorage(
  storage: readonly MaterialStorageNode[],
  lanes: readonly RetainedBuffer[],
): MaterialRealization['pendingStorage'] {
  const successors: (readonly [MaterialStorageNode['node'], THREE.StorageInstancedBufferAttribute])[] = [];
  for (const { node, lane } of storage) {
    const successor = lanes.find((buffer) => buffer.codecBufferId === lane);
    if (successor === undefined || 'pbo' in node.value) return undefined;
    successors.push([node, successor.attribute]);
  }
  return successors;
}

const storageVec2 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>): THREE.Node<'vec2'> =>
  storageLane(buffer, 'vec2').element(instance);
const storageVec4 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>): THREE.Node<'vec4'> =>
  storageLane(buffer, 'vec4').element(instance);
const storageUvec2 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>): THREE.Node<'uvec2'> =>
  storageLane(buffer, 'uvec2').element(instance);
const storageUint = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>): THREE.Node<'uint'> =>
  storageLane(buffer, 'uint').element(instance);

function glyphStorageProgramKey(buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>): string {
  const stableIds = buffers.get(threeSystemBuffers.stableGlyphId.id);
  return stableIds === undefined ? 'glyph-storage:none' : `glyph-storage:${glyphStorageKey(stableIds)}`;
}

function materialBuffers(
  required: readonly RetainedBuffer[],
  transform: TransformRealization,
): readonly RetainedBuffer[] {
  const buffers = new Map(required.map((buffer) => [buffer.binding, buffer]));
  if (transform.kind === 'indexed') buffers.set(transform.indices.binding, transform.indices);
  return [...buffers.values()];
}

function indexedTransformNodes(
  indices: RetainedBuffer,
  transforms: THREE.StorageInstancedBufferAttribute,
  instance: THREE.Node<'uint'>,
) {
  const transformIndex = storageUint(indices, instance);
  return affineColumns(transforms, transformIndex.mul(4));
}

/** One column-major 4x4 stored as four consecutive vec4 records. */
function affineColumns(transforms: THREE.StorageInstancedBufferAttribute, firstColumn: THREE.Node<'uint'>) {
  const table = TSL.storage(transforms, 'vec4', transforms.count).setPBO(true);
  const column0 = table.element(firstColumn);
  const column1 = table.element(firstColumn.add(1));
  const column2 = table.element(firstColumn.add(2));
  const column3 = table.element(firstColumn.add(3));
  return {
    matrix: TSL.mat4(column0, column1, column2, column3),
    position(position: THREE.Node<'vec3'>): THREE.Node<'vec3'> {
      const local = TSL.vec4(position, 1);
      return column0.mul(local.x).add(column1.mul(local.y)).add(column2.mul(local.z)).add(column3.mul(local.w)).xyz;
    },
  };
}

/**
 * A vertex graph (a position, or a per-glyph fact read from instance storage) that is safe to read from either stage.
 *
 * The vertex stage reads the graph itself, so a material passing a position to `positionNode` compiles to the default
 * material's vertex program; a three.js `vertexStage()` varying there instead loses a TypeGPU-backed graph's
 * `positionLocal` on WebGL2. The fragment stage reads the graph's vertex-computed varying: the position of the
 * rasterized surface, interpolated from the corners actually drawn, rather than the graph re-run per fragment (where
 * Slug's graph would assign its coverage varying, an immutable fragment input, and an instance read has no instance).
 * Three interpolates an integer varying flat.
 */
class StageNode extends THREE.Node {
  readonly node: THREE.Node;
  readonly interpolated: THREE.Node;

  constructor(node: THREE.Node, type: 'vec3' | 'uint' | 'float') {
    super(type);
    this.node = node;
    this.interpolated = TSL.vertexStage(node);
  }

  #stageNode(builder: THREE.NodeBuilder): THREE.Node {
    // three 0.185.1 sets `NodeBuilder.shaderStage` while building each stage; @types/three 0.185.4 declares only a
    // stub of the builder, so the field is read untyped and compared, never trusted as a type.
    return Reflect.get(builder, 'shaderStage') === 'fragment' ? this.interpolated : this.node;
  }

  // Only the graph a stage reads is set up and analyzed there, so the vertex stage never builds the unused varying.
  override setup(): null {
    return null;
  }

  override analyze(builder: THREE.NodeBuilder): void {
    this.#stageNode(builder).build(builder, this);
  }

  override generate(builder: THREE.NodeBuilder, output?: string | null): string {
    return this.#stageNode(builder).build(builder, output) as string;
  }
}

function stageNode<Type extends 'vec3' | 'uint' | 'float'>(node: THREE.Node<Type>, type: Type): THREE.Node<Type> {
  // The wrapper builds whichever of two graphs of `type` its stage reads, so it is a node of that type.
  const staged: THREE.Node = new StageNode(node, type);
  return TSL.nodeObject(staged) as THREE.Node<Type>;
}

function unpublishedGlyphFact(name: 'glyphIndex' | 'glyphOrigin'): TypeError {
  return new TypeError(
    `text material read ${name}, which its handle does not publish; create the handle with defineThreeConfig({ glyphFacts: true })`,
  );
}

/** A context of a handle that publishes no glyph facts: reading either one says how to get them. */
function withoutGlyphFacts<Context extends object>(
  context: Context,
): Context & { readonly glyphIndex: never; readonly glyphOrigin: never } {
  return {
    ...context,
    get glyphIndex(): never {
      throw unpublishedGlyphFact('glyphIndex');
    },
    get glyphOrigin(): never {
      throw unpublishedGlyphFact('glyphOrigin');
    },
  };
}

/**
 * A decoration rectangle's facts. Its record names the first and last glyph it runs under, and a line's glyphs are
 * indexed in the order they are drawn, so the index at a point of the rectangle is the mix of the two along its inline
 * axis: each end takes exactly its glyph's index. The unit quad's own `x` spans the rectangle from 0 to 1; it is read
 * from the geometry because Three reassigns `positionLocal` to the material's `positionNode` before it evaluates the
 * varying a fragment read goes through.
 */
function decorationFacts(lanes: GlyphFactLanes | undefined, instance: THREE.Node<'uint'>): RawMaterialNodes['glyph'] {
  if (lanes === undefined) return undefined;
  const record = storageVec4(lanes.facts, instance);
  return { span: TSL.mix(record.z, record.w, TSL.positionGeometry.x), origin: record.xy };
}

function glyphFacts(
  lanes: GlyphFactLanes | undefined,
  instance: THREE.Node<'uint'>,
  placementOffset: THREE.Node<'vec2'>,
): RawMaterialNodes['glyph'] {
  if (lanes === undefined) return undefined;
  const record = storageVec4(lanes.facts, instance);
  return { index: TSL.uint(record.z), origin: record.xy.add(placementOffset) };
}

function bitmapMaterial(
  shader: Readonly<{ clipPosition: THREE.Node<'vec4'>; color: THREE.Node<'vec3'>; opacity: THREE.Node<'float'> }>,
  position: THREE.Node<'vec3'>,
): THREE.MeshBasicNodeMaterial {
  const material = baseTextMaterial();
  material.positionNode = position;
  material.vertexNode = shader.clipPosition;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;
  return material;
}

function coverageMaterial(
  shader: Readonly<{ color: THREE.Node<'vec3'>; opacity: THREE.Node<'float'> }>,
  position: THREE.Node<'vec3'>,
): THREE.MeshBasicNodeMaterial {
  const material = baseTextMaterial();
  material.positionNode = position;
  material.colorNode = shader.color;
  material.opacityNode = shader.opacity;
  return material;
}

function baseTextMaterial(): THREE.MeshBasicNodeMaterial {
  return new THREE.MeshBasicNodeMaterial({
    blending: THREE.NormalBlending,
    depthTest: false,
    depthWrite: false,
    // Three draws a transparent double-sided material twice (back faces, then front faces). Text quads are
    // coplanar and never depth-tested, so one pass with culling off produces the same pixels in half the draws.
    forceSinglePass: true,
    side: THREE.DoubleSide,
    transparent: true,
  });
}
