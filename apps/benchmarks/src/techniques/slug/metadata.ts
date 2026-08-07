import { type RegisteredFont } from '@pmndrs/text';
import { slug, slugDescriptorRasterKey, type SlugResource } from '@pmndrs/text/raster/slug/v0';

export interface SlugRasterConfiguration {
  readonly planeUnitsPerEm: number;
  readonly pageCount: number;
  readonly curveTexelCount: number;
  readonly curveGpuBytes: number;
  readonly headerCount: number;
  readonly headerGpuBytes: number;
  readonly referenceCount: number;
  readonly referenceGpuBytes: number;
  readonly gpuBytes: number;
}

/** Decodes and releases Slug resources solely to report their stable allocation configuration. */
export async function registeredSlugConfiguration(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<SlugRasterConfiguration> {
  const rasterKey = await slugDescriptorRasterKey();
  const raster = await font.loadRaster({ kind: slug.kind, rasterKey }, signal === undefined ? undefined : { signal });
  const resource = await slug.decode(font, raster, signal);
  try {
    return slugResourceConfiguration(resource);
  } finally {
    slug.dispose(resource);
  }
}

function slugResourceConfiguration(resource: SlugResource): SlugRasterConfiguration {
  let curveTexelCount = 0;
  let curveGpuBytes = 0;
  let headerCount = 0;
  let headerGpuBytes = 0;
  let referenceCount = 0;
  let referenceGpuBytes = 0;
  for (const page of resource.pages) {
    const curveAllocation = page.curveWidth * page.curveHeight * 8;
    const headerAllocation = page.headerWidth * page.headerHeight * 4;
    const referenceAllocation = page.referenceWidth * page.referenceHeight * 4;
    curveTexelCount += page.curveWidth * page.curveHeight;
    curveGpuBytes += curveAllocation;
    headerCount += page.headerCount;
    headerGpuBytes += headerAllocation;
    referenceCount += page.referenceCount;
    referenceGpuBytes += referenceAllocation;
  }
  const allocationTotal = curveGpuBytes + headerGpuBytes + referenceGpuBytes;
  if (allocationTotal !== resource.gpuBytes) {
    throw new Error('Slug page allocations do not match the decoded resource GPU byte total');
  }
  return {
    planeUnitsPerEm: resource.planeUnitsPerEm,
    pageCount: resource.pages.length,
    curveTexelCount,
    curveGpuBytes,
    headerCount,
    headerGpuBytes,
    referenceCount,
    referenceGpuBytes,
    gpuBytes: resource.gpuBytes,
  };
}
