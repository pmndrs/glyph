import type { BakeProgressListener } from '../bake.js';
import type { FontBakeCore, PreparedFontReport } from '../font-baker/index.js';
import { validateFontArtifact } from '../font-baker/validator.js';
import type { Sha256Hex } from '../identity.js';

import { composeFontBake, type ComposedFontBakeResult } from './compose-bake.js';
import { soleCoreFontArtifact } from './core-bake-policy.js';
import { normalizeUnicodeRanges } from './font-selection.js';
import type { ResolvedRasterBakePlan } from './raster-bake-plan.js';

export interface FontBakePipelineOptions {
  readonly fontBaker: FontBakeCore;
  readonly source: Uint8Array;
  readonly fontFaceIndex: number;
  readonly unicodeRanges?: readonly { readonly start: number; readonly end: number }[];
  readonly rasters: readonly ResolvedRasterBakePlan[];
  readonly signal?: AbortSignal;
  readonly onProgress?: BakeProgressListener;
}

export interface FontBakePipelineTimings {
  readonly coreBake: number;
  readonly rasterBake: number;
  readonly compose: number;
  readonly validate: number;
}

export interface FontBakePipelineResult {
  readonly composed: ComposedFontBakeResult;
  readonly preparation?: PreparedFontReport;
  readonly timings: FontBakePipelineTimings;
}

/** Prepare once, then feed the exact prepared bytes to the shaping core and every requested raster baker. */
export async function bakeFontPipeline(options: FontBakePipelineOptions): Promise<FontBakePipelineResult> {
  const timings = { coreBake: 0, rasterBake: 0, compose: 0, validate: 0 };
  options.signal?.throwIfAborted();

  let phase = performance.now();
  const preparation =
    options.unicodeRanges === undefined
      ? undefined
      : options.fontBaker.prepare({
          source: options.source,
          selection: {
            formatVersion: 0,
            fontFaceIndex: options.fontFaceIndex,
            unicodeRanges: normalizeUnicodeRanges(options.unicodeRanges),
          },
        });
  const source = preparation?.bytes ?? options.source;
  const fontFaceIndex = preparation?.report.fontFaceIndex ?? options.fontFaceIndex;
  const core = options.fontBaker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex },
  });
  timings.coreBake = performance.now() - phase;
  options.signal?.throwIfAborted();

  phase = performance.now();
  const coreValidation = await validateFontArtifact(soleCoreFontArtifact(core).bytes);
  timings.validate += performance.now() - phase;

  phase = performance.now();
  const rasters = [];
  for (const plan of options.rasters) {
    options.signal?.throwIfAborted();
    const raster = await plan.baker.bake({
      font: {
        source,
        fontFaceIndex,
        glyphCount: coreValidation.glyphCount,
        shapingHash: coreValidation.shapingHash as Sha256Hex,
      },
      rasterKey: plan.rasterKey,
      packaging: plan.packaging,
      descriptor: plan.descriptor,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
    rasters.push({ raster, packaging: plan.packaging });
  }
  timings.rasterBake = performance.now() - phase;

  phase = performance.now();
  const composed = await composeFontBake(core, rasters);
  timings.compose = performance.now() - phase;
  options.signal?.throwIfAborted();

  phase = performance.now();
  await validateFontArtifact(composed.artifacts[0]!.bytes);
  timings.validate += performance.now() - phase;

  return {
    composed,
    ...(preparation === undefined ? {} : { preparation: preparation.report }),
    timings,
  };
}
