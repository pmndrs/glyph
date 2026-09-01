import type { BakeProgressListener } from '../bake.js';
import type { FontBakeCore, PreparedFontReport } from '../font-baker/index.js';

import { composeFontBake, type ComposedFontBakeResult } from './compose-bake.js';
import { soleCoreFontArtifact } from './core-bake-policy.js';
import { readRuntimeFontArtifact } from './font-artifact-reader.js';
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
  /** Optional bake/CI validation. Runtime baking trusts package-produced artifacts. */
  readonly validateArtifact?: (bytes: Uint8Array) => Promise<unknown>;
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

  const coreArtifact = soleCoreFontArtifact(core);
  if (options.validateArtifact !== undefined) {
    phase = performance.now();
    await options.validateArtifact(coreArtifact.bytes);
    timings.validate += performance.now() - phase;
  }
  const coreFont = readRuntimeFontArtifact(coreArtifact.bytes);

  phase = performance.now();
  const rasters = [];
  for (const plan of options.rasters) {
    options.signal?.throwIfAborted();
    const raster = await plan.baker.bake({
      font: {
        source,
        sourceFingerprint: coreFont.sourceFingerprint,
        fontFaceIndex,
        glyphCount: coreFont.extension.metrics.glyphCount,
        shapingFingerprint: coreFont.shapingFingerprint,
      },
      rasterKey: plan.rasterKey,
      packaging: plan.packaging,
      descriptor: plan.descriptor,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
    });
    rasters.push({
      raster,
      packaging: plan.packaging,
      ...(plan.companionName === undefined ? {} : { companionName: plan.companionName }),
    });
  }
  timings.rasterBake = performance.now() - phase;

  phase = performance.now();
  const composed = await composeFontBake(core, rasters);
  timings.compose = performance.now() - phase;
  options.signal?.throwIfAborted();

  if (options.validateArtifact !== undefined) {
    phase = performance.now();
    await options.validateArtifact(composed.artifacts[0]!.bytes);
    timings.validate += performance.now() - phase;
  }

  return {
    composed,
    ...(preparation === undefined ? {} : { preparation: preparation.report }),
    timings,
  };
}
