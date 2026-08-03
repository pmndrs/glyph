import { Text, type AnyRasterInput, type RegisteredFont } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import fontAwesomeIcons from '../../fixtures/fonts/font-awesome-free-6.7.2/icons.json';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './shared/text-style';
import type { ComparisonWorkloadDefinition } from './contracts';
import { committedTextLayout, type ComparisonWorkloadEntry } from './factory-contracts';

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
      labelRaster: context.raster,
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

export interface IconGridFont {
  readonly font: RegisteredFont;
  readonly raster: AnyRasterInput;
}

export function createIconGridEntries({
  dpr,
  iconFont,
  iconSize,
  indices = [],
  labelFont,
  labelRaster,
  count,
}: {
  readonly count: number;
  readonly dpr: number;
  readonly iconFont: IconGridFont;
  readonly iconSize: number;
  readonly indices?: readonly number[];
  readonly labelFont: RegisteredFont;
  readonly labelRaster: AnyRasterInput;
}): readonly ComparisonWorkloadEntry[] {
  return Array.from({ length: count }, (_, poolIndex) => {
    const assignment = iconGridEntryAssignment(indices, poolIndex);
    const iconIndex = assignment.iconIndex;
    const { content, glyph } = iconGridContent(iconIndex);
    const text = new Text({
      font: iconFont.font,
      raster: iconFont.raster,
      rasterPixelRatio: dpr,
      text: glyph,
      fontSize: iconSize,
      color: LIVE_TEXT_COLOR,
    });
    const labelText = new Text({
      font: labelFont,
      raster: labelRaster,
      rasterPixelRatio: dpr,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      text: iconGridLabel(iconIndex),
      fontSize: ICON_GRID_LABEL_SIZE,
      color: LIVE_TEXT_COLOR,
      width: ICON_GRID_LABEL_WIDTH,
      maxLines: 2,
      overflow: 'ellipsis',
      wrap: 'none',
      textAlign: 'center',
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
): void {
  for (const entry of entries) entry.text.setProperties({ fontSize: iconSize });
  for (const { node } of entries) node.updateMatrixWorld(true);
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
