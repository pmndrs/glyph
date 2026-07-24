import type { FontInput, RegisteredFont } from './font.js'
import type { FontKey } from './identity.js'
import type { RegisteredRaster } from './raster.js'

export interface FontLoadOptions {
  readonly signal?: AbortSignal
}

export interface FontRegistry {
  registerAsset(bytes: ArrayBufferView): Promise<RegisteredFont>
  get(key: FontKey): RegisteredFont | undefined
  getByHandle(handle: RegisteredFont['handle']): RegisteredFont | undefined
}

/** Public loader contract; runtime implementation lands with the loader milestone. */
export interface FontLoader {
  load(input: FontInput, options?: FontLoadOptions): Promise<RegisteredFont>
  /** Primitive used by key- and module-typed raster loading paths. */
  attachRaster(font: RegisteredFont, bytes: ArrayBufferView): Promise<RegisteredRaster>
}
