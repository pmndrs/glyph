import { span, txt, type TextFlow, type TextFlowExclusion } from '@pmndrs/glyph';
import { projectTextFlowBounds } from '@pmndrs/glyph/three';
import * as THREE from 'three/webgpu';

import type {
  ComparisonWorkloadConfiguration,
  ComparisonWorkloadDefinition,
  ComparisonWorkloadReflowPhases,
} from '../comparison/contracts';
import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  exactWidth,
  paintColor,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

/** One editorial column: every paragraph fully expands like CSS and bounds only compression. */
export const EDITORIAL_TEXT = [
  'The pull of a justified column is older than the press that made it common. A page holds its measure, both edges true, while every line negotiates its own interior: word spaces narrow only inside declared bounds and widen to settle the remaining difference.',
  'Typography is the craft of endowing human language with a durable visual form. The paragraph opens with a small indent, carries its own space before and after, and asks the composer for restraint: compression never past three quarters, full expansion to the far edge, and the last line left to fall where it may.',
  'A tight measure is the honest test. When the column narrows, the breaker may borrow back the declared shrink to seat one more word; when it widens, word spaces absorb the remainder so the edge remains true. The reader should notice none of this — only that the page sits quietly.',
] as const;

const EDITORIAL_JUSTIFY = {
  minWordSpaceRatio: 0.75,
} as const;

/** A bounded expansion specimen: word spaces cap first, then letter gaps absorb the remainder. */
const EDITORIAL_BOUNDED_JUSTIFY = {
  ...EDITORIAL_JUSTIFY,
  maxWordSpaceRatio: 1.25,
  letterSpaceExpansion: 4,
} as const;

const EDITORIAL_DROP_CAP_COLOR = '#e87938';
const EDITORIAL_DROP_CAP_CONTOUR = [
  [0, 0],
  [1, 0],
  [1, 0.3],
  [0.6, 0.3],
  [0.85, 1],
  [0, 1],
] as const;
const EDITORIAL_OBSTACLE_COLOR = 0x2dd4bf;
const EDITORIAL_FLOW_REGION_KEYS = ['editorial-left', 'editorial-right'] as const;
const EDITORIAL_OBSTACLE_KEY = 'editorial-projected-object';

export const editorialWorkload = {
  animate(
    entries,
    configuration,
    elapsedMs,
    viewportWidth,
    viewportHeight,
    scene,
    _scratch,
    onError,
    onReflow,
    camera,
  ) {
    animateEditorialEntries(
      entries,
      configuration,
      elapsedMs,
      viewportWidth,
      viewportHeight,
      scene,
      onError,
      onReflow,
      camera,
    );
  },
  applyRetainedConfiguration() {},
  batching: 'group',
  cameraKind: 'perspective',
  contentWidth: { maximumWidth: 860 },
  create(context) {
    return createEditorialEntries({
      ...context.configuration,
      animationElapsedMs: context.animationElapsedMs,
      dpr: context.dpr,
      font: context.font,
      root: context.root,
      viewportWidth: context.viewportWidth,
    });
  },
  id: 'editorial',
  layout(entries, context) {
    layoutEditorialEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

/** The animated editorial measure: one shared column width breathing slowly. */
export function editorialColumnWidth(
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed' | 'layoutWidthRatio'>,
  viewportWidth: number,
  animationElapsedMs: number,
): number {
  const phase = animationElapsedMs * 0.00035 * animationRate(configuration.animationSpeed);
  const baseWidth = benchmarkContentWidth(viewportWidth, configuration.layoutWidthRatio, 860);
  return Math.max(220, baseWidth * (0.82 + Math.sin(phase) * 0.16));
}

/** The columned body keeps a fixed page height; reflow refills it as the measure breathes. */
export function editorialBodyHeight(fontSize: number): number {
  return Math.ceil(fontSize * LIVE_TEXT_LINE_HEIGHT * 11);
}

export function createEditorialEntries(
  context: WorkloadTextFactoryContext &
    Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationSpeed' | 'fontSize' | 'layoutWidthRatio'> & {
      readonly animationElapsedMs: number;
      readonly viewportWidth: number;
    },
): readonly ComparisonWorkloadEntry[] {
  const width = editorialColumnWidth(context, context.viewportWidth, context.animationElapsedMs);
  // A real editorial page: one single-measure justified lede, then the body
  // flowing through two ordered justified columns under it. The amount control
  // scales how much body text refills the fixed page height.
  const repeats = Math.max(1, Math.round(context.amount / 25));
  const bodyText = Array.from({ length: repeats }, (_, cycle) =>
    EDITORIAL_TEXT.slice(cycle === 0 ? 1 : 0).join(' '),
  ).join(' ');
  if (!bodyText.startsWith('Typography')) throw new Error('editorial body must retain its drop-cap source');
  const dropCap = span({ color: EDITORIAL_DROP_CAP_COLOR, fontSize: context.fontSize * 3.2 });
  const bodyLiteral = txt`${dropCap`T`}${bodyText.slice(1)}`;
  const lede = context.root.createText({
    font: context.font,
    rasterPixelRatio: context.dpr,
    text: EDITORIAL_TEXT[0],
    style: { fontSize: context.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT, color: paintColor(LIVE_TEXT_COLOR) },
    constraints: { width: exactWidth(width) },
    layout: {
      wrap: 'word',
      align: 'justify',
      spaceAfter: context.fontSize * 0.8,
      justify: EDITORIAL_BOUNDED_JUSTIFY,
    },
  });
  const body = context.root.createText({
    font: context.font,
    rasterPixelRatio: context.dpr,
    text: bodyLiteral,
    style: {
      fontSize: context.fontSize,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      wordSpacing: context.fontSize * 0.05,
      color: paintColor(LIVE_TEXT_COLOR),
    },
    constraints: {
      width: exactWidth(width),
      height: { mode: 'exact', size: editorialBodyHeight(context.fontSize) },
    },
    layout: {
      wrap: 'word',
      align: 'justify',
      firstLineIndent: context.fontSize * 1.5,
      dropCap: {
        lines: 3,
        marginInline: context.fontSize * 0.2,
        marginBlock: context.fontSize * 0.05,
        contour: EDITORIAL_DROP_CAP_CONTOUR,
      },
      justify: EDITORIAL_JUSTIFY,
      overflow: 'clip',
    },
    flow: editorialFlow(width, editorialBodyHeight(context.fontSize), context.fontSize),
  });
  const obstacleSize = context.fontSize * 2.8;
  const obstacleGeometry = new THREE.BoxGeometry(obstacleSize, obstacleSize, obstacleSize * 0.7);
  const obstacleMaterial = new THREE.MeshBasicNodeMaterial({ color: EDITORIAL_OBSTACLE_COLOR });
  const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
  obstacle.rotation.set(0.4, 0.65, 0.18);
  const bodyNode = new THREE.Group();
  bodyNode.add(body, obstacle);
  return [
    { node: lede, role: 'primary', sourceText: EDITORIAL_TEXT[0], text: lede, lastWidth: width },
    {
      node: bodyNode,
      role: 'secondary',
      sourceText: bodyLiteral.text,
      text: body,
      lastWidth: width,
      editorialObstacle: obstacle,
      editorialObstacleBounds: new THREE.Box3(
        new THREE.Vector3(-obstacleSize / 2, -obstacleSize / 2, -(obstacleSize * 0.7) / 2),
        new THREE.Vector3(obstacleSize / 2, obstacleSize / 2, (obstacleSize * 0.7) / 2),
      ),
    },
  ];
}

export function editorialFlow(
  width: number,
  height: number,
  gap: number,
  exclusions: readonly (TextFlowExclusion | undefined)[] = [],
): TextFlow {
  if (![width, height, gap].every(Number.isFinite) || width <= 0 || height <= 0 || gap < 0 || gap >= width) {
    throw new RangeError('editorial flow dimensions must describe two positive columns');
  }
  const columnWidth = (width - gap) / 2;
  return {
    regions: EDITORIAL_FLOW_REGION_KEYS.map((key, index) => {
      const inlineStart = index === 0 ? 0 : columnWidth + gap;
      const inlineEnd = index === 0 ? columnWidth : width;
      const exclusion = exclusions[index];
      return {
        key,
        shape: { kind: 'rectangle', bounds: [inlineStart, 0, inlineEnd, height] },
        ...(exclusion === undefined ? {} : { exclusions: [exclusion] }),
      };
    }),
  };
}

export function animateEditorialEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'animationEnabled' | 'animationSpeed' | 'fontSize' | 'layoutWidthRatio'
  >,
  timestamp: number,
  viewportWidth: number,
  viewportHeight: number,
  scene: THREE.Scene,
  onError: (error: unknown) => void,
  onReflow: (duration: number, phases?: ComparisonWorkloadReflowPhases) => void,
  camera?: THREE.OrthographicCamera | THREE.PerspectiveCamera,
): void {
  const reflowStarted = performance.now();
  try {
    const body = entries.find((entry) => entry.editorialObstacle !== undefined);
    if (body?.editorialObstacle === undefined || body.editorialObstacleBounds === undefined) {
      throw new Error('editorial workload is missing its projected obstacle');
    }
    if (camera === undefined) throw new Error('editorial workload requires its perspective camera');
    const motionTimestamp = configuration.animationEnabled ? timestamp : 0;
    const width = editorialColumnWidth(configuration, viewportWidth, motionTimestamp);
    const bodyHeight = editorialBodyHeight(configuration.fontSize);
    positionEditorialObstacle(body.editorialObstacle, width, bodyHeight, configuration.animationSpeed, motionTimestamp);
    const flow = projectedEditorialFlow(body, camera, width, bodyHeight, configuration.fontSize);
    if (
      !configuration.animationEnabled &&
      body.editorialProjectionInitialized === true &&
      body.lastWidth !== undefined &&
      Math.abs(width - body.lastWidth) < 1
    ) {
      return;
    }
    for (const entry of entries) {
      entry.lastWidth = width;
      entry.text.set({
        constraints: { ...entry.text.constraints, width: exactWidth(width) },
        ...(entry === body ? { flow } : {}),
      });
    }
    const stageMs = performance.now() - reflowStarted;
    const publishStarted = performance.now();
    publishWorkloadTexts(scene, entries);
    const publishMs = performance.now() - publishStarted;
    const layoutStarted = performance.now();
    layoutEditorialEntries(entries, viewportWidth, viewportHeight);
    const layoutMs = performance.now() - layoutStarted;
    body.editorialProjectionInitialized = true;
    onReflow(performance.now() - reflowStarted, { stageMs, publishMs, layoutMs });
  } catch (error) {
    onError(error);
  }
}

export function positionEditorialObstacle(
  obstacle: THREE.Object3D,
  width: number,
  height: number,
  animationSpeed: number,
  timestamp: number,
): void {
  const phase = timestamp * 0.00042 * animationRate(animationSpeed);
  obstacle.position.set(
    width * (0.5 + Math.sin(phase * 0.73) * 0.28),
    -height * (0.42 + Math.sin(phase * 0.39) * 0.18),
    Math.cos(phase) * Math.max(24, width * 0.16),
  );
  obstacle.rotation.set(0.4 + phase * 0.17, 0.65 + phase * 0.31, 0.18 + phase * 0.11);
}

function projectedEditorialFlow(
  entry: ComparisonWorkloadEntry,
  camera: THREE.Camera,
  width: number,
  height: number,
  gap: number,
): TextFlow {
  const obstacle = entry.editorialObstacle;
  const bounds = entry.editorialObstacleBounds;
  if (obstacle === undefined || bounds === undefined) throw new Error('editorial obstacle state is incomplete');
  const base = editorialFlow(width, height, gap);
  const exclusions = base.regions.map((region) => {
    if (region.shape.kind !== 'rectangle') throw new Error('editorial region must stay rectangular');
    return projectTextFlowBounds({
      key: `${EDITORIAL_OBSTACLE_KEY}-${region.key}`,
      camera,
      text: entry.text,
      object: obstacle,
      bounds,
      flowBounds: region.shape.bounds,
      projectionError: 0.5,
      wrapSide: 'largest',
      marginInline: gap * 0.2,
      marginBlock: gap * 0.15,
    });
  });
  return editorialFlow(width, height, gap, exclusions);
}

/** Paragraphs stack from their measured extents: space-after is part of the block size. */
export function layoutEditorialEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const inset = 24;
  let columnWidth = 0;
  let totalHeight = 0;
  for (const entry of entries) {
    const layout = committedTextMetrics(entry.text);
    columnWidth = Math.max(columnWidth, layout.width);
    entry.node.position.set(0, -totalHeight, 0);
    totalHeight += layout.height;
  }
  const left = Math.max(inset, (viewportWidth - columnWidth) / 2);
  const top = Math.max(inset, (viewportHeight - totalHeight) / 2);
  for (const entry of entries) {
    entry.node.position.set(left, entry.node.position.y - top, 0);
  }
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}
