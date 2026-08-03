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
> & {
  readonly onBeforeShowGrid: () => void;
  readonly onRuntimeControl: () => void;
};

export function RuntimeControls({ onBeforeShowGrid, onRuntimeControl, ...props }: RuntimeControlsProps) {
  const world = useRuntimeWorld();
  const view = useRuntimeViewControls();
  const layout = useRuntimeLayoutControls();
  const animation = useRuntimeAnimationControls();
  const paint = useRuntimePaintControls();
  const { stats: liveStats } = useRuntimeTelemetry();
  const changed = (change: () => void): void => {
    change();
    onRuntimeControl();
  };
  return (
    <Controls
      {...props}
      {...view}
      {...layout}
      {...animation}
      {...paint}
      liveStats={liveStats}
      onAnimationEnabled={(animationEnabled) =>
        changed(() => world.set(RuntimeAnimationControls, { animationEnabled }))
      }
      onAnimationSpeed={(animationSpeed) => changed(() => world.set(RuntimeAnimationControls, { animationSpeed }))}
      onFontSize={(fontSize) => changed(() => world.set(RuntimeLayoutControls, { fontSize }))}
      onLayoutWidthPercent={(layoutWidthPercent) =>
        changed(() => world.set(RuntimeLayoutControls, { layoutWidthPercent }))
      }
      onPaintOpacityPercent={(paintOpacityPercent) =>
        changed(() => world.set(RuntimePaintControls, { paintOpacityPercent }))
      }
      onPaintShadowEnabled={(paintShadowEnabled) =>
        changed(() => world.set(RuntimePaintControls, { paintShadowEnabled }))
      }
      onPaintStrokePercent={(paintStrokePercent) =>
        changed(() => world.set(RuntimePaintControls, { paintStrokePercent }))
      }
      onShowGrid={(showGrid) => {
        onBeforeShowGrid();
        changed(() => world.set(RuntimeViewControls, { showGrid }));
      }}
      onShowLayoutBounds={(showLayoutBounds) => changed(() => world.set(RuntimeViewControls, { showLayoutBounds }))}
      onWorkloadAmount={(workloadAmount) => changed(() => world.set(RuntimeLayoutControls, { workloadAmount }))}
    />
  );
}
