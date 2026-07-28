import type { RegisteredFont, RegisteredRaster } from '@pmndrs/text'
import {
  SLUG_KIND,
  slug,
  slugDescriptor,
  slugDescriptorRasterKey,
  type SlugDrawBatch,
  type SlugResource,
} from '@pmndrs/text/raster/slug'

const descriptor = slugDescriptor()
const kind: 'slug' = SLUG_KIND
declare const font: RegisteredFont
declare const raster: RegisteredRaster<'slug'>
const resource: Promise<SlugResource> = slug.decode(font, raster)
declare const batch: SlugDrawBatch

void descriptor
void kind
void resource
void batch
void slugDescriptorRasterKey()
