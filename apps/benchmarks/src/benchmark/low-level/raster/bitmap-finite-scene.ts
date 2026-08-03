import { FontRegistry, type RegisteredFont } from '@pmndrs/text';
import { bitmap, bitmapRasterKey, type BitmapResource } from '@pmndrs/text/raster/bitmap';
import * as THREE from 'three/webgpu';

import { conformanceText, type BenchmarkFontFixture } from '../../font-fixtures';
import type { TargetRunOutput } from '../../contracts';
import type { FontDelivery } from '../../url-state';
import { loadBitmapFontAsset } from '../../../workloads/font-assets/bitmap';
import { createBitmapLine, disposeBitmapLine, type BitmapLine } from '../../../renderer/bitmap-line';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from '../../../renderer/webgpu-renderer';
import type { PersistentRenderSceneRenderer } from '../../../renderer/persistent-render-host';
import { withRendererStateRestored } from '../../../renderer/renderer-state-transaction';
import { compactRgba8Readback } from './rgba-readback';

export const BITMAP_FINITE_WIDTH = 384;
export const BITMAP_FINITE_HEIGHT = 128;
const CLIPPED_WIDTH = 192;
const CLIPPED_HEIGHT = 64;
const BITMAP_FONT_SIZE = 16;
const bitmapRequest = bitmap({ strikes: [16] as const });

interface BitmapReferencePage {
  readonly width: number;
  readonly height: number;
  readonly texels: Uint8Array;
}

interface BitmapReferenceStrike {
  readonly ppem: number;
  readonly planeUnitsPerEm: number;
  readonly records: Uint8Array;
  readonly pages: readonly BitmapReferencePage[];
}

interface BitmapReferenceResource {
  readonly strikes: readonly BitmapReferenceStrike[];
}

export interface BitmapFiniteScene {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  readonly font: RegisteredFont;
  readonly line: BitmapLine;
  readonly reference: BitmapReferenceResource;
  readonly referencePixels: Uint8Array;
  readonly atlasGpuBytes: number;
  readonly firstDrawMs: number;
  readonly fontFixture: BenchmarkFontFixture;
}

/** Exact finite-scene readback and CPU atlas reference, independent of its conformance consumer. */
export interface BitmapFiniteSceneCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly mismatchBytes: number;
  readonly litPixels: number;
  readonly inkPixels: number;
  readonly renderSubmitMs: number;
}

export interface CreateBitmapFiniteSceneOptions {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly delivery?: FontDelivery;
  readonly signal?: AbortSignal;
  readonly renderer?: PersistentRenderSceneRenderer;
}

export async function createBitmapFiniteScene({
  backend,
  dpr,
  fontFixture = 'inter',
  delivery = 'baked',
  signal,
  renderer: borrowedRenderer,
}: CreateBitmapFiniteSceneOptions): Promise<BitmapFiniteScene> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: BITMAP_FINITE_WIDTH,
          height: BITMAP_FINITE_HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  const rendererViewport = readRendererViewportState(renderer as THREE.WebGPURenderer);
  let target: THREE.RenderTarget | undefined;
  let font: RegisteredFont | undefined;
  let line: BitmapLine | undefined;
  try {
    const loadedFont = await loadBitmapFontAsset({
      technique: 'bitmap',
      fixture: fontFixture,
      delivery,
      bitmapDensity: 'conformance',
      registry: new FontRegistry(),
      ...(signal === undefined ? {} : { signal }),
    });
    font = loadedFont.font;
    line = await createBitmapLine(
      font,
      loadedFont.raster,
      conformanceText(),
      BITMAP_FONT_SIZE / dpr,
      rendererViewport.pixelRatio,
      signal,
    );
    line.object.position.set(
      quarterDevicePosition(Math.max(4, (BITMAP_FINITE_WIDTH - line.width) / 2), dpr),
      quarterDevicePosition(-Math.max(4, (BITMAP_FINITE_HEIGHT - line.height) / 2), dpr),
      0,
    );
    const scene = new THREE.Scene();
    scene.add(line.object);
    const camera = new THREE.OrthographicCamera(0, BITMAP_FINITE_WIDTH, 0, -BITMAP_FINITE_HEIGHT, 0.1, 10);
    camera.position.z = 1;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(BITMAP_FINITE_WIDTH * dpr), Math.round(BITMAP_FINITE_HEIGHT * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    const firstDrawTarget = target;
    const firstDrawMs = await withRendererStateRestored(renderer, () => {
      renderer.setRenderTarget(firstDrawTarget);
      renderer.setClearColor(0x000000, 1);
      renderer.clear();
      const firstDrawStarted = performance.now();
      renderer.render(scene, camera);
      return performance.now() - firstDrawStarted;
    });
    const { atlasGpuBytes, reference } = await loadBitmapReferenceSnapshot(font, signal);
    const referencePixels = composeBitmapReference(line, reference, dpr, BITMAP_FINITE_WIDTH, BITMAP_FINITE_HEIGHT);
    return {
      backend,
      dpr,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      font,
      line,
      reference,
      referencePixels,
      atlasGpuBytes,
      firstDrawMs,
      fontFixture,
    };
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line);
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

export async function captureBitmapFiniteScene(resources: BitmapFiniteScene): Promise<BitmapFiniteSceneCapture> {
  const width = Math.round(BITMAP_FINITE_WIDTH * resources.dpr);
  const height = Math.round(BITMAP_FINITE_HEIGHT * resources.dpr);
  const rendered = await renderBitmapFiniteFrame(resources, width, height);
  const quality = assertBitmapTextPixels(rendered.bytes, width, height);
  const { bytes: difference, mismatchBytes } = differenceImage(rendered.bytes, resources.referencePixels);
  return {
    width,
    height,
    candidate: rendered.bytes,
    reference: resources.referencePixels.slice(),
    difference,
    mismatchBytes,
    litPixels: quality.litPixels,
    inkPixels: quality.inkPixels,
    renderSubmitMs: rendered.renderMs,
  };
}

export async function renderBitmapFiniteProduct(resources: BitmapFiniteScene): Promise<TargetRunOutput> {
  const { target, camera, line } = resources;
  const physicalWidth = Math.round(BITMAP_FINITE_WIDTH * resources.dpr);
  const physicalHeight = Math.round(BITMAP_FINITE_HEIGHT * resources.dpr);
  const originalPosition = line.object.position.clone();
  const unsnappedOriginFraction = Math.max(
    devicePixelFraction(originalPosition.x * resources.dpr),
    devicePixelFraction(originalPosition.y * resources.dpr),
  );
  const full = await renderBitmapFiniteFrame(resources, physicalWidth, physicalHeight);
  const quality = assertBitmapTextPixels(full.bytes, physicalWidth, physicalHeight, resources.referencePixels);
  const clippedPhysicalWidth = Math.round(CLIPPED_WIDTH * resources.dpr);
  const clippedPhysicalHeight = Math.round(CLIPPED_HEIGHT * resources.dpr);
  let clipped: Awaited<ReturnType<typeof renderBitmapFiniteFrame>>;
  let clippedQuality: ReturnType<typeof assertBitmapTextPixels>;
  try {
    target.setSize(clippedPhysicalWidth, clippedPhysicalHeight);
    camera.right = CLIPPED_WIDTH;
    camera.bottom = -CLIPPED_HEIGHT;
    camera.updateProjectionMatrix();
    line.object.position.set(quarterDevicePosition(-40, resources.dpr), quarterDevicePosition(-4, resources.dpr), 0);
    const clippedReference = composeBitmapReference(
      line,
      resources.reference,
      resources.dpr,
      CLIPPED_WIDTH,
      CLIPPED_HEIGHT,
      true,
    );
    clipped = await renderBitmapFiniteFrame(resources, clippedPhysicalWidth, clippedPhysicalHeight);
    clippedQuality = assertBitmapTextPixels(
      clipped.bytes,
      clippedPhysicalWidth,
      clippedPhysicalHeight,
      clippedReference,
      true,
    );
    if (!clippedQuality.touchesBoundary || clippedQuality.inkPixels >= quality.inkPixels) {
      throw new Error('bitmap Text resize did not produce a smaller clipped frame');
    }
  } finally {
    line.object.position.copy(originalPosition);
    target.setSize(physicalWidth, physicalHeight);
    camera.right = BITMAP_FINITE_WIDTH;
    camera.bottom = -BITMAP_FINITE_HEIGHT;
    camera.updateProjectionMatrix();
  }
  return {
    bytes: full.bytes.byteLength,
    hash: await sha256(full.bytes),
    metrics: {
      fixtureIsInter: resources.fontFixture === 'inter' ? 1 : 0,
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      glyphCount: line.glyphCount,
      missingGlyphCount: line.missingGlyphCount,
      drawCount: line.drawCount,
      strikePpem: line.strikePpem,
      cssFontSize: line.cssFontSize,
      renderedPpem: line.cssFontSize * resources.dpr,
      scaleRatio: (line.cssFontSize * resources.dpr) / line.strikePpem,
      atlasGpuBytes: resources.atlasGpuBytes,
      renderTargetGpuBytes: full.bytes.byteLength,
      totalGpuBytes: resources.atlasGpuBytes + full.bytes.byteLength,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      inkMinX: quality.inkMinX,
      inkMinY: quality.inkMinY,
      inkMaxX: quality.inkMaxX,
      inkMaxY: quality.inkMaxY,
      renderMs: full.renderMs,
      clippedRenderMs: clipped.renderMs,
      clippedInkPixels: clippedQuality.inkPixels,
      clippedTouchesBoundary: clippedQuality.touchesBoundary ? 1 : 0,
      resizedWidth: CLIPPED_WIDTH,
      resizedHeight: CLIPPED_HEIGHT,
      firstDrawMs: resources.firstDrawMs,
      referenceMismatchBytes: quality.referenceMismatchBytes,
      unsnappedOriginFraction,
    },
  };
}

export async function renderBitmapFiniteFrame(
  resources: BitmapFiniteScene,
  physicalWidth: number,
  physicalHeight: number,
): Promise<{ readonly bytes: Uint8Array; readonly renderMs: number }> {
  const { renderer, target, scene, camera } = resources;
  return withRendererStateRestored(renderer, async () => {
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const renderStarted = performance.now();
    renderer.render(scene, camera);
    const renderMs = performance.now() - renderStarted;
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, physicalWidth, physicalHeight);
    return {
      bytes: compactRgba8Readback(
        new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
        physicalWidth,
        physicalHeight,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      ),
      renderMs,
    };
  });
}

export async function disposeBitmapFiniteScene(resources: BitmapFiniteScene): Promise<void> {
  disposeBitmapLine(resources.line);
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
}

export function assertBitmapTextPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  referenceBytes?: Uint8Array,
  allowBoundary = false,
): {
  readonly litPixels: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly inkPixels: number;
  readonly inkMinX: number;
  readonly inkMinY: number;
  readonly inkMaxX: number;
  readonly inkMaxY: number;
  readonly touchesBoundary: boolean;
  readonly referenceMismatchBytes: number;
} {
  if (bytes.byteLength !== width * height * 4) throw new Error('bitmap text readback length does not match its target');
  const referenceMismatchBytes = referenceBytes === undefined ? 0 : assertExactReference(bytes, referenceBytes, width);
  let litPixels = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let inkPixels = 0;
  let inkMinX = width;
  let inkMinY = height;
  let inkMaxX = -1;
  let inkMaxY = -1;
  let touchesBoundary = false;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const coverage = Math.max(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0);
    if (coverage === 0) continue;
    litPixels += 1;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      touchesBoundary = true;
      if (!allowBoundary) throw new Error('bitmap text touches the render boundary');
    }
    if (coverage >= 128) {
      inkPixels += 1;
      inkMinX = Math.min(inkMinX, x);
      inkMinY = Math.min(inkMinY, y);
      inkMaxX = Math.max(inkMaxX, x);
      inkMaxY = Math.max(inkMaxY, y);
    }
  }
  if (litPixels < 100) throw new Error('bitmap text did not produce enough visible coverage');
  if (inkPixels < 100) throw new Error('bitmap text did not produce enough half-coverage ink');
  return {
    litPixels,
    minX,
    minY,
    maxX,
    maxY,
    inkPixels,
    inkMinX,
    inkMinY,
    inkMaxX,
    inkMaxY,
    touchesBoundary,
    referenceMismatchBytes,
  };
}

async function loadBitmapReferenceSnapshot(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<{ readonly atlasGpuBytes: number; readonly reference: BitmapReferenceResource }> {
  const raster = await font.loadRaster(
    { rasterKey: await bitmapRasterKey({ strikes: [16] as const }), kind: 'bitmap' },
    signal === undefined ? undefined : { signal },
  );
  const resource = await bitmapRequest.module.decode(font, raster, signal);
  try {
    return { atlasGpuBytes: bitmapAtlasBytes(resource), reference: snapshotBitmapReference(resource) };
  } finally {
    bitmapRequest.module.dispose(resource);
  }
}

function bitmapAtlasBytes(resource: BitmapResource): number {
  return resource.strikes.reduce(
    (strikeBytes, strike) =>
      strikeBytes + strike.pages.reduce((pageBytes, page) => pageBytes + page.width * page.height, 0),
    0,
  );
}

function snapshotBitmapReference(resource: BitmapResource): BitmapReferenceResource {
  return {
    strikes: resource.strikes.map((strike) => ({
      ppem: strike.ppem,
      planeUnitsPerEm: strike.planeUnitsPerEm,
      records: strike.records.slice(),
      pages: strike.pages.map((page) => {
        const texels = page.texture.image.data;
        if (!(texels instanceof Uint8Array))
          throw new TypeError('bitmap reference page is not backed by unsigned-byte coverage');
        return { width: page.width, height: page.height, texels: texels.slice() };
      }),
    })),
  };
}

function differenceImage(
  candidate: Uint8Array,
  reference: Uint8Array,
): { readonly bytes: Uint8Array; readonly mismatchBytes: number } {
  if (candidate.byteLength !== reference.byteLength)
    throw new Error('bitmap conformance images do not have matching dimensions');
  const bytes = new Uint8Array(candidate.byteLength);
  let mismatchBytes = 0;
  for (let offset = 0; offset < candidate.byteLength; offset += 4) {
    const red = Math.abs((candidate[offset] ?? 0) - (reference[offset] ?? 0));
    const green = Math.abs((candidate[offset + 1] ?? 0) - (reference[offset + 1] ?? 0));
    const blue = Math.abs((candidate[offset + 2] ?? 0) - (reference[offset + 2] ?? 0));
    if (red !== 0) mismatchBytes += 1;
    if (green !== 0) mismatchBytes += 1;
    if (blue !== 0) mismatchBytes += 1;
    bytes[offset] = Math.max(red, green, blue);
    bytes[offset + 1] = 0;
    bytes[offset + 2] = 0;
    bytes[offset + 3] = 255;
  }
  return { bytes, mismatchBytes };
}

function composeBitmapReference(
  line: BitmapLine,
  resource: BitmapReferenceResource,
  dpr: number,
  cssWidth: number,
  cssHeight: number,
  allowClipping = false,
): Uint8Array {
  const physicalWidth = Math.round(cssWidth * dpr);
  const physicalHeight = Math.round(cssHeight * dpr);
  const output = new Uint8Array(physicalWidth * physicalHeight * 4);
  for (let alpha = 3; alpha < output.byteLength; alpha += 4) output[alpha] = 255;
  const strike = resource.strikes.find(({ ppem }) => ppem === line.strikePpem);
  if (strike === undefined) throw new Error('bitmap reference is missing the selected strike');
  const records = new DataView(strike.records.buffer, strike.records.byteOffset, strike.records.byteLength);
  const { layout } = line;
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== 0) continue;
    const glyphId = layout.glyphIds[glyphIndex];
    const fontSize = layout.glyphFontSizes[glyphIndex];
    if (glyphId === undefined || fontSize === undefined) continue;
    const record = glyphId * 20;
    const pageIndex = records.getUint16(record + 16, true);
    if (pageIndex === 0xffff) continue;
    const page = strike.pages[pageIndex];
    if (page === undefined) throw new Error('bitmap reference record points to a missing page');
    const scale = fontSize / strike.planeUnitsPerEm;
    if (scale * dpr !== 1) throw new Error('exact bitmap reference requires one atlas texel per device pixel');
    const planeLeft = records.getInt16(record, true);
    const planeTop = records.getInt16(record + 6, true);
    const atlasLeft = records.getUint16(record + 8, true);
    const atlasTop = records.getUint16(record + 10, true);
    const atlasRight = records.getUint16(record + 12, true);
    const atlasBottom = records.getUint16(record + 14, true);
    const left = Math.round((line.object.position.x + layout.x[glyphIndex]! + planeLeft * scale) * dpr);
    const top = Math.round(-(line.object.position.y - layout.y[glyphIndex]! + planeTop * scale) * dpr);
    for (let atlasY = atlasTop; atlasY < atlasBottom; atlasY += 1) {
      for (let atlasX = atlasLeft; atlasX < atlasRight; atlasX += 1) {
        const x = left + atlasX - atlasLeft;
        const y = top + atlasY - atlasTop;
        if (x < 0 || y < 0 || x >= physicalWidth || y >= physicalHeight) {
          if (allowClipping) continue;
          throw new Error('bitmap reference glyph exceeds the framebuffer');
        }
        const coverage = page.texels[atlasY * page.width + atlasX]!;
        const destination = (y * physicalWidth + x) * 4;
        const previous = output[destination]!;
        const composed = coverage + Math.round((previous * (255 - coverage)) / 255);
        output[destination] = composed;
        output[destination + 1] = composed;
        output[destination + 2] = composed;
      }
    }
  }
  return output;
}

function assertExactReference(actual: Uint8Array, expected: Uint8Array, width: number): number {
  if (actual.byteLength !== expected.byteLength)
    throw new Error('bitmap CPU reference length does not match the GPU readback');
  const samples: string[] = [];
  let mismatchBytes = 0;
  let maximumDifference = 0;
  for (let index = 0; index < actual.byteLength; index += 1) {
    if (actual[index] === expected[index]) continue;
    mismatchBytes += 1;
    maximumDifference = Math.max(maximumDifference, Math.abs(actual[index]! - expected[index]!));
    if (samples.length < 8) {
      const pixel = Math.floor(index / 4);
      samples.push(
        `(${String(pixel % width)},${String(Math.floor(pixel / width))},${String(index % 4)}):${String(actual[index])}/${String(expected[index])}`,
      );
    }
  }
  if (mismatchBytes !== 0) {
    throw new Error(
      `bitmap GPU readback differs from its CPU atlas reference in ${String(mismatchBytes)} bytes ` +
        `(max delta ${String(maximumDifference)}; actual bounds ${coverageBounds(actual, width)}; ` +
        `expected bounds ${coverageBounds(expected, width)}; actual/expected ${samples.join(', ')})`,
    );
  }
  return mismatchBytes;
}

function coverageBounds(bytes: Uint8Array, width: number): string {
  let minX = width;
  let minY = Number.MAX_SAFE_INTEGER;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < bytes.byteLength / 4; pixel += 1) {
    if ((bytes[pixel * 4] ?? 0) === 0) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return `[${String(minX)},${String(minY)},${String(maxX)},${String(maxY)}]`;
}

function devicePixelFraction(value: number): number {
  return Math.abs(value - Math.round(value));
}

function quarterDevicePosition(value: number, dpr: number): number {
  return (Math.floor(value * dpr) + 0.25) / dpr;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice());
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
