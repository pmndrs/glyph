import type { AnyRasterTechnique, LoadedFont, LoadedFontRequest, ParagraphLayout } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { FontLoader, Text, TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

import interBitmapFontUrl from '../../../../fixtures/rendering/inter-bitmap-16.font.glb?url';
import devanagariBitmapFontUrl from '../../../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url';
import sourceSerifBitmapFontUrl from '../../../../fixtures/rendering/source-serif-4-bitmap-16.font.glb?url';
import {
  RICH_TEXT_ACCENT_COLOR,
  RICH_TEXT_SPANS,
  RICH_TEXT_TINT_COLOR,
  assertRichTextSpans,
  richTextComposition,
  richTextLiteral,
  richTextSpanRange,
  type RichTextCompanionFonts,
} from '../../../workloads/rich-text/scene';
import type { BenchmarkTarget } from '../../contracts';

type BitmapTechnique = typeof bitmap;

/**
 * One measure and one body size for every case.
 *
 * 700 CSS px is not arbitrary: it is the measure at which dropping the emphasis span's size back to the body size
 * changes the paragraph from three lines to two. A case that only moved advances would leave line breaking as an open
 * question, so the pinned measure is the one that closes it.
 */
const CONTENT_WIDTH = 700;
const BODY_FONT_SIZE = 16;
const UTF8_ENCODER = new TextEncoder();
const bitmapRaster: LoadedFontRequest<BitmapTechnique>['raster'] = {
  technique: bitmap,
  options: { strikes: [16] },
};

/**
 * Each control removes exactly one span property from the composed paragraph, so the difference it makes is
 * attributable to that property alone. `composed` is the paragraph the live workload renders.
 */
type RichTextCaseId =
  | 'composed'
  | 'no-small-caps'
  | 'no-tracking'
  | 'body-size-emphasis'
  | 'no-face'
  | 'no-fallback'
  | 'no-nesting';

const CASE_IDS: readonly RichTextCaseId[] = [
  'composed',
  'no-small-caps',
  'no-tracking',
  'body-size-emphasis',
  'no-face',
  'no-fallback',
  'no-nesting',
];

interface CaseEvidence {
  readonly clusters: readonly number[];
  readonly colors: readonly string[];
  readonly contentWidth: number;
  readonly drawCount: number;
  readonly fontHandleCount: number;
  readonly fontSizes: readonly number[];
  readonly glyphIds: readonly number[];
  readonly glyphFontSlots: readonly number[];
  readonly lineCount: number;
  readonly lineTextEnds: readonly number[];
  readonly notdefCount: number;
  readonly renderedGlyphCount: number;
  readonly x: readonly number[];
}

type RichTextSpansState =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly loader: FontLoader;
      readonly body: LoadedFont<BitmapTechnique>;
      readonly companions: RichTextCompanionFonts;
    };

export function createRichTextSpansConformanceTarget(): BenchmarkTarget {
  let state: RichTextSpansState = { kind: 'empty' };
  return {
    id: 'rich-text-spans-conformance',
    label: 'Rich text span conformance',
    detail: 'features · tracking · size · face · fallback · nested paint · public Text bitmap batches',
    color: 'violet',
    capabilities: new Set(['deterministic', 'font-bytes', 'wasm', 'shaping', 'paragraph', 'raster']),
    status: () => 'ready',
    load: async (_controls, context) => {
      if (state.kind === 'ready') return;
      // A loading manager this target owns keeps its text runtime, and the fonts registered in it, isolated from the
      // shared manager every other benchmark surface loads through.
      const loader = new FontLoader(new THREE.LoadingManager());
      const loaded: LoadedFont<BitmapTechnique>[] = [];
      try {
        const [body, foreign, emphasis] = await Promise.all(
          [interBitmapFontUrl, devanagariBitmapFontUrl, sourceSerifBitmapFontUrl].map(async (url) => {
            const font = await loader.loadAsync({
              input: { baked: url },
              raster: bitmapRaster,
              ...(context?.signal === undefined ? {} : { signal: context.signal }),
            });
            loaded.push(font);
            return font;
          }),
        );
        if (body === undefined || foreign === undefined || emphasis === undefined) {
          throw new Error('rich text conformance did not load its three fixtures');
        }
        state = { kind: 'ready', loader, body, companions: { emphasis, foreign } };
      } catch (error) {
        for (const font of loaded) font.dispose();
        loader.dispose();
        throw error;
      }
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') throw new Error('rich text spans conformance target was not loaded');
      const { body, companions } = state;

      const scene = new THREE.Scene();
      // One group so every case packs through the same batch the live workload uses, rather than through a
      // standalone-Text path the workload never takes.
      const group = new TextGroup<AnyRasterTechnique>({ capacity: { size: 4_096, policy: 'grow' } });
      scene.add(group);
      const evidence = new Map<RichTextCaseId, CaseEvidence>();
      try {
        for (const caseId of CASE_IDS) {
          evidence.set(caseId, measureCase(group, body, companions, caseId));
        }
      } finally {
        group.clear();
        group.removeFromParent();
        group.dispose();
      }

      const composed = required(evidence, 'composed');
      const noSmallCaps = required(evidence, 'no-small-caps');
      const noTracking = required(evidence, 'no-tracking');
      const bodySizeEmphasis = required(evidence, 'body-size-emphasis');
      const noFace = required(evidence, 'no-face');
      const noFallback = required(evidence, 'no-fallback');
      const noNesting = required(evidence, 'no-nesting');

      const properNoun = richTextSpanRange('properNoun');
      const face = richTextSpanRange('face');
      const foreign = richTextSpanRange('foreign');
      const accent = richTextSpanRange('accent');
      const nested = richTextSpanRange('nested');
      const tint = richTextSpanRange('tint');

      // A feature span must change which glyphs are selected inside its range and nothing outside it.
      const smallCapsChangedGlyphs = differingGlyphsIn(composed, noSmallCaps, properNoun);
      const smallCapsChangedGlyphsOutside = differingGlyphsOutside(composed, noSmallCaps, properNoun);
      // Tracking is the exact inverse: identical glyph selection, moved origins.
      const trackingChangedGlyphs = composed.glyphIds.filter((id, index) => id !== noTracking.glyphIds[index]).length;
      const trackingMovedOrigins = composed.x.filter((value, index) => value !== noTracking.x[index]).length;
      // A size span must re-measure rather than re-select, and at this measure it must also move the line breaks.
      const emphasisChangedGlyphs = composed.glyphIds.filter(
        (id, index) => id !== bodySizeEmphasis.glyphIds[index],
      ).length;
      const emphasisMovedOrigins = composed.x.filter((value, index) => value !== bodySizeEmphasis.x[index]).length;
      // A font span must move its range to another slot; fallback must additionally be what resolves the glyphs.
      const faceSlotGlyphs = glyphsInRange(composed, face).filter((index) => composed.glyphFontSlots[index] !== 0);
      const faceSlotGlyphsWithout = glyphsInRange(noFace, face).filter((index) => noFace.glyphFontSlots[index] !== 0);
      const fallbackSlotGlyphs = glyphsInRange(composed, foreign).filter(
        (index) => composed.glyphFontSlots[index] !== 0,
      );

      const accentColor = linearColorKey(RICH_TEXT_ACCENT_COLOR);
      const tintColor = linearColorKey(RICH_TEXT_TINT_COLOR);
      const paragraphColor = linearColorKey('#ffffff');
      const accentPaintGlyphs = countColor(composed, accentColor);
      const tintPaintGlyphs = countColor(composed, tintColor);
      const paragraphPaintGlyphs = countColor(composed, paragraphColor);
      /*
       * The nested style-only span states no paint of its own, so the README's cascade requires every one of its glyphs
       * to keep the paint of the span that encloses it. Counting accent glyphs with and without the nesting isolates
       * that: the two counts are equal when the inner range inherits, and differ by exactly the nested glyph count when
       * it resets to the paragraph paint instead. A count is used rather than per-glyph attribution because draws are
       * grouped by raster resource, so drawn instance order is not paragraph order and cannot address a cluster.
       */
      const nestedGlyphCount = glyphsInRange(composed, nested).length;
      const nestedPaintDelta = countColor(noNesting, accentColor) - accentPaintGlyphs;

      const hashes = CASE_IDS.map((caseId) => {
        const value = required(evidence, caseId);
        return [
          caseId,
          value.glyphIds.join(','),
          value.clusters.join(','),
          value.glyphFontSlots.join(','),
          value.fontSizes.map((size) => size.toFixed(4)).join(','),
          value.x.map((origin) => origin.toFixed(4)).join(','),
          value.lineTextEnds.join(','),
          value.contentWidth.toFixed(4),
          value.colors.join(','),
        ].join('|');
      });

      return {
        bytes: composed.glyphIds.length * 4,
        hash: hashText(hashes.join('\n')),
        metrics: {
          caseCount: CASE_IDS.length,
          spanCount: RICH_TEXT_SPANS.length,
          glyphCount: composed.glyphIds.length,
          missingGlyphCount: composed.notdefCount,
          renderedGlyphCount: composed.renderedGlyphCount,
          drawCount: composed.drawCount,
          fontHandleCount: composed.fontHandleCount,
          distinctFontSizeCount: new Set(composed.fontSizes).size,
          lineCount: composed.lineCount,

          smallCapsChangedGlyphs,
          smallCapsChangedGlyphsOutside,
          trackingChangedGlyphs,
          trackingMovedOrigins,
          emphasisChangedGlyphs,
          emphasisMovedOrigins,
          emphasisLineCount: composed.lineCount,
          bodySizeEmphasisLineCount: bodySizeEmphasis.lineCount,
          emphasisFirstLineTextEnd: composed.lineTextEnds[0] ?? 0,
          bodySizeEmphasisFirstLineTextEnd: bodySizeEmphasis.lineTextEnds[0] ?? 0,

          faceSpanSlotGlyphs: faceSlotGlyphs.length,
          faceSpanSlotGlyphsWithoutSpan: faceSlotGlyphsWithout.length,
          fallbackSpanSlotGlyphs: fallbackSlotGlyphs.length,
          fallbackMissingGlyphsWithoutSpan: noFallback.notdefCount,
          fallbackFontHandleCountWithoutSpan: noFallback.fontHandleCount,

          accentPaintGlyphs,
          tintPaintGlyphs,
          paragraphPaintGlyphs,
          nestedGlyphCount,
          nestedPaintDelta,
          accentSpanGlyphCount: glyphsInRange(composed, accent).length,
          tintSpanGlyphCount: glyphsInRange(composed, tint).length,
        },
      };
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const { body, companions, loader } = state;
      state = { kind: 'empty' };
      body.dispose();
      companions.emphasis.dispose();
      companions.foreign.dispose();
      loader.dispose();
    },
  };
}

function measureCase(
  group: TextGroup<AnyRasterTechnique>,
  body: LoadedFont<BitmapTechnique>,
  companions: RichTextCompanionFonts,
  caseId: RichTextCaseId,
): CaseEvidence {
  const composition = richTextComposition(BODY_FONT_SIZE, {
    ...(caseId === 'no-small-caps' ? { smallCaps: false } : {}),
    ...(caseId === 'no-tracking' ? { letterSpacing: 0 } : {}),
    ...(caseId === 'body-size-emphasis' ? { emphasisFontSize: BODY_FONT_SIZE } : {}),
    ...(caseId === 'no-nesting' ? { nested: false } : {}),
  });
  // Dropping a font span means composing against the body face for that range, which is exactly what an author who
  // omitted the span would get. Keeping the paragraph text identical is what makes the comparison attributable.
  const fonts: RichTextCompanionFonts = {
    emphasis: caseId === 'no-face' ? body : companions.emphasis,
    foreign: caseId === 'no-fallback' ? body : companions.foreign,
  };
  const literal = richTextLiteral(fonts, composition);
  assertRichTextSpans(literal, composition);
  const text = new Text({
    font: body,
    text: literal,
    style: { fontSize: BODY_FONT_SIZE, lineHeight: 1.25 },
    paint: { color: '#ffffff' },
    contentBox: { width: { mode: 'exact', size: CONTENT_WIDTH }, wrap: 'word' },
  });
  try {
    group.add(text);
    // Target v1 publishes shaping, layout, and draws during the world-matrix update instead of through an awaited
    // readiness promise, so failures surface on the object rather than as a rejected wait.
    group.updateMatrixWorld(true);
    // Headless runs read this across a page boundary that cannot transfer a cause, so the case that failed and the
    // underlying reason both belong in the message.
    const failure = group.error ?? text.error;
    if (failure !== undefined) {
      throw new Error(`${caseId} failed to publish: ${String(failure)}`, { cause: failure });
    }
    const layout = text.layout;
    if (layout === undefined) throw new Error(`${caseId} has no layout`);
    return readEvidence(text, layout);
  } finally {
    text.removeFromParent();
    text.dispose();
  }
}

/**
 * Reads the paint the packer actually resolved, not the paint the author stated.
 *
 * Bitmap publishes one instance colour per drawn glyph into the batch storage its draws share, and each draw records
 * where its run begins, so walking the draws recovers the resolved colour of every rendered glyph. Draws are grouped by
 * raster resource rather than by paragraph position, so the result is the paragraph's multiset of resolved colours and
 * not a per-cluster mapping — which is why the paint evidence is expressed as counts and differences between cases.
 */
function readEvidence(text: THREE.Object3D, layout: ParagraphLayout): CaseEvidence {
  const colors: string[] = [];
  let drawCount = 0;
  let renderedGlyphCount = 0;
  text.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.InstancedBufferGeometry)) return;
    drawCount += 1;
    const attribute = child.geometry.getAttribute('_pmndrsTextColors');
    const start = (child.userData.pmndrsTextRunStart as number | undefined) ?? 0;
    const count = child.geometry.instanceCount;
    renderedGlyphCount += count;
    for (let instance = 0; instance < count; instance += 1) {
      const at = (start + instance) * 4;
      colors.push(
        [attribute.array[at], attribute.array[at + 1], attribute.array[at + 2], attribute.array[at + 3]]
          .map((channel) => (channel ?? 0).toFixed(4))
          .join(','),
      );
    }
  });
  return {
    clusters: [...layout.clusters],
    colors,
    contentWidth: layout.contentWidth,
    drawCount,
    fontHandleCount: layout.fontHandles.length,
    fontSizes: [...layout.glyphFontSizes],
    glyphIds: [...layout.glyphIds],
    glyphFontSlots: [...layout.glyphFontSlots],
    lineCount: layout.lineGlyphStarts.length,
    lineTextEnds: [...layout.lineTextEnds],
    notdefCount: [...layout.glyphIds].reduce((count, id) => count + (id === 0 ? 1 : 0), 0),
    renderedGlyphCount,
    x: [...layout.x],
  };
}

function required(evidence: ReadonlyMap<RichTextCaseId, CaseEvidence>, caseId: RichTextCaseId): CaseEvidence {
  const value = evidence.get(caseId);
  if (value === undefined) throw new Error(`rich text conformance did not measure ${caseId}`);
  return value;
}

function glyphsInRange(evidence: CaseEvidence, range: { readonly start: number; readonly end: number }): number[] {
  const indices: number[] = [];
  for (const [index, cluster] of evidence.clusters.entries()) {
    if (cluster >= range.start && cluster < range.end) indices.push(index);
  }
  return indices;
}

function countColor(evidence: CaseEvidence, color: string): number {
  return evidence.colors.filter((value) => value === color).length;
}

function differingGlyphsIn(
  left: CaseEvidence,
  right: CaseEvidence,
  range: { readonly start: number; readonly end: number },
): number {
  return glyphsInRange(left, range).filter((index) => left.glyphIds[index] !== right.glyphIds[index]).length;
}

function differingGlyphsOutside(
  left: CaseEvidence,
  right: CaseEvidence,
  range: { readonly start: number; readonly end: number },
): number {
  const inside = new Set(glyphsInRange(left, range));
  return left.glyphIds.filter((id, index) => !inside.has(index) && id !== right.glyphIds[index]).length;
}

/** Paint resolves through the same sRGB-to-linear transfer the packer applies, so the comparison uses resolved values. */
function linearColorKey(color: string): string {
  const match = /^#([0-9a-f]{6})$/iu.exec(color);
  if (match === null) throw new TypeError('rich text conformance colors must be #rrggbb');
  const hex = match[1]!;
  const channel = (at: number): number => {
    const srgb = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return [channel(0), channel(2), channel(4), 1].map((value) => value.toFixed(4)).join(',');
}

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (const byte of UTF8_ENCODER.encode(value)) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
