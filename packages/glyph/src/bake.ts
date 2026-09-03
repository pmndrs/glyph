import type { JsonValue } from './raster.js';
import type { RasterKey, Sha256Hex } from './identity.js';

export type { BakeWarning, SerializedBakeError } from './font-baker/index.js';

export type BakeProgressPhase =
  | 'queued'
  | 'loading'
  | 'baking'
  | 'rasterizing'
  | 'packaging'
  | 'transferring'
  | 'complete';

export interface BakeProgress {
  readonly stage: 'font' | 'raster';
  readonly phase: BakeProgressPhase;
  readonly completed: number;
  readonly total: number;
}

export type BakeProgressListener = (progress: BakeProgress) => void;

export interface RasterPackaging {
  readonly artifact: 'embedded' | 'external';
  readonly pages: 'embedded' | 'external';
}

export interface BakeArtifact {
  readonly role: 'font' | 'raster' | 'raster-page';
  readonly id: string;
  readonly bytes: Uint8Array;
  readonly sha256: Sha256Hex;
}

export interface RasterBakeFontContext {
  readonly source: Uint8Array;
  readonly fontFaceIndex: number;
  readonly glyphCount: number;
  readonly shapingHash: Sha256Hex;
}

export interface RasterBakeRequest<Descriptor extends JsonValue> {
  readonly font: RasterBakeFontContext;
  readonly rasterKey: RasterKey;
  readonly packaging: RasterPackaging;
  readonly descriptor: Descriptor;
  readonly signal?: AbortSignal;
  readonly onProgress?: BakeProgressListener;
}

export interface RasterPayloadReport {
  readonly metadataBytes: number;
  readonly serializedBytes: number;
  readonly gpuBytes: number;
  readonly pages: readonly RasterPagePayloadReport[];
}

export interface RasterPagePayloadReport {
  readonly width: number;
  readonly height: number;
  readonly format: string;
  readonly gpuBytes: number;
  readonly source: 'embedded' | 'external';
  readonly encodedBytes: number;
}

export interface FontPayloadReport {
  readonly source: { readonly bytes: number };
  readonly shared: Readonly<Record<string, { readonly rawBytes: number; readonly [key: string]: unknown }>>;
  readonly rasters: readonly {
    readonly kind: string;
    readonly metadataBytes: number;
    readonly serializedBytes: number;
    readonly gpuBytes: number;
    readonly pages: readonly RasterPagePayloadReport[];
  }[];
  readonly containers: readonly {
    readonly artifactId: string;
    readonly role: BakeArtifact['role'];
    readonly jsonBytes: number;
    readonly paddingBytes: number;
    readonly totalBytes: number;
  }[];
  readonly transport: readonly {
    readonly artifactId: string;
    readonly format: string;
    readonly bytes: number;
  }[];
}

export interface RasterBakeArtifact<Kind extends string = string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly artifacts: readonly BakeArtifact[];
  readonly report: RasterPayloadReport;
}

export interface RasterBakerModule<Kind extends string, Options, Descriptor extends JsonValue> {
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  descriptor(options: Options): Descriptor;
  bake(request: RasterBakeRequest<Descriptor>): Promise<RasterBakeArtifact<Kind>>;
}

export type RasterBakeOptionsOf<Module> =
  Module extends RasterBakerModule<string, infer Options, JsonValue> ? Options : never;

export type RasterBakeDescriptorOf<Module> =
  Module extends RasterBakerModule<string, infer _Options, infer Descriptor extends JsonValue> ? Descriptor : never;

export function defineRasterBaker<const Kind extends string, Options, Descriptor extends JsonValue>(
  module: RasterBakerModule<Kind, Options, Descriptor>,
): RasterBakerModule<Kind, Options, Descriptor> {
  return module;
}

export type RasterBakePlan<Module> =
  Module extends RasterBakerModule<string, infer Options, JsonValue>
    ? {
        readonly baker: Module;
        readonly packaging: RasterPackaging;
        readonly options: Options;
      }
    : never;

export function rasterBake<Module>(
  baker: Module,
  options: Omit<RasterBakePlan<Module>, 'baker'>,
): RasterBakePlan<Module>;

export function rasterBake<Kind extends string, Options, Descriptor extends JsonValue>(
  baker: RasterBakerModule<Kind, Options, Descriptor>,
  options: { readonly packaging: RasterPackaging; readonly options: Options },
) {
  return { baker, ...options };
}
