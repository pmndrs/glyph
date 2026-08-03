import { describe, expect, it } from 'vitest';
import { SELECTABLE_FONT_FIXTURE_IDS } from './font-fixtures';
import { readHarnessLocation, writeHarnessLocation, writeHarnessUrl } from './url-state';

describe('harness URL state', () => {
  it('round-trips a reproducible selection', () => {
    const value = {
      mode: 'conformance',
      layout: 'presentation',
      technique: 'bitmap',
      backend: 'webgl2',
      delivery: 'runtime',
      dpr: 2,
      fontFixture: 'source-serif-4',
      workload: 'text-accuracy',
      view: 'report',
    } as const;
    expect(readHarnessLocation(writeHarnessLocation(value), 1, 'presentation')).toEqual(value);
    expect(writeHarnessUrl(value)).toMatch(/^\/presentation\?/);
  });

  it('keeps layout in the route instead of the query string', () => {
    const search = writeHarnessLocation({ ...readHarnessLocation(''), layout: 'main' });

    expect(new URLSearchParams(search).has('layout')).toBe(false);
    expect(readHarnessLocation(search).layout).toBe('main');
    expect(writeHarnessUrl({ ...readHarnessLocation(''), layout: 'main' })).toMatch(/^\/\?/);
  });

  it('rejects unknown axes without losing the human-facing workload', () => {
    expect(
      readHarnessLocation(
        '?mode=unknown&technique=unknown&backend=unknown&font=unknown&workload=text-ladder&view=unknown',
      ),
    ).toEqual({
      mode: 'benchmark',
      layout: 'main',
      technique: 'bitmap',
      backend: 'webgpu',
      delivery: 'baked',
      dpr: 1,
      fontFixture: 'inter',
      workload: 'text-ladder',
      view: 'scene',
    });
  });

  it('normalizes an unknown workload inside the selected mode', () => {
    expect(readHarnessLocation('?mode=benchmark&workload=unknown').workload).toBe('benchmark-ipsum');
    expect(readHarnessLocation('?mode=conformance&workload=unknown').workload).toBe('mtsdf-slug-compare');
  });

  it('maps old bitmap target and scenario links into conformance', () => {
    expect(readHarnessLocation('?target=bitmap-text-webgl2&scenario=bitmap-text-frame')).toEqual({
      mode: 'conformance',
      layout: 'main',
      technique: 'bitmap',
      backend: 'webgl2',
      delivery: 'baked',
      dpr: 1,
      fontFixture: 'inter',
      workload: 'text-accuracy',
      view: 'scene',
    });
  });

  it('uses the device default only when a link does not select a DPR', () => {
    expect(readHarnessLocation('?dpr=1', 2).dpr).toBe(1);
    expect(readHarnessLocation('', 2).dpr).toBe(2);
    expect(readHarnessLocation('?dpr=3', 2).dpr).toBe(2);
  });

  it('accepts every fixture from the canonical selectable inventory', () => {
    for (const fontFixture of SELECTABLE_FONT_FIXTURE_IDS) {
      expect(readHarnessLocation(`?font=${fontFixture}`).fontFixture).toBe(fontFixture);
    }
  });
});
