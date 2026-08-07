import { prepareParagraphLayout } from './paragraph-batch.js';
import { FontRegistry } from './loader.js';
import { createRuntimeShaper } from './shaper.js';
import type {
  TextPreparationFailureV1,
  TextPreparationRequestV1,
  TextPreparationSuccessV1,
  TextPreparationWorkerMessageV1,
} from './internal/text-preparation-worker-protocol.js';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;
const cancelled = new Set<number>();
const registry = new FontRegistry();
const shaperPromise = createRuntimeShaper({ registry });

scope.addEventListener('message', (event: MessageEvent<TextPreparationWorkerMessageV1>) => {
  const message = event.data;
  if (message.type === 'pmndrs-text-cancel-v1') {
    cancelled.add(message.id);
    return;
  }
  if (message.type === 'pmndrs-text-prepare-v1') void prepare(message);
});

async function prepare(request: TextPreparationRequestV1): Promise<void> {
  try {
    const shaper = await shaperPromise;
    for (const font of request.fonts) shaper.registerFont(registry._registerShapingFont(font));
    if (cancelled.delete(request.id)) return;
    const layouts: TextPreparationSuccessV1['layouts'][number][] = [];
    let stagedGlyphs = 0;
    for (let index = 0; index < request.paragraphs.length; index += 1) {
      if (cancelled.delete(request.id)) return;
      const paragraph = request.paragraphs[index]!;
      const layout = prepareParagraphLayout(shaper, paragraph.input);
      stagedGlyphs += layout.glyphIds.length;
      layouts.push({ batch: paragraph.batch, paragraph: paragraph.paragraph, layout });
      scope.postMessage({
        type: 'pmndrs-text-progress-v1',
        id: request.id,
        preparedParagraphs: index + 1,
        totalParagraphs: request.paragraphs.length,
        stagedGlyphs,
      });
    }
    const response: TextPreparationSuccessV1 = { type: 'pmndrs-text-success-v1', id: request.id, layouts };
    scope.postMessage(response, transferLayouts(layouts));
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    const response: TextPreparationFailureV1 = {
      type: 'pmndrs-text-failure-v1',
      id: request.id,
      error: { name: error.name, message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) },
    };
    scope.postMessage(response);
  } finally {
    cancelled.delete(request.id);
  }
}

function transferLayouts(layouts: TextPreparationSuccessV1['layouts']): Transferable[] {
  const buffers = new Set<ArrayBuffer>();
  for (const { layout } of layouts) {
    for (const value of Object.values(layout)) if (ArrayBuffer.isView(value)) buffers.add(value.buffer as ArrayBuffer);
  }
  return [...buffers];
}
