import { bitmapDescriptor, bitmapRasterKey, type BitmapOptions } from '@pmndrs/text/raster/bitmap'

const inline = bitmapDescriptor({ strikes: [16, 32] })
const tuple = [16, 32] as const
const fromTuple = bitmapDescriptor({ strikes: tuple })
void inline
void fromTuple

const configured: BitmapOptions<typeof tuple> = { strikes: tuple }
void bitmapRasterKey(configured)

declare const dynamicStrike: number
declare const dynamicStrikes: number[]

// @ts-expect-error Strike values must be literal numbers.
bitmapDescriptor({ strikes: [dynamicStrike] })
// @ts-expect-error Strikes must be non-empty.
bitmapDescriptor({ strikes: [] })
// @ts-expect-error Broad arrays cannot describe bake-time payloads.
bitmapDescriptor({ strikes: dynamicStrikes })
