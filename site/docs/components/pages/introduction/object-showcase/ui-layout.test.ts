import { describe, expect, it } from 'vitest';

import { cameraUnitsPerPixel, containsScreenPoint, showcaseUiLayout } from './ui-layout';

describe('object-showcase screen-space UI layout', () => {
  it('keeps the panel exactly twelve pixels from the viewport edges', () => {
    const layout = showcaseUiLayout(720, 352);
    expect(layout.panel.x + layout.panel.width).toBe(708);
    expect(layout.panel.y).toBe(12);
    expect(layout.panel.y + layout.panel.height).toBe(340);
    expect(layout.content.x - layout.panel.x).toBe(18);
    expect(layout.panel.x + layout.panel.width - (layout.content.x + layout.content.width)).toBe(18);
  });

  it('keeps the launch control inside the panel and hit-tests its inclusive edges', () => {
    const { launch, panel } = showcaseUiLayout(720, 352);
    expect(launch.x).toBeGreaterThan(panel.x);
    expect(launch.x + launch.width).toBeLessThan(panel.x + panel.width);
    expect(containsScreenPoint(launch, launch.x, launch.y)).toBe(true);
    expect(containsScreenPoint(launch, launch.x + launch.width, launch.y + launch.height)).toBe(true);
    expect(containsScreenPoint(launch, launch.x - 0.01, launch.y)).toBe(false);
  });

  it('keeps the dense-mode exit in the exact launch-control frame', () => {
    const { denseExit, launch } = showcaseUiLayout(720, 352);
    expect(denseExit).toBe(launch);
    expect(containsScreenPoint(denseExit, denseExit.x + denseExit.width / 2, denseExit.y + denseExit.height / 2)).toBe(
      true,
    );
  });

  it('maps authored pixels to the perspective camera plane without changing projected size', () => {
    const units = cameraUnitsPerPixel(352, 35, 1);
    const projected = (12 * units * 352) / (2 * Math.tan((35 * Math.PI) / 360));
    expect(projected).toBeCloseTo(12, 10);
  });
});
