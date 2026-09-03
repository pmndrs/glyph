import type { Font } from '../../font.js';
import type { FontFaceSelection, FontFaceRasterOf } from '../../font-face.js';
import type { ThreeHandle } from '../handle.js';
import { threeRootHost, type ThreeRoot } from '../text.js';

/** Resolve the anonymous public root fronted by a Three handle. */
export function threeHandleRoot(handle: ThreeHandle): ThreeRoot {
  if (handle.handle !== handle || typeof handle.createText !== 'function') {
    throw new TypeError('handle is not configured for Three');
  }
  return handle;
}

/** Resolve the owning handle for a terminal Three root. */
export function threeRootHandle(root: ThreeRoot): ThreeHandle {
  return root.handle;
}

/** Acquire an independent mounted Font lease from one loaded handle selection. */
export function acquireThreeHandleFont<const Selection extends FontFaceSelection>(
  handle: ThreeHandle,
  selection: Selection,
): Font<FontFaceRasterOf<Selection>> {
  return threeRootHost(threeHandleRoot(handle)).acquireFont(selection);
}

/** Borrow the handle store's immutable source for a render-phase snapshot. */
export function threeHandleFontSource<const Selection extends FontFaceSelection>(
  handle: ThreeHandle,
  selection: Selection,
): Font<FontFaceRasterOf<Selection>> {
  return threeRootHost(threeHandleRoot(handle)).fontSource(selection);
}

/** Read whether the selected handle can synchronously acquire this FontFace format. */
export function isThreeHandleFontLoaded(handle: ThreeHandle, selection: FontFaceSelection): boolean {
  return threeRootHost(threeHandleRoot(handle)).isFontLoaded(selection);
}

/** Load the exact FontFace format selected by this handle. */
export function loadThreeHandleFont<const Selection extends FontFaceSelection>(
  handle: ThreeHandle,
  selection: Selection,
): Promise<Selection> {
  return threeRootHost(threeHandleRoot(handle)).loadFont(selection);
}
