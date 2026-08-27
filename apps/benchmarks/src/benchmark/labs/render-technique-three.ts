import { FontRegistry, type AnyRasterTechnique, type LoadedFont } from '@pmndrs/glyph';
import { createTextRuntime } from '@pmndrs/glyph/core';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { Text, TextGroup } from '@pmndrs/glyph/three';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import * as THREE from 'three/webgpu';

import { registerExternalGlyphExampleThree } from '../targets/product/external-raster-three';
import {
  createFontDeliveryMetrics,
  measuredRuntimeFontBake,
  sourceUrlForFixture,
} from '../../workloads/font-assets/runtime';

registerExternalGlyphExampleThree();

const INITIAL_TEXT = 'PUBLICRASTER';
const UPDATED_TEXT = 'PLUGINUPDATE';

export interface RenderTechniqueThreeLabReport {
  readonly samples: number;
  readonly warmup: number;
  readonly genericFontLoadMs: number;
  readonly bitmapFontLoadMs: number;
  readonly generic: RenderTechniqueThreeLabResult;
  readonly bitmap: RenderTechniqueThreeLabResult;
  readonly warmMedianRatio: number;
}

export interface RenderTechniqueThreeLabResult {
  readonly firstRealizationMs: number;
  readonly warmMedianMs: number;
  readonly warmP95Ms: number;
  readonly draws: number;
  readonly instances: number;
  readonly retainedGeometry: boolean;
}

export async function runRenderTechniqueThreeLab({
  samples = 101,
  warmup = 20,
}: {
  readonly samples?: number;
  readonly warmup?: number;
} = {}): Promise<RenderTechniqueThreeLabReport> {
  assertCount(samples, 'samples', 1);
  assertCount(warmup, 'warmup', 0);
  const runtime = await createTextRuntime({ registry: new FontRegistry() });
  let genericFont: LoadedFont<typeof glyphExample> | undefined;
  let bitmapFont: LoadedFont<typeof bitmap> | undefined;
  try {
    const genericStarted = performance.now();
    genericFont = await runtime.loadFont({
      input: {
        source: sourceUrlForFixture('inter'),
        runtimeBake: measuredRuntimeFontBake(createFontDeliveryMetrics('runtime')),
      },
      raster: { technique: glyphExample, options: { paletteSeed: 17, inset: 0.1 } },
    });
    const genericFontLoadMs = performance.now() - genericStarted;

    const bitmapStarted = performance.now();
    bitmapFont = await runtime.loadFont({
      input: {
        source: sourceUrlForFixture('inter'),
        runtimeBake: measuredRuntimeFontBake(createFontDeliveryMetrics('runtime')),
      },
      raster: { technique: bitmap, options: { strikes: [16] } },
    });
    const bitmapFontLoadMs = performance.now() - bitmapStarted;

    const generic = measureTechnique(genericFont, warmup, samples);
    const bitmapResult = measureTechnique(bitmapFont, warmup, samples);
    if (generic.instances !== bitmapResult.instances) {
      throw new Error(
        `Three render-technique lab compared ${generic.instances} generic instances with ${bitmapResult.instances} Bitmap instances`,
      );
    }
    return Object.freeze({
      samples,
      warmup,
      genericFontLoadMs,
      bitmapFontLoadMs,
      generic,
      bitmap: bitmapResult,
      warmMedianRatio: generic.warmMedianMs / bitmapResult.warmMedianMs,
    });
  } finally {
    genericFont?.dispose();
    bitmapFont?.dispose();
    runtime.dispose();
  }
}

function measureTechnique(
  font: LoadedFont<AnyRasterTechnique>,
  warmup: number,
  samples: number,
): RenderTechniqueThreeLabResult {
  const firstStarted = performance.now();
  const text = new Text({ font, text: INITIAL_TEXT, style: { fontSize: 48 } });
  const group = new TextGroup();
  const scene = new THREE.Scene();
  group.add(text);
  scene.add(group);
  scene.updateMatrixWorld(true);
  const firstRealizationMs = performance.now() - firstStarted;
  try {
    if (group.error !== undefined) throw group.error;
    const draw = onlyDraw(group);
    const geometry = draw.geometry;
    if (!(geometry instanceof THREE.InstancedBufferGeometry)) {
      throw new TypeError('Three render-technique lab expected instanced geometry');
    }
    if (!Number.isSafeInteger(geometry.instanceCount) || geometry.instanceCount < 1) {
      throw new Error('Three render-technique lab expected a non-empty draw');
    }
    for (let index = 0; index < warmup; index += 1) update(index, text, scene, group, draw, geometry);
    const durations: number[] = [];
    for (let index = 0; index < samples; index += 1) {
      const started = performance.now();
      update(index + warmup, text, scene, group, draw, geometry);
      durations.push(performance.now() - started);
    }
    const ordered = durations.toSorted((left, right) => left - right);
    return Object.freeze({
      firstRealizationMs,
      warmMedianMs: percentile(ordered, 0.5),
      warmP95Ms: percentile(ordered, 0.95),
      draws: group.children.filter((child) => child instanceof THREE.Mesh).length,
      instances: geometry.instanceCount,
      retainedGeometry: onlyDraw(group).geometry === geometry,
    });
  } finally {
    group.dispose();
    text.dispose();
  }
}

function update(
  index: number,
  text: Text<AnyRasterTechnique>,
  scene: THREE.Scene,
  group: TextGroup,
  draw: THREE.Mesh,
  geometry: THREE.BufferGeometry,
): void {
  text.text = index % 2 === 0 ? UPDATED_TEXT : INITIAL_TEXT;
  scene.updateMatrixWorld(true);
  if (group.error !== undefined) throw group.error;
  const current = onlyDraw(group);
  if (current !== draw || current.geometry !== geometry) {
    throw new Error('Three render-technique lab lost its retained draw or geometry');
  }
}

function onlyDraw(group: TextGroup): THREE.Mesh {
  const draws = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  if (draws.length !== 1) throw new Error(`Three render-technique lab expected one draw, received ${draws.length}`);
  return draws[0]!;
}

function percentile(ordered: readonly number[], quantile: number): number {
  const index = Math.min(ordered.length - 1, Math.max(0, Math.ceil(ordered.length * quantile) - 1));
  return ordered[index]!;
}

function assertCount(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`Three render-technique lab ${label} must be an integer of at least ${minimum}`);
  }
}
