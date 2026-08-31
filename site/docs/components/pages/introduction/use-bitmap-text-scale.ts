import { useThree } from '@react-three/fiber/webgpu';

import { bitmapTextScale } from './bitmap-text-scale';
import type { BitmapTextScale } from './bitmap-text-scale';

export function useBitmapTextScale(cssPpem: number): BitmapTextScale {
  const viewportHeight = useThree((state) => state.viewport.height);
  const canvasCssHeight = useThree((state) => state.size.height);
  const renderPixelRatio = useThree((state) => state.gl.getPixelRatio());
  return bitmapTextScale(cssPpem, viewportHeight, canvasCssHeight, renderPixelRatio);
}
