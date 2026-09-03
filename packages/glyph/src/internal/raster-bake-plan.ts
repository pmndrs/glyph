import type {
  RasterBakeArtifact,
  RasterBakePlan,
  RasterBakeRequest,
  RasterBakerModule,
  RasterPackaging,
} from '../bake.js';
import type { RasterKey } from '../identity.js';
import type { JsonValue } from '../raster.js';
import { deriveRasterKey } from './raster-identity.js';

interface ResolvedRasterBaker {
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  bake(request: RasterBakeRequest<JsonValue>): Promise<RasterBakeArtifact>;
}

export interface ResolvedRasterBakePlan {
  readonly baker: ResolvedRasterBaker;
  readonly packaging: RasterPackaging;
  readonly descriptor: JsonValue;
  readonly rasterKey: RasterKey;
}

/** Package one concrete baker/descriptor association for the heterogeneous pipeline queue. */
export function createResolvedRasterBakePlan<Kind extends string, Descriptor extends JsonValue>(
  baker: {
    readonly kind: Kind;
    readonly extension: string;
    readonly version: number;
    bake(request: RasterBakeRequest<Descriptor>): Promise<RasterBakeArtifact<Kind>>;
  },
  packaging: RasterPackaging,
  descriptor: Descriptor,
  rasterKey: RasterKey,
): ResolvedRasterBakePlan {
  return {
    baker: {
      kind: baker.kind,
      extension: baker.extension,
      version: baker.version,
      bake(request) {
        const { descriptor: _resolvedDescriptor, ...rest } = request;
        return baker.bake({ ...rest, descriptor });
      },
    },
    packaging,
    descriptor,
    rasterKey,
  };
}

/** Resolve plugin-owned identity exactly once before ordering or baking. */
export function resolveRasterBakePlan<Module>(plan: RasterBakePlan<Module>): Promise<ResolvedRasterBakePlan>;

export async function resolveRasterBakePlan<Kind extends string, Options, Descriptor extends JsonValue>(plan: {
  readonly baker: RasterBakerModule<Kind, Options, Descriptor>;
  readonly packaging: RasterPackaging;
  readonly options: Options;
}): Promise<ResolvedRasterBakePlan> {
  const descriptor = plan.baker.descriptor(plan.options);
  const rasterKey = await deriveRasterKey({
    descriptor,
    extension: plan.baker.extension,
    kind: plan.baker.kind,
    version: plan.baker.version,
  });
  return createResolvedRasterBakePlan(plan.baker, plan.packaging, descriptor, rasterKey);
}
