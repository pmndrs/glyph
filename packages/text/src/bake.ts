import type { RasterKey, Sha256Hex } from './identity.js'

export type RasterPackaging = 'embedded' | 'external'

export interface RasterBakeFontContext {
  readonly source: Uint8Array
  readonly fontFaceIndex: number
  readonly glyphCount: number
  readonly shapingHash: Sha256Hex
}

export interface RasterBakeRequest<Descriptor> {
  readonly font: RasterBakeFontContext
  readonly rasterKey: RasterKey
  readonly packaging: RasterPackaging
  readonly descriptor: Descriptor
  readonly signal?: AbortSignal
}

export interface RasterPayloadReport {
  readonly metadataBytes: number
  readonly serializedBytes: number
  readonly gpuBytes: number
}

export interface FontPayloadReport {
  readonly source: { readonly bytes: number }
  readonly shared: Readonly<Record<string, { readonly rawBytes: number }>>
  readonly rasters: readonly {
    readonly kind: string
    readonly metadataBytes: number
    readonly serializedBytes: number
    readonly gpuBytes: number
    readonly pages: readonly {
      readonly width: number
      readonly height: number
      readonly format: string
      readonly mipBytes: number
    }[]
  }[]
  readonly container: {
    readonly jsonBytes: number
    readonly paddingBytes: number
    readonly totalBytes: number
  }
  readonly transport: readonly { readonly format: string; readonly bytes: number }[]
}

export interface BakeWarning {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface SerializedBakeError {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export interface RasterBakeArtifact<Kind extends string = string> {
  readonly rasterKey: RasterKey
  readonly kind: Kind
  readonly extension: string
  readonly version: number
  readonly bytes: Uint8Array
  readonly report: RasterPayloadReport
}

export interface RasterBakerModule<
  Kind extends string,
  Options,
  Descriptor,
> {
  readonly kind: Kind
  readonly extension: string
  readonly version: number
  descriptor(options: Options): Descriptor
  bake(request: RasterBakeRequest<Descriptor>): Promise<RasterBakeArtifact<Kind>>
}

export type AnyRasterBakerModule = RasterBakerModule<string, any, any>

export type RasterBakeOptionsOf<Module extends AnyRasterBakerModule> =
  Module extends RasterBakerModule<any, infer Options, any> ? Options : never

export type RasterBakeDescriptorOf<Module extends AnyRasterBakerModule> =
  Module extends RasterBakerModule<any, any, infer Descriptor>
    ? Descriptor
    : never

export function defineRasterBaker<
  const Kind extends string,
  Options,
  Descriptor,
>(
  module: RasterBakerModule<Kind, Options, Descriptor>,
): RasterBakerModule<Kind, Options, Descriptor> {
  return module
}

export interface RasterBakePlan<Module extends AnyRasterBakerModule> {
  readonly baker: Module
  readonly packaging: RasterPackaging
  readonly options: RasterBakeOptionsOf<Module>
}

export function rasterBake<Module extends AnyRasterBakerModule>(
  baker: Module,
  options: Omit<RasterBakePlan<Module>, 'baker'>,
): RasterBakePlan<Module> {
  return { baker, ...options }
}
