import type { ShowcaseObject } from './showcase-objects';

/** Dense mode exposes generated names only because no object is interactive there. */
export function isShowcaseLabelVisible(
  role: ShowcaseObject['role'],
  index: number,
  visibleCount: number,
  denseMode: boolean,
  selectedIndex: number | undefined,
  isolateSelection: boolean,
): boolean {
  return index < visibleCount && !(denseMode && role === 'primary') && (!isolateSelection || index === selectedIndex);
}
