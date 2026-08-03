import { Text } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import { benchmarkContentWidth, LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './shared/text-style';

import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from './contracts';
import {
  committedTextLayout,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from './factory-contracts';

export const DYNAMIC_LAYOUT_TEXT = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Left-aligned lines narrow and open while every word reshapes into its changing measure.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This centered paragraph breathes independently while preserving its typographic rhythm.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Right-aligned lines reflow on their own cadence and remain anchored to the far edge.',
] as const;

export const dynamicLayoutWorkload = {
  cameraKind: 'orthographic',
  contentWidth: { maximumWidth: 1_000 },
  id: 'dynamic-layout',
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function dynamicLayoutWidths(
  configuration: Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationSpeed' | 'layoutWidthRatio'>,
  viewportWidth: number,
  animationElapsedMs: number,
  target: Float64Array = new Float64Array(DYNAMIC_LAYOUT_TEXT.length),
): Float64Array {
  const phase = animationElapsedMs * 0.00045 * animationRate(configuration.animationSpeed);
  const amplitude = 0.08 + (configuration.amount / 100) * 0.28;
  const baseWidth = benchmarkContentWidth(viewportWidth, configuration.layoutWidthRatio, 1_000);
  if (target.length !== DYNAMIC_LAYOUT_TEXT.length) {
    throw new RangeError(`dynamic layout width target must contain ${String(DYNAMIC_LAYOUT_TEXT.length)} values`);
  }
  for (let index = 0; index < DYNAMIC_LAYOUT_TEXT.length; index += 1) {
    target[index] = Math.max(160, baseWidth * (0.72 + Math.sin(phase + index * ((Math.PI * 2) / 3)) * amplitude));
  }
  return target;
}

export function createDynamicLayoutEntries(
  context: WorkloadTextFactoryContext &
    Pick<ComparisonWorkloadConfiguration, 'amount' | 'animationSpeed' | 'fontSize' | 'layoutWidthRatio'> & {
      readonly animationElapsedMs: number;
      readonly showLayoutBounds: boolean;
      readonly viewportWidth: number;
    },
): readonly ComparisonWorkloadEntry[] {
  const widths = dynamicLayoutWidths(context, context.viewportWidth, context.animationElapsedMs);
  return DYNAMIC_LAYOUT_TEXT.map((sourceText, index) => {
    const alignment = (['start', 'center', 'end'] as const)[index]!;
    const animationPhase = index * ((Math.PI * 2) / 3);
    const width = widths[index]!;
    const text = new Text({
      font: context.font,
      raster: context.raster,
      rasterPixelRatio: context.dpr,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      text: sourceText,
      fontSize: context.fontSize,
      color: LIVE_TEXT_COLOR,
      width,
      wrap: 'word',
      textAlign: alignment,
    });
    const bounds = createLayoutBounds();
    setDynamicLayoutBoundsVisibility(bounds, context.showLayoutBounds);
    const node = new THREE.Group();
    node.add(bounds, text);
    return {
      node,
      role: index === 0 ? 'primary' : 'secondary',
      sourceText,
      text,
      bounds,
      alignment,
      animationPhase,
      lastWidth: width,
      widthUpdate: { width },
    };
  });
}

export function setDynamicLayoutBoundsVisibility(bounds: { visible: boolean }, visible: boolean): void {
  bounds.visible = visible;
}

export function animateDynamicLayoutEntries(
  entries: readonly ComparisonWorkloadEntry[],
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'amount' | 'animationEnabled' | 'animationSpeed' | 'layoutWidthRatio'
  >,
  timestamp: number,
  viewportWidth: number,
  viewportHeight: number,
  widthsScratch: Float64Array,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (!configuration.animationEnabled) return;
  const nextWidths = dynamicLayoutWidths(configuration, viewportWidth, timestamp, widthsScratch);
  if (
    entries.length === nextWidths.length &&
    entries.every((entry, index) => entry.lastWidth !== undefined && Math.abs(nextWidths[index]! - entry.lastWidth) < 1)
  ) {
    return;
  }
  const reflowStarted = performance.now();
  try {
    for (const [index, entry] of entries.entries()) {
      entry.lastWidth = nextWidths[index]!;
      if (entry.widthUpdate === undefined) throw new Error('dynamic layout entry is missing its retained width update');
      entry.widthUpdate.width = nextWidths[index]!;
      entry.text.setProperties(entry.widthUpdate);
    }
    for (const { node } of entries) node.updateMatrixWorld(true);
    layoutDynamicLayoutEntries(entries, viewportWidth, viewportHeight);
    onReflow(performance.now() - reflowStarted);
  } catch (error) {
    onError(error);
  }
}

export function layoutDynamicLayoutEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const inset = 20;
  const laneHeight = viewportHeight / Math.max(1, entries.length);
  for (const [index, entry] of entries.entries()) {
    const layout = committedTextLayout(entry.text);
    const x =
      entry.alignment === 'end'
        ? viewportWidth - inset - layout.width
        : entry.alignment === 'center'
          ? (viewportWidth - layout.width) / 2
          : inset;
    const y = index * laneHeight + Math.max(inset, (laneHeight - layout.height) / 2);
    entry.text.position.set(x, -y, 0);
    if (entry.bounds !== undefined) updateLayoutBounds(entry.bounds, x, y, layout.width, layout.height);
  }
}

function createLayoutBounds(): THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial> {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3));
  const material = new THREE.LineBasicNodeMaterial({
    color: 0xb6bac3,
    depthTest: false,
    depthWrite: false,
    opacity: 0.55,
    transparent: true,
  });
  return new THREE.LineSegments(geometry, material);
}

function updateLayoutBounds(
  bounds: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const positions = bounds.geometry.getAttribute('position');
  const right = x + width;
  const bottom = -(y + height);
  const top = -y;
  const vertices = [
    x,
    top,
    0,
    right,
    top,
    0,
    right,
    top,
    0,
    right,
    bottom,
    0,
    right,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    top,
    0,
  ];
  if (!(positions.array instanceof Float32Array)) {
    throw new TypeError('dynamic layout bounds require a Float32 position buffer');
  }
  positions.array.set(vertices);
  positions.needsUpdate = true;
  bounds.geometry.computeBoundingSphere();
}

function animationRate(animationSpeed: number): number {
  return 0.25 + animationSpeed * 0.0175;
}
