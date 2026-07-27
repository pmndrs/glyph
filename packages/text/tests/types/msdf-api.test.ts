import type { RegisteredFont, RegisteredRaster } from '@pmndrs/text'
import {
  MSDF_KIND,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
  type MsdfDrawBatch,
  type MsdfResource,
} from '@pmndrs/text/raster/msdf'

const descriptor = msdfDescriptor()
const kind: 'msdf' = MSDF_KIND
const requestModule = msdf
declare const font: RegisteredFont
declare const raster: RegisteredRaster<'msdf'>
const resource: Promise<MsdfResource> = requestModule.decode(font, raster)
declare const batch: MsdfDrawBatch

void descriptor
void kind
void resource
void batch
void msdfDescriptorRasterKey()
