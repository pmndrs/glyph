import type { RegisteredFont, RegisteredRaster } from '@pmndrs/text';
import { SLUG_KIND, slug, slugDescriptor, slugDescriptorRasterKey, type SlugData } from '@pmndrs/text/raster/slug';

const descriptor = slugDescriptor();
const kind: 'slug' = SLUG_KIND;
declare const font: RegisteredFont;
declare const raster: RegisteredRaster<'slug'>;
const data: Promise<SlugData> = slug.decode(font, raster);

void descriptor;
void kind;
void data;
void slugDescriptorRasterKey();
