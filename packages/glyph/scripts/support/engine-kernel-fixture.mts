import { textShaperAbi as abi } from '../../dist/text-shaper-abi.js';

import {
  createBenchmarkParagraph,
  disposeBenchmarkParagraph,
  loadParagraphBenchmarkFixture,
  paragraphTextForGlyphs,
} from './paragraph-benchmark-fixture.mts';
import { kernelPolicyBytes } from '../../tests/support/engine-abi.mjs';

export interface CapturedKernelInput {
  readonly label: string;
  readonly glyphs: number;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly fontSize: Float32Array;
  readonly planeLeft: Float32Array;
  readonly planeBottom: Float32Array;
  readonly planeRight: Float32Array;
  readonly planeTop: Float32Array;
  readonly advances: Int32Array;
  readonly flags: Uint8Array;
  readonly levels: Uint8Array;
  readonly mixedLevels: Uint8Array;
  readonly policy: Uint8Array;
}

export async function captureKernelWorkloads(targets: readonly number[]): Promise<readonly CapturedKernelInput[]> {
  const fixture = await loadParagraphBenchmarkFixture();
  const policy = kernelPolicyBytes(abi);
  try {
    return targets.map((target) => captureWorkload(fixture, target, policy));
  } finally {
    fixture.dispose();
  }
}

function captureWorkload(
  fixture: Awaited<ReturnType<typeof loadParagraphBenchmarkFixture>>,
  targetGlyphs: number,
  policy: Uint8Array,
): CapturedKernelInput {
  const chunkTargets: number[] = [];
  for (let remaining = targetGlyphs; remaining > 0; remaining -= 40_000) {
    chunkTargets.push(Math.min(remaining, 40_000));
  }
  const captures: Array<{
    readonly layout: NonNullable<ReturnType<ReturnType<typeof createBenchmarkParagraph>['paragraph']['glyphs']>>;
    readonly text: string;
  }> = [];
  const createdParagraphs: Array<ReturnType<typeof createBenchmarkParagraph>> = [];
  try {
    for (const target of chunkTargets) {
      const text = paragraphTextForGlyphs(target);
      const created = createBenchmarkParagraph(fixture, text, 600);
      createdParagraphs.push(created);
      created.group.updateMatrixWorld(true);
      if (created.group.error !== undefined) throw created.group.error;
      const layout = created.paragraph.glyphs();
      if (layout === undefined) throw new Error('paragraph benchmark fixture did not publish a layout');
      captures.push({ layout, text });
    }
    const glyphs = captures.reduce((total, capture) => total + capture.layout.glyphIds.length, 0);
    const x = new Float32Array(glyphs);
    const y = new Float32Array(glyphs);
    const fontSize = new Float32Array(glyphs);
    const planeLeft = new Float32Array(glyphs);
    const planeBottom = new Float32Array(glyphs);
    const planeRight = new Float32Array(glyphs);
    const planeTop = new Float32Array(glyphs);
    const advances = new Int32Array(glyphs);
    const flags = new Uint8Array(glyphs);
    const levels = new Uint8Array(glyphs);
    const mixedLevels = new Uint8Array(glyphs);
    let cursor = 0;
    for (const { layout, text } of captures) {
      x.set(layout.x, cursor);
      y.set(layout.y, cursor);
      fontSize.set(layout.glyphFontSizes, cursor);
      for (let index = 0; index < layout.glyphIds.length; index += 1) {
        const target = cursor + index;
        const glyphId = layout.glyphIds[index]!;
        const left = (glyphId % 13) - 4;
        const bottom = (glyphId % 7) - 3;
        planeLeft[target] = left;
        planeBottom[target] = bottom;
        planeRight[target] = left + 6 + (glyphId % 9);
        planeTop[target] = bottom + 8 + (glyphId % 11);
        const nextX = layout.x[index + 1];
        const positionedAdvance =
          nextX === undefined ? layout.glyphFontSizes[index]! * 0.5 : Math.abs(nextX - layout.x[index]!);
        advances[target] = Math.max(1, Math.round(positionedAdvance * 64));
        const cluster = layout.clusters[index]!;
        const codeUnit = text.charCodeAt(cluster);
        flags[target] = codeUnit === 0x20 || codeUnit === 0x0a || codeUnit === 0x2d ? 1 : 0;
        levels[target] = layout.glyphBidiLevels[index]!;
        // Adversarial short runs remain a separate lane instead of replacing the captured paragraph levels.
        mixedLevels[target] = ((Math.floor(cluster / 53) % 5) & 1) === 0 ? 0 : 1 + (glyphId & 1);
      }
      cursor += layout.glyphIds.length;
    }
    return {
      label: `${glyphs}-glyphs`,
      glyphs,
      x,
      y,
      fontSize,
      planeLeft,
      planeBottom,
      planeRight,
      planeTop,
      advances,
      flags,
      levels,
      mixedLevels,
      policy,
    };
  } finally {
    for (const created of createdParagraphs) disposeBenchmarkParagraph(created);
  }
}
