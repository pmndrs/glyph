import { createElement, type ComponentType, type PropsWithChildren } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { World } from 'koota';

import {
  createRuntimeWorld,
  RuntimeAnimationControls,
  RuntimeLayoutControls,
  useRuntimeLayoutControls,
} from './runtime-world';
import { WorldProvider } from 'koota/react';

const TestWorldProvider = WorldProvider as ComponentType<PropsWithChildren<{ readonly world: World }>>;

describe('runtime world', () => {
  it('isolates control state between worlds', () => {
    const first = createRuntimeWorld({ initialFontSize: 24 });
    const second = createRuntimeWorld({ initialFontSize: 48 });

    first.set(RuntimeLayoutControls, { layoutWidthPercent: 64 });

    expect(first.get(RuntimeLayoutControls)).toEqual({
      fontSize: 24,
      layoutWidthPercent: 64,
      workloadAmount: 50,
    });
    expect(second.get(RuntimeLayoutControls)).toEqual({
      fontSize: 48,
      layoutWidthPercent: 82,
      workloadAmount: 50,
    });

    first.destroy();
    second.destroy();
  });

  it('routes hooks to the provider-local world', () => {
    function FontSizeProbe() {
      const { fontSize } = useRuntimeLayoutControls();
      return createElement('span', null, fontSize);
    }

    const markup = renderToStaticMarkup(
      createElement(
        'main',
        null,
        createElement(
          TestWorldProvider,
          { world: createRuntimeWorld({ initialFontSize: 18 }) },
          createElement(FontSizeProbe),
        ),
        createElement(
          TestWorldProvider,
          { world: createRuntimeWorld({ initialFontSize: 72 }) },
          createElement(FontSizeProbe),
        ),
      ),
    );

    expect(markup).toBe('<main><span>18</span><span>72</span></main>');
  });

  it('does not notify a layout subscriber for an unrelated control trait', () => {
    const world = createRuntimeWorld();
    let layoutNotifications = 0;
    const unsubscribe = world.onChange(RuntimeLayoutControls, () => {
      layoutNotifications += 1;
    });

    world.set(RuntimeAnimationControls, { animationSpeed: 75 });

    expect(layoutNotifications).toBe(0);
    unsubscribe();
    world.destroy();
  });
});
