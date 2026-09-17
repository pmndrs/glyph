import type { ComponentProps } from 'react';

import {
  RuntimeAnimationControls,
  RuntimeLayoutControls,
  RuntimePaintControls,
  RuntimeViewControls,
  useRuntimeAnimationControls,
  useRuntimeLayoutControls,
  useRuntimePaintControls,
  useRuntimeTelemetry,
  useRuntimeViewControls,
  useRuntimeWorld,
} from '../benchmark/runtime-world';
import { Controls } from './render-controls';

export type RuntimeControlsProps = Omit<
  ComponentProps<typeof Controls>,
  | 'animationEnabled'
  | 'animationSpeed'
  | 'fontSize'
  | 'layoutWidthPercent'
  | 'liveStats'
  | 'onAnimationEnabled'
  | 'onAnimationSpeed'
  | 'onFontSize'
  | 'onLayoutWidthPercent'
  | 'onPaintOpacityPercent'
  | 'onPaintShadowEnabled'
  | 'onPaintStrokePercent'
  | 'onShowGrid'
  | 'onShowLayoutBounds'
  | 'onWorkloadAmount'
  | 'paintOpacityPercent'
  | 'paintShadowEnabled'
  | 'paintStrokePercent'
  | 'showGrid'
  | 'showLayoutBounds'
  | 'workloadAmount'
>;

export function RuntimeControls(props: RuntimeControlsProps) {
  const world = useRuntimeWorld();
  const view = useRuntimeViewControls();
  const layout = useRuntimeLayoutControls();
  const animation = useRuntimeAnimationControls();
  const paint = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  return (
    <Controls
      {...props}
      {...view}
      {...layout}
      {...animation}
      {...paint}
      liveStats={liveStats}
      onAnimationEnabled={(animationEnabled) => world.set(RuntimeAnimationControls, { animationEnabled })}
      onAnimationSpeed={(animationSpeed) => world.set(RuntimeAnimationControls, { animationSpeed })}
      onFontSize={(fontSize) => world.set(RuntimeLayoutControls, { fontSize })}
      onLayoutWidthPercent={(layoutWidthPercent) => world.set(RuntimeLayoutControls, { layoutWidthPercent })}
      onPaintOpacityPercent={(paintOpacityPercent) => world.set(RuntimePaintControls, { paintOpacityPercent })}
      onPaintShadowEnabled={(paintShadowEnabled) => world.set(RuntimePaintControls, { paintShadowEnabled })}
      onPaintStrokePercent={(paintStrokePercent) => world.set(RuntimePaintControls, { paintStrokePercent })}
      onShowGrid={(showGrid) => world.set(RuntimeViewControls, { showGrid })}
      onShowLayoutBounds={(showLayoutBounds) => world.set(RuntimeViewControls, { showLayoutBounds })}
      onWorkloadAmount={(workloadAmount) => world.set(RuntimeLayoutControls, { workloadAmount })}
    />
  );
}
