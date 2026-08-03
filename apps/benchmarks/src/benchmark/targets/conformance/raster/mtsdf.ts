import { selectableFontFixture } from '../../../font-fixtures';
import type { RasterConformanceAdapter } from './contracts';

export const mtsdfRasterConformanceAdapter: RasterConformanceAdapter = {
  technique: 'mtsdf',
  async createSession(backend) {
    const { captureMtsdfSourceOutlineFidelity, createMtsdfConformanceTarget } =
      await import('../../../../renderer/mtsdf-text');
    const target = createMtsdfConformanceTarget(backend);
    return {
      load: async (input, controls, context) => {
        target.configure?.(input);
        await target.load(controls, context);
      },
      captureSampling: (input, sampleIndex, controls, context) => target.run(input, sampleIndex, controls, context),
      captureSourceOutline: async (input, controls, context) =>
        captureMtsdfSourceOutlineFidelity({
          backend,
          dpr: controls.dpr,
          fontFixture: selectableFontFixture(input.fontFixture ?? 'inter'),
          ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
          ...(context?.signal === undefined ? {} : { signal: context.signal }),
        }),
      dispose: () => target.dispose(),
    };
  },
};
