import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import type { CodecBufferDeclaration, CodecBufferDeclarations, TechniqueSchemaMetadata } from '../../config/schema.js';
import type { PortableResourceGroupPayload, PortableTextureArrayPayload } from '../../config/resources.js';
import { bitmapSchema, bitmap } from '../../raster/bitmap.js';
import { msdfSchema } from '../../raster/msdf.js';
import { msdf } from '../../raster/msdf.js';
import { slugSchema } from '../../raster/slug.js';
import { slug } from '../../raster/slug.js';
import { bitmapShader } from '../../tsl/bitmap-shader.js';
import { decorationShader } from '../../tsl/decoration-shader.js';
import { msdfShader } from '../../tsl/msdf-shader.js';
import { slugShader } from '../../tsl/slug-shader.js';
import type { ThreeRendererResources } from './renderer-resources.js';
import type { ThreeRootContext, ThreeTextMaterialContext } from '../material.js';
import type { ThreeRasterProgramBuffer } from '../raster-program.js';
import { decorationSchema, threeSystemBuffers } from '../codec.js';
import type { ThreeResolvedMaterialBinding, ThreeResolvedResourceBinding } from '../handle.js';
import type { RetainedBuffer, ThreeBufferBindingId } from './host-buffer.js';
import {
  dataTexture,
  f32BufferMember,
  f32x3BufferMember,
  ownedUint16,
  ownedUint32,
  resourceGroup,
  textureArrayMember,
  textureArrayResource,
  textureMember,
} from './portable-resource.js';
import type {
  PreparationContext,
  RecordAddressing,
  RetainedResource,
  RetainedSlugPage,
  ThreeHostResource,
  TransformRealization,
} from './render-state.js';

type MaterialSelection = ThreeResolvedMaterialBinding | undefined;

interface ThreeMaterialOwner {
  readonly renderObject: THREE.Object3D;
  readonly pixelSnapping?: boolean;
  readonly root?: ThreeRootContext;
  glyphStorage?(storageKey: string):
    | Readonly<{
        transforms: THREE.StorageInstancedBufferAttribute;
        pivots: THREE.StorageInstancedBufferAttribute;
      }>
    | undefined;
}

interface ThreeMaterialRealizerOptions {
  readonly coordinator: ThreeRendererResources;
  readonly owner: ThreeMaterialOwner;
  readonly context: PreparationContext;
  readonly ownedMaterials: WeakSet<THREE.NodeMaterial>;
  readonly bindingId: (value: object) => number;
}

/** Realizes program-specific Three materials and GPU resources inside one publication transaction. */
export class ThreeMaterialRealizer {
  readonly #coordinator: ThreeRendererResources;
  readonly #owner: ThreeMaterialOwner;
  readonly #context: PreparationContext;
  readonly #ownedMaterials: WeakSet<THREE.NodeMaterial>;
  readonly #bindingId: (value: object) => number;

  constructor(options: ThreeMaterialRealizerOptions) {
    this.#coordinator = options.coordinator;
    this.#owner = options.owner;
    this.#context = options.context;
    this.#ownedMaterials = options.ownedMaterials;
    this.#bindingId = options.bindingId;
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
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const rect = buffers.get(decorationSchema.buffers.rect.id);
    const packed = buffers.get(decorationSchema.buffers.packed.id);
    if (rect === undefined || packed === undefined) {
      throw new Error('decoration draw is missing its rectangle or packed Codec buffer');
    }
    const key = `decoration:${this.key(selection)}:${rect.storageKey}:${packed.storageKey}:${transformProgramKey(
      transform,
      this.#context.transformGeneration,
    )}:${addressingProgramKey(addressing)}`;
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const instance = physicalInstance(runInstance(), addressing);
    const shader = decorationShader({
      rect: TSL.storage(rect.attribute, 'vec4', rect.attribute.count).setPBO(true).element(instance),
      packed: TSL.storage(packed.attribute, 'uvec2', packed.attribute.count).setPBO(true).element(instance),
    });
    const position = this.#position(shader.position, instance, buffers, transform);
    const material = this.#createMaterial(selection, {
      root: this.#root(selection),
      kind: 'decoration',
      shader,
      position,
      createDefaultMaterial: () => coverageMaterial(shader, position),
    });
    this.#retain(key, material, undefined, materialBuffers([rect, packed], transform, addressing), transform.kind);
    return material;
  }

  glyph(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const resolved = resource.resolved;
    if (resolved.format === bitmap.id) return this.#bitmap(resource, buffers, selection, transform, addressing);
    if (resolved.format === msdf.id) return this.#msdf(resource, buffers, selection, transform, addressing);
    if (resolved.format === slug.id) return this.#slug(resource, buffers, selection, transform, addressing);
    if (resolved.program !== undefined) {
      return this.#external(
        resource,
        { ...resolved, program: resolved.program },
        buffers,
        selection,
        transform,
        addressing,
      );
    }
    throw new Error('this Three plan target does not recognize the draw technique');
  }

  #bitmap(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const atlas = textureArrayResource(resource.resolved, 'atlas', 'r8unorm', 'Bitmap');
    const part = schemaDrawBuffers(bitmapSchema, buffers, 'Bitmap');
    const required = [part.origin, part.size, part.uvOrigin, part.uvSize, part.color, part.page];
    const key = this.#cacheKey('bitmap', resource, selection, required, buffers, transform, addressing, [
      `snap=${String(this.#owner.pixelSnapping ?? selection?.pixelSnapping ?? false)}`,
    ]);
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const texture = this.#textureArray(resource.binding, atlas, 'bitmap');
    const instance = physicalInstance(runInstance(), addressing);
    const shader = bitmapShader(
      {
        origin: storageVec2(part.origin, instance),
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
    const material = this.#createMaterial(selection, {
      root: this.#root(selection),
      kind: 'glyph',
      format: bitmap.id,
      shader,
      position,
      createDefaultMaterial: () => bitmapMaterial(shader, position),
    });
    this.#retain(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #msdf(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const atlas = resourceGroup(resource.resolved, 'atlas', 'MSDF');
    const data = textureArrayMember(atlas, 'texture', 'rgba8unorm', 'MSDF');
    const part = schemaDrawBuffers(msdfSchema, buffers, 'MSDF');
    const required = [part.rect, part.uvRect, part.uvBounds, part.color, part.effectColor, part.page];
    const key = this.#cacheKey('msdf', resource, selection, required, buffers, transform, addressing);
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const instance = physicalInstance(runInstance(), addressing);
    const field = (buffer: RetainedBuffer) => storageVec4(buffer, instance);
    const rect = field(part.rect);
    const uvRect = field(part.uvRect);
    const page = field(part.page);
    const shader = msdfShader(
      {
        origin: rect.xy,
        size: rect.zw,
        uvOrigin: uvRect.xy,
        uvSize: uvRect.zw,
        uvBounds: field(part.uvBounds),
        fillColor: field(part.color),
        effectColor: storageUvec2(part.effectColor, instance),
        shadowOffset: page.xy.mul(TSL.vec2(...f32x3BufferMember(atlas, 'effectScale', 'MSDF').slice(0, 2))),
        outlineWidth: page.z.mul(f32x3BufferMember(atlas, 'effectScale', 'MSDF')[2]),
        pageIndex: page.w,
      },
      {
        atlas: this.#textureArray(resource.binding, data, 'msdf'),
        atlasWidth: data.width,
        atlasHeight: data.height,
        pixelRange: f32BufferMember(atlas, 'pixelRange', 'MSDF'),
      },
    );
    const position = this.#position(shader.position, instance, buffers, transform);
    const material = this.#createMaterial(selection, {
      root: this.#root(selection),
      kind: 'glyph',
      format: msdf.id,
      shader,
      position,
      createDefaultMaterial: () => coverageMaterial(shader, position),
    });
    this.#retain(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #slug(
    resource: RetainedResource,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const page = resourceGroup(resource.resolved, 'page', 'Slug');
    const part = schemaDrawBuffers(slugSchema, buffers, 'Slug');
    const required = [
      part.rect,
      part.planeRect,
      part.bandTransform,
      part.color,
      part.inverseFontSize,
      part.tableStarts,
      part.bandCounts,
    ];
    const key = this.#cacheKey('slug', resource, selection, required, buffers, transform, addressing);
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const instance = physicalInstance(runInstance(), addressing);
    const field = (buffer: RetainedBuffer) => storageVec4(buffer, instance);
    const rect = field(part.rect);
    const planeRect = field(part.planeRect);
    const addresses = storageUvec4(part.tableStarts, instance);
    const counts = storageUvec4(part.bandCounts, instance);
    const indexed =
      transform.kind === 'indexed'
        ? indexedTransformNodes(transform.indices.attribute, this.#context.transformAttribute, instance)
        : undefined;
    const modelViewProjection =
      indexed === undefined
        ? TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix)
        : TSL.cameraProjectionMatrix.mul(TSL.modelViewMatrix).mul(indexed.matrix);
    const viewport = TSL.uniform(new THREE.Vector2(1, 1)).onRenderUpdate(({ renderer }, self) =>
      renderer?.getDrawingBufferSize(self.value),
    );
    const shader = slugShader(
      {
        origin: rect.xy,
        size: rect.zw,
        emOrigin: planeRect.xy,
        emSize: planeRect.zw,
        bandTransform: field(part.bandTransform),
        color: field(part.color),
        inverseScale: field(part.inverseFontSize).x,
        curveBaseTexel: addresses.x,
        horizontalHeaderBase: addresses.y,
        verticalHeaderBase: addresses.z,
        referenceBase: addresses.w,
        horizontalBandCount: counts.x,
        verticalBandCount: counts.y,
      },
      { page: this.#slugPage(resource.binding, page), viewport, modelViewProjection },
    );
    const glyphPosition = this.#glyphPosition(shader.position, instance, buffers);
    const position = indexed?.position(glyphPosition) ?? glyphPosition;
    const material = this.#createMaterial(selection, {
      root: this.#root(selection),
      kind: 'glyph',
      format: slug.id,
      shader,
      position,
      createDefaultMaterial: () => coverageMaterial(shader, position),
    });
    this.#retain(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #external(
    resource: RetainedResource,
    resolved: ThreeHostResource & { readonly program: NonNullable<ThreeHostResource['program']> },
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    selection: MaterialSelection,
    transform: TransformRealization,
    addressing: RecordAddressing,
  ): THREE.NodeMaterial {
    const required = [...buffers.values()];
    const key = this.#cacheKey('external', resource, selection, required, buffers, transform, addressing);
    const cached = this.#context.materials.get(key);
    if (cached !== undefined) return cached.material;
    const instance = physicalInstance(runInstance(), addressing);
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
        transformPosition: (position) => this.#position(position, instance, buffers, transform),
      }),
    );
    this.#retain(key, material, resource, materialBuffers(required, transform, addressing), transform.kind);
    return material;
  }

  #cacheKey(
    kind: string,
    resource: RetainedResource,
    material: MaterialSelection,
    required: readonly RetainedBuffer[],
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
    addressing: RecordAddressing,
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
      addressingProgramKey(addressing),
    ].join(':');
  }

  #position(
    position: THREE.Node<'vec3'>,
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
    transform: TransformRealization,
  ): THREE.Node<'vec3'> {
    const glyphPosition = this.#glyphPosition(position, instance, buffers);
    return transform.kind === 'indexed'
      ? indexedTransformNodes(transform.indices.attribute, this.#context.transformAttribute, instance).position(
          glyphPosition,
        )
      : glyphPosition;
  }

  #glyphPosition(
    position: THREE.Node<'vec3'>,
    instance: THREE.Node<'uint'>,
    buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>,
  ): THREE.Node<'vec3'> {
    const stableIds = buffers.get(threeSystemBuffers.stableGlyphId.id);
    const retained = stableIds === undefined ? undefined : this.#owner.glyphStorage?.(glyphStorageKey(stableIds));
    if (retained === undefined) return position;
    const pivot = TSL.storage(retained.pivots, 'vec2', retained.pivots.count).setPBO(true).element(instance);
    const table = TSL.storage(retained.transforms, 'vec4', retained.transforms.count).setPBO(true);
    const firstColumn = instance.mul(4);
    const column0 = table.element(firstColumn);
    const column1 = table.element(firstColumn.add(1));
    const column2 = table.element(firstColumn.add(2));
    const column3 = table.element(firstColumn.add(3));
    const local = TSL.vec4(position.x.sub(pivot.x), position.y.sub(pivot.y), position.z, 1);
    return column0.mul(local.x).add(column1.mul(local.y)).add(column2.mul(local.z)).add(column3.mul(local.w)).xyz;
  }

  #textureArray(
    binding: ThreeResolvedResourceBinding,
    data: PortableTextureArrayPayload,
    kind: 'bitmap' | 'msdf',
  ): THREE.DataArrayTexture {
    const textures = kind === 'bitmap' ? this.#context.bitmapTextures : this.#context.msdfAtlases;
    let lease = textures.get(binding);
    if (lease !== undefined) return lease.resource;
    lease = this.#coordinator.acquireRenderResource(data, () => {
      const texture = new THREE.DataArrayTexture(data.bytes, data.width, data.height, data.layers);
      texture.format = kind === 'bitmap' ? THREE.RedFormat : THREE.RGBAFormat;
      texture.type = THREE.UnsignedByteType;
      texture.colorSpace = THREE.NoColorSpace;
      texture.magFilter = THREE.LinearFilter;
      texture.minFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    });
    this.#context.newTextures.add(lease);
    textures.set(binding, lease);
    return lease.resource;
  }

  #slugPage(binding: ThreeResolvedResourceBinding, data: PortableResourceGroupPayload): RetainedSlugPage {
    let lease = this.#context.slugPages.get(binding);
    if (lease !== undefined) return lease.resource;
    lease = this.#coordinator.acquireRenderResource(data, () => {
      const curves = textureMember(data, 'curves', 'rgba16float', 'Slug');
      const headers = textureMember(data, 'headers', 'r32uint', 'Slug');
      const references = textureMember(data, 'references', 'r32uint', 'Slug');
      const curveBytes = ownedUint16(curves.bytes);
      const headerBytes = ownedUint32(headers.bytes);
      const referenceBytes = ownedUint32(references.bytes);
      const curveTexture = dataTexture(curveBytes, curves.width, curves.height, THREE.RGBAFormat, THREE.HalfFloatType);
      const headerTexture = dataTexture(
        headerBytes,
        headers.width,
        headers.height,
        THREE.RedIntegerFormat,
        THREE.UnsignedIntType,
      );
      const referenceTexture = dataTexture(
        referenceBytes,
        references.width,
        references.height,
        THREE.RedIntegerFormat,
        THREE.UnsignedIntType,
      );
      return {
        curveTexture,
        curveWidth: curves.width,
        headerTexture,
        headerWidth: headers.width,
        referenceTexture,
        referenceWidth: references.width,
        byteLength: curveBytes.byteLength + headerBytes.byteLength + referenceBytes.byteLength,
        dispose() {
          curveTexture.dispose();
          headerTexture.dispose();
          referenceTexture.dispose();
        },
      };
    });
    this.#context.newTextures.add(lease);
    this.#context.slugPages.set(binding, lease);
    return lease.resource;
  }

  #createMaterial(selection: MaterialSelection, context: ThreeTextMaterialContext): THREE.NodeMaterial {
    return this.#own(selection?.material?.create(context) ?? context.createDefaultMaterial());
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
  ): void {
    this.#context.materials.set(key, {
      material,
      resource: resource?.binding,
      buffers: buffers.map(({ binding }) => binding),
      indexedTransform: transformKind === 'indexed',
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

export function physicalRecordIndex(order: RetainedBuffer | undefined, logical: number): number {
  return order === undefined ? logical : (order.array as Uint32Array)[logical]!;
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

function physicalInstance(logical: THREE.Node<'uint'>, addressing: RecordAddressing): THREE.Node<'uint'> {
  return addressing.order === undefined
    ? logical
    : TSL.storage(addressing.order.attribute, 'uint', addressing.order.attribute.count).setPBO(true).element(logical);
}

const storageVec2 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>) =>
  TSL.storage(buffer.attribute, 'vec2', buffer.attribute.count).setPBO(true).element(instance);
const storageVec4 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>) =>
  TSL.storage(buffer.attribute, 'vec4', buffer.attribute.count).setPBO(true).element(instance);
const storageUvec2 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>) =>
  TSL.storage(buffer.attribute, 'uvec2', buffer.attribute.count).setPBO(true).element(instance);
const storageUvec4 = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>) =>
  TSL.storage(buffer.attribute, 'uvec4', buffer.attribute.count).setPBO(true).element(instance);
const storageUint = (buffer: RetainedBuffer, instance: THREE.Node<'uint'>) =>
  TSL.storage(buffer.attribute, 'uint', buffer.attribute.count).setPBO(true).element(instance);

function glyphStorageProgramKey(buffers: ReadonlyMap<ThreeBufferBindingId, RetainedBuffer>): string {
  const stableIds = buffers.get(threeSystemBuffers.stableGlyphId.id);
  return stableIds === undefined ? 'glyph-storage:none' : `glyph-storage:${glyphStorageKey(stableIds)}`;
}

function addressingProgramKey(addressing: RecordAddressing): string {
  return addressing.order === undefined ? 'ordered' : `stable:${addressing.order.storageKey}`;
}

function materialBuffers(
  required: readonly RetainedBuffer[],
  transform: TransformRealization,
  addressing: RecordAddressing,
): readonly RetainedBuffer[] {
  const buffers = new Map(required.map((buffer) => [buffer.binding, buffer]));
  if (transform.kind === 'indexed') buffers.set(transform.indices.binding, transform.indices);
  if (addressing.order !== undefined) buffers.set(addressing.order.binding, addressing.order);
  return [...buffers.values()];
}

function indexedTransformNodes(
  indexAttribute: THREE.StorageInstancedBufferAttribute,
  transforms: THREE.StorageInstancedBufferAttribute,
  instance: THREE.Node<'uint'>,
) {
  const transformIndex = TSL.storage(indexAttribute, 'uint', indexAttribute.count).setPBO(true).element(instance);
  const firstColumn = transformIndex.mul(4);
  const table = TSL.storage(transforms, 'vec4', transforms.count).setPBO(true);
  const column0 = table.element(firstColumn);
  const column1 = table.element(firstColumn.add(1));
  const column2 = table.element(firstColumn.add(2));
  const column3 = table.element(firstColumn.add(3));
  return {
    matrix: TSL.mat4(column0, column1, column2, column3),
    position(position: THREE.Node<'vec3'>) {
      const local = TSL.vec4(position, 1);
      return column0.mul(local.x).add(column1.mul(local.y)).add(column2.mul(local.z)).add(column3.mul(local.w)).xyz;
    },
  };
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
    side: THREE.DoubleSide,
    transparent: true,
  });
}
