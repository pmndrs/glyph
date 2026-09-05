import * as THREE from 'three/webgpu';

import type { ComparisonWorkloadDefinition } from '../comparison/contracts';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  paintColor,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

/** Radius of the shell the labels sit on, in world units. */
const BILLBOARD_RADIUS = 260;
/** How far the orbit rises and falls, so labels cross in depth rather than only sweeping sideways. */
const BILLBOARD_ORBIT_ELEVATION = 90;
/** Seconds for one full orbit. Slow enough to read the resort, fast enough to churn depth order. */
const BILLBOARD_ORBIT_PERIOD_MS = 24_000;
const BILLBOARD_CAMERA_DISTANCE = 520;
/** Fewest labels the shell ever carries, so the orbit still crosses depth at density zero. */
const BILLBOARD_MINIMUM_LABELS = 32;
/** Labels added at full density. 32..544 spans a readable scene through a genuinely dense one. */
const BILLBOARD_DENSITY_RANGE = 512;

/** Maps the shared 0..100 density control onto a label count. */
export function billboardLabelCount(amount: number): number {
  const normalized = Math.min(100, Math.max(0, amount)) / 100;
  return BILLBOARD_MINIMUM_LABELS + Math.round(normalized * BILLBOARD_DENSITY_RANGE);
}

const BILLBOARD_WORDS = [
  'Aperture',
  'Bearing',
  'Caliper',
  'Datum',
  'Escapement',
  'Ferrule',
  'Gimbal',
  'Housing',
  'Isotope',
  'Journal',
  'Kerf',
  'Lattice',
] as const;

/** A deterministic point on the shell, so a run is reproducible across techniques and backends. */
function billboardPosition(index: number, count: number): THREE.Vector3 {
  // Fibonacci sphere: even coverage without clustering at the poles, and no random source to seed.
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index;
  return new THREE.Vector3(Math.cos(theta) * radius, y, Math.sin(theta) * radius).multiplyScalar(BILLBOARD_RADIUS);
}

export function createBillboardLabelEntries(
  context: WorkloadTextFactoryContext & { readonly count: number; readonly fontSize: number },
): readonly ComparisonWorkloadEntry[] {
  const entries: ComparisonWorkloadEntry[] = [];
  for (let index = 0; index < context.count; index += 1) {
    const word = BILLBOARD_WORDS[index % BILLBOARD_WORDS.length] ?? 'Label';
    const sourceText = `${word} ${String(index)}`;
    const text = context.root.createText({
      font: context.font,
      rasterPixelRatio: context.dpr,
      text: sourceText,
      style: { fontSize: context.fontSize, lineHeight: LIVE_TEXT_LINE_HEIGHT, color: paintColor(LIVE_TEXT_COLOR) },
    });
    const node = new THREE.Group();
    node.position.copy(billboardPosition(index, context.count));
    node.add(text);
    entries.push({ node, role: 'primary', sourceText, text });
  }
  return entries;
}

/** Centres each label on its own anchor once its metrics are committed. */
export function layoutBillboardLabelEntries(entries: readonly ComparisonWorkloadEntry[]): void {
  for (const entry of entries) {
    const layout = committedTextMetrics(entry.text);
    entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
  }
}

const billboardCameraTarget = new THREE.Vector3(0, 0, 0);
const billboardDistanceScratch: { distance: number; entry: ComparisonWorkloadEntry }[] = [];

/**
 * Orbits the camera, faces every label at it, and reissues render order front to back.
 *
 * This is the case a draw-order guarantee has to survive: the labels never move, but which one is
 * nearest changes continuously, so their declared order has to be rewritten every frame without
 * re-shaping or re-planning any paragraph.
 */
export function animateBillboardLabelEntries(
  entries: readonly ComparisonWorkloadEntry[],
  elapsedMs: number,
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
): void {
  const phase = (elapsedMs % BILLBOARD_ORBIT_PERIOD_MS) / BILLBOARD_ORBIT_PERIOD_MS;
  const angle = phase * Math.PI * 2;
  camera.position.set(
    Math.cos(angle) * BILLBOARD_CAMERA_DISTANCE,
    Math.sin(angle * 2) * BILLBOARD_ORBIT_ELEVATION,
    Math.sin(angle) * BILLBOARD_CAMERA_DISTANCE,
  );
  camera.lookAt(billboardCameraTarget);
  camera.updateMatrixWorld();

  billboardDistanceScratch.length = 0;
  for (const entry of entries) {
    // A billboard copies the camera's rotation rather than looking at it, so labels stay coplanar
    // with the screen instead of fanning at the edges of a wide field of view.
    entry.node.quaternion.copy(camera.quaternion);
    billboardDistanceScratch.push({ distance: entry.node.position.distanceToSquared(camera.position), entry });
  }
  // Farthest first, so nearer labels paint over the ones behind them.
  billboardDistanceScratch.sort((left, right) => right.distance - left.distance);
  for (let index = 0; index < billboardDistanceScratch.length; index += 1) {
    const sorted = billboardDistanceScratch[index];
    if (sorted !== undefined) sorted.entry.text.renderOrder = index;
  }
}

export const billboardLabelsWorkload = {
  animate(entries, _configuration, elapsedMs, _width, _height, _scene, _scratch, _onError, _onReflow, camera) {
    if (camera !== undefined) animateBillboardLabelEntries(entries, elapsedMs, camera);
  },
  applyRetainedConfiguration() {},
  batching: 'group',
  cameraKind: 'perspective',
  contentWidth: 'none',
  create(context) {
    return createBillboardLabelEntries({
      count: billboardLabelCount(context.configuration.amount),
      dpr: context.dpr,
      font: context.font,
      fontSize: context.configuration.fontSize,
      root: context.root,
    });
  },
  id: 'billboard-labels',
  layout(entries) {
    layoutBillboardLabelEntries(entries);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;
