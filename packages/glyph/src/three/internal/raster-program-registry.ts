import { createRasterCodecProgram, type RasterCodec } from '../../config/raster.js';
import type { CodecIdFactory, CodecProgram } from '../../config/codec.js';
import type { TechniqueSchemaMetadata } from '../../config/schema.js';
import type { RasterFormatMetadata } from '../../config/raster-format.js';
import { threeCodecCapabilitySet, threeSystemBuffers } from '../codec.js';
import type { ThreeRasterMaterialContext } from '../raster-program.js';
import type { NodeMaterial } from 'three/webgpu';

export interface RuntimeThreeRasterVariant {
  readonly id: string;
  readonly language: string;
  readonly outputs: Readonly<Record<string, string>>;
  createMaterial(context: ThreeRasterMaterialContext): NodeMaterial;
}

export interface CompiledThreeRasterProgram {
  readonly raster: RasterFormatMetadata;
  readonly schema: TechniqueSchemaMetadata;
  readonly variant: RuntimeThreeRasterVariant;
  readonly techniqueId: number;
  readonly programId: number;
  readonly codec: CodecProgram;
  createMaterial: RuntimeThreeRasterVariant['createMaterial'];
}

export interface RegisteredThreeRasterProgram {
  readonly techniqueId: string;
  readonly variantId: string;
  compile(identities: CodecIdFactory, transformMode: 'indexed' | 'direct'): CompiledThreeRasterProgram;
}

const programs = new Map<string, RegisteredThreeRasterProgram>();
const registeredSources = new WeakMap<object, RegisteredThreeRasterProgram>();
const snapshotsByRegistry = new WeakMap<CodecIdFactory, WeakRef<CodecIdFactory>[]>();
const snapshotReferences = new Set<WeakRef<CodecIdFactory>>();
const snapshotFinalizer = new FinalizationRegistry<WeakRef<CodecIdFactory>>((reference) => {
  snapshotReferences.delete(reference);
});

export function registeredThreeRasterProgram(source: object): RegisteredThreeRasterProgram | undefined {
  return registeredSources.get(source);
}

export function commitThreeRasterProgram<Format extends RasterFormatMetadata, Schema extends TechniqueSchemaMetadata>(
  source: object,
  codec: RasterCodec<Format, Schema>,
  variant: RuntimeThreeRasterVariant,
): void {
  const formatId = codec.raster.id;
  const existing = programs.get(formatId);
  if (existing !== undefined) {
    throw new TypeError(`Three already selected raster variant "${existing.variantId}" for format "${formatId}"`);
  }
  const engineCount = liveSnapshotCount();
  if (engineCount !== 0) {
    throw new Error(
      `Three raster variant "${formatId}/${variant.id}" was registered after ${engineCount} glyph engine(s) ` +
        'already read the registry; register every format before its first Text or TextGroup realization',
    );
  }
  const registered: RegisteredThreeRasterProgram = Object.freeze({
    techniqueId: formatId,
    variantId: variant.id,
    compile: (identities: CodecIdFactory, transformMode: 'indexed' | 'direct') =>
      compileProgram(codec, variant, identities, transformMode),
  });
  programs.set(formatId, registered);
  registeredSources.set(source, registered);
}

export function compiledThreeRasterPrograms(
  identities: CodecIdFactory,
  transformMode: 'indexed' | 'direct' = 'indexed',
): readonly CompiledThreeRasterProgram[] {
  const selected = [...programs.values()].sort((left, right) => left.techniqueId.localeCompare(right.techniqueId));
  const compiled = selected.map((program) => program.compile(identities, transformMode));
  const reference = new WeakRef(identities);
  const references = snapshotsByRegistry.get(identities) ?? [];
  references.push(reference);
  snapshotsByRegistry.set(identities, references);
  snapshotReferences.add(reference);
  snapshotFinalizer.register(identities, reference, reference);
  return compiled;
}

export function releaseThreeRasterProgramSnapshot(identities: CodecIdFactory): void {
  const references = snapshotsByRegistry.get(identities);
  if (references === undefined) return;
  const reference = references.pop();
  if (reference === undefined) return;
  snapshotFinalizer.unregister(reference);
  snapshotReferences.delete(reference);
  if (references.length === 0) snapshotsByRegistry.delete(identities);
}

function liveSnapshotCount(): number {
  let count = 0;
  for (const reference of snapshotReferences) {
    if (reference.deref() === undefined) snapshotReferences.delete(reference);
    else count += 1;
  }
  return count;
}

function compileProgram<Format extends RasterFormatMetadata, Schema extends TechniqueSchemaMetadata>(
  portable: RasterCodec<Format, Schema>,
  variant: RuntimeThreeRasterVariant,
  identities: CodecIdFactory,
  transformMode: 'indexed' | 'direct',
): CompiledThreeRasterProgram {
  const system = transformMode === 'indexed' ? threeSystemBuffers : { stableGlyphId: threeSystemBuffers.stableGlyphId };
  const codec = createRasterCodecProgram(portable, {
    namespace: 'three',
    system,
    capabilitySet: threeCodecCapabilitySet(),
    transformMode,
    allocationMode: 'ordered',
    ids: identities,
  });
  return {
    raster: portable.raster,
    schema: portable.schema,
    variant,
    techniqueId: codec.techniqueId,
    programId: codec.programId,
    codec,
    createMaterial: (context) => variant.createMaterial(context),
  };
}
