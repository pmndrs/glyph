import { createRasterCodecProgram, resolveRasterPlanProgram } from '../../config/raster.js';
import type { CodecIdFactory, CodecProgram } from '../../config/codec.js';
import type { AnyTechniqueSchema } from '../../config/schema.js';
import type { AnyRasterFormat } from '../../config/raster-format.js';
import { threeCodecCapabilitySet, threeSystemBuffers } from '../codec.js';
import type { ThreeRasterPlanProgram, ThreeRasterPlanVariant } from '../plan-program-registry.js';

export interface CompiledThreeRasterPlanProgram {
  readonly raster: AnyRasterFormat;
  readonly schema: AnyTechniqueSchema;
  readonly variant: ThreeRasterPlanVariant;
  readonly techniqueId: number;
  readonly programId: number;
  readonly codec: CodecProgram;
  createMaterial: ThreeRasterPlanVariant['createMaterial'];
}

const programs = new Map<string, ThreeRasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>>();
const registeredSources = new WeakMap<object, ThreeRasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>>();
const snapshotsByRegistry = new WeakMap<CodecIdFactory, WeakRef<CodecIdFactory>[]>();
const snapshotReferences = new Set<WeakRef<CodecIdFactory>>();
const snapshotFinalizer = new FinalizationRegistry<WeakRef<CodecIdFactory>>((reference) => {
  snapshotReferences.delete(reference);
});

export function registeredThreeRasterPlanProgram(
  source: object,
): ThreeRasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema> | undefined {
  return registeredSources.get(source);
}

export function commitThreeRasterPlanProgram(
  source: object,
  program: ThreeRasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>,
): void {
  const existing = programs.get(program.raster.id);
  if (existing !== undefined) {
    throw new TypeError(
      `Three already selected raster variant "${existing.variant.id}" for technique "${program.raster.id}"`,
    );
  }
  const engineCount = liveSnapshotCount();
  if (engineCount !== 0) {
    throw new Error(
      `Three raster variant "${program.raster.id}/${program.variant.id}" was registered after ${engineCount} glyph engine(s) ` +
        'already read the registry; register every technique before its first Text or TextGroup realization',
    );
  }
  programs.set(program.raster.id, program);
  registeredSources.set(source, program);
}

export function compiledThreeRasterPlanPrograms(
  identities: CodecIdFactory,
  transformMode: 'indexed' | 'direct' = 'indexed',
): readonly CompiledThreeRasterPlanProgram[] {
  const selected = [...programs.values()].sort((left, right) => left.raster.id.localeCompare(right.raster.id));
  const compiled = selected.map((program) => compileProgram(program, identities, transformMode));
  const reference = new WeakRef(identities);
  const references = snapshotsByRegistry.get(identities) ?? [];
  references.push(reference);
  snapshotsByRegistry.set(identities, references);
  snapshotReferences.add(reference);
  snapshotFinalizer.register(identities, reference, reference);
  return compiled;
}

export function releaseThreeRasterPlanProgramSnapshot(identities: CodecIdFactory): void {
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

function compileProgram(
  program: ThreeRasterPlanProgram<AnyRasterFormat, AnyTechniqueSchema>,
  identities: CodecIdFactory,
  transformMode: 'indexed' | 'direct',
): CompiledThreeRasterPlanProgram {
  const portable = resolveRasterPlanProgram(program.raster.id);
  if (portable === undefined)
    throw new Error(`no portable raster plan program is registered for "${program.raster.id}"`);
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
    raster: program.raster,
    schema: portable.schema,
    variant: program.variant,
    techniqueId: codec.techniqueId,
    programId: codec.programId,
    codec,
    createMaterial: (context) => program.variant.createMaterial(context),
  };
}
