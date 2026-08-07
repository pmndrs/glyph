import { FontRegistry, type LoadedFont, type ParagraphLayout } from '@pmndrs/text';
import { slug } from '@pmndrs/text/raster/slug';
import { FontLoader, Text, type TextSpan } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

import type { TargetRunOutput } from '../../../contracts';
import { rasterConformanceSpecimen, type BenchmarkFontFixture } from '../../../font-fixtures';
import { compareRgba8Coverage } from '../../../low-level/raster/mtsdf-cpu-reference';
import { compactRgba8Readback } from '../../../low-level/raster/rgba-readback';
import { renderFlatSlugCpuReference } from '../../../low-level/raster/slug-cpu-reference';
import { sha256 } from '../../shared';
import type { FontDelivery } from '../../../url-state';
import type { BakedSlugArtifactSource as SlugBakedArtifactSource } from '../../../../workloads/font-assets';
import { loadSlugFontAsset } from '../../../../workloads/font-assets/slug';
import type { PersistentRenderSceneRenderer } from '../../../../renderer/persistent-render-host';
import { withRendererStateRestored } from '../../../../renderer/renderer-state-transaction';
import type {
  SlugAffineRoleSceneDefinition,
  SlugProjectionZoomSceneDefinition,
  SlugRoleSceneDefinition,
} from './slug-role-scenes';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from '../../../../renderer/webgpu-renderer';
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from '../../../low-level/raster/source-outline-reference';
import type { RasterConformanceSession } from './contracts';

const WIDTH = 512;
const FLAT_CONFORMANCE_HEIGHT = 512;

export interface SlugTextConformanceCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly severeErrorPixels: number;
  readonly glyphCount: number;
  readonly evaluatedCurves: number;
  readonly viewportClipped: boolean;
  readonly renderSubmitMs: number;
}

export interface SlugRasterSourceTypes {
  readonly raster: 'embedded' | 'external';
  readonly curve: 'bufferView' | 'external';
  readonly headers: 'bufferView' | 'external';
  readonly references: 'bufferView' | 'external';
}

export interface SlugExternalRenderParityCapture {
  readonly backend: RendererBackend;
  readonly width: number;
  readonly height: number;
  readonly embedded: Uint8Array;
  readonly external: Uint8Array;
  readonly externalSourceTypes: SlugRasterSourceTypes;
  readonly embeddedGlyphCount: number;
  readonly externalGlyphCount: number;
  readonly embeddedEvaluatedCurves: number;
  readonly externalEvaluatedCurves: number;
  readonly embeddedRenderSubmitMs: number;
  readonly externalRenderSubmitMs: number;
}

export interface SlugRoleSceneCapture {
  readonly scene: SlugRoleSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly cpuReference: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly cpuMeanAbsoluteError: number;
  readonly cpuMaximumError: number;
  readonly cpuErrorPixels: number;
  readonly cpuSevereErrorPixels: number;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly glyphCount: number;
  readonly evaluatedCurves: number;
  readonly boundaryInkPixels: number;
  readonly viewportClipped: boolean;
  readonly renderSubmitMs: number;
}

export interface SlugAffineRoleSceneCapture {
  readonly scene: SlugAffineRoleSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly boundaryInkPixels: number;
  readonly renderSubmitMs: number;
}

export interface SlugProjectionZoomCapture {
  readonly zoom: 1 | 8;
  readonly candidate: Uint8Array;
  readonly sourceReference: Uint8Array;
  readonly sourceMeanAbsoluteError: number;
  readonly sourceMaximumError: number;
  readonly sourceErrorPixels: number;
  readonly fringeWidth: number;
  readonly fringeSampleY: number;
  readonly fringeInkMinX: number;
  readonly fringeInkMaxX: number;
  readonly leftFringeWidth: number;
  readonly rightFringeWidth: number;
  readonly inkPixels: number;
  readonly renderSubmitMs: number;
}

export interface SlugProjectionZoomRoleSceneCapture {
  readonly scene: SlugProjectionZoomSceneDefinition;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly captures: readonly [SlugProjectionZoomCapture, SlugProjectionZoomCapture];
}

interface FlatSlugConformanceResources {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly renderer: PersistentRenderSceneRenderer;
  readonly ownedRenderer?: THREE.WebGPURenderer;
  readonly target: THREE.RenderTarget;
  readonly scene: THREE.Scene;
  readonly camera: THREE.OrthographicCamera;
  /** Owns the decoded Slug data the CPU reference reads, so no scene decodes the raster a second time. */
  readonly font: LoadedFont<typeof slug>;
  readonly line: Text<typeof slug>;
  readonly sourceTypes?: SlugRasterSourceTypes;
}

interface FlatSlugSceneOptions {
  readonly width: number;
  readonly height: number;
  readonly fontSize: number;
  readonly layoutWidth: number;
  readonly originX: number;
  readonly originY: number;
  readonly text: string;
  readonly spans?: readonly TextSpan<typeof slug>[];
  readonly language: string;
  readonly direction: 'ltr' | 'rtl';
}

/** A warm finite Slug session with an optional host renderer lease. */
export function createSlugConformanceSession(backend: RendererBackend): RasterConformanceSession {
  let resources: FlatSlugConformanceResources | undefined;
  let fontFixture: BenchmarkFontFixture = 'inter';
  return {
    async load(input, controls, context) {
      fontFixture = input.fontFixture ?? 'inter';
      resources ??= await createFlatSlugConformanceResources({
        backend,
        dpr: controls.dpr,
        fontFixture,
        delivery: 'baked',
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
      });
    },
    async captureSampling(_input, _sampleIndex, _controls, context): Promise<TargetRunOutput> {
      context?.signal?.throwIfAborted();
      if (resources === undefined) throw new Error('Slug conformance target was not loaded');
      const capture = await captureFlatSlugConformance(resources);
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          fixtureIsDotGothic: fontFixture === 'dot-gothic-16' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          evaluatedCurves: capture.evaluatedCurves,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          severeErrorPixels: capture.severeErrorPixels,
          renderMs: capture.renderSubmitMs,
        },
      };
    },
    async captureSourceOutline(input, controls, context): Promise<SourceOutlineFidelityCapture> {
      return captureSlugSourceOutlineFidelity({
        backend,
        dpr: controls.dpr,
        fontFixture: input.fontFixture ?? fontFixture,
        ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
        ...(context?.signal === undefined ? {} : { signal: context.signal }),
      });
    },
    async dispose() {
      const current = resources;
      resources = undefined;
      if (current !== undefined) await disposeFlatSlugConformanceResources(current);
    },
  };
}

export async function captureSlugTextConformance(options: {
  readonly backend: RendererBackend;
  readonly bakedArtifact?: SlugBakedArtifactSource;
  readonly delivery?: FontDelivery;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SlugTextConformanceCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatSlugConformanceResources(options);
  try {
    options.signal?.throwIfAborted();
    const capture = await captureFlatSlugConformance(resources);
    options.signal?.throwIfAborted();
    return capture;
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugExternalRenderParity(options: {
  readonly backend: RendererBackend;
  readonly externalArtifactUrl: string;
  readonly fetch: typeof fetch;
  readonly signal?: AbortSignal;
}): Promise<SlugExternalRenderParityCapture> {
  const embeddedResources = await createFlatSlugConformanceResources({
    backend: options.backend,
    dpr: 1,
    fontFixture: 'inter',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  let externalResources: FlatSlugConformanceResources | undefined;
  try {
    externalResources = await createFlatSlugConformanceResources({
      backend: options.backend,
      dpr: 1,
      fontFixture: 'inter',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      loadFont: (signal) => loadExternalSlugFont(options.externalArtifactUrl, options.fetch, signal),
    });
    const [embedded, external] = await Promise.all([
      captureFlatSlugConformance(embeddedResources),
      captureFlatSlugConformance(externalResources),
    ]);
    if (embedded.width !== external.width || embedded.height !== external.height) {
      throw new Error('Embedded and external Slug parity scenes have different dimensions');
    }
    return {
      backend: options.backend,
      width: embedded.width,
      height: embedded.height,
      embedded: embedded.candidate,
      external: external.candidate,
      externalSourceTypes: requireExternalSlugSources(externalResources.sourceTypes),
      embeddedGlyphCount: embedded.glyphCount,
      externalGlyphCount: external.glyphCount,
      embeddedEvaluatedCurves: embedded.evaluatedCurves,
      externalEvaluatedCurves: external.evaluatedCurves,
      embeddedRenderSubmitMs: embedded.renderSubmitMs,
      externalRenderSubmitMs: external.renderSubmitMs,
    };
  } finally {
    if (externalResources !== undefined) await disposeFlatSlugConformanceResources(externalResources);
    await disposeFlatSlugConformanceResources(embeddedResources);
  }
}

export async function captureSlugSourceOutlineFidelity(options: {
  readonly backend: RendererBackend;
  readonly bakedArtifact?: SlugBakedArtifactSource;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly renderer?: PersistentRenderSceneRenderer;
  readonly signal?: AbortSignal;
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted();
  const resources = await createFlatSlugConformanceResources({ ...options, delivery: 'baked' });
  try {
    const capture = await captureFlatSlugConformance(resources);
    const specimen = rasterConformanceSpecimen(options.fontFixture);
    options.signal?.throwIfAborted();
    return await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: 64 / options.dpr,
      direction: specimen.direction,
      layout: committedLayout(resources.line),
      originX: resources.line.position.x,
      originY: resources.line.position.y,
      text: specimen.text,
      renderSubmitMs: capture.renderSubmitMs,
    });
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugRoleSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugRoleSceneCapture> {
  const { dpr, scene } = options;
  const resources = await createFlatSlugConformanceResources({
    backend: options.backend,
    dpr,
    fontFixture: scene.fontFixture,
    delivery: 'baked',
    sceneOptions: {
      width: scene.physicalWidth / dpr,
      height: scene.physicalHeight / dpr,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: scene.physicalLayoutWidth / dpr,
      originX: scene.physicalOriginX / dpr,
      originY: scene.physicalOriginY / dpr,
      text: scene.text,
      language: scene.language,
      direction: scene.direction,
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  try {
    options.signal?.throwIfAborted();
    const cpuCapture = await captureFlatSlugConformance(resources);
    const sourceCapture = await captureSourceOutlineFidelity({
      candidate: cpuCapture.candidate,
      width: cpuCapture.width,
      height: cpuCapture.height,
      dpr,
      fontFixture: scene.fontFixture,
      fontSize: scene.physicalPpem / dpr,
      direction: scene.direction,
      layout: committedLayout(resources.line),
      originX: scene.physicalOriginX / dpr,
      originY: scene.physicalOriginY / dpr,
      text: scene.text,
      renderSubmitMs: cpuCapture.renderSubmitMs,
    });
    return {
      scene,
      dpr,
      width: cpuCapture.width,
      height: cpuCapture.height,
      candidate: cpuCapture.candidate,
      cpuReference: cpuCapture.reference,
      sourceReference: sourceCapture.reference,
      cpuMeanAbsoluteError: cpuCapture.meanAbsoluteError,
      cpuMaximumError: cpuCapture.maximumError,
      cpuErrorPixels: cpuCapture.errorPixels,
      cpuSevereErrorPixels: cpuCapture.severeErrorPixels,
      sourceMeanAbsoluteError: sourceCapture.meanAbsoluteError,
      sourceMaximumError: sourceCapture.maximumError,
      sourceErrorPixels: sourceCapture.errorPixels,
      glyphCount: cpuCapture.glyphCount,
      evaluatedCurves: cpuCapture.evaluatedCurves,
      boundaryInkPixels: countBoundaryInkPixels(cpuCapture.candidate, cpuCapture.width, cpuCapture.height),
      viewportClipped: cpuCapture.viewportClipped,
      renderSubmitMs: cpuCapture.renderSubmitMs,
    };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugAffineRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugAffineRoleSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugAffineRoleSceneCapture> {
  const { dpr, scene } = options;
  const resources = await createFlatSlugConformanceResources({
    backend: options.backend,
    dpr,
    fontFixture: scene.fontFixture,
    delivery: 'baked',
    sceneOptions: {
      width: scene.physicalWidth / dpr,
      height: scene.physicalHeight / dpr,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: scene.physicalLayoutWidth / dpr,
      originX: 0,
      originY: 0,
      text: scene.text,
      language: scene.language,
      direction: scene.direction,
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  try {
    const positionX = scene.physicalPositionX / dpr;
    const positionY = scene.physicalPositionY / dpr;
    resources.line.position.set(positionX, positionY, 0);
    resources.line.rotation.z = scene.rotationRadians;
    resources.line.scale.set(scene.scaleX, scene.scaleY, 1);
    resources.line.updateMatrixWorld(true);
    const capture = await captureFlatSlugCandidate(resources);
    const cosine = Math.cos(scene.rotationRadians);
    const sine = Math.sin(scene.rotationRadians);
    const source = await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr,
      fontFixture: scene.fontFixture,
      fontSize: scene.physicalPpem / dpr,
      direction: scene.direction,
      layout: committedLayout(resources.line),
      originX: 0,
      originY: 0,
      text: scene.text,
      renderSubmitMs: capture.renderSubmitMs,
      transform: {
        a: cosine * scene.scaleX,
        b: -sine * scene.scaleX,
        c: sine * scene.scaleY,
        d: cosine * scene.scaleY,
        e: positionX,
        f: -positionY,
      },
    });
    return {
      scene,
      dpr,
      width: capture.width,
      height: capture.height,
      candidate: capture.candidate,
      sourceReference: source.reference,
      sourceMeanAbsoluteError: source.meanAbsoluteError,
      sourceMaximumError: source.maximumError,
      sourceErrorPixels: source.errorPixels,
      boundaryInkPixels: countBoundaryInkPixels(capture.candidate, capture.width, capture.height),
      renderSubmitMs: capture.renderSubmitMs,
    };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

export async function captureSlugProjectionZoomRoleScene(options: {
  readonly backend: RendererBackend;
  readonly dpr: 1 | 2;
  readonly scene: SlugProjectionZoomSceneDefinition;
  readonly signal?: AbortSignal;
}): Promise<SlugProjectionZoomRoleSceneCapture> {
  const { dpr, scene } = options;
  const logicalWidth = scene.physicalWidth / dpr;
  const logicalHeight = scene.physicalHeight / dpr;
  const resources = await createFlatSlugConformanceResources({
    backend: options.backend,
    dpr,
    fontFixture: scene.fontFixture,
    delivery: 'baked',
    sceneOptions: {
      width: logicalWidth,
      height: logicalHeight,
      fontSize: scene.physicalPpem / dpr,
      layoutWidth: logicalWidth,
      originX: 0,
      originY: 0,
      text: scene.text,
      language: 'en',
      direction: 'ltr',
    },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  try {
    const layout = committedLayout(resources.line);
    const zeroOriginReference = renderFlatSlugCpuReference(resources.font.data, layout, {
      width: scene.physicalWidth,
      height: scene.physicalHeight,
      dpr,
    });
    const bounds = zeroOriginReference.unclippedBounds;
    if (bounds === undefined) throw new Error('Slug projection zoom scene contains no glyph bounds');
    const originX = (scene.physicalWidth / 2 - (bounds.minX + bounds.maxX + 1) / 2) / dpr;
    const originY = -((scene.physicalHeight / 2 - (bounds.minY + bounds.maxY + 1) / 2) / dpr);
    resources.line.position.set(originX, originY, 0);
    const captureAtZoom = async (zoom: 1 | 8): Promise<SlugProjectionZoomCapture> => {
      resources.camera.zoom = zoom;
      resources.camera.updateProjectionMatrix();
      const capture = await captureFlatSlugCandidate(resources);
      const source = await captureSourceOutlineFidelity({
        candidate: capture.candidate,
        width: capture.width,
        height: capture.height,
        dpr,
        fontFixture: scene.fontFixture,
        fontSize: scene.physicalPpem / dpr,
        direction: 'ltr',
        layout,
        originX,
        originY,
        text: scene.text,
        renderSubmitMs: capture.renderSubmitMs,
        transform: {
          a: zoom,
          b: 0,
          c: 0,
          d: zoom,
          e: (logicalWidth * (1 - zoom)) / 2,
          f: (logicalHeight * (1 - zoom)) / 2,
        },
      });
      const fringe = horizontalFringeAtCenter(capture.candidate, capture.width, capture.height);
      return {
        zoom,
        candidate: capture.candidate,
        sourceReference: source.reference,
        sourceMeanAbsoluteError: source.meanAbsoluteError,
        sourceMaximumError: source.maximumError,
        sourceErrorPixels: source.errorPixels,
        fringeWidth: fringe.maximumPartialCoverageRun,
        fringeSampleY: fringe.sampleY,
        fringeInkMinX: fringe.inkMinX,
        fringeInkMaxX: fringe.inkMaxX,
        leftFringeWidth: fringe.leftPartialCoverageWidth,
        rightFringeWidth: fringe.rightPartialCoverageWidth,
        inkPixels: countInkPixels(capture.candidate),
        renderSubmitMs: capture.renderSubmitMs,
      };
    };
    const one = await captureAtZoom(scene.zooms[0]);
    const eight = await captureAtZoom(scene.zooms[1]);
    return { scene, dpr, width: scene.physicalWidth, height: scene.physicalHeight, captures: [one, eight] };
  } finally {
    await disposeFlatSlugConformanceResources(resources);
  }
}

interface CreateFlatSlugConformanceResourcesOptions {
  readonly backend: RendererBackend;
  readonly dpr: number;
  readonly fontFixture?: BenchmarkFontFixture;
  readonly signal?: AbortSignal;
  readonly delivery?: FontDelivery;
  readonly bakedArtifact?: SlugBakedArtifactSource;
  readonly sceneOptions?: FlatSlugSceneOptions;
  readonly loadFont?: (signal?: AbortSignal) => Promise<LoadedFont<typeof slug>>;
  readonly renderer?: PersistentRenderSceneRenderer;
}

async function createFlatSlugConformanceResources({
  backend,
  dpr,
  fontFixture = 'inter',
  signal,
  delivery = 'baked',
  bakedArtifact,
  sceneOptions,
  loadFont,
  renderer: borrowedRenderer,
}: CreateFlatSlugConformanceResourcesOptions): Promise<FlatSlugConformanceResources> {
  signal?.throwIfAborted();
  const ownedRenderer =
    borrowedRenderer === undefined
      ? await createConfiguredRenderer({
          canvas: document.createElement('canvas'),
          width: sceneOptions?.width ?? WIDTH,
          height: sceneOptions?.height ?? FLAT_CONFORMANCE_HEIGHT,
          backend,
          dpr,
        })
      : undefined;
  const renderer = borrowedRenderer ?? ownedRenderer!;
  let target: THREE.RenderTarget | undefined;
  let font: LoadedFont<typeof slug> | undefined;
  let line: Text<typeof slug> | undefined;
  try {
    font =
      loadFont === undefined
        ? await loadConformanceSlugFont(fontFixture, delivery, bakedArtifact, signal)
        : await loadFont(signal);
    const specimen = sceneOptions ?? rasterConformanceSpecimen(fontFixture);
    line = new Text({
      text: specimen.text,
      ...(sceneOptions?.spans === undefined ? {} : { spans: sceneOptions.spans }),
      font,
      rasterPixelRatio: dpr,
      // An exact width is what centre and end alignment measure against; `at-most` would collapse them onto the start.
      contentBox: { width: { mode: 'exact', size: sceneOptions?.layoutWidth ?? 476 }, wrap: 'word', align: 'start' },
      style: {
        fontSize: sceneOptions?.fontSize ?? 64 / dpr,
        lineHeight: 1.2,
        language: specimen.language,
        direction: specimen.direction,
      },
      paint: { color: '#ffffff' },
    });
    line.position.set(sceneOptions?.originX ?? 18, sceneOptions?.originY ?? -18, 0);
    const scene = new THREE.Scene();
    scene.add(line);
    line.updateMatrixWorld(true);
    const missingGlyphs = committedLayout(line).glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0);
    if (missingGlyphs !== 0) {
      throw new Error(`${fontFixture} Slug conformance specimen contains ${String(missingGlyphs)} missing glyphs`);
    }
    const sourceTypes = loadFont === undefined ? undefined : slugRasterSourceTypes(font);
    signal?.throwIfAborted();
    const logicalWidth = sceneOptions?.width ?? WIDTH;
    const logicalHeight = sceneOptions?.height ?? FLAT_CONFORMANCE_HEIGHT;
    const camera = new THREE.OrthographicCamera(0, logicalWidth, 0, -logicalHeight, 0.1, 1_000);
    camera.position.z = 500;
    camera.updateProjectionMatrix();
    target = new THREE.RenderTarget(Math.round(logicalWidth * dpr), Math.round(logicalHeight * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    });
    target.texture.colorSpace = THREE.NoColorSpace;
    target.texture.generateMipmaps = false;
    return {
      backend,
      dpr,
      fontFixture,
      renderer,
      ...(ownedRenderer === undefined ? {} : { ownedRenderer }),
      target,
      scene,
      camera,
      font,
      line,
      ...(sourceTypes === undefined ? {} : { sourceTypes }),
    };
  } catch (error) {
    line?.dispose();
    font?.dispose();
    target?.dispose();
    if (ownedRenderer !== undefined) await disposeConfiguredRenderer(ownedRenderer);
    throw error;
  }
}

async function loadConformanceSlugFont(
  fixture: BenchmarkFontFixture,
  delivery: FontDelivery,
  bakedArtifact: SlugBakedArtifactSource | undefined,
  signal: AbortSignal | undefined,
): Promise<LoadedFont<typeof slug>> {
  const loaded = await loadSlugFontAsset(
    delivery === 'runtime'
      ? {
          technique: 'slug',
          fixture,
          delivery,
          registry: new FontRegistry(),
          ...(signal === undefined ? {} : { signal }),
        }
      : {
          technique: 'slug',
          fixture,
          delivery,
          registry: new FontRegistry(),
          ...(bakedArtifact === undefined ? {} : { bakedArtifact }),
          ...(signal === undefined ? {} : { signal }),
        },
  );
  return loaded.loaded;
}

/**
 * Target-v1 `FontLoader` publishes no fetch hook, so the only way to observe which URLs one external artifact touches
 * is to own `globalThis.fetch` for the duration of that load. The swap is scoped to this call and restored
 * unconditionally; the embedded fixture of a parity run has already finished loading before it is installed.
 */
async function loadExternalSlugFont(
  artifactUrl: string,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<LoadedFont<typeof slug>> {
  signal?.throwIfAborted();
  const loader = new FontLoader();
  const installedFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await loader.loadAsync({
      input: { baked: artifactUrl },
      raster: { technique: slug },
      ...(signal === undefined ? {} : { signal }),
    });
  } finally {
    globalThis.fetch = installedFetch;
    loader.dispose();
  }
}

function slugRasterSourceTypes(font: LoadedFont<typeof slug>): SlugRasterSourceTypes {
  const reference = font.font.rasterReferences.find((candidate) => candidate.rasterKey === font.raster.rasterKey);
  if (reference === undefined) throw new Error('Slug raster reference disappeared after loading');
  const extension = nonArrayObject(font.raster.extensionData, 'Slug extension');
  if (!Array.isArray(extension.pages) || extension.pages.length !== 1) {
    throw new TypeError('Slug external parity requires exactly one Inter page');
  }
  const page = nonArrayObject(extension.pages[0], 'Slug page');
  const curve = nonArrayObject(page.curve, 'Slug curve');
  if (!Array.isArray(curve.variants) || curve.variants.length !== 1) {
    throw new TypeError('Slug external parity requires exactly one curve variant');
  }
  const curveVariant = nonArrayObject(curve.variants[0], 'Slug curve variant');
  const headerResource = nonArrayObject(page.headerResource, 'Slug header resource');
  const referenceResource = nonArrayObject(page.referenceResource, 'Slug reference resource');
  return {
    raster: reference.source.type,
    curve: resourceSourceType(curveVariant.source, 'Slug curve source'),
    headers: resourceSourceType(headerResource.source, 'Slug header source'),
    references: resourceSourceType(referenceResource.source, 'Slug reference source'),
  };
}

function requireExternalSlugSources(sourceTypes: SlugRasterSourceTypes | undefined): SlugRasterSourceTypes {
  if (
    sourceTypes === undefined ||
    sourceTypes.raster !== 'external' ||
    sourceTypes.curve !== 'external' ||
    sourceTypes.headers !== 'external' ||
    sourceTypes.references !== 'external'
  ) {
    throw new Error(`Slug parity resource was not fully external: ${JSON.stringify(sourceTypes)}`);
  }
  return sourceTypes;
}

function resourceSourceType(value: unknown, label: string): 'bufferView' | 'external' {
  const source = nonArrayObject(value, label);
  if (source.type !== 'bufferView' && source.type !== 'external') throw new TypeError(`${label} has an invalid type`);
  return source.type;
}

function nonArrayObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError(`${label} must be an object`);
  return value as Record<string, unknown>;
}

async function captureFlatSlugConformance(
  resources: FlatSlugConformanceResources,
): Promise<SlugTextConformanceCapture> {
  const { candidate, width, height, renderSubmitMs } = await captureFlatSlugCandidate(resources);
  const referenceResult = renderFlatSlugCpuReference(resources.font.data, committedLayout(resources.line), {
    width,
    height,
    dpr: resources.dpr,
    originX: resources.line.position.x,
    originY: resources.line.position.y,
  });
  const comparison = compareRgba8Coverage(candidate, referenceResult.pixels);
  const bounds = referenceResult.unclippedBounds;
  return {
    width,
    height,
    candidate,
    reference: referenceResult.pixels,
    difference: comparison.heatmap,
    meanAbsoluteError: comparison.meanAbsoluteError,
    maximumError: comparison.maximumError,
    errorPixels: comparison.errorPixels,
    severeErrorPixels: comparison.severeErrorPixels,
    glyphCount: referenceResult.glyphCount,
    evaluatedCurves: referenceResult.evaluatedCurves,
    viewportClipped:
      bounds !== undefined && (bounds.minX < 0 || bounds.minY < 0 || bounds.maxX >= width || bounds.maxY >= height),
    renderSubmitMs,
  };
}

interface FlatSlugCandidateCapture {
  readonly candidate: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly renderSubmitMs: number;
}

async function captureFlatSlugCandidate(resources: FlatSlugConformanceResources): Promise<FlatSlugCandidateCapture> {
  const width = resources.target.width;
  const height = resources.target.height;
  if (resources.ownedRenderer !== undefined) {
    const viewport = readRendererViewportState(resources.ownedRenderer);
    if (viewport.drawingBufferWidth !== width || viewport.drawingBufferHeight !== height) {
      throw new Error(
        `Slug render target ${String(width)}x${String(height)} does not match drawing buffer ${String(viewport.drawingBufferWidth)}x${String(viewport.drawingBufferHeight)}`,
      );
    }
  }
  return withRendererStateRestored(resources.renderer, async () => {
    resources.renderer.setRenderTarget(resources.target);
    resources.renderer.setClearColor(0x000000, 1);
    resources.renderer.clear();
    const started = performance.now();
    resources.renderer.render(resources.scene, resources.camera);
    const renderSubmitMs = performance.now() - started;
    const readback = await resources.renderer.readRenderTargetPixelsAsync(resources.target, 0, 0, width, height);
    return {
      candidate: compactRgba8Readback(
        new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
        width,
        height,
        resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
      ),
      width,
      height,
      renderSubmitMs,
    };
  });
}

function countBoundaryInkPixels(bytes: Uint8Array, width: number, height: number): number {
  let count = 0;
  for (let x = 0; x < width; x += 1) {
    if (pixelHasInk(bytes, x)) count += 1;
    if (height > 1 && pixelHasInk(bytes, (height - 1) * width + x)) count += 1;
  }
  for (let y = 1; y < height - 1; y += 1) {
    if (pixelHasInk(bytes, y * width)) count += 1;
    if (width > 1 && pixelHasInk(bytes, y * width + width - 1)) count += 1;
  }
  return count;
}

function countInkPixels(bytes: Uint8Array): number {
  let count = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    if (bytes[offset]! > 32 || bytes[offset + 1]! > 32 || bytes[offset + 2]! > 32) count += 1;
  }
  return count;
}

interface HorizontalFringeMeasurement {
  readonly sampleY: number;
  readonly inkMinX: number;
  readonly inkMaxX: number;
  readonly leftPartialCoverageWidth: number;
  readonly rightPartialCoverageWidth: number;
  readonly maximumPartialCoverageRun: number;
}

function horizontalFringeAtCenter(bytes: Uint8Array, width: number, height: number): HorizontalFringeMeasurement {
  let maximum = 0;
  let run = 0;
  const y = Math.floor(height / 2);
  let inkMinX = width;
  let inkMaxX = -1;
  for (let x = 0; x < width; x += 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value > 8) {
      inkMinX = Math.min(inkMinX, x);
      inkMaxX = x;
    }
    if (value > 8 && value < 247) {
      run += 1;
      maximum = Math.max(maximum, run);
    } else {
      run = 0;
    }
  }
  if (inkMaxX < inkMinX) throw new Error('Slug projection zoom center row contains no ink');
  let leftPartialCoverageWidth = 0;
  for (let x = inkMinX; x <= inkMaxX; x += 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value <= 8 || value >= 247) break;
    leftPartialCoverageWidth += 1;
  }
  let rightPartialCoverageWidth = 0;
  for (let x = inkMaxX; x >= inkMinX; x -= 1) {
    const value = bytes[(y * width + x) * 4]!;
    if (value <= 8 || value >= 247) break;
    rightPartialCoverageWidth += 1;
  }
  return {
    sampleY: y,
    inkMinX,
    inkMaxX,
    leftPartialCoverageWidth,
    rightPartialCoverageWidth,
    maximumPartialCoverageRun: maximum,
  };
}

function pixelHasInk(bytes: Uint8Array, pixelIndex: number): boolean {
  const offset = pixelIndex * 4;
  return bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 0;
}

/** Every layout read doubles as the commit check, because `Text` reports a failed synchronize through `error`. */
function committedLayout(line: Text<typeof slug>): ParagraphLayout {
  const error = line.error;
  if (error !== undefined) throw error;
  const layout = line.layout;
  if (layout === undefined) throw new Error('Slug conformance Text lost its committed layout');
  return layout;
}

async function disposeFlatSlugConformanceResources(resources: FlatSlugConformanceResources): Promise<void> {
  resources.line.removeFromParent();
  resources.line.dispose();
  resources.font.dispose();
  resources.target.dispose();
  if (resources.ownedRenderer !== undefined) await disposeConfiguredRenderer(resources.ownedRenderer);
}
