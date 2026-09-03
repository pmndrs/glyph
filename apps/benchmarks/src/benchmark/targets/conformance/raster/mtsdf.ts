import { createMtsdfConformanceSession } from './mtsdf-capture';
import type { RasterConformanceAdapter } from './contracts';

export const mtsdfRasterConformanceAdapter: RasterConformanceAdapter = {
  format: 'mtsdf',
  async createSession(backend) {
    return createMtsdfConformanceSession(backend);
  },
};
