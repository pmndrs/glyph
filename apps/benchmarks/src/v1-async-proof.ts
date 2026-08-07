import { createTextPreparationWorker, createTextRuntime } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';

declare global {
  interface Window {
    targetV1AsyncReady: Promise<TargetV1AsyncResult>;
  }
}

interface TargetV1AsyncResult {
  readonly status: string;
  readonly workerCount: number;
  readonly glyphCount: number;
  readonly progressEvents: number;
  readonly snapshotGlyphCount: number;
  readonly desiredGlyphCount: number;
  readonly superseded: boolean;
  readonly aborted: boolean;
}

window.targetV1AsyncReady = prepare();

async function prepare(): Promise<TargetV1AsyncResult> {
  let workerCount = 0;
  const runtime = await createTextRuntime({
    async: {
      createWorker: () => {
        workerCount += 1;
        return createTextPreparationWorker();
      },
    },
  });
  const font = await runtime.loadFont({
    input: { baked: '/fixtures/rendering/inter-bitmap-16.font.glb' },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const batch = runtime.createParagraphBatch({ technique: bitmap });
  const paragraph = batch.add({ font, text: 'Worker shaping proof' });
  const progress: unknown[] = [];
  try {
    const outcome = await runtime.updateAsync({ onProgress: (value) => progress.push(value) });

    paragraph.text = 'Worker A';
    const snapshotA = runtime.updateAsync();
    paragraph.text = 'Worker desired state B';
    await snapshotA;
    const snapshotGlyphCount = paragraph.committed?.layout.glyphIds.length ?? 0;
    runtime.update();
    const desiredGlyphCount = paragraph.committed?.layout.glyphIds.length ?? 0;

    paragraph.text = 'Old worker';
    const oldWorker = runtime.updateAsync();
    paragraph.text = 'Newest sync';
    runtime.update();
    const superseded = (await oldWorker).status === 'superseded';

    paragraph.text = 'Abort worker';
    const controller = new AbortController();
    const aborting = runtime.updateAsync({ signal: controller.signal });
    controller.abort('proof complete');
    const aborted = (await aborting).status === 'aborted';
    return {
      status: outcome.status,
      workerCount,
      glyphCount: paragraph.committed?.layout.glyphIds.length ?? 0,
      progressEvents: progress.length,
      snapshotGlyphCount,
      desiredGlyphCount,
      superseded,
      aborted,
    };
  } finally {
    batch.dispose();
    font.dispose();
    runtime.dispose();
  }
}
