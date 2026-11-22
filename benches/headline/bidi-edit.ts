// Mixed-bidi editing headline: a 15,000-unit paragraph of alternating Latin and Arabic sentences in Amiri Bitmap
// 16, edited the way a text editor drives the engine. Every timed step runs the complete operation through to a
// GPU-completed frame: edit and measure -> scene publication -> render -> queue completion. Uses only public entry
// points that both a baseline and a candidate archive provide; `run-headline-bidi-edit.mts` builds and drives it.
import * as THREE from 'three/webgpu';
import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

interface StepRecord {
  readonly layout: number[];
  readonly publish: number[];
  readonly render: number[];
  readonly gpuWait: number[];
  readonly total: number[];
}

export interface HeadlineOperation {
  readonly steps: number;
  /** Per-step medians, in milliseconds. */
  readonly layoutMedian: number;
  readonly publishMedian: number;
  readonly renderMedian: number;
  readonly gpuWaitMedian: number;
  readonly totalMedian: number;
  readonly glyphs: number;
  readonly lines: number;
}

export interface HeadlineResult {
  backend?: string;
  editPath?: string;
  error?: string;
  sourceUtf16?: number;
  initial?: { glyphs: number; lines: number; missing: number };
  final?: { glyphs: number; lines: number; missing: number };
  readonly operations: Record<string, HeadlineOperation>;
}

declare global {
  interface Window {
    glyphHeadlineResult?: HeadlineResult;
    glyphHeadlineDone?: boolean;
  }
}

const WIDTH = 1280;
const HEIGHT = 800;
const PIXEL_RATIO = 2;
const BIDI_UNITS = [
  'The panel resizes while the reader keeps their place. ',
  'النص العربي يتدفق من اليمين إلى اليسار ويختلط مع الأرقام مثل 2026 و 15.5 والكلمات اللاتينية. ',
  'Mixed lines reorder numbers, quotes and (parentheses) at every width. ',
  'هذه الفقرة تختبر إعادة ترتيب الاتجاه الثنائي عند تغيير عرض السطر في كل إطار. ',
  'Prices such as 24.50 and ranges from 8 to 512 px sit beside right-to-left words. ',
  'يكتب المستخدم في منتصف الفقرة الطويلة وتعاد صياغة الأسطر التالية فقط. ',
].join('');

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const median = (values: readonly number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
};

const result: HeadlineResult = { operations: {} };
window.glyphHeadlineResult = result;
try {
  const canvas = document.querySelector('canvas');
  if (canvas === null) throw new Error('the page has no canvas');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false });
  renderer.setPixelRatio(PIXEL_RATIO);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x101014, 1);
  await renderer.init();
  const backend = renderer.backend as {
    isWebGPUBackend?: boolean;
    device?: { readonly queue: { onSubmittedWorkDone(): Promise<undefined> } };
  };
  if (backend.isWebGPUBackend !== true || backend.device === undefined) throw new Error('WebGPU is unavailable');
  const device = backend.device;
  result.backend = 'webgpu';
  await glyph.init();
  const font = glyph.fontFace(new URL('./amiri-bitmap-16.font.glb', location.href).href, {
    format: bitmap({ strikes: [16] }),
  });
  await font.load();
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10);
  camera.position.z = 1;

  let source = '';
  while (source.length < 15_000) source += BIDI_UNITS;
  result.sourceUtf16 = source.length;
  const handle = glyph.handle('headline', defineThreeConfig({ capacity: { size: 4096, policy: 'chunk' } }));
  const text = handle('headline-root').createText({
    font,
    rasterPixelRatio: PIXEL_RATIO,
    text: source,
    style: { fontSize: 8, lineHeight: 1.25, color: '#ffffff' },
    constraints: { width: { mode: 'exact', size: 600 } },
    layout: { wrap: 'word' },
  });
  text.position.set(24, -16, 0);
  scene.add(text);

  /** One complete frame: `mutate` (edit and measure), publication, render, GPU completion. */
  const frame = async (mutate: () => void, record?: StepRecord) => {
    const started = performance.now();
    mutate();
    const mutated = performance.now();
    scene.updateMatrixWorld(true);
    const published = performance.now();
    renderer.render(scene, camera);
    const rendered = performance.now();
    await device.queue.onSubmittedWorkDone();
    const completed = performance.now();
    if (record === undefined) return;
    record.layout.push(mutated - started);
    record.publish.push(published - mutated);
    record.render.push(rendered - published);
    record.gpuWait.push(completed - rendered);
    record.total.push(completed - started);
  };

  await frame(() => void text.measure());
  const first = text.measure();
  result.initial = { glyphs: first.glyphCount, lines: first.lineCount, missing: first.missingGlyphCount };
  // A baseline without `replace()` assigns the whole string, as an application on that release would.
  const editable = text as unknown as { replace?: (start: number, end: number, insert: string) => void };
  const replace = editable.replace?.bind(text);
  result.editPath = replace === undefined ? 'text setter' : 'replace(start, end, insert)';
  let current = source;
  const apply = (start: number, end: number, insert: string) => {
    const next = current.slice(0, start) + insert + current.slice(end);
    if (replace === undefined) text.text = next;
    else replace(start, end, insert);
    current = next;
  };
  const middle = source.length >> 1;
  const paste = source.slice(0, 200);
  const operations: ReadonlyArray<readonly [string, number, () => void, (() => void) | undefined]> = [
    ['type-end', 100, () => apply(current.length, current.length, 'x'), undefined],
    ['insert-middle', 100, () => apply(middle, middle, 'x'), undefined],
    ['delete-middle', 100, () => apply(middle, middle + 1, ''), undefined],
    ['paste-middle', 40, () => apply(middle, middle, paste), () => apply(middle, middle + paste.length, '')],
  ];
  for (const [label, steps, edit, restore] of operations) {
    // Untimed warm-up of the same operation, then the text is put back so the timed run starts from it.
    const before = current;
    for (let index = 0; index < 5; index += 1) {
      await nextFrame();
      await frame(() => {
        edit();
        text.measure();
      });
      if (restore !== undefined) await frame(restore);
    }
    await frame(() => {
      apply(0, current.length, before);
      text.measure();
    });
    const record: StepRecord = { layout: [], publish: [], render: [], gpuWait: [], total: [] };
    for (let index = 0; index < steps; index += 1) {
      await nextFrame();
      await frame(() => {
        edit();
        text.measure();
      }, record);
      if (restore !== undefined) {
        await nextFrame();
        await frame(() => {
          restore();
          text.measure();
        });
      }
    }
    const after = text.measure();
    result.operations[label] = {
      steps,
      layoutMedian: median(record.layout),
      publishMedian: median(record.publish),
      renderMedian: median(record.render),
      gpuWaitMedian: median(record.gpuWait),
      totalMedian: median(record.total),
      glyphs: after.glyphCount,
      lines: after.lineCount,
    };
  }
  const final = text.measure();
  result.final = { glyphs: final.glyphCount, lines: final.lineCount, missing: final.missingGlyphCount };
} catch (error) {
  result.error = String(error instanceof Error ? (error.stack ?? error.message) : error);
}
window.glyphHeadlineDone = true;
