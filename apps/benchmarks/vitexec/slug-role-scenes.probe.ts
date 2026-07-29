export {};

const slugTextPath = '/src/renderer/slug-text.ts';
const scenesPath = '/src/renderer/slug-role-scenes.ts';
const environmentPath = '/src/benchmark/environment.ts';
const [slugText, sceneDefinitions, { environmentResource }] = await Promise.all([
  import(/* @vite-ignore */ slugTextPath),
  import(/* @vite-ignore */ scenesPath),
  import(/* @vite-ignore */ environmentPath),
]);

const environment = await environmentResource();
if (!environment.webgpu) throw new Error('Slug role-scene capture requires an available WebGPU adapter');

const observations: Array<Record<string, unknown>> = [];
const dprStableCandidateHashes = new Map<string, string>();
for (const backend of ['webgpu', 'webgl2'] as const) {
  for (const dpr of [1, 2] as const) {
    for (const scene of sceneDefinitions.SLUG_ROLE_SCENES) {
      const capture = await slugText.captureSlugRoleScene({ backend, dpr, scene });
      const pixelCount = capture.width * capture.height;
      if (
        capture.candidate.byteLength !== pixelCount * 4 ||
        capture.cpuReference.byteLength !== pixelCount * 4 ||
        capture.sourceReference.byteLength !== pixelCount * 4 ||
        capture.glyphCount <= 0 ||
        capture.evaluatedCurves <= 0 ||
        capture.cpuMeanAbsoluteError > 0.01 ||
        capture.cpuErrorPixels > 64 ||
        capture.cpuSevereErrorPixels !== 0 ||
        capture.sourceMeanAbsoluteError > 2 ||
        capture.sourceErrorPixels > pixelCount * 0.03 ||
        capture.viewportClipped !== scene.expectsViewportClipping ||
        (scene.expectsViewportClipping ? capture.boundaryInkPixels <= 0 : capture.boundaryInkPixels !== 0)
      ) {
        throw new Error(`Slug role scene exceeded its quality envelope: ${scene.id}`);
      }
      const candidateHash = await sha256(capture.candidate);
      assertDprStableCandidate(`${backend}:${scene.id}`, dpr, candidateHash);
      observations.push({
        backend,
        dpr,
        sceneId: scene.id,
        kind: scene.kind,
        fontFixture: scene.fontFixture,
        physicalPpem: scene.physicalPpem,
        width: capture.width,
        height: capture.height,
        candidateHash,
        numericalAuthority: 'independent-scalar-slug-reference',
        cpuReferenceHash: await sha256(capture.cpuReference),
        sourceReferenceHash: await sha256(capture.sourceReference),
        cpuMeanAbsoluteError: capture.cpuMeanAbsoluteError,
        cpuMaximumError: capture.cpuMaximumError,
        cpuErrorPixels: capture.cpuErrorPixels,
        cpuSevereErrorPixels: capture.cpuSevereErrorPixels,
        sourceMeanAbsoluteError: capture.sourceMeanAbsoluteError,
        sourceMaximumError: capture.sourceMaximumError,
        sourceErrorPixels: capture.sourceErrorPixels,
        glyphCount: capture.glyphCount,
        evaluatedCurves: capture.evaluatedCurves,
        boundaryInkPixels: capture.boundaryInkPixels,
        viewportClipped: capture.viewportClipped,
        renderSubmitMs: capture.renderSubmitMs,
      });
    }

    const affine = await slugText.captureSlugAffineRoleScene({
      backend,
      dpr,
      scene: sceneDefinitions.SLUG_AFFINE_ROLE_SCENE,
    });
    const affinePixelCount = affine.width * affine.height;
    if (
      affine.candidate.byteLength !== affinePixelCount * 4 ||
      affine.sourceReference.byteLength !== affinePixelCount * 4 ||
      affine.sourceMeanAbsoluteError > 1 ||
      affine.sourceErrorPixels > affinePixelCount * 0.02 ||
      affine.boundaryInkPixels !== 0
    ) {
      throw new Error('Slug affine role scene exceeded its quality envelope');
    }
    const affineCandidateHash = await sha256(affine.candidate);
    assertDprStableCandidate(`${backend}:${affine.scene.id}`, dpr, affineCandidateHash);
    observations.push({
      backend,
      dpr,
      sceneId: affine.scene.id,
      kind: affine.scene.kind,
      fontFixture: affine.scene.fontFixture,
      physicalPpem: affine.scene.physicalPpem,
      width: affine.width,
      height: affine.height,
      candidateHash: affineCandidateHash,
      numericalAuthority: 'not-applicable',
      sourceReferenceHash: await sha256(affine.sourceReference),
      sourceMeanAbsoluteError: affine.sourceMeanAbsoluteError,
      sourceMaximumError: affine.sourceMaximumError,
      sourceErrorPixels: affine.sourceErrorPixels,
      boundaryInkPixels: affine.boundaryInkPixels,
      renderSubmitMs: affine.renderSubmitMs,
    });

    const projectionZoom = await slugText.captureSlugProjectionZoomRoleScene({
      backend,
      dpr,
      scene: sceneDefinitions.SLUG_PROJECTION_ZOOM_SCENE,
    });
    const [zoomOne, zoomEight] = projectionZoom.captures;
    if (
      zoomOne.fringeWidth <= 0 ||
      zoomEight.fringeWidth <= 0 ||
      zoomOne.fringeWidth > 2 ||
      zoomEight.fringeWidth > 2 ||
      zoomOne.fringeSampleY !== Math.floor(projectionZoom.height / 2) ||
      zoomEight.fringeSampleY !== Math.floor(projectionZoom.height / 2) ||
      zoomOne.fringeInkMinX >= zoomOne.fringeInkMaxX ||
      zoomEight.fringeInkMinX >= zoomEight.fringeInkMaxX ||
      zoomOne.leftFringeWidth + zoomOne.rightFringeWidth <= 0 ||
      zoomEight.leftFringeWidth + zoomEight.rightFringeWidth <= 0 ||
      zoomOne.inkPixels <= 0 ||
      zoomEight.inkPixels <= zoomOne.inkPixels ||
      zoomOne.sourceMeanAbsoluteError > 1 ||
      zoomEight.sourceMeanAbsoluteError > 1 ||
      zoomOne.sourceErrorPixels > projectionZoom.width * projectionZoom.height * 0.01 ||
      zoomEight.sourceErrorPixels > projectionZoom.width * projectionZoom.height * 0.01
    ) {
      throw new Error('Slug projection zoom did not preserve its screen-space AA contract');
    }
    for (const capture of projectionZoom.captures) {
      const candidateHash = await sha256(capture.candidate);
      assertDprStableCandidate(`${backend}:${projectionZoom.scene.id}:${String(capture.zoom)}`, dpr, candidateHash);
      observations.push({
        backend,
        dpr,
        sceneId: projectionZoom.scene.id,
        kind: projectionZoom.scene.kind,
        fontFixture: projectionZoom.scene.fontFixture,
        basePhysicalPpem: projectionZoom.scene.physicalPpem,
        zoom: capture.zoom,
        effectivePhysicalPpem: projectionZoom.scene.physicalPpem * capture.zoom,
        width: projectionZoom.width,
        height: projectionZoom.height,
        candidateHash,
        numericalAuthority: 'not-applicable',
        sourceReferenceHash: await sha256(capture.sourceReference),
        sourceMeanAbsoluteError: capture.sourceMeanAbsoluteError,
        sourceMaximumError: capture.sourceMaximumError,
        sourceErrorPixels: capture.sourceErrorPixels,
        fringeWidth: capture.fringeWidth,
        fringeSampleY: capture.fringeSampleY,
        fringeInkMinX: capture.fringeInkMinX,
        fringeInkMaxX: capture.fringeInkMaxX,
        leftFringeWidth: capture.leftFringeWidth,
        rightFringeWidth: capture.rightFringeWidth,
        inkPixels: capture.inkPixels,
        renderSubmitMs: capture.renderSubmitMs,
      });
    }
  }
}

console.log(
  'slug-role-scenes-ready',
  JSON.stringify({
    schemaVersion: 0,
    kind: 'slug-role-scene-observation',
    capturedAt: new Date().toISOString(),
    environment,
    authority: {
      visual: 'current-browser-source-font',
      flatNumerical: 'independent-scalar-slug-reference',
      transformedNumerical: 'not-applicable',
      historicalOnly: 'three-flatland',
    },
    priorArt: {
      revision: '2935a89fcd9999e8a8b3d3b733f7f7302285cd60',
      transformGate: 'examples/three/uikit/s3.ts',
      projectionZoomGate: 'examples/three/uikit/u2.ts',
      preservedTransform: '37deg rotation with 3x0.5 nonuniform scale',
      preservedProjectionZoom: 'same Inter I geometry at 1x and 8x camera zoom',
    },
    observations,
  }),
);

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertDprStableCandidate(key: string, dpr: 1 | 2, hash: string): void {
  const first = dprStableCandidateHashes.get(key);
  if (dpr === 1) {
    if (first !== undefined) throw new Error(`Duplicate Slug role-scene DPR-1 identity: ${key}`);
    dprStableCandidateHashes.set(key, hash);
    return;
  }
  if (first !== hash) throw new Error(`Slug role scene changed physical output across DPR: ${key}`);
}
