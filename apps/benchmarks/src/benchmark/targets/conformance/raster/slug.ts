import type { RasterConformanceAdapter } from './contracts';

export const slugRasterConformanceAdapter: RasterConformanceAdapter = {
  technique: 'slug',
  async createSession(backend) {
    const { captureSlugSourceOutlineFidelity, createSlugConformanceTarget } =
      await import('../../../../renderer/slug-text');
    const target = createSlugConformanceTarget(backend);
    return {
      load: async (input, controls, context) => {
        target.configure?.(input);
        await target.load(controls, context);
      },
      captureSampling: (input, sampleIndex, controls, context) => target.run(input, sampleIndex, controls, context),
      captureSourceOutline: async (input, controls, context) =>
        captureSlugSourceOutlineFidelity({
          backend,
          dpr: controls.dpr,
          fontFixture: input.fontFixture ?? 'inter',
          ...(context?.renderer === undefined ? {} : { renderer: context.renderer }),
          ...(context?.signal === undefined ? {} : { signal: context.signal }),
        }),
      dispose: () => target.dispose(),
    };
  },
};
