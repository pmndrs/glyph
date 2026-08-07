import { Text } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

import fontAwesomeIcons from '../../../fixtures/fonts/font-awesome-free-6.7.2/icons.json';
import type { ComparisonWorkloadConfiguration, ComparisonWorkloadDefinition } from '../comparison/contracts';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../shared/text-style';
import {
  committedTextLayout,
  exactWidth,
  paintColor,
  publishWorkloadTexts,
  type ComparisonWorkloadEntry,
  type WorkloadFont,
} from '../shared/scene-entry';

export const ICON_GRID_LABEL_SIZE = 11;
const ICON_GRID_LABEL_WIDTH = 112;
const ICON_GRID_INSET = 24;
const ICON_GRID_GAP = 18;
const ICON_GRID_MIN_CELL_WIDTH = 112;
const ICON_GRID_ICON_PADDING = 16;
const ICON_GRID_LABEL_GAP = 8;
export const ICON_GRID_OVERSCAN_ROWS = 3;
export const ICON_GRID_OVERSCAN_COLUMNS = 3;
const ICON_GRID_FRAME_DELTA_RESPONSE = 0.2;
const ICON_GRID_MAX_FRAME_DELTA_MULTIPLIER = 2;
// Authenticated fa-solid-900.ttf metrics: 512 units/em and a 640-unit maximum advance.
const ICON_GRID_FONT_UNITS_PER_EM = 512;
const ICON_GRID_MAX_ADVANCE = 640;
const ICON_GRID_MAX_ADVANCE_EM = ICON_GRID_MAX_ADVANCE / ICON_GRID_FONT_UNITS_PER_EM;
export const ICON_GRID_ITEMS = fontAwesomeIcons.icons;
const ICON_GRID_CONTENT = ICON_GRID_ITEMS.map((icon) => {
  const glyph = String.fromCodePoint(icon.codePoint);
  return { content: `${glyph}\n${icon.name}`, glyph, label: icon.name };
});

/** Icon Grid keeps a retained, virtualized pool and therefore owns suspension policy. */
export const iconGridWorkload = {
  animate() {},
  applyRetainedConfiguration() {},
  batching: 'group',
  cameraKind: 'orthographic',
  contentWidth: 'none',
  create(context) {
    if (context.iconFont === undefined) throw new Error('icon grid requires its icon font fixture');
    const window = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      context.configuration.fontSize,
      context.viewportWidth,
      context.viewportHeight,
      context.iconScrollX,
      context.iconScrollY,
    );
    return createIconGridEntries({
      count: window.poolCapacity,
      dpr: context.dpr,
      iconFont: context.iconFont,
      iconSize: context.configuration.fontSize,
      indices: window.indices,
      labelFont: context.font,
    });
  },
  id: 'icon-grid',
  layout(entries, context) {
    const layout = iconGridLayout(ICON_GRID_ITEMS.length, context.configuration.fontSize, context.viewportWidth);
    for (const entry of entries) {
      if (entry.virtualIconIndex === undefined) continue;
      const column = entry.virtualIconIndex % layout.columns;
      const row = Math.floor(entry.virtualIconIndex / layout.columns);
      positionIconGridEntry(entry, layout, column, row, context.configuration.fontSize);
    }
  },
  suspendsIconWindow: true,
  updateKind: () => 'retained',
} satisfies ComparisonWorkloadDefinition;

export function createIconGridEntries({
  dpr,
  iconFont,
  iconSize,
  indices = [],
  labelFont,
  count,
}: {
  readonly count: number;
  readonly dpr: number;
  readonly iconFont: WorkloadFont;
  readonly iconSize: number;
  readonly indices?: readonly number[];
  readonly labelFont: WorkloadFont;
}): readonly ComparisonWorkloadEntry[] {
  return Array.from({ length: count }, (_, poolIndex) => {
    const assignment = iconGridEntryAssignment(indices, poolIndex);
    const iconIndex = assignment.iconIndex;
    const { content, glyph } = iconGridContent(iconIndex);
    const text = new Text({
      font: iconFont,
      rasterPixelRatio: dpr,
      text: glyph,
      style: { fontSize: iconSize },
      paint: { color: paintColor(LIVE_TEXT_COLOR) },
    });
    const labelText = new Text({
      font: labelFont,
      rasterPixelRatio: dpr,
      text: iconGridLabel(iconIndex),
      style: { fontSize: ICON_GRID_LABEL_SIZE, lineHeight: LIVE_TEXT_LINE_HEIGHT },
      paint: { color: paintColor(LIVE_TEXT_COLOR) },
      contentBox: {
        width: exactWidth(ICON_GRID_LABEL_WIDTH),
        maxLines: 2,
        overflow: 'ellipsis',
        wrap: 'none',
        align: 'center',
      },
    });
    const node = new THREE.Group();
    node.add(text, labelText);
    if (assignment.virtualIconIndex === undefined) {
      node.visible = false;
      return { node, role: 'primary', sourceText: content, text, labelText };
    }
    return {
      node,
      role: 'primary',
      sourceText: content,
      text,
      labelText,
      virtualIconIndex: assignment.virtualIconIndex,
    };
  });
}

/** Maps an unassigned pool slot to a hidden placeholder without falsely assigning icon zero. */
export function iconGridEntryAssignment(
  indices: readonly number[],
  poolIndex: number,
): { readonly iconIndex: number; readonly virtualIconIndex: number | undefined } {
  const virtualIconIndex = indices[poolIndex];
  return { iconIndex: virtualIconIndex ?? 0, virtualIconIndex };
}

export function iconGridContent(iconIndex: number): { readonly content: string; readonly glyph: string } {
  const content = ICON_GRID_CONTENT[iconIndex];
  if (content === undefined) throw new RangeError(`Unknown Font Awesome icon index: ${String(iconIndex)}`);
  return content;
}

export function iconGridLabel(iconIndex: number): string {
  const content = ICON_GRID_CONTENT[iconIndex];
  if (content === undefined) throw new RangeError(`Unknown Font Awesome icon index: ${String(iconIndex)}`);
  return content.label;
}

export function positionIconGridEntry(
  entry: ComparisonWorkloadEntry,
  layout: IconGridLayout,
  column: number,
  row: number,
  iconSize: number,
): void {
  const iconLayout = committedTextLayout(entry.text);
  entry.node.position.set(
    layout.inset + column * (layout.cellWidth + layout.gap),
    -(layout.inset + row * (layout.cellHeight + layout.gap)),
    0,
  );
  entry.text.position.set((layout.cellWidth - iconLayout.width) / 2, 0, 0);
  entry.labelText?.position.set(
    (layout.cellWidth - ICON_GRID_LABEL_WIDTH) / 2,
    -(iconSize * LIVE_TEXT_LINE_HEIGHT + ICON_GRID_LABEL_GAP),
    0,
  );
  freezeLocalMatrices(entry.node);
}

export function resizeIconGridEntries(
  entries: readonly ComparisonWorkloadEntry[],
  iconSize: number,
  layout: IconGridLayout,
  root: THREE.Object3D,
): void {
  for (const entry of entries) entry.text.set({ style: { ...entry.text.style, fontSize: iconSize } });
  publishWorkloadTexts(root, entries);
  for (const entry of entries) {
    if (entry.virtualIconIndex === undefined) continue;
    const column = entry.virtualIconIndex % layout.columns;
    const row = Math.floor(entry.virtualIconIndex / layout.columns);
    positionIconGridEntry(entry, layout, column, row, iconSize);
  }
}

function freezeLocalMatrices(root: THREE.Object3D): void {
  root.traverse((object) => {
    object.updateMatrix();
    object.matrixAutoUpdate = false;
  });
}

export interface IconGridLayout {
  readonly columns: number;
  readonly rows: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly gap: number;
  readonly inset: number;
  readonly width: number;
  readonly height: number;
}

export interface IconGridAutoPanState {
  directionX: -1 | 1;
  directionY: -1 | 1;
  scrollX: number;
  scrollY: number;
}

export interface IconGridFrameDeltaState {
  smoothedElapsedMs: number | undefined;
}

export function iconGridAutoPanStart(
  view: 'origin' | 'alternate',
  maximumScrollX: number,
  maximumScrollY: number,
): IconGridAutoPanState {
  if (!Number.isFinite(maximumScrollX) || !Number.isFinite(maximumScrollY)) {
    throw new TypeError('icon grid auto-pan bounds must be finite');
  }
  if (maximumScrollX < 0 || maximumScrollY < 0) {
    throw new RangeError('icon grid auto-pan bounds must be non-negative');
  }
  if (view === 'origin') return { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };
  if (view === 'alternate') {
    return {
      directionX: -1,
      directionY: -1,
      scrollX: maximumScrollX * 0.72,
      scrollY: maximumScrollY * 0.58,
    };
  }
  throw new RangeError(`unknown icon grid view: ${String(view)}`);
}

export function smoothIconGridFrameDelta(state: IconGridFrameDeltaState, elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new RangeError('icon grid frame delta must be finite and nonnegative');
  }
  if (elapsedMs === 0) return 0;
  const previous = state.smoothedElapsedMs;
  if (previous === undefined) {
    state.smoothedElapsedMs = elapsedMs;
    return elapsedMs;
  }
  const boundedElapsedMs = Math.min(elapsedMs, previous * ICON_GRID_MAX_FRAME_DELTA_MULTIPLIER);
  const smoothedElapsedMs = previous + (boundedElapsedMs - previous) * ICON_GRID_FRAME_DELTA_RESPONSE;
  state.smoothedElapsedMs = smoothedElapsedMs;
  return smoothedElapsedMs;
}

const ICON_GRID_AUTO_PAN_PX_PER_SECOND = 160;

export interface IconGridViewport {
  readonly height: number;
  readonly width: number;
}

/**
 * The renderer owns Text readiness, scene attachment, and disposal. Icon Grid owns which of those retained Texts
 * represent the current virtual window, including its scroll, recycling, and metrics state.
 */
export interface IconGridEntryPool {
  entries(): readonly ComparisonWorkloadEntry[];
  resize(poolCapacity: number, iconSize: number, layout: IconGridLayout): Promise<void>;
}

export interface IconGridWorkloadMetrics {
  readonly assignedCount: number;
  readonly assignmentSignature: string;
  readonly firstVisibleIndex: number;
  readonly gridHeight: number;
  readonly gridWidth: number;
  readonly lastVisibleIndex: number;
  readonly maximumScrollX: number;
  readonly maximumScrollY: number;
  readonly poolCapacity: number;
  readonly recycleCount: number;
  readonly renderVisibleCount: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly windowRevision: number;
  readonly columnCount: number;
  readonly rowCount: number;
}

export interface IconGridWorkloadInstance {
  activate(configuration: ComparisonWorkloadConfiguration, viewport: IconGridViewport): IconGridVirtualWindow;
  dispose(): void;
  frame(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    timestamp: number,
    animationRate: number,
    onError: (error: unknown) => void,
  ): void;
  metrics(viewport: IconGridViewport, scene: THREE.Scene): IconGridWorkloadMetrics;
  panBy(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    deltaX: number,
    deltaY: number,
    onError: (error: unknown) => void,
  ): { readonly deltaX: number; readonly deltaY: number };
  reconfigure(
    previous: ComparisonWorkloadConfiguration,
    next: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
  ): Promise<void>;
  requestRefresh(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void;
  resetView(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void;
  resume(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void;
  settle(configuration: ComparisonWorkloadConfiguration, viewport: IconGridViewport, scene: THREE.Scene): void;
  suspend(): void;
}

export function createIconGridWorkloadInstance(
  pool: IconGridEntryPool,
  isCurrent: () => boolean,
): IconGridWorkloadInstance {
  return new RetainedIconGridWorkload(pool, isCurrent);
}

class RetainedIconGridWorkload implements IconGridWorkloadInstance {
  readonly #autoPan: IconGridAutoPanState = { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };
  readonly #frameDelta: IconGridFrameDeltaState = { smoothedElapsedMs: undefined };
  readonly #desiredEpochs = new Uint32Array(ICON_GRID_ITEMS.length);
  readonly #retainedEpochs = new Uint32Array(ICON_GRID_ITEMS.length);
  readonly #availableEntries: ComparisonWorkloadEntry[] = [];
  readonly #pendingEntries: ComparisonWorkloadEntry[] = [];
  readonly #missingIndices: number[] = [];
  #assignmentEpoch = 0;
  #assignmentSignature = '[]';
  #autoPanTimestamp: number | undefined;
  #disposed = false;
  #iconSize = 1;
  #pendingWindow: IconGridVirtualWindow | undefined;
  #refreshDeferred = false;
  #refreshing = false;
  #requestScrollX = 0;
  #requestScrollY = 0;
  #recycleCount = 0;
  #settledWindow: IconGridVirtualWindow | undefined;
  #suspended = false;
  #windowRevision = 0;
  readonly #pool: IconGridEntryPool;
  readonly #isCurrent: () => boolean;

  constructor(pool: IconGridEntryPool, isCurrent: () => boolean) {
    this.#pool = pool;
    this.#isCurrent = isCurrent;
  }

  activate(configuration: ComparisonWorkloadConfiguration, viewport: IconGridViewport): IconGridVirtualWindow {
    this.#assertLive();
    this.#iconSize = configuration.fontSize;
    const origin = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewport.width,
      viewport.height,
      0,
      0,
    );
    const start = iconGridAutoPanStart(
      configuration.iconGridView ?? 'origin',
      origin.maximumScrollX,
      origin.maximumScrollY,
    );
    this.#autoPan.directionX = start.directionX;
    this.#autoPan.directionY = start.directionY;
    this.#autoPan.scrollX = start.scrollX;
    this.#autoPan.scrollY = start.scrollY;
    this.#autoPanTimestamp = undefined;
    this.#frameDelta.smoothedElapsedMs = undefined;
    this.#requestScrollX = start.scrollX;
    this.#requestScrollY = start.scrollY;
    this.#settledWindow = undefined;
    return iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewport.width,
      viewport.height,
      start.scrollX,
      start.scrollY,
    );
  }

  dispose(): void {
    this.#disposed = true;
    this.#pendingWindow = undefined;
    this.#availableEntries.length = 0;
    this.#pendingEntries.length = 0;
    this.#missingIndices.length = 0;
  }

  frame(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    timestamp: number,
    animationRate: number,
    onError: (error: unknown) => void,
  ): void {
    if (this.#disposed) return;
    const elapsedMs = this.#autoPanTimestamp === undefined ? 0 : Math.max(0, timestamp - this.#autoPanTimestamp);
    this.#autoPanTimestamp = timestamp;
    const window = this.#settledWindow;
    if (!configuration.animationEnabled || window === undefined) return;
    advanceIconGridAutoPan(
      this.#autoPan,
      -scene.position.x,
      scene.position.y,
      window.maximumScrollX,
      window.maximumScrollY,
      smoothIconGridFrameDelta(this.#frameDelta, elapsedMs),
      ICON_GRID_AUTO_PAN_PX_PER_SECOND * animationRate,
    );
    scene.position.set(-this.#autoPan.scrollX, this.#autoPan.scrollY, 0);
    updateIconGridEntryVisibility(
      this.#pool.entries(),
      window.layout,
      this.#autoPan.scrollX,
      this.#autoPan.scrollY,
      viewport,
    );
    const pitchX = window.layout.cellWidth + window.layout.gap;
    const pitchY = window.layout.cellHeight + window.layout.gap;
    if (
      Math.abs(this.#autoPan.scrollX - this.#requestScrollX) >= pitchX ||
      Math.abs(this.#autoPan.scrollY - this.#requestScrollY) >= pitchY
    ) {
      this.requestRefresh(configuration, viewport, scene, onError);
    }
  }

  metrics(viewport: IconGridViewport, scene: THREE.Scene): IconGridWorkloadMetrics {
    const window =
      this.#settledWindow ??
      iconGridVirtualWindow(
        ICON_GRID_ITEMS.length,
        this.#iconSize,
        viewport.width,
        viewport.height,
        -scene.position.x,
        scene.position.y,
      );
    let assignedCount = 0;
    let renderVisibleCount = 0;
    const entries = this.#pool.entries();
    for (const entry of entries) {
      if (entry.virtualIconIndex !== undefined) assignedCount += 1;
      if (entry.node.visible) renderVisibleCount += 1;
    }
    return {
      assignedCount,
      assignmentSignature: this.#assignmentSignature,
      columnCount: window.layout.columns,
      firstVisibleIndex: window.firstVisibleIndex,
      gridHeight: window.layout.height,
      gridWidth: window.layout.width,
      lastVisibleIndex: window.lastVisibleIndex,
      maximumScrollX: window.maximumScrollX,
      maximumScrollY: window.maximumScrollY,
      poolCapacity: entries.length,
      recycleCount: this.#recycleCount,
      renderVisibleCount,
      rowCount: window.layout.rows,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      windowRevision: this.#windowRevision,
    };
  }

  panBy(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    deltaX: number,
    deltaY: number,
    onError: (error: unknown) => void,
  ): { readonly deltaX: number; readonly deltaY: number } {
    this.#assertLive();
    const horizontal = finite(deltaX, 'workload horizontal pan');
    const vertical = finite(deltaY, 'workload vertical pan');
    const previousX = scene.position.x;
    const previousY = scene.position.y;
    scene.position.x += horizontal;
    scene.position.y -= vertical;
    this.#clampScene(configuration.fontSize, viewport, scene);
    this.requestRefresh(configuration, viewport, scene, onError);
    return { deltaX: scene.position.x - previousX, deltaY: previousY - scene.position.y };
  }

  async reconfigure(
    previous: ComparisonWorkloadConfiguration,
    next: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
  ): Promise<void> {
    this.#assertLive();
    const viewChanged = next.iconGridView !== previous.iconGridView;
    const nextAutoPan = viewChanged ? iconGridViewStart(next, viewport) : undefined;
    const [requestedScrollX, requestedScrollY] =
      nextAutoPan !== undefined
        ? [nextAutoPan.scrollX, nextAutoPan.scrollY]
        : next.fontSize === previous.fontSize
          ? [-scene.position.x, scene.position.y]
          : iconGridCenteredScroll(
              ICON_GRID_ITEMS.length,
              previous.fontSize,
              next.fontSize,
              viewport.width,
              viewport.height,
              -scene.position.x,
              scene.position.y,
            );
    const nextWindow = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      next.fontSize,
      viewport.width,
      viewport.height,
      requestedScrollX,
      requestedScrollY,
    );
    await this.#pool.resize(nextWindow.poolCapacity, next.fontSize, nextWindow.layout);
    if (!this.#isLive()) return;
    if (nextAutoPan !== undefined) {
      this.#autoPan.directionX = nextAutoPan.directionX;
      this.#autoPan.directionY = nextAutoPan.directionY;
      this.#frameDelta.smoothedElapsedMs = undefined;
    }
    this.#iconSize = next.fontSize;
    scene.position.set(-nextWindow.scrollX, nextWindow.scrollY, 0);
    this.#applyWindow(nextWindow, next.fontSize, viewport, scene);
  }

  requestRefresh(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void {
    if (!this.#isLive()) return;
    this.#requestScrollX = -scene.position.x;
    this.#requestScrollY = scene.position.y;
    if (this.#suspended) {
      this.#refreshDeferred = true;
      return;
    }
    this.#pendingWindow = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewport.width,
      viewport.height,
      this.#requestScrollX,
      this.#requestScrollY,
    );
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      while (this.#pendingWindow !== undefined && this.#isLive()) {
        const nextWindow = this.#pendingWindow;
        this.#pendingWindow = undefined;
        this.#applyWindow(nextWindow, configuration.fontSize, viewport, scene);
      }
    } catch (error) {
      onError(error);
    } finally {
      this.#refreshing = false;
    }
    if (this.#pendingWindow !== undefined && this.#isLive()) {
      this.requestRefresh(configuration, viewport, scene, onError);
    }
  }

  resetView(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void {
    if (this.#disposed) return;
    this.#autoPan.directionX = 1;
    this.#autoPan.directionY = 1;
    this.#autoPan.scrollX = 0;
    this.#autoPan.scrollY = 0;
    this.#autoPanTimestamp = undefined;
    this.#frameDelta.smoothedElapsedMs = undefined;
    scene.position.set(0, 0, 0);
    this.requestRefresh(configuration, viewport, scene, onError);
  }

  resume(
    configuration: ComparisonWorkloadConfiguration,
    viewport: IconGridViewport,
    scene: THREE.Scene,
    onError: (error: unknown) => void,
  ): void {
    if (this.#disposed) return;
    this.#suspended = false;
    if (!this.#refreshDeferred) return;
    this.#refreshDeferred = false;
    this.requestRefresh(configuration, viewport, scene, onError);
  }

  suspend(): void {
    if (this.#disposed) return;
    this.#suspended = true;
    this.#refreshDeferred = true;
  }

  settle(configuration: ComparisonWorkloadConfiguration, viewport: IconGridViewport, scene: THREE.Scene): void {
    this.#iconSize = configuration.fontSize;
    this.#settleWindow(
      iconGridVirtualWindow(
        ICON_GRID_ITEMS.length,
        configuration.fontSize,
        viewport.width,
        viewport.height,
        -scene.position.x,
        scene.position.y,
      ),
      viewport,
      scene,
    );
  }

  #applyWindow(window: IconGridVirtualWindow, iconSize: number, viewport: IconGridViewport, scene: THREE.Scene): void {
    const entries = this.#pool.entries();
    if (window.poolCapacity !== entries.length) {
      throw new Error('icon grid pool capacity changed without a scene rebuild');
    }
    this.#assignmentEpoch = (this.#assignmentEpoch + 1) >>> 0;
    if (this.#assignmentEpoch === 0) {
      this.#desiredEpochs.fill(0);
      this.#retainedEpochs.fill(0);
      this.#assignmentEpoch = 1;
    }
    this.#availableEntries.length = 0;
    this.#pendingEntries.length = 0;
    this.#missingIndices.length = 0;
    for (const index of window.indices) this.#desiredEpochs[index] = this.#assignmentEpoch;
    for (const entry of entries) {
      const iconIndex = entry.virtualIconIndex;
      if (
        iconIndex !== undefined &&
        this.#desiredEpochs[iconIndex] === this.#assignmentEpoch &&
        this.#retainedEpochs[iconIndex] !== this.#assignmentEpoch
      ) {
        this.#retainedEpochs[iconIndex] = this.#assignmentEpoch;
        continue;
      }
      this.#availableEntries.push(entry);
    }
    for (const index of window.indices) {
      if (this.#retainedEpochs[index] !== this.#assignmentEpoch) this.#missingIndices.push(index);
    }
    if (this.#missingIndices.length > this.#availableEntries.length) {
      throw new Error('icon grid window exceeds its recyclable tile pool');
    }
    for (const [poolIndex, iconIndex] of this.#missingIndices.entries()) {
      const entry = this.#availableEntries[poolIndex]!;
      const { glyph } = iconGridContent(iconIndex);
      entry.text.set({ text: glyph });
      entry.labelText?.set({ text: iconGridLabel(iconIndex) });
      this.#pendingEntries.push(entry);
    }
    // Recycled tiles share the workload's batch, so one publication commits every reassigned Text at once.
    publishWorkloadTexts(scene, this.#pendingEntries);
    if (!this.#isLive()) return;
    for (const [poolIndex, entry] of this.#pendingEntries.entries()) {
      if (entry.disposed) continue;
      const iconIndex = this.#missingIndices[poolIndex]!;
      const { content } = iconGridContent(iconIndex);
      entry.virtualIconIndex = iconIndex;
      entry.sourceText = content;
      const column = iconIndex % window.layout.columns;
      const row = Math.floor(iconIndex / window.layout.columns);
      positionIconGridEntry(entry, window.layout, column, row, iconSize);
    }
    for (let index = this.#missingIndices.length; index < this.#availableEntries.length; index += 1) {
      const entry = this.#availableEntries[index]!;
      entry.node.visible = false;
      delete entry.virtualIconIndex;
    }
    this.#recycleCount += this.#missingIndices.length;
    this.#settleWindow(window, viewport, scene);
  }

  #assertLive(): void {
    if (!this.#isLive()) throw new DOMException('The Icon Grid workload instance is disposed', 'AbortError');
  }

  #clampScene(iconSize: number, viewport: IconGridViewport, scene: THREE.Scene): void {
    const layout = iconGridLayout(ICON_GRID_ITEMS.length, iconSize, viewport.width);
    const maximumScrollX = Math.max(0, layout.width - viewport.width);
    const maximumScrollY = Math.max(0, layout.height - viewport.height);
    scene.position.x = Math.min(0, Math.max(-maximumScrollX, scene.position.x));
    scene.position.y = Math.min(maximumScrollY, Math.max(0, scene.position.y));
  }

  #isLive(): boolean {
    return !this.#disposed && this.#isCurrent();
  }

  #settleWindow(window: IconGridVirtualWindow, viewport: IconGridViewport, scene: THREE.Scene): void {
    const assignments = iconGridAssignments(this.#pool.entries());
    if (
      assignments.length !== window.indices.length ||
      assignments.some(({ index }, assignmentIndex) => index !== window.indices[assignmentIndex])
    ) {
      throw new Error('icon grid cannot publish a window before every assignment is coherent');
    }
    updateIconGridEntryVisibility(this.#pool.entries(), window.layout, -scene.position.x, scene.position.y, viewport);
    this.#settledWindow = window;
    this.#assignmentSignature = JSON.stringify(assignments);
    this.#windowRevision += 1;
  }
}

function iconGridViewStart(
  configuration: ComparisonWorkloadConfiguration,
  viewport: IconGridViewport,
): IconGridAutoPanState {
  const origin = iconGridVirtualWindow(
    ICON_GRID_ITEMS.length,
    configuration.fontSize,
    viewport.width,
    viewport.height,
    0,
    0,
  );
  return iconGridAutoPanStart(configuration.iconGridView ?? 'origin', origin.maximumScrollX, origin.maximumScrollY);
}

function updateIconGridEntryVisibility(
  entries: readonly ComparisonWorkloadEntry[],
  layout: IconGridLayout,
  scrollX: number,
  scrollY: number,
  viewport: IconGridViewport,
): void {
  const pitchX = layout.cellWidth + layout.gap;
  const pitchY = layout.cellHeight + layout.gap;
  const viewportRight = scrollX + viewport.width;
  const viewportBottom = scrollY + viewport.height;
  for (const entry of entries) {
    const index = entry.virtualIconIndex;
    if (index === undefined) {
      entry.node.visible = false;
      continue;
    }
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    const left = layout.inset + column * pitchX;
    const top = layout.inset + row * pitchY;
    entry.node.visible =
      left + layout.cellWidth > scrollX &&
      left < viewportRight &&
      top + layout.cellHeight > scrollY &&
      top < viewportBottom;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

export function advanceIconGridAutoPan(
  state: IconGridAutoPanState,
  scrollX: number,
  scrollY: number,
  maximumScrollX: number,
  maximumScrollY: number,
  elapsedMs: number,
  speedPxPerSecond: number,
): void {
  if (![scrollX, scrollY, maximumScrollX, maximumScrollY, elapsedMs, speedPxPerSecond].every(Number.isFinite)) {
    throw new TypeError('icon grid auto-pan inputs must be finite');
  }
  if (maximumScrollX < 0 || maximumScrollY < 0) {
    throw new RangeError('icon grid auto-pan bounds must be non-negative');
  }
  if (elapsedMs < 0 || speedPxPerSecond < 0) {
    throw new RangeError('icon grid auto-pan elapsed time and speed must be non-negative');
  }
  if ((state.directionX !== -1 && state.directionX !== 1) || (state.directionY !== -1 && state.directionY !== 1)) {
    throw new RangeError('icon grid auto-pan directions must be -1 or 1');
  }
  state.scrollX = Math.min(maximumScrollX, Math.max(0, scrollX));
  state.scrollY = Math.min(maximumScrollY, Math.max(0, scrollY));
  const distance = (elapsedMs / 1_000) * speedPxPerSecond;
  advanceIconGridAutoPanAxis(state, 'x', distance, maximumScrollX);
  advanceIconGridAutoPanAxis(state, 'y', distance, maximumScrollY);
}

export interface IconGridVirtualWindow {
  readonly layout: IconGridLayout;
  readonly indices: readonly number[];
  readonly visibleIndices: readonly number[];
  readonly poolCapacity: number;
  readonly firstVisibleIndex: number;
  readonly lastVisibleIndex: number;
  readonly scrollX: number;
  readonly scrollY: number;
  readonly maximumScrollX: number;
  readonly maximumScrollY: number;
}

export interface IconGridAssignment {
  readonly index: number;
  readonly content: string;
}

export function iconGridCenteredScroll(
  itemCount: number,
  previousIconSize: number,
  nextIconSize: number,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
): readonly [number, number] {
  positive(viewportHeight, 'icon grid viewport height');
  if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY)) {
    throw new TypeError('icon grid scroll positions must be finite');
  }
  const previous = iconGridLayout(itemCount, previousIconSize, viewportWidth);
  const next = iconGridLayout(itemCount, nextIconSize, viewportWidth);
  const previousPitchX = previous.cellWidth + previous.gap;
  const previousPitchY = previous.cellHeight + previous.gap;
  const nextPitchX = next.cellWidth + next.gap;
  const nextPitchY = next.cellHeight + next.gap;
  const anchorColumn = (scrollX + viewportWidth / 2 - previous.inset) / previousPitchX;
  const anchorRow = (scrollY + viewportHeight / 2 - previous.inset) / previousPitchY;
  const requestedScrollX = next.inset + anchorColumn * nextPitchX - viewportWidth / 2;
  const requestedScrollY = next.inset + anchorRow * nextPitchY - viewportHeight / 2;
  const maximumScrollX = Math.max(0, next.width - viewportWidth);
  const maximumScrollY = Math.max(0, next.height - viewportHeight);
  return [
    Math.min(maximumScrollX, Math.max(0, requestedScrollX)),
    Math.min(maximumScrollY, Math.max(0, requestedScrollY)),
  ];
}

export function iconGridViewportUpdateKind(
  currentPoolCapacity: number,
  nextWindow: Pick<IconGridVirtualWindow, 'poolCapacity'>,
): 'rebuild' | 'retained' {
  if (!Number.isSafeInteger(currentPoolCapacity) || currentPoolCapacity < 0) {
    throw new RangeError('icon grid pool capacity must be a non-negative safe integer');
  }
  return currentPoolCapacity === nextWindow.poolCapacity ? 'retained' : 'rebuild';
}

export function iconGridAssignmentSignature(
  entries: readonly { readonly sourceText: string; readonly virtualIconIndex?: number }[],
): string {
  return JSON.stringify(iconGridAssignments(entries));
}

export function iconGridLayout(itemCount: number, iconSize: number, viewportWidth: number): IconGridLayout {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) {
    throw new RangeError('icon grid item count must be a positive safe integer');
  }
  positive(iconSize, 'icon grid icon size');
  positive(viewportWidth, 'icon grid viewport width');
  const cellWidth = Math.max(
    ICON_GRID_MIN_CELL_WIDTH,
    iconSize * ICON_GRID_MAX_ADVANCE_EM + ICON_GRID_ICON_PADDING * 2,
  );
  const cellHeight = (iconSize + ICON_GRID_LABEL_SIZE) * LIVE_TEXT_LINE_HEIGHT + ICON_GRID_LABEL_GAP;
  const columns = Math.ceil(Math.sqrt(itemCount));
  const rows = Math.ceil(itemCount / columns);
  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    gap: ICON_GRID_GAP,
    inset: ICON_GRID_INSET,
    width: ICON_GRID_INSET * 2 + columns * cellWidth + Math.max(0, columns - 1) * ICON_GRID_GAP,
    height: ICON_GRID_INSET * 2 + rows * cellHeight + Math.max(0, rows - 1) * ICON_GRID_GAP,
  };
}

export function iconGridVirtualWindow(
  itemCount: number,
  iconSize: number,
  viewportWidth: number,
  viewportHeight: number,
  requestedScrollX: number,
  requestedScrollY: number,
): IconGridVirtualWindow {
  positive(viewportHeight, 'icon grid viewport height');
  if (!Number.isFinite(requestedScrollX) || !Number.isFinite(requestedScrollY)) {
    throw new TypeError('icon grid scroll positions must be finite');
  }
  const layout = iconGridLayout(itemCount, iconSize, viewportWidth);
  const maximumScrollX = Math.max(0, layout.width - viewportWidth);
  const maximumScrollY = Math.max(0, layout.height - viewportHeight);
  const scrollX = Math.min(maximumScrollX, Math.max(0, requestedScrollX));
  const scrollY = Math.min(maximumScrollY, Math.max(0, requestedScrollY));
  const pitchX = layout.cellWidth + layout.gap;
  const pitchY = layout.cellHeight + layout.gap;
  const [firstVisibleColumn, lastVisibleColumn] = intersectingGridRange(
    scrollX,
    scrollX + viewportWidth,
    layout.inset,
    layout.cellWidth,
    pitchX,
    layout.columns,
  );
  const [firstVisibleRow, lastVisibleRow] = intersectingGridRange(
    scrollY,
    scrollY + viewportHeight,
    layout.inset,
    layout.cellHeight,
    pitchY,
    layout.rows,
  );
  const visibleColumnCapacity = Math.ceil(viewportWidth / pitchX) + 1;
  const poolColumns = Math.min(layout.columns, visibleColumnCapacity + ICON_GRID_OVERSCAN_COLUMNS * 2);
  const poolStartColumn = Math.min(
    Math.max(0, layout.columns - poolColumns),
    Math.max(0, firstVisibleColumn - ICON_GRID_OVERSCAN_COLUMNS),
  );
  const visibleRowCapacity = Math.ceil(viewportHeight / pitchY) + 1;
  const poolRows = Math.min(layout.rows, visibleRowCapacity + ICON_GRID_OVERSCAN_ROWS * 2);
  const poolStartRow = Math.min(
    Math.max(0, layout.rows - poolRows),
    Math.max(0, firstVisibleRow - ICON_GRID_OVERSCAN_ROWS),
  );
  const poolEndRow = poolStartRow + poolRows;
  const indices: number[] = [];
  for (let row = poolStartRow; row < poolEndRow; row += 1) {
    for (let column = poolStartColumn; column < poolStartColumn + poolColumns; column += 1) {
      const index = row * layout.columns + column;
      if (index < itemCount) indices.push(index);
    }
  }
  const visibleIndices: number[] = [];
  for (let row = firstVisibleRow; row <= lastVisibleRow; row += 1) {
    for (let column = firstVisibleColumn; column <= lastVisibleColumn; column += 1) {
      const index = row * layout.columns + column;
      if (index < itemCount) visibleIndices.push(index);
    }
  }
  return {
    layout,
    indices,
    visibleIndices,
    poolCapacity: poolRows * poolColumns,
    firstVisibleIndex: visibleIndices.at(0) ?? -1,
    lastVisibleIndex: visibleIndices.at(-1) ?? -1,
    scrollX,
    scrollY,
    maximumScrollX,
    maximumScrollY,
  };
}

function advanceIconGridAutoPanAxis(
  state: IconGridAutoPanState,
  axis: 'x' | 'y',
  distance: number,
  maximum: number,
): void {
  if (maximum === 0) {
    if (axis === 'x') {
      state.scrollX = 0;
      state.directionX = 1;
    } else {
      state.scrollY = 0;
      state.directionY = 1;
    }
    return;
  }
  const position = axis === 'x' ? state.scrollX : state.scrollY;
  const direction = axis === 'x' ? state.directionX : state.directionY;
  const cycle = maximum * 2;
  const startingPhase = direction === 1 ? position : cycle - position;
  const phase = (startingPhase + distance) % cycle;
  const nextPosition = phase <= maximum ? phase : cycle - phase;
  const nextDirection = phase < maximum || phase === 0 ? 1 : -1;
  if (axis === 'x') {
    state.scrollX = nextPosition;
    state.directionX = nextDirection;
  } else {
    state.scrollY = nextPosition;
    state.directionY = nextDirection;
  }
}

export function iconGridAssignments(
  entries: readonly { readonly sourceText: string; readonly virtualIconIndex?: number }[],
): readonly IconGridAssignment[] {
  const assignments = entries
    .filter(
      (entry): entry is typeof entry & { readonly virtualIconIndex: number } => entry.virtualIconIndex !== undefined,
    )
    .map(({ sourceText, virtualIconIndex }) => ({ index: virtualIconIndex, content: sourceText }))
    .sort((left, right) => left.index - right.index);
  for (let index = 1; index < assignments.length; index += 1) {
    if (assignments[index - 1]!.index === assignments[index]!.index) {
      throw new Error(`icon grid assigned catalog index ${String(assignments[index]!.index)} twice`);
    }
  }
  return assignments;
}

function intersectingGridRange(
  minimum: number,
  maximum: number,
  origin: number,
  cellSize: number,
  pitch: number,
  count: number,
): readonly [number, number] {
  const first = Math.floor((minimum - origin - cellSize) / pitch) + 1;
  const last = Math.ceil((maximum - origin) / pitch) - 1;
  return [Math.min(count - 1, Math.max(0, first)), Math.min(count - 1, Math.max(0, last))];
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}
