import type {
  AnyRasterModule,
  AnyRasterInput,
  RasterLoadOptions,
  RasterReference,
  RasterRequest,
  RasterOptionsOf,
  RasterSelection,
  RegisteredRaster,
} from './raster.js'
import type { FontHandle, FontKey, RasterKey, Sha256Hex } from './identity.js'

export interface FontMetrics {
  readonly unitsPerEm: number
  readonly ascender: number
  readonly descender: number
  readonly lineGap: number
}

export interface RegisteredFont {
  readonly key: FontKey
  readonly handle: FontHandle
  readonly shapingHash: Sha256Hex
  readonly glyphCount: number
  readonly glyphIdWidth: 16
  readonly metrics: FontMetrics
  readonly rasterReferences: readonly RasterReference[]

  getRaster(rasterKey: RasterKey | string): RegisteredRaster | undefined

  loadRaster(
    selection: RasterSelection,
    options?: RasterLoadOptions,
  ): Promise<RegisteredRaster>

  dispose(): void
}

export interface FontSourceOverride {
  readonly source: string | URL
  readonly baked?: string | URL
}

export interface BakedFontSource {
  readonly baked: string | URL
  readonly source?: never
}

export type FontInput = string | URL | FontSourceOverride | BakedFontSource

export interface FontToken<
  Module extends AnyRasterModule,
  Input extends FontInput = FontInput,
> {
  readonly input: Input
  readonly raster: RasterRequest<Module>
}

export interface AnyFontToken {
  readonly input: FontInput
  readonly raster: {
    readonly module: AnyRasterModule
    readonly options?: unknown
  }
}

export type FontInputOf<Token extends AnyFontToken> =
  Token['input']

export type FontRasterModuleOf<Token extends AnyFontToken> =
  Token['raster']['module']

export function defineFont<
  const Input extends FontInput,
  const Module extends AnyRasterModule,
>(
  input: Input,
  raster: Module & ([RasterOptionsOf<Module>] extends [never] ? unknown : never),
): FontToken<Module, Input>

export function defineFont<
  const Input extends FontInput,
  const Module extends AnyRasterModule,
>(
  input: Input,
  raster: RasterRequest<Module>,
): FontToken<Module, Input>

export function defineFont(
  input: FontInput,
  raster: AnyRasterInput,
): AnyFontToken {
  return {
    input,
    raster: 'module' in raster ? raster : { module: raster },
  }
}
