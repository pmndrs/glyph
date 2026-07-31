import type { AnyRasterInput, RegisteredFont } from '@pmndrs/text';
import { describe, expect, it } from 'vitest';

import {
  advanceIconGridAutoPan,
  applyRetainedTextFontFixture,
  applyRetainedTextFontSize,
  applyRetainedTextWidths,
  comparisonWorkloadContentWidth,
  comparisonWorkloadRequiresIconWindowSuspension,
  comparisonWorkloadUpdateKind,
  createComparisonWorkloadPersistentScene,
  dynamicLayoutWidths,
  iconGridAssignmentSignature,
  iconGridCenteredScroll,
  iconGridLayout,
  iconGridVirtualWindow,
  iconGridViewportUpdateKind,
  ladderCssSizes,
  OFF_AXIS_SPANS,
  OFF_AXIS_TEXT,
  paintWordHue,
  ZOOM_TEXT_BASE_CSS_PX,
  ZOOM_TEXT_PHRASES,
  ZOOM_TEXT_CORPUS,
  shuffleZoomTextPhrases,
  textLadderScenePosition,
  zoomTextAnimationState,
  zoomTextMaximumScale,
  type ComparisonWorkloadConfiguration,
  type IconGridAutoPanState,
} from './comparison-workload';

const baseConfiguration: ComparisonWorkloadConfiguration = {
  amount: 50,
  animationEnabled: true,
  animationSpeed: 50,
  fontFixture: 'inter',
  fontSize: 20,
  layoutWidthRatio: 0.8,
  paintOpacity: 1,
  paintShadowEnabled: true,
  paintStrokeWidth: 0.5,
  showGrid: true,
  showLayoutBounds: true,
  workload: 'paint-effects',
};

describe('comparison workload updates', () => {
  it('creates an inert persistent scene before the host activates it', async () => {
    const scene = createComparisonWorkloadPersistentScene({
      ...baseConfiguration,
      backend: 'webgpu',
      delivery: 'baked',
      technique: 'bitmap',
      onError: () => undefined,
      onStats: () => undefined,
    });

    expect(scene.id).toBe('comparison-bitmap-paint-effects');
    expect(() => scene.panBy(1, 1)).toThrow('not active');
    await scene.deactivate?.('released');
    await scene.deactivate?.('released');
  });

  it('keeps the off-axis callout on one Inter-safe paragraph with reviewed color spans', () => {
    expect(OFF_AXIS_TEXT).toBe(
      'Render shaped text directly in your canvas, without the DOM. It reflows at runtime and uses the scene camera and depth. Bitmap, MSDF, Slug.',
    );
    expect(OFF_AXIS_SPANS.map(({ color, end, start }) => ({ color, word: OFF_AXIS_TEXT.slice(start, end) }))).toEqual([
      { color: 0xa855f7, word: 'shaped' },
      { color: 0x22d3ee, word: 'canvas' },
      { color: 0x34d399, word: 'reflows' },
      { color: 0xf59e0b, word: 'Bitmap' },
      { color: 0xfb7185, word: 'MSDF' },
      { color: 0xff4dc4, word: 'Slug' },
    ]);
  });

  it('holds bounded content steady below its minimum and expands in a larger viewport', () => {
    expect(comparisonWorkloadContentWidth(baseConfiguration, 390)).toBe(576);
    expect(comparisonWorkloadContentWidth(baseConfiguration, 768)).toBe(576);
    expect(comparisonWorkloadContentWidth(baseConfiguration, 1_280)).toBeCloseTo(985.6);
  });

  it('lets off-axis content extend beyond the viewport', () => {
    expect(
      comparisonWorkloadContentWidth({ ...baseConfiguration, workload: 'off-axis-3d', layoutWidthRatio: 1.5 }, 1_280),
    ).toBeCloseTo(1_848);
    expect(() =>
      comparisonWorkloadContentWidth({ ...baseConfiguration, workload: 'off-axis-3d', layoutWidthRatio: 2.1 }, 1_280),
    ).toThrow('layout width ratio');
  });

  it('keeps pan-only and specialized-fit workloads independent of content width', () => {
    for (const workload of ['text-ladder', 'icon-grid', 'zoom-text'] as const) {
      const configuration = { ...baseConfiguration, workload };
      expect(comparisonWorkloadContentWidth(configuration, 1_280)).toBeUndefined();
      expect(comparisonWorkloadUpdateKind(configuration, configuration, true)).toBe('retained');
    }
  });

  it('retains the scene for animation and paint controls', () => {
    for (const update of [
      { animationEnabled: false },
      { animationSpeed: 75 },
      { amount: 80 },
      { paintOpacity: 0.5 },
      { paintShadowEnabled: false },
      { paintStrokeWidth: 0.75 },
      { showGrid: false },
      { showLayoutBounds: false },
    ] satisfies readonly Partial<ComparisonWorkloadConfiguration>[]) {
      expect(comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, ...update })).toBe('retained');
    }
  });

  it('rebuilds workload-specific Text entries inside the retained scene', () => {
    expect(comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, workload: 'off-axis-3d' })).toBe(
      'rebuild',
    );
    expect(comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, workload: 'icon-grid' })).toBe(
      'rebuild',
    );
  });

  it('retains width and font-size layout changes', () => {
    expect(comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, fontSize: 32 })).toBe('retained');
    expect(
      comparisonWorkloadUpdateKind(baseConfiguration, {
        ...baseConfiguration,
        layoutWidthRatio: 0.6,
      }),
    ).toBe('retained');
    expect(comparisonWorkloadUpdateKind(baseConfiguration, baseConfiguration, true)).toBe('retained');
  });

  it('updates retained Text objects in place and waits for every replacement layout', async () => {
    const releases: Array<() => void> = [];
    const updates: number[][] = [[], [], []];
    const texts = updates.map((entryUpdates) => ({
      ready: new Promise<void>((resolve) => releases.push(resolve)),
      setProperties: ({ width }: { readonly width?: number }) => entryUpdates.push(width!),
    }));
    let settled = false;
    const update = applyRetainedTextWidths(texts, new Float64Array([320, 480, 640])).then(() => {
      settled = true;
    });

    expect(updates).toEqual([[320], [480], [640]]);
    expect(settled).toBe(false);
    releases[0]!();
    releases[1]!();
    await Promise.resolve();
    expect(settled).toBe(false);
    releases[2]!();
    await update;
    expect(settled).toBe(true);
  });

  it('updates retained Text font sizes without replacing their objects', async () => {
    const updates: Array<{ readonly fontSize?: number; readonly width?: number }> = [];
    const text = {
      ready: Promise.resolve(),
      setProperties: (properties: { readonly fontSize?: number; readonly width?: number }) => updates.push(properties),
    };

    await applyRetainedTextFontSize([text], 72);

    expect(updates).toEqual([{ fontSize: 72 }]);
  });

  it('rolls every retained Text back before a failed candidate font can be released', async () => {
    const previous = fakeFontFixture();
    const next = fakeFontFixture();
    const updates: Array<Array<RegisteredFont>> = [[], []];
    const texts = updates.map((fontUpdates, index) => {
      let ready = Promise.resolve();
      return {
        get ready() {
          return ready;
        },
        setProperties(properties: { readonly font: RegisteredFont; readonly raster: AnyRasterInput }) {
          fontUpdates.push(properties.font);
          ready =
            properties.font === next.font && index === 1
              ? Promise.reject(new Error('candidate failed'))
              : Promise.resolve();
        },
      };
    });

    await expect(applyRetainedTextFontFixture(texts, previous, next)).rejects.toThrow('rolled back');
    expect(updates).toEqual([
      [next.font, previous.font],
      [next.font, previous.font],
    ]);
  });

  it('rebuilds paragraph stress when its text volume changes', () => {
    const paragraphStress = {
      ...baseConfiguration,
      workload: 'paragraph-stress',
    } satisfies ComparisonWorkloadConfiguration;

    expect(comparisonWorkloadUpdateKind(paragraphStress, { ...paragraphStress, amount: 80 })).toBe('rebuild');
    expect(comparisonWorkloadUpdateKind(paragraphStress, paragraphStress)).toBe('retained');
  });

  it('keeps icon-size changes on the retained tile path', () => {
    const iconGrid = {
      ...baseConfiguration,
      workload: 'icon-grid',
    } satisfies ComparisonWorkloadConfiguration;

    expect(comparisonWorkloadUpdateKind(iconGrid, { ...iconGrid, fontSize: 1_024 })).toBe('retained');
    expect(comparisonWorkloadRequiresIconWindowSuspension(iconGrid, { ...iconGrid, fontSize: 1_024 })).toBe(true);
    expect(comparisonWorkloadRequiresIconWindowSuspension(iconGrid, baseConfiguration)).toBe(true);
    expect(comparisonWorkloadRequiresIconWindowSuspension(baseConfiguration, iconGrid)).toBe(true);
    expect(comparisonWorkloadRequiresIconWindowSuspension(baseConfiguration, baseConfiguration)).toBe(false);
  });

  it('keeps Zoom text controls and viewport fitting on retained nodes', () => {
    const zoomText = {
      ...baseConfiguration,
      workload: 'zoom-text',
    } satisfies ComparisonWorkloadConfiguration;

    expect(comparisonWorkloadUpdateKind(zoomText, { ...zoomText, animationSpeed: 80 })).toBe('retained');
    expect(comparisonWorkloadUpdateKind(zoomText, { ...zoomText, fontSize: 48 })).toBe('retained');
  });
});

function fakeFontFixture(): { readonly font: RegisteredFont; readonly raster: AnyRasterInput } {
  return {
    font: {} as RegisteredFont,
    raster: {} as AnyRasterInput,
  };
}

describe('Zoom text scale and language cycle', () => {
  it('retains the reviewed multilingual Shape corpus', () => {
    expect(ZOOM_TEXT_CORPUS).toEqual([
      { language: 'en', text: 'Shape' },
      { language: 'fr', text: 'Forme' },
      { language: 'es', text: 'Figura' },
      { language: 'de', text: 'Form' },
      { language: 'pt', text: 'Formato' },
      { language: 'pl', text: 'Kształt' },
      { language: 'tr', text: 'Şekil' },
      { language: 'el', text: 'Σχήμα' },
      { language: 'ru', text: 'Форма' },
      { language: 'uk', text: 'Обрис' },
      { language: 'vi', text: 'Hình dạng' },
      { language: 'is', text: 'Lögun' },
      { language: 'ro', text: 'Formă' },
      { language: 'cy', text: 'Siâp' },
      { language: 'sr', text: 'Облик' },
      { language: 'kk', text: 'Пішін' },
    ]);
  });

  it('starts with Shape and shuffles every other phrase once without replacement', () => {
    const shuffled = shuffleZoomTextPhrases(ZOOM_TEXT_CORPUS, () => 0);

    expect(shuffled[0]).toEqual({ language: 'en', text: 'Shape' });
    expect(shuffled).not.toEqual(ZOOM_TEXT_CORPUS);
    expect(new Set(shuffled)).toEqual(new Set(ZOOM_TEXT_CORPUS));
    expect(new Set(shuffled.map(({ text }) => text)).size).toBe(shuffled.length);
    expect(ZOOM_TEXT_CORPUS[1]).toEqual({ language: 'fr', text: 'Forme' });
  });

  it('rejects an invalid shuffle source instead of creating a biased order', () => {
    expect(() => shuffleZoomTextPhrases(ZOOM_TEXT_CORPUS, () => 1)).toThrow(
      'zoom text shuffle source must return a value in [0, 1)',
    );
  });

  it('converts the 8 point floor to CSS pixels exactly', () => {
    expect(ZOOM_TEXT_BASE_CSS_PX).toBeCloseTo(10.666_666_666_7);
  });

  it('fits each committed word inside both viewport axes', () => {
    expect(zoomTextMaximumScale(100, 20, 1_000, 500)).toBeCloseTo(9.52);
    expect(zoomTextMaximumScale(100, 100, 300, 900)).toBeCloseTo(2.52);
    expect(zoomTextMaximumScale(500, 200, 200, 100)).toBe(1);
  });

  it('advances each phrase monotonically before the two-slot handoff', () => {
    const start = zoomTextAnimationState(0, 50, 3);
    const maximum = zoomTextAnimationState(1_555.555_556, 50, 3);
    const next = zoomTextAnimationState(3_111.111_112, 50, 3);

    expect(start).toEqual({ phraseIndex: 0, phraseRevision: 0, progress: 0 });
    expect(maximum.phraseIndex).toBe(0);
    expect(maximum.progress).toBeCloseTo(0.5);
    expect(next.phraseIndex).toBe(1);
    expect(next.progress).toBeCloseTo(0);
  });

  it('keeps timeline progress linear so scale and crossfade can apply independent easing', () => {
    const oneEighth = zoomTextAnimationState(218.75, 100, 1);
    const oneQuarter = zoomTextAnimationState(437.5, 100, 1);

    expect(oneEighth.progress).toBeCloseTo(0.125);
    expect(oneQuarter.progress).toBeCloseTo(0.25);
  });

  it('keeps every authenticated Inter phrase explicitly tagged', () => {
    expect(new Set(ZOOM_TEXT_CORPUS.map(({ language }) => language)).size).toBe(ZOOM_TEXT_CORPUS.length);
    expect(new Set(ZOOM_TEXT_CORPUS.map(({ text }) => text)).size).toBe(ZOOM_TEXT_CORPUS.length);
    expect(ZOOM_TEXT_PHRASES.every(({ text }) => text.length > 0)).toBe(true);
  });

  it('rejects invalid fit and animation inputs', () => {
    expect(() => zoomTextMaximumScale(0, 20, 100, 100)).toThrow('zoom text layout width must be positive');
    expect(() => zoomTextAnimationState(-1, 50)).toThrow('zoom text elapsed time must be nonnegative');
    expect(() => zoomTextAnimationState(0, 101)).toThrow('zoom text animation speed must be in [0, 100]');
  });
});

describe('dynamic layout animation', () => {
  it('starts with the same phase-offset widths used by live frames', () => {
    const configuration = {
      ...baseConfiguration,
      workload: 'dynamic-layout',
    } satisfies ComparisonWorkloadConfiguration;

    const widths = dynamicLayoutWidths(configuration, 1_000, 0);
    const left = widths[0]!;
    const center = widths[1]!;
    const right = widths[2]!;

    expect(left).toBeCloseTo(576);
    expect(center).toBeGreaterThan(left);
    expect(right).toBeLessThan(left);
  });
});

describe('text ladder scale selection', () => {
  it('fills a tall viewport with the complete ordered scale', () => {
    expect(ladderCssSizes(1_700)).toEqual([
      8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512, 1024,
    ]);
  });

  it('keeps the complete CSS-pixel range on a small viewport', () => {
    expect(ladderCssSizes(360).at(0)).toBe(8);
    expect(ladderCssSizes(360).at(-1)).toBe(1024);
  });

  it('rejects invalid viewport inputs', () => {
    expect(() => ladderCssSizes(0)).toThrow('text ladder viewport height must be positive');
  });

  it('keeps the final specimen trailing edge inside the viewport through the cycle hold', () => {
    const viewportWidth = 1_280;
    const finalEntryX = 120;
    const finalEntryWidth = 2_000;
    for (const elapsedMs of [0, 4_160, 5_680, 7_200, 7_920]) {
      const position = textLadderScenePosition({
        animationSpeed: 50,
        elapsedMs,
        finalCenterY: -1_500,
        finalEntryWidth,
        finalEntryX,
        viewportHeight: 720,
        viewportWidth,
      });

      expect(position.x + finalEntryX + finalEntryWidth).toBeGreaterThanOrEqual(viewportWidth * 0.92);
    }
  });
});

describe('icon grid layout', () => {
  it('starts at the top-left and advances both axes at a constant rate', () => {
    const state: IconGridAutoPanState = { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };

    advanceIconGridAutoPan(state, 0, 0, 500, 500, 250, 160);

    expect(state).toEqual({ directionX: 1, directionY: 1, scrollX: 40, scrollY: 40 });
  });

  it('reverses each axis independently at its grid boundary', () => {
    const state: IconGridAutoPanState = { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };

    advanceIconGridAutoPan(state, 0, 0, 100, 200, 1_250, 100);

    expect(state).toEqual({ directionX: -1, directionY: 1, scrollX: 75, scrollY: 125 });
  });

  it('preserves reflected linear motion across multiple complete loops', () => {
    const state: IconGridAutoPanState = { directionX: 1, directionY: 1, scrollX: 0, scrollY: 0 };

    advanceIconGridAutoPan(state, 0, 0, 100, 50, 4_500, 100);

    expect(state).toEqual({ directionX: 1, directionY: -1, scrollX: 50, scrollY: 50 });
  });

  it('continues from a manually panned position without resetting the view', () => {
    const state: IconGridAutoPanState = { directionX: -1, directionY: 1, scrollX: 80, scrollY: 20 };

    advanceIconGridAutoPan(state, 30, 120, 500, 500, 100, 100);

    expect(state).toEqual({ directionX: -1, directionY: 1, scrollX: 20, scrollY: 130 });
  });

  it('holds its position at zero speed and collapses motion on a viewport-sized axis', () => {
    const state: IconGridAutoPanState = { directionX: -1, directionY: -1, scrollX: 40, scrollY: 40 };

    advanceIconGridAutoPan(state, 40, 40, 0, 500, 500, 0);

    expect(state).toEqual({ directionX: 1, directionY: -1, scrollX: 0, scrollY: 40 });
  });

  it('keeps the grid coordinate at viewport center stable while icon size changes', () => {
    const viewportWidth = 720;
    const viewportHeight = 640;
    const previousSize = 48;
    const nextSize = 256;
    const previousScrollX = 1_800;
    const previousScrollY = 1_200;
    const previous = iconGridLayout(1_402, previousSize, viewportWidth);
    const next = iconGridLayout(1_402, nextSize, viewportWidth);
    const [nextScrollX, nextScrollY] = iconGridCenteredScroll(
      1_402,
      previousSize,
      nextSize,
      viewportWidth,
      viewportHeight,
      previousScrollX,
      previousScrollY,
    );
    const previousCenterColumn =
      (previousScrollX + viewportWidth / 2 - previous.inset) / (previous.cellWidth + previous.gap);
    const previousCenterRow =
      (previousScrollY + viewportHeight / 2 - previous.inset) / (previous.cellHeight + previous.gap);
    const nextCenterColumn = (nextScrollX + viewportWidth / 2 - next.inset) / (next.cellWidth + next.gap);
    const nextCenterRow = (nextScrollY + viewportHeight / 2 - next.inset) / (next.cellHeight + next.gap);

    expect(nextCenterColumn).toBeCloseTo(previousCenterColumn);
    expect(nextCenterRow).toBeCloseTo(previousCenterRow);
  });

  it('clamps the centered anchor when a smaller grid reaches its outer edges', () => {
    const viewportWidth = 720;
    const viewportHeight = 640;
    const next = iconGridLayout(1_402, 48, viewportWidth);
    const [scrollX, scrollY] = iconGridCenteredScroll(
      1_402,
      1_024,
      48,
      viewportWidth,
      viewportHeight,
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    );

    expect(scrollX).toBe(next.width - viewportWidth);
    expect(scrollY).toBe(next.height - viewportHeight);
  });

  it('publishes exact assigned index/content pairs in catalog order independent of render visibility', () => {
    expect(
      iconGridAssignmentSignature([
        { sourceText: '\uf002\nsearch', virtualIconIndex: 41 },
        { sourceText: '\uf00d\nxmark', virtualIconIndex: 12 },
        { sourceText: '\uf007\nuser', virtualIconIndex: 7 },
      ]),
    ).toBe(
      JSON.stringify([
        { index: 7, content: '\uf007\nuser' },
        { index: 12, content: '\uf00d\nxmark' },
        { index: 41, content: '\uf002\nsearch' },
      ]),
    );
  });

  it('rejects duplicate catalog assignments independent of render visibility', () => {
    expect(() =>
      iconGridAssignmentSignature([
        { sourceText: '\uf002\nsearch', virtualIconIndex: 41 },
        { sourceText: '\uf003\nenvelope', virtualIconIndex: 41 },
      ]),
    ).toThrow('assigned catalog index 41 twice');
  });

  it('places every item in a bounded row-major grid', () => {
    const layout = iconGridLayout(1_402, 48, 720);
    expect(layout.columns).toBe(38);
    expect(layout.rows).toBe(37);
    expect(layout.width).toBe(layout.inset * 2 + layout.columns * layout.cellWidth + (layout.columns - 1) * layout.gap);
    expect(layout.height).toBe(layout.inset * 2 + layout.rows * layout.cellHeight + (layout.rows - 1) * layout.gap);
  });

  it('keeps a stable near-square catalog while scale changes cell dimensions', () => {
    const large = iconGridLayout(1_402, 1_024, 1_920);
    const small = iconGridLayout(1_402, 8, 1_920);
    expect(large.columns).toBe(small.columns);
    expect(large.rows).toBe(small.rows);
    expect(small.cellWidth).toBe(112);
    expect(large.cellWidth).toBe(1_024 * 1.25 + 32);
    expect(small.cellHeight).toBe((8 + 11) * 1.25 + 8);
    expect(large.cellHeight).toBe((1_024 + 11) * 1.25 + 8);
    expect(large.cellHeight - small.cellHeight).toBe((1_024 - 8) * 1.25);
    expect(large.cellWidth + large.gap).toBeGreaterThan(1_024 * 1.25);
    expect(large.cellHeight + large.gap).toBeGreaterThan((1_024 + 11) * 1.25);
  });

  it('keeps the 1024 px icon pool bounded with conservative two-axis spacing', () => {
    const window = iconGridVirtualWindow(1_402, 1_024, 1_920, 1_080, 0, 0);
    expect(window.indices).toHaveLength(window.poolCapacity);
    expect(window.poolCapacity).toBeLessThan(1_402);
    expect(window.layout.cellWidth).toBeGreaterThanOrEqual(1_024 * 1.25 + 32);
    expect(window.layout.cellHeight).toBeGreaterThanOrEqual((1_024 + 11) * 1.25 + 8);
  });

  it('rejects invalid item, size, and viewport inputs', () => {
    expect(() => iconGridLayout(0, 48, 720)).toThrow('item count');
    expect(() => iconGridLayout(12, 0, 720)).toThrow('icon size');
    expect(() => iconGridLayout(12, 48, 0)).toThrow('viewport width');
  });

  it('keeps a bounded overscanned pool while reaching the complete catalog', () => {
    const top = iconGridVirtualWindow(1_402, 48, 720, 360, 0, 0);
    expect(top.firstVisibleIndex).toBe(0);
    expect(top.indices).toHaveLength(top.poolCapacity);
    expect(top.visibleIndices.length).toBeLessThan(top.indices.length);
    expect(top.visibleIndices.every((index) => top.indices.includes(index))).toBe(true);
    expect(top.visibleIndices.at(0)).toBe(top.firstVisibleIndex);
    expect(top.visibleIndices.at(-1)).toBe(top.lastVisibleIndex);
    expect(top.poolCapacity).toBeLessThan(1_402);
    expect(new Set(top.indices).size).toBe(top.indices.length);

    const bottom = iconGridVirtualWindow(1_402, 48, 720, 360, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
    expect(bottom.lastVisibleIndex).toBe(1_401);
    expect(bottom.indices.at(-1)).toBe(1_401);
    expect(bottom.indices.every((index) => index >= 0 && index < 1_402)).toBe(true);
  });

  it('recomputes columns and pool capacity after viewport resize', () => {
    const narrow = iconGridVirtualWindow(1_402, 48, 360, 640, 500, 500);
    const wide = iconGridVirtualWindow(1_402, 48, 1_200, 360, 500, 500);
    expect(narrow.layout.columns).toBe(wide.layout.columns);
    expect(narrow.layout.rows).toBe(wide.layout.rows);
    expect(narrow.indices).toHaveLength(narrow.poolCapacity);
    expect(wide.indices).toHaveLength(wide.poolCapacity);
    expect(narrow.poolCapacity).not.toBe(wide.poolCapacity);
  });

  it('keeps the virtual pool capacity stable across sub-cell viewport resizes', () => {
    const before = iconGridVirtualWindow(1_402, 48, 720, 640, 500, 500);
    const after = iconGridVirtualWindow(1_402, 48, 740, 650, 500, 500);
    expect(after.poolCapacity).toBe(before.poolCapacity);
    expect(after.indices).toHaveLength(before.poolCapacity);
    expect(iconGridViewportUpdateKind(before.poolCapacity, after)).toBe('retained');
  });

  it('rebuilds the virtual pool only when resize changes its capacity', () => {
    const before = iconGridVirtualWindow(1_402, 48, 360, 640, 500, 500);
    const after = iconGridVirtualWindow(1_402, 48, 1_200, 360, 500, 500);
    expect(iconGridViewportUpdateKind(before.poolCapacity, after)).toBe('rebuild');
    expect(() => iconGridViewportUpdateKind(-1, after)).toThrow('pool capacity');
  });

  it('rejects an invalid virtual viewport or scroll position', () => {
    expect(() => iconGridVirtualWindow(1_402, 48, 720, 0, 0, 0)).toThrow('viewport height');
    expect(() => iconGridVirtualWindow(1_402, 48, 720, 360, Number.NaN, 0)).toThrow('scroll positions');
  });
});

describe('paint word hue sequence', () => {
  it('gives adjacent words equal positive offsets around one circular sequence', () => {
    const hues = Array.from({ length: 8 }, (_, index) => paintWordHue(index, 8, 0, 50));
    const unwrapped = hues.map((hue, index) => hue + (index >= 7 ? 1 : 0));
    const offsets = unwrapped.slice(1).map((hue, index) => hue - unwrapped[index]!);
    expect(offsets.every((offset) => Math.abs(offset - offsets[0]!) < 1e-12)).toBe(true);
    expect(offsets[0]).toBeGreaterThan(0);
  });

  it('moves every word by the same shared phase', () => {
    const before = Array.from({ length: 5 }, (_, index) => paintWordHue(index, 5, 0.1, 25));
    const after = Array.from({ length: 5 }, (_, index) => paintWordHue(index, 5, 0.2, 25));
    expect(after.every((hue, index) => Math.abs(((hue - before[index]! + 1) % 1) - 0.1) < 1e-12)).toBe(true);
  });
});
