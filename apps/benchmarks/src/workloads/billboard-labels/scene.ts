import * as THREE from 'three/webgpu';

import type { ComparisonWorkloadDefinition } from '../comparison/contracts';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextMetrics,
  paintColor,
  type ComparisonWorkloadEntry,
  type WorkloadTextFactoryContext,
} from '../shared/scene-entry';

/** Fewest labels the shell carries, so the orbit still crosses depth at density zero. */
const BILLBOARD_MINIMUM_LABELS = 32;
/** Labels added at full density. 32..544 spans a readable scene through a genuinely dense one. */
const BILLBOARD_DENSITY_RANGE = 512;
/** Shell radius as a fraction of the smaller viewport axis, so the sphere stays fully on screen. */
const BILLBOARD_RADIUS_RATIO = 0.32;
/** Orbit distance as a multiple of the shell radius. Close enough that perspective separates depth. */
const BILLBOARD_ORBIT_DISTANCE_RATIO = 2.6;
/** How far the orbit rises and falls, as a fraction of radius, so labels cross rather than sweep. */
const BILLBOARD_ELEVATION_RATIO = 0.35;
/** Seconds for one full orbit: slow enough to read, fast enough to churn depth order. */
const BILLBOARD_ORBIT_PERIOD_MS = 24_000;

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

/** Maps the shared 0..100 density control onto a label count. */
export function billboardLabelCount(amount: number): number {
  const normalized = Math.min(100, Math.max(0, amount)) / 100;
  return BILLBOARD_MINIMUM_LABELS + Math.round(normalized * BILLBOARD_DENSITY_RANGE);
}

/** Returns a deterministic Fibonacci-distributed direction for cross-backend repeatability. */
function billboardDirection(index: number, count: number, target: THREE.Vector3): THREE.Vector3 {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = count === 1 ? 0 : 1 - (index / (count - 1)) * 2;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index;
  return target.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
}

/** Returns the center in the app's top-left-origin, descending-Y world space. */
function billboardCenter(viewportWidth: number, viewportHeight: number, target: THREE.Vector3): THREE.Vector3 {
  return target.set(viewportWidth / 2, -viewportHeight / 2, 0);
}

function billboardRadius(viewportWidth: number, viewportHeight: number): number {
  return Math.min(viewportWidth, viewportHeight) * BILLBOARD_RADIUS_RATIO;
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
    node.add(text);
    entries.push({ animationPhase: index, node, role: 'primary', sourceText, text });
  }
  return entries;
}

const billboardScratch = new THREE.Vector3();
const billboardCenterScratch = new THREE.Vector3();

/** Places the shell around the viewport centre and centres each label on its own anchor. */
export function layoutBillboardLabelEntries(
  entries: readonly ComparisonWorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const center = billboardCenter(viewportWidth, viewportHeight, billboardCenterScratch);
  const radius = billboardRadius(viewportWidth, viewportHeight);
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    const direction = billboardDirection(index, entries.length, billboardScratch);
    entry.node.position.copy(center).addScaledVector(direction, radius);
    const layout = committedTextMetrics(entry.text);
    entry.text.position.set(-layout.width / 2, layout.height / 2, 0);
  }
}

const billboardLookTarget = new THREE.Vector3();
interface BillboardOrderEntry {
  distance: number;
  entry: ComparisonWorkloadEntry;
}

const billboardOrder: BillboardOrderEntry[] = [];
const farthestBillboardFirst = (left: BillboardOrderEntry, right: BillboardOrderEntry): number =>
  right.distance - left.distance;

/** Orbits and faces labels, rewriting front-to-back order without reshaping them. */
export function animateBillboardLabelEntries(
  entries: readonly ComparisonWorkloadEntry[],
  elapsedMs: number,
  viewportWidth: number,
  viewportHeight: number,
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
): void {
  const center = billboardCenter(viewportWidth, viewportHeight, billboardCenterScratch);
  const radius = billboardRadius(viewportWidth, viewportHeight);
  const angle = ((elapsedMs % BILLBOARD_ORBIT_PERIOD_MS) / BILLBOARD_ORBIT_PERIOD_MS) * Math.PI * 2;
  camera.position.set(
    center.x + Math.cos(angle) * radius * BILLBOARD_ORBIT_DISTANCE_RATIO,
    center.y + Math.sin(angle * 2) * radius * BILLBOARD_ELEVATION_RATIO,
    center.z + Math.sin(angle) * radius * BILLBOARD_ORBIT_DISTANCE_RATIO,
  );
  billboardLookTarget.copy(center);
  camera.lookAt(billboardLookTarget);
  camera.updateMatrixWorld();

  billboardOrder.length = entries.length;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined) continue;
    // A billboard copies the camera's rotation rather than looking at it, so labels stay coplanar
    // with the screen instead of fanning at the edges of a wide field of view.
    entry.node.quaternion.copy(camera.quaternion);
    const order = billboardOrder[index] ?? { distance: 0, entry };
    order.distance = entry.node.position.distanceToSquared(camera.position);
    order.entry = entry;
    billboardOrder[index] = order;
  }
  // Farthest first, so nearer labels paint over the ones behind them.
  billboardOrder.sort(farthestBillboardFirst);
  for (let index = 0; index < billboardOrder.length; index += 1) {
    const sorted = billboardOrder[index];
    if (sorted !== undefined) sorted.entry.text.renderOrder = index;
  }
}

export const billboardLabelsWorkload = {
  animate(
    entries,
    _configuration,
    elapsedMs,
    viewportWidth,
    viewportHeight,
    _scene,
    _scratch,
    _onError,
    _onReflow,
    camera,
  ) {
    if (camera !== undefined) {
      animateBillboardLabelEntries(entries, elapsedMs, viewportWidth, viewportHeight, camera);
    }
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
  layout(entries, context) {
    layoutBillboardLabelEntries(entries, context.viewportWidth, context.viewportHeight);
  },
  suspendsIconWindow: false,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;
