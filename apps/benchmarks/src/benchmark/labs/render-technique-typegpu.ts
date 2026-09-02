import { createFontStack, glyph, loadFont } from '@pmndrs/glyph';
import { glyphExample } from '@pmndrs/glyph-example-raster';
import {
  defineExampleConfig,
  TypeGpuExampleRendererDevice,
  type ExampleHandle,
  type ExampleText,
} from '@pmndrs/glyph-example-renderer';

import {
  createFontDeliveryMetrics,
  measuredRuntimeFontBake,
  sourceUrlForFixture,
} from '../../workloads/font-assets/runtime';

const SUBMISSION_WARMUP = 20;
const SUBMISSION_SAMPLES = 101;

/** Hardware-backed draw, recovery, and submission evidence from the TypeGPU lab. */
export interface RenderTechniqueTypeGpuLabReport {
  readonly initialDraws: number;
  readonly updatedDraws: number;
  readonly initialVisiblePixels: number;
  readonly updatedVisiblePixels: number;
  readonly changedPixels: number;
  readonly recoveredDraws: number;
  readonly recoveredVisiblePixels: number;
  readonly idleGpuSubmissions: number;
  readonly clearGpuSubmissions: number;
  readonly clearedVisiblePixels: number;
  readonly submissionMedianMs: number;
  readonly submissionP95Ms: number;
}

/** Runs the external-renderer contract through a real WebGPU device and reads its RGBA target back. */
export async function runRenderTechniqueTypeGpuLab(): Promise<RenderTechniqueTypeGpuLabReport> {
  if (navigator.gpu === undefined) throw new Error('the TypeGPU renderer lab requires WebGPU');
  await glyph.init();
  let gpuDevice = await requestGpuDevice();
  let renderer = new TypeGpuExampleRendererDevice({ device: gpuDevice, width: 768, height: 192 });
  const devices = [gpuDevice];
  const renderers = [renderer];
  let handle: ExampleHandle = glyph.handle('benchmark:typegpu:primary', defineExampleConfig(renderer));
  let font;
  let binding;
  let text: ExampleText | undefined;
  let textDisposed = false;
  try {
    font = await loadFont(
      {
        source: sourceUrlForFixture('inter'),
        runtimeBake: measuredRuntimeFontBake(createFontDeliveryMetrics('runtime')),
      },
      { technique: glyphExample, options: { paletteSeed: 17, inset: 0.08 } },
    );
    binding = handle.bindFontStack(createFontStack(font));
    text = handle.createText({
      font: binding,
      text: 'Portable TypeGPU',
      fontSize: 64,
      width: 768,
      height: 192,
    });
    try {
      const initial = text.publish();
      const initialPixels = await renderer.readPixels();
      text.update({ text: 'Updated WebGPU', color: '#ff40a0' });
      const updated = text.publish();
      const updatedPixels = await renderer.readPixels();
      gpuDevice.destroy();
      text.dispose();
      binding.dispose();
      handle.dispose();
      gpuDevice = await requestGpuDevice();
      devices.push(gpuDevice);
      renderer = new TypeGpuExampleRendererDevice({ device: gpuDevice, width: 768, height: 192 });
      renderers.push(renderer);
      handle = glyph.handle('benchmark:typegpu:recovered', defineExampleConfig(renderer));
      binding = handle.bindFontStack(createFontStack(font));
      text = handle.createText({
        font: binding,
        text: 'Updated WebGPU',
        color: '#ff40a0',
        fontSize: 64,
        width: 768,
        height: 192,
      });
      const recovered = text.publish();
      const recoveredPixels = await renderer.readPixels();
      const submissionSamples: number[] = [];
      for (let index = 0; index < SUBMISSION_WARMUP + SUBMISSION_SAMPLES; index += 1) {
        text.update({ text: index % 2 === 0 ? 'Pipeline WebGPU' : 'Updated WebGPU' });
        const started = performance.now();
        const sampled = text.publish();
        const duration = performance.now() - started;
        if (sampled.draws.length === 0) throw new Error('the TypeGPU submission benchmark produced no draw');
        if (index >= SUBMISSION_WARMUP) submissionSamples.push(duration);
      }
      submissionSamples.sort((left, right) => left - right);
      const submissionsBeforeIdle = renderer.submittedPasses;
      if (submissionsBeforeIdle !== 1 + SUBMISSION_WARMUP + SUBMISSION_SAMPLES) {
        throw new Error('the TypeGPU renderer lab did not submit every measured frame');
      }
      text.publish();
      const idleGpuSubmissions = renderer.submittedPasses - submissionsBeforeIdle;
      const submissionsBeforeDispose = renderer.submittedPasses;
      text.dispose();
      handle.publish();
      textDisposed = true;
      const clearedPixels = await renderer.readPixels();
      const report = Object.freeze({
        initialDraws: initial.draws.length,
        updatedDraws: updated.draws.length,
        initialVisiblePixels: visiblePixelCount(initialPixels),
        updatedVisiblePixels: visiblePixelCount(updatedPixels),
        changedPixels: changedPixelCount(initialPixels, updatedPixels),
        recoveredDraws: recovered.draws.length,
        recoveredVisiblePixels: visiblePixelCount(recoveredPixels),
        idleGpuSubmissions,
        clearGpuSubmissions: renderer.submittedPasses - submissionsBeforeDispose,
        clearedVisiblePixels: visiblePixelCount(clearedPixels),
        submissionMedianMs: percentile(submissionSamples, 0.5),
        submissionP95Ms: percentile(submissionSamples, 0.95),
      });
      if (report.initialDraws === 0 || report.updatedDraws === 0) {
        throw new Error('the TypeGPU renderer lab produced an empty draw list');
      }
      if (
        report.initialVisiblePixels === 0 ||
        report.updatedVisiblePixels === 0 ||
        report.changedPixels === 0 ||
        report.recoveredDraws === 0 ||
        report.recoveredVisiblePixels === 0 ||
        report.idleGpuSubmissions !== 0 ||
        report.clearGpuSubmissions !== 1 ||
        report.clearedVisiblePixels !== 0 ||
        !Number.isFinite(report.submissionMedianMs) ||
        !Number.isFinite(report.submissionP95Ms) ||
        report.submissionMedianMs <= 0 ||
        report.submissionP95Ms < report.submissionMedianMs
      ) {
        throw new Error('the TypeGPU renderer lab did not produce changing visible pixels');
      }
      return report;
    } finally {
      if (!textDisposed) text?.dispose();
      binding?.dispose();
    }
  } finally {
    handle.dispose();
    font?.dispose();
    for (const ownedRenderer of renderers.reverse()) ownedRenderer.dispose();
    for (const ownedDevice of devices.reverse()) ownedDevice.destroy();
  }
}

async function requestGpuDevice(): Promise<GPUDevice> {
  const adapter = await navigator.gpu.requestAdapter();
  if (adapter === null) throw new Error('the TypeGPU renderer lab could not acquire a WebGPU adapter');
  return adapter.requestDevice();
}

function percentile(sorted: readonly number[], quantile: number): number {
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * quantile));
  const value = sorted[index];
  if (value === undefined) throw new Error('TypeGPU submission benchmark produced no samples');
  return value;
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
