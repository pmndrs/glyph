import type { TgpuRoot } from 'typegpu';

import type { PreparedParagraphBatchRevision } from '../../src/paragraph-batch.js';
import { bitmap } from '../../src/raster/bitmap-technique.js';
import {
  createTypeGpuTextEngine,
  defineTypeGpuRasterProgram,
  defineTypeGpuRasterShader,
  type TypeGpuParagraphBatchTargetRevision,
  type TypeGpuRasterProgram,
} from '../../src/typegpu.js';

interface TintVariant {
  readonly tint: readonly [number, number, number, number];
}

interface BitmapDraw {
  readonly instanceCount: number;
}

interface BitmapRevision extends TypeGpuParagraphBatchTargetRevision<BitmapDraw> {
  readonly sourceRevision: number;
}

const shader = defineTypeGpuRasterShader({
  technique: bitmap,
  vertex: { input: 'bitmap-instance', output: 'clip-position' },
  fragment: { input: 'bitmap-sample', output: 'color' },
  resources: { atlas: 'texture-2d-array' },
});

const bitmapProgram = defineTypeGpuRasterProgram({
  technique: bitmap,
  createTarget(options) {
    return {
      root: options.root,
      technique: bitmap,
      setParagraphState() {},
      stage(_previous: BitmapRevision | undefined, next: PreparedParagraphBatchRevision<typeof bitmap, TintVariant>) {
        return {
          status: 'ready' as const,
          stage: {
            sourceRevision: next.revision,
            commit: () => ({ sourceRevision: next.revision, draws: [], dispose() {} }),
            abort() {},
          },
        };
      },
      encode() {},
      dispose() {},
    };
  },
  dispose() {},
} satisfies TypeGpuRasterProgram<typeof bitmap, TintVariant, BitmapDraw, BitmapRevision>);

declare const root: TgpuRoot;

async function useTypeGpuApi(): Promise<void> {
  const engine = await createTypeGpuTextEngine({ root, colorFormat: 'rgba8unorm' });
  const batch = engine.createParagraphBatch({ technique: bitmap, program: bitmapProgram });

  // The concrete program carries its exact variant into paragraphs.
  batch.renderVariant = { tint: [1, 0, 0, 1] };

  // @ts-expect-error The retained variant is not an untyped effect bag.
  batch.renderVariant = { opacity: 0.5 };

  batch.dispose();
  engine.dispose();
}

void shader;
void useTypeGpuApi;
