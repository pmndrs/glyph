import { useEffect, useRef, type ComponentProps } from 'react';

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

/** How long the workload amount must hold still before the scene rebuilds for it. */
const WORKLOAD_AMOUNT_SETTLE_MS = 120;

/** Calls `callback` once the caller stops producing values; a dragged range control emits one value per pointer move, most of which are noise. */
function useDebouncedCallback<Value>(callback: (value: Value) => void, delayMs: number): (value: Value) => void {
  const latest = useRef(callback);
  const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    latest.current = callback;
  });
  useEffect(
    () => () => {
      if (pending.current !== undefined) clearTimeout(pending.current);
    },
    [],
  );
  return (value: Value) => {
    if (pending.current !== undefined) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = undefined;
      latest.current(value);
    }, delayMs);
  };
}

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
  // Workload amount rebuilds the scene from nothing on every intermediate value, so a drag would queue one
  // rebuild per step; settling drops the values the pointer never held on.
  const debouncedWorkloadAmount = useDebouncedCallback((workloadAmount: number) => {
    changed(() => world.set(RuntimeLayoutControls, { workloadAmount }));
  }, WORKLOAD_AMOUNT_SETTLE_MS);
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
      onWorkloadAmount={debouncedWorkloadAmount}
    />
  );
}
