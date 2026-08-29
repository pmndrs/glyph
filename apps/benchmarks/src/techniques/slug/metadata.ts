import type { SlugCpuReferenceData } from '../../benchmark/low-level/raster/slug-cpu-reference';

/**
 * Renderer-neutral Slug page allocation. Every byte figure counts decoded resource bytes the technique retains, not
 * GPU residency: a renderer repacks the 16-bit reference table before upload, so only the renderer can report what it
 * actually holds. Read retained GPU bytes from `Text.gpuBytes` or `TextGroup.gpuBytes` instead.
 */
export interface SlugRasterConfiguration {
  readonly planeUnitsPerEm: number;
  readonly pageCount: number;
  readonly curveTexelCount: number;
  readonly curveBytes: number;
  readonly headerCount: number;
  readonly headerBytes: number;
  readonly referenceCount: number;
  readonly referenceBytes: number;
  readonly resourceBytes: number;
}

/** Reports the stable allocation configuration of the Slug resource a font load already decoded. */
export function slugDataConfiguration(data: SlugCpuReferenceData): SlugRasterConfiguration {
  let curveTexelCount = 0;
  let curveBytes = 0;
  let headerCount = 0;
  let headerBytes = 0;
  let referenceCount = 0;
  let referenceBytes = 0;
  for (const page of data.pages) {
    curveTexelCount += page.curveWidth * page.curveHeight;
    curveBytes += page.curveBytes.byteLength;
    headerCount += page.headerCount;
    headerBytes += page.headerBytes.byteLength;
    referenceCount += page.referenceCount;
    referenceBytes += page.referenceBytes.byteLength;
  }
  return {
    planeUnitsPerEm: data.planeUnitsPerEm,
    pageCount: data.pages.length,
    curveTexelCount,
    curveBytes,
    headerCount,
    headerBytes,
    referenceCount,
    referenceBytes,
    resourceBytes: curveBytes + headerBytes + referenceBytes,
  };
}
