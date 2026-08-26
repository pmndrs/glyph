import { createTextRuntime, FontRegistry } from '@pmndrs/glyph';
import { id, textRuntimeShaper } from '@pmndrs/glyph/core';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import { ExampleTextEngine, TypeGpuExampleRendererDevice } from '@pmndrs/glyph-example-renderer';

import {
  createFontDeliveryMetrics,
  measuredRuntimeFontBake,
  sourceUrlForFixture,
} from '../../workloads/font-assets/runtime';

const STACK_HANDLE = id('font-stack', 'labs/typegpu-example/font-stack');
const SESSION_HANDLE = id('session', 'labs/typegpu-example/session');

export interface RenderTechniqueTypeGpuLabReport {
  readonly initialDraws: number;
  readonly updatedDraws: number;
  readonly initialVisiblePixels: number;
  readonly updatedVisiblePixels: number;
  readonly changedPixels: number;
  readonly idleGpuSubmissions: number;
  readonly clearGpuSubmissions: number;
  readonly clearedVisiblePixels: number;
}

/** Runs the external-renderer contract through a real WebGPU device and reads its RGBA target back. */
export async function runRenderTechniqueTypeGpuLab(): Promise<RenderTechniqueTypeGpuLabReport> {
  if (navigator.gpu === undefined) throw new Error('the TypeGPU renderer lab requires WebGPU');
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('the TypeGPU renderer lab could not acquire a WebGPU adapter');
  const gpuDevice = await adapter.requestDevice();
  const runtime = await createTextRuntime({ registry: new FontRegistry() });
  const renderer = new TypeGpuExampleRendererDevice({ device: gpuDevice, width: 768, height: 192 });
  const engine = new ExampleTextEngine(textRuntimeShaper(runtime), renderer);
  let font;
  try {
    font = await runtime.loadFont({
      input: {
        source: sourceUrlForFixture('inter'),
        runtimeBake: measuredRuntimeFontBake(createFontDeliveryMetrics('runtime')),
      },
      raster: { technique: glyphExample, options: { paletteSeed: 17, inset: 0.08 } },
    });
    const binding = engine.registerFont(font);
    engine.registerFontStack(STACK_HANDLE, [binding]);
    engine.openSession(SESSION_HANDLE);
    const text = engine.createText({
      fontStack: STACK_HANDLE,
      text: 'Portable TypeGPU',
      fontSize: 64,
      width: 768,
      height: 192,
    });
    let textDisposed = false;
    try {
      const initial = await text.render();
      const initialPixels = await renderer.readPixels();
      text.update({ text: 'Updated WebGPU', foregroundRgba: 0xff40_a0ff });
      const updated = await text.render();
      const updatedPixels = await renderer.readPixels();
      const submissionsBeforeIdle = renderer.submittedPasses;
      if (submissionsBeforeIdle !== 2) throw new Error('the TypeGPU renderer lab expected two visible GPU submissions');
      await text.render();
      const idleGpuSubmissions = renderer.submittedPasses - submissionsBeforeIdle;
      const submissionsBeforeDispose = renderer.submittedPasses;
      await text.dispose();
      textDisposed = true;
      const clearedPixels = await renderer.readPixels();
      const report = Object.freeze({
        initialDraws: initial.draws.length,
        updatedDraws: updated.draws.length,
        initialVisiblePixels: visiblePixelCount(initialPixels),
        updatedVisiblePixels: visiblePixelCount(updatedPixels),
        changedPixels: changedPixelCount(initialPixels, updatedPixels),
        idleGpuSubmissions,
        clearGpuSubmissions: renderer.submittedPasses - submissionsBeforeDispose,
        clearedVisiblePixels: visiblePixelCount(clearedPixels),
      });
      if (report.initialDraws === 0 || report.updatedDraws === 0) {
        throw new Error('the TypeGPU renderer lab produced an empty draw list');
      }
      if (
        report.initialVisiblePixels === 0 ||
        report.updatedVisiblePixels === 0 ||
        report.changedPixels === 0 ||
        report.idleGpuSubmissions !== 0 ||
        report.clearGpuSubmissions !== 1 ||
        report.clearedVisiblePixels !== 0
      ) {
        throw new Error('the TypeGPU renderer lab did not produce changing visible pixels');
      }
      return report;
    } finally {
      if (!textDisposed) await text.dispose();
    }
  } finally {
    engine.dispose();
    font?.dispose();
    renderer.dispose();
    runtime.dispose();
    gpuDevice.destroy();
  }
}

function visiblePixelCount(pixels: Uint8Array): number {
  let count = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) count += 1;
  }
  return count;
}

function changedPixelCount(left: Uint8Array, right: Uint8Array): number {
  if (left.length !== right.length) throw new RangeError('TypeGPU renderer pixel snapshots need equal dimensions');
  let count = 0;
  for (let index = 0; index < left.length; index += 4) {
    if (
      left[index] !== right[index] ||
      left[index + 1] !== right[index + 1] ||
      left[index + 2] !== right[index + 2] ||
      left[index + 3] !== right[index + 3]
    ) {
      count += 1;
    }
  }
  return count;
}
