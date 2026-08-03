import type { RasterConformanceAdapter } from './contracts';
import { createSlugConformanceSession } from './slug-capture';

export const slugRasterConformanceAdapter: RasterConformanceAdapter = {
  technique: 'slug',
  async createSession(backend) {
    return createSlugConformanceSession(backend);
  },
};
