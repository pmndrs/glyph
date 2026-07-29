import type { AnyRasterBakerModule, RasterBakePlan } from '../bake.js';
import type { RasterKey } from '../identity.js';
import type { JsonValue } from '../raster.js';
import { deriveRasterKey } from './raster-identity.js';

export interface ResolvedRasterBakePlan extends RasterBakePlan<AnyRasterBakerModule> {
  readonly descriptor: JsonValue;
  readonly rasterKey: RasterKey;
}

/** Resolve plugin-owned identity exactly once before ordering or baking. */
export async function resolveRasterBakePlan(
  plan: RasterBakePlan<AnyRasterBakerModule>,
): Promise<ResolvedRasterBakePlan> {
  const descriptor = plan.baker.descriptor(plan.options);
  const rasterKey = await deriveRasterKey({
    descriptor,
    extension: plan.baker.extension,
    kind: plan.baker.kind,
    version: plan.baker.version,
  });
  return { ...plan, descriptor, rasterKey };
}
