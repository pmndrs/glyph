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
  readonly policy: Uint8Array;
}

export async function captureKernelWorkloads(targets: readonly number[]): Promise<readonly CapturedKernelInput[]> {
  const fixture = await loadParagraphBenchmarkFixture();
  const policy = kernelPolicyBytes(abi);
  try {
    return targets.map((target) => captureWorkload(fixture, target, policy));
  } finally {
    fixture.loaded.dispose();
    fixture.runtime.dispose();
  }
}

function captureWorkload(
  fixture: Awaited<ReturnType<typeof loadParagraphBenchmarkFixture>>,
  targetGlyphs: number,
  policy: Uint8Array,
): CapturedKernelInput {
  const text = paragraphTextForGlyphs(targetGlyphs);
  const created = createBenchmarkParagraph(fixture, text, 600);
  created.group.updateMatrixWorld(true);
  if (created.group.error !== undefined) throw created.group.error;
  const layout = created.paragraph.layout();
  if (layout === undefined) throw new Error('paragraph benchmark fixture did not publish a layout');
  const glyphs = layout.glyphIds.length;
  const planeLeft = new Float32Array(glyphs);
  const planeBottom = new Float32Array(glyphs);
  const planeRight = new Float32Array(glyphs);
  const planeTop = new Float32Array(glyphs);
  const advances = new Int32Array(glyphs);
  const flags = new Uint8Array(glyphs);
  const levels = new Uint8Array(glyphs);
  for (let index = 0; index < glyphs; index += 1) {
    const glyphId = layout.glyphIds[index]!;
    const left = (glyphId % 13) - 4;
    const bottom = (glyphId % 7) - 3;
    planeLeft[index] = left;
    planeBottom[index] = bottom;
    planeRight[index] = left + 6 + (glyphId % 9);
    planeTop[index] = bottom + 8 + (glyphId % 11);
    const nextX = layout.x[index + 1];
    const positionedAdvance =
      nextX === undefined ? layout.glyphFontSizes[index]! * 0.5 : Math.abs(nextX - layout.x[index]!);
    advances[index] = Math.max(1, Math.round(positionedAdvance * 64));
    const cluster = layout.clusters[index]!;
    const codeUnit = text.charCodeAt(cluster);
    flags[index] = codeUnit === 0x20 || codeUnit === 0x0a || codeUnit === 0x2d ? 1 : 0;
    // Preserve long uniform spans and real cluster boundaries while injecting mixed-direction transitions. The kernel
    // consumes resolved levels; script coverage and direction resolution themselves remain separate semantic gates.
    levels[index] = ((Math.floor(cluster / 53) % 5) & 1) === 0 ? 0 : 1 + (glyphId & 1);
  }
  const captured = {
    label: `${glyphs}-glyphs`,
    glyphs,
    x: layout.x.slice(),
    y: layout.y.slice(),
    fontSize: layout.glyphFontSizes.slice(),
    planeLeft,
    planeBottom,
    planeRight,
    planeTop,
    advances,
    flags,
    levels,
    policy,
  };
  disposeBenchmarkParagraph(created);
  return captured;
}
