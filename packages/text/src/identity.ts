declare const brand: unique symbol

type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name
}

export type FontHandle = Brand<number, 'FontHandle'>
export type RasterHandle = Brand<number, 'RasterHandle'>
export type FontKey = Brand<string, 'FontKey'>
export type RasterKey = Brand<string, 'RasterKey'>
export type Sha256Hex = Brand<string, 'Sha256Hex'>

export type LocalGlyphId = number
export type FontSlot = number
