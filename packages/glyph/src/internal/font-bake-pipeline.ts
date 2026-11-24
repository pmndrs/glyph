import type { BakeProgressListener, BakeWarning } from '../bake.js';
import type { FontBakeCore, PreparedFontReport } from '../font-baker/index.js';

import { composeFontBake, type ComposedFontBakeResult } from './compose-bake.js';
import { soleCoreFontArtifact } from './core-bake-policy.js';
import { readRuntimeFontArtifact } from './font-artifact-reader.js';
import { prepareBakeSource } from './bake-source.js';
import type { ResolvedRasterBakePlan } from './raster-bake-plan.js';

export interface FontBakePipelineOptions {
  readonly fontBaker: FontBakeCore;
  readonly source: Uint8Array;
  readonly fontFaceIndex: number;
  readonly outlines?: boolean;
  readonly unicodeRanges?: readonly { readonly start: number; readonly end: number }[];
  /** `--layout-features` tokens; omitted keeps hb-subset's default list. */
  readonly layoutFeatures?: readonly string[];
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
  /** Absent when the source could not be prepared and was baked as it is (see `warning`). */
  readonly preparation?: PreparedFontReport;
  readonly warning?: BakeWarning;
  readonly timings: FontBakePipelineTimings;
}

/** Prepare once, then feed the exact prepared bytes to the shaping core and every requested raster baker. */
export async function bakeFontPipeline(options: FontBakePipelineOptions): Promise<FontBakePipelineResult> {
  const timings = { coreBake: 0, rasterBake: 0, compose: 0, validate: 0 };
  options.signal?.throwIfAborted();

  let phase = performance.now();
  const prepared = prepareBakeSource(
    options.fontBaker,
    options.source,
    options.fontFaceIndex,
    options.unicodeRanges,
    options.layoutFeatures,
  );
  const source = prepared.bytes;
  const preparation = prepared.preparation;
  const fontFaceIndex = preparation?.fontFaceIndex ?? options.fontFaceIndex;
  const dropped = preparation?.droppedLayoutFeatures;
  const core = options.fontBaker.bake({
    source,
    descriptor: {
      formatVersion: 0,
      fontFaceIndex,
      ...(options.outlines === undefined ? {} : { outlines: options.outlines }),
      ...(dropped === undefined ? {} : { droppedLayoutFeatures: dropped }),
    },
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
    ...(preparation === undefined ? {} : { preparation }),
    ...(prepared.warning === undefined ? {} : { warning: prepared.warning }),
    timings,
  };
}
