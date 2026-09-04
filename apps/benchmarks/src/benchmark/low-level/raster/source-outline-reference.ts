import type { GlyphLayout } from '@pmndrs/glyph';

import amiriSourceUrl from '../../../../fixtures/fonts/amiri-1.002/Amiri-Regular.ttf?url';
import dancingScriptSourceUrl from '../../../../fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf?url';
import dotGothicSourceUrl from '../../../../fixtures/fonts/dot-gothic-16/DotGothic16-Regular.ttf?url';
import fontAwesomeSourceUrl from '../../../../fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf?url';
import interSourceUrl from '../../../../fixtures/fonts/inter-v4.1/Inter-Regular.ttf?url';
import notoCjkSourceUrl from '../../../../fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf?url';
import devanagariSourceUrl from '../../../../fixtures/fonts/noto-sans-devanagari/NotoSansDevanagari.ttf?url';
import sourceSerifSourceUrl from '../../../../fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf?url';
import type { BenchmarkFontFixture } from '../../font-fixtures';
import { compareRgba8Coverage } from './mtsdf-cpu-reference';

const sourceFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interSourceUrl,
  'source-serif-4': sourceSerifSourceUrl,
  'dancing-script': dancingScriptSourceUrl,
  amiri: amiriSourceUrl,
  'noto-sans-devanagari': devanagariSourceUrl,
  'noto-sans-cjk-showcase': notoCjkSourceUrl,
  'dot-gothic-16': dotGothicSourceUrl,
  'font-awesome-free-6.7.2': fontAwesomeSourceUrl,
};

export interface SourceOutlineFidelityCapture {
  readonly width: number;
  readonly height: number;
  readonly candidate: Uint8Array;
  readonly reference: Uint8Array;
  readonly difference: Uint8Array;
  readonly meanAbsoluteError: number;
  readonly maximumError: number;
  readonly errorPixels: number;
  readonly renderSubmitMs: number;
  readonly physicalPpem: number;
}

export interface SourceOutlineReferenceOptions {
  readonly candidate: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly fontFixture: BenchmarkFontFixture;
  readonly fontSize: number;
  readonly direction: 'ltr' | 'rtl';
  readonly layout: GlyphLayout;
  readonly originX: number;
  readonly originY: number;
  readonly text: string;
  readonly renderSubmitMs: number;
  /** Canvas2D affine transform in logical screen coordinates. */
  readonly transform?: SourceOutlineTransform;
}

export interface SourceOutlineTransform {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** Renders the pinned source font via Canvas2D at the candidate's physical size and baselines; Canvas owns shaping and rasterization, the candidate only supplies line positions. */
export async function captureSourceOutlineFidelity(
  options: SourceOutlineReferenceOptions,
): Promise<SourceOutlineFidelityCapture> {
  const family = `pmndrs-source-outline-${options.fontFixture}`;
  const response = await fetch(sourceFontUrls[options.fontFixture]);
  if (!response.ok) {
    throw new Error(`Unable to load source font fixture (${response.status})`);
  }
  const face = new FontFace(family, await response.arrayBuffer());
  await face.load();
  document.fonts.add(face);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext('2d', { alpha: false });
    if (context === null) throw new Error('Unable to create source-outline reference canvas');
    context.fillStyle = '#000';
    context.fillRect(0, 0, options.width, options.height);
    context.fillStyle = '#fff';
    const transform = options.transform;
    if (transform === undefined) {
      context.font = `${options.fontSize * options.dpr}px "${family}"`;
    } else {
      assertSourceOutlineTransform(transform);
      context.setTransform(
        options.dpr * transform.a,
        options.dpr * transform.b,
        options.dpr * transform.c,
        options.dpr * transform.d,
        options.dpr * transform.e,
        options.dpr * transform.f,
      );
      context.font = `${options.fontSize}px "${family}"`;
    }
    context.direction = options.direction;
    context.textAlign = 'start';
    context.textBaseline = 'alphabetic';
    context.fontKerning = 'normal';
    for (let line = 0; line < options.layout.lineBaselines.length; line += 1) {
      const start = options.layout.lineTextStarts[line];
      const end = options.layout.lineTextEnds[line];
      const baseline = options.layout.lineBaselines[line];
      if (start === undefined || end === undefined || baseline === undefined) {
        throw new Error('Paragraph layout contains an incomplete source-reference line');
      }
      const x = options.originX + (options.direction === 'rtl' ? options.layout.width : 0);
      const y = -options.originY + baseline;
      context.fillText(
        options.text.slice(start, end),
        transform === undefined ? x * options.dpr : x,
        transform === undefined ? y * options.dpr : y,
      );
    }
    const image = context.getImageData(0, 0, options.width, options.height);
    const reference = new Uint8Array(image.data);
    const comparison = compareRgba8Coverage(options.candidate, reference);
    return {
      width: options.width,
      height: options.height,
      candidate: options.candidate,
      reference,
      difference: comparison.heatmap,
      meanAbsoluteError: comparison.meanAbsoluteError,
      maximumError: comparison.maximumError,
      errorPixels: comparison.errorPixels,
      renderSubmitMs: options.renderSubmitMs,
      physicalPpem: options.fontSize * options.dpr,
    };
  } finally {
    document.fonts.delete(face);
  }
}

export function assertSourceOutlineTransform(transform: SourceOutlineTransform): void {
  const components = [transform.a, transform.b, transform.c, transform.d, transform.e, transform.f];
  if (components.some((component) => !Number.isFinite(component))) {
    throw new RangeError('source-outline transform components must be finite');
  }
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RangeError('source-outline transform must be invertible');
  }
}
