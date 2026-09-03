import { loadFont, type Font, type GlyphLayout, type RasterFormatInput } from '@pmndrs/glyph';
import { id as hashId } from '@pmndrs/glyph/config/codec';
import { bitmap, bitmapSchema } from '@pmndrs/glyph/raster/bitmap';
import type { TextGroup, ThreeRoot } from '@pmndrs/glyph/three';
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
import { codecAttributeName, requiredCodecAttribute } from '../three-policy-buffer-evidence';
import { createBenchmarkThreeRoot, disposeBenchmarkThreeRoot } from '../../../three-root';

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
const BITMAP_COLOR_ATTRIBUTE = codecAttributeName(bitmapSchema.buffers.color.id);
const DECORATION_RECT_ATTRIBUTE = codecAttributeName(hashId.buffer('glyph-three/decoration/rect'));
const DECORATION_PACKED_ATTRIBUTE = codecAttributeName(hashId.buffer('glyph-three/decoration/packed'));
// Decoration gather convention (D-248): buffer 2 packs [color, flags | style << 8] per instance. The bit values are
// the shaper ABI's `engine.decorationFlags` / `engine.decorationStyles`, pinned here because a silent renumbering
// must fail this lane rather than shift what the probe counts.
const DECORATION_UNDERLINE_FLAG = 0b0001;
const DECORATION_LINE_THROUGH_FLAG = 0b0100;
const DECORATION_SOLID_STYLE = 1;
const bitmapRaster: RasterFormatInput<BitmapTechnique> = {
  raster: bitmap,
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
  readonly underlineCount: number;
  readonly lineThroughCount: number;
  readonly x: readonly number[];
}

type RichTextSpansState =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'ready';
      readonly body: Font<BitmapTechnique>;
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
      const loaded: Font<BitmapTechnique>[] = [];
      try {
        const [body, foreign, emphasis] = await Promise.all(
          [interBitmapFontUrl, devanagariBitmapFontUrl, sourceSerifBitmapFontUrl].map(async (url) => {
            const font = await loadFont(
              { baked: url },
              bitmapRaster,
              context?.signal === undefined ? {} : { signal: context.signal },
            );
            loaded.push(font);
            return font;
          }),
        );
        if (body === undefined || foreign === undefined || emphasis === undefined) {
          throw new Error('rich text conformance did not load its three fixtures');
        }
        // Decoration-metrics probe: every baked font this workload touches must expose the
        // underline and strikeout values the artifact bakes from `post` and `OS/2`, so a
        // regression in the bake or decode path fails this lane before any renderer work.
        for (const loadedFont of [body, foreign, emphasis]) {
          const { underlinePosition, underlineThickness, strikeoutPosition, strikeoutSize } = loadedFont.metrics;
          const values = [underlinePosition, underlineThickness, strikeoutPosition, strikeoutSize];
          if (!values.every(Number.isFinite) || underlineThickness <= 0 || strikeoutSize <= 0) {
            throw new Error(
              `baked decoration metrics are missing or degenerate for ${loadedFont.raster.id}: ` +
                `underline ${underlinePosition}/${underlineThickness}, strikeout ${strikeoutPosition}/${strikeoutSize}`,
            );
          }
        }
        state = { kind: 'ready', body, companions: { emphasis, foreign } };
      } catch (error) {
        for (const font of loaded) font.dispose();
        throw error;
      }
    },
    run: async (_input, _sampleIndex, _controls, context) => {
      context?.signal?.throwIfAborted();
      if (state.kind !== 'ready') throw new Error('rich text spans conformance target was not loaded');
      const { body, companions } = state;

      const scene = new THREE.Scene();
      const root = createBenchmarkThreeRoot('rich-text-spans', { capacity: { size: 4_096, policy: 'grow' } });
      // One group so every case packs through the same batch the live workload uses, rather than through a
      // standalone-Text path the workload never takes.
      const group = root.createTextGroup();
      scene.add(group);
      const evidence = new Map<RichTextCaseId, CaseEvidence>();
      try {
        for (const caseId of CASE_IDS) {
          evidence.set(caseId, measureCase(root, scene, group, body, companions, caseId));
        }
      } finally {
        group.clear();
        group.removeFromParent();
        group.dispose();
        disposeBenchmarkThreeRoot(root);
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

      // Decoration probe (D-248): the composed paragraph declares an underline on the emphasis span and line-through
      // on the tint and accent spans, so both kinds must be published as decoration instances in every case.
      if (composed.underlineCount === 0 || composed.lineThroughCount === 0) {
        throw new Error(
          `composed paragraph published ${composed.underlineCount} underline and ` +
            `${composed.lineThroughCount} line-through decoration instances; both must be nonzero`,
        );
      }

      const hashes = CASE_IDS.map((caseId) => {
        const value = required(evidence, caseId);
        // Glyph selection and topology remain exact. Positions are public f32 values, so the semantic digest quantizes
        // below a visible hundredth of a pixel; paint is explicitly a multiset because resource batching may reorder
        // draws without changing the paragraph's resolved colors.
        return [
          caseId,
          value.glyphIds.join(','),
          value.clusters.join(','),
          value.glyphFontSlots.join(','),
          value.fontSizes.map((size) => size.toFixed(4)).join(','),
          value.x.map((origin) => origin.toFixed(2)).join(','),
          value.lineTextEnds.join(','),
          value.contentWidth.toFixed(2),
          [...value.colors].sort().join(','),
          `${value.underlineCount}/${value.lineThroughCount}`,
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
          underlineCount: composed.underlineCount,
          lineThroughCount: composed.lineThroughCount,
        },
      };
    },
    dispose: async () => {
      if (state.kind !== 'ready') return;
      const { body, companions } = state;
      state = { kind: 'empty' };
      body.dispose();
      companions.emphasis.dispose();
      companions.foreign.dispose();
    },
  };
}

function measureCase(
  root: ThreeRoot,
  scene: THREE.Scene,
  group: TextGroup,
  body: Font<BitmapTechnique>,
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
  const text = root.createText({
    font: body,
    text: literal,
    style: { fontSize: BODY_FONT_SIZE, lineHeight: 1.25, color: '#ffffff' },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: CONTENT_WIDTH } },
  });
  try {
    group.add(text);
    // Target v1 publishes shaping, layout, and draws during the world-matrix update instead of through an awaited
    // readiness promise, so failures surface on the object rather than as a rejected wait.
    scene.updateMatrixWorld(true);
    // Headless runs read this across a page boundary that cannot transfer a cause, so the case that failed and the
    // underlying reason both belong in the message.
    const failure = group.error ?? text.error;
    if (failure !== undefined) {
      throw new Error(`${caseId} failed to publish: ${String(failure)}`, { cause: failure });
    }
    const layout = text.glyphs();
    if (layout === undefined) throw new Error(`${caseId} has no layout`);
    return readEvidence(scene, root, layout);
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
function readEvidence(scene: THREE.Scene, root: ThreeRoot, layout: GlyphLayout): CaseEvidence {
  const colors: string[] = [];
  let drawCount = 0;
  let renderedGlyphCount = 0;
  let underlineCount = 0;
  let lineThroughCount = 0;
  const drawRoot = scene.getObjectByName(
    root.name === undefined ? '@pmndrs/glyph:anonymous' : `@pmndrs/glyph:${root.name}`,
  );
  drawRoot?.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.InstancedBufferGeometry)) return;
    if (child.userData.pmndrsGlyphPrimitiveKind === 'decoration') {
      const rect = requiredCodecAttribute(child.geometry, DECORATION_RECT_ATTRIBUTE, 'decoration rect evidence');
      const packed = requiredCodecAttribute(child.geometry, DECORATION_PACKED_ATTRIBUTE, 'decoration packed evidence');
      if (!(rect?.array instanceof Float32Array) || !(packed?.array instanceof Uint32Array)) {
        throw new Error('decoration draw is missing its rect or packed color/flags buffer');
      }
      const start = (child.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
      for (let instance = 0; instance < child.geometry.instanceCount; instance += 1) {
        const value = packed.array[(start + instance) * 2 + 1] ?? 0;
        if ((value >>> 8) & 0xff && ((value >>> 8) & 0xff) !== DECORATION_SOLID_STYLE) {
          throw new Error(`decoration instance carries unimplemented line style ${(value >>> 8) & 0xff}`);
        }
        if (value & DECORATION_UNDERLINE_FLAG) underlineCount += 1;
        if (value & DECORATION_LINE_THROUGH_FLAG) lineThroughCount += 1;
      }
      return;
    }
    drawCount += 1;
    const attribute = requiredCodecAttribute(child.geometry, BITMAP_COLOR_ATTRIBUTE, 'Bitmap color evidence');
    const start = (child.userData.pmndrsGlyphRunStart as number | undefined) ?? 0;
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
    underlineCount,
    lineThroughCount,
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
