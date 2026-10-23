import type { GlyphLayoutInspection } from '@pmndrs/glyph';
import * as THREE from 'three/webgpu';
import type { ComparisonWorkloadConfiguration } from '../../../workloads/comparison/contracts';
import { projectedPausedEditorialFlow, sameEditorialFlow } from '../../../workloads/editorial/scene';
import type { ComparisonWorkloadEntry } from '../../../workloads/shared/scene-entry';

/** Requested only by the installed-archive editorial proof, after its paused completed-frame signal. */
export function editorialSceneProof(
  configuration: ComparisonWorkloadConfiguration,
  dpr: number,
  revision: number,
  viewport: readonly [number, number],
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  entries: readonly ComparisonWorkloadEntry[],
) {
  if (configuration.workload !== 'editorial' || configuration.animationEnabled || entries.length !== 2) {
    throw new Error('Editorial scene proof requires a paused, committed editorial scene');
  }
  const [lede, body] = entries;
  if (lede === undefined || body === undefined || body.editorialObstacle === undefined) {
    throw new Error('Editorial scene proof lost its lede, body, or obstacle');
  }
  if (body.editorialProjectionInitialized !== true) {
    throw new Error('Editorial scene proof requires a published projected flow');
  }
  camera.updateMatrixWorld();
  const projectedBodyFlow = projectedPausedEditorialFlow(body, camera, configuration, viewport[0]);
  if (!sameEditorialFlow(projectedBodyFlow, body.text.flow)) {
    throw new Error('Editorial scene proof found body flow stale against the captured scene transforms');
  }
  return {
    schemaVersion: 1,
    configuration: {
      revision,
      workload: configuration.workload,
      amount: configuration.amount,
      animationEnabled: configuration.animationEnabled,
      animationSpeed: configuration.animationSpeed,
      fontSize: configuration.fontSize,
      layoutWidthRatio: configuration.layoutWidthRatio,
      dpr,
      viewport,
      fontFixture: configuration.fontFixture,
      showGrid: configuration.showGrid,
    },
    camera: {
      kind: camera instanceof THREE.PerspectiveCamera ? 'perspective' : 'orthographic',
      matrixWorld: camera.matrixWorld.toArray(),
      matrixWorldInverse: camera.matrixWorldInverse.toArray(),
      projectionMatrix: camera.projectionMatrix.toArray(),
      projectionMatrixInverse: camera.projectionMatrixInverse.toArray(),
    },
    obstacle: {
      worldMatrix: body.editorialObstacle.matrixWorld.toArray(),
      localBounds:
        body.editorialObstacleBounds === undefined
          ? undefined
          : {
              min: body.editorialObstacleBounds.min.toArray(),
              max: body.editorialObstacleBounds.max.toArray(),
            },
    },
    projectedBodyFlow,
    texts: entries.map((entry) => ({
      role: entry.role,
      sourceText: entry.sourceText,
      text: entry.text.text,
      style: entry.text.style,
      layout: entry.text.layout,
      constraints: entry.text.constraints,
      flow: entry.text.flow,
      rasterPixelRatio: entry.text.rasterPixelRatio,
      nodeWorldMatrix: entry.node.matrixWorld.toArray(),
      textWorldMatrix: entry.text.matrixWorld.toArray(),
      aggregateMeasurement: entry.text.measure(),
      placement: placedGlyphRows(entry.text.glyphs()),
    })),
  };
}

function placedGlyphRows(layout: GlyphLayoutInspection) {
  return {
    measurement: {
      width: layout.width,
      height: layout.height,
      glyphCount: layout.glyphCount,
      lineCount: layout.lineCount,
      missingGlyphCount: layout.missingGlyphCount,
    },
    lines: Array.from({ length: layout.lineCount }, (_, index) => ({
      textStart: layout.lineTextStarts[index],
      textEnd: layout.lineTextEnds[index],
      glyphStart: layout.lineGlyphStarts[index],
      glyphCount: layout.lineGlyphCounts[index],
      baseline: layout.lineBaselines[index],
      advance: layout.lineAdvances[index],
    })),
    glyphs: Array.from({ length: layout.glyphCount }, (_, index) => ({
      stableId: layout.glyphStableIds[index],
      fontHandle: layout.fontHandles[layout.glyphFontSlots[index] ?? 0],
      fontSlot: layout.glyphFontSlots[index],
      glyphId: layout.glyphIds[index],
      cluster: layout.clusters[index],
      bidiLevel: layout.glyphBidiLevels[index],
      fontSize: layout.glyphFontSizes[index],
      x: layout.x[index],
      y: layout.y[index],
      advance: layout.glyphAdvances[index],
      inkX: layout.glyphInkX[index],
      inkY: layout.glyphInkY[index],
      inkWidth: layout.glyphInkWidths[index],
      inkHeight: layout.glyphInkHeights[index],
      flags: layout.glyphFlags[index],
    })),
  };
}
