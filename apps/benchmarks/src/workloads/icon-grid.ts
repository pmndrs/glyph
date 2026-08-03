import { Text, type AnyRasterInput, type RegisteredFont } from '@pmndrs/text';
import * as THREE from 'three/webgpu';

import fontAwesomeIcons from '../../fixtures/fonts/font-awesome-free-6.7.2/icons.json';
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from '../renderer/live-text-style';
import type { ComparisonWorkloadDefinition } from './contracts';
import type { ComparisonWorkloadEntry } from './factory-contracts';

const ICON_GRID_LABEL_SIZE = 11;
const ICON_GRID_LABEL_WIDTH = 112;
export const ICON_GRID_ITEMS = fontAwesomeIcons.icons;
const ICON_GRID_CONTENT = ICON_GRID_ITEMS.map((icon) => {
  const glyph = String.fromCodePoint(icon.codePoint);
  return { content: `${glyph}\n${icon.name}`, glyph, label: icon.name };
});

/** Icon Grid keeps a retained, virtualized pool and therefore owns suspension policy. */
export const iconGridWorkload = {
  cameraKind: 'orthographic',
  contentWidth: 'none',
  id: 'icon-grid',
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
