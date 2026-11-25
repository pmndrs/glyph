import {
  createCodecProgram,
  id,
  type CodecBufferId,
  type CodecProgram,
  type CodecProgramId,
  type CodecTechniqueId,
  type CodecTransformMode,
} from './codec.js';
import type { CodecProgramSystemBuffers } from './codec-program.js';
import { attachHostCodecProgramSystemBuffers, hostAbsoluteTechniqueProgram } from './raster-host.js';
import { attachDecorationGlyphFacts, normalizeCodecProgramSystemBuffers } from '../internal/codec-program-contract.js';
import { defineTechniqueSchema, schemaCodecBuffers, type TechniqueSchema } from './schema.js';

const DECORATION_RECT_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/decoration/rect');
const DECORATION_PACKED_BUFFER_ID: CodecBufferId = id.buffer('glyph-three/decoration/packed');

/** Decoration is a reserved technique of a host Codec, not a raster technique: rows are resource-free and fill the gather lanes directly. */
export const decorationSchema: TechniqueSchema<
  {
    readonly rect: {
      readonly id: typeof DECORATION_RECT_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top', 'width', 'height'];
    };
    readonly packed: {
      readonly id: typeof DECORATION_PACKED_BUFFER_ID;
      readonly scalar: 'u32';
      readonly lanes: readonly ['color', 'flags'];
    };
  },
  { readonly u32: readonly ['color', 'flags'] }
> = defineTechniqueSchema({
  technique: 'pmndrs.decoration',
  scope: 'glyph',
  binding: { u32: ['color', 'flags'] },
  buffers: {
    rect: { id: DECORATION_RECT_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    packed: { id: DECORATION_PACKED_BUFFER_ID, scalar: 'u32', lanes: ['color', 'flags'] },
  },
});

/** Renderer-owned identities and system lanes for resource-free paragraph decorations. */
export interface DecorationCodecProgramOptions {
  readonly techniqueId: CodecTechniqueId;
  readonly programId: CodecProgramId;
  readonly transformMode: CodecTransformMode;
  /**
   * `glyphFacts` publishes, per rectangle, which glyphs it runs under: the pen origin and layout index of the glyph
   * at its inline start, and the layout index of the glyph at its inline end in the lane a glyph row leaves unused.
   * Indices grow along the inline axis whatever the direction of the text.
   */
  readonly system: Pick<CodecProgramSystemBuffers, 'stableGlyphId' | 'transformIndex' | 'glyphFacts'>;
}

/**
 * Compile the engine's absolute decoration rectangles without raster resources or font scaling. Decoration rows fill
 * gather lanes by position, not per-glyph meaning: the "inlineOrigin" lane holds the rect's inline start, for example.
 * The program publishes the schema's buffers, then `stableGlyphId`, then `transformIndex` and `glyphFacts` when
 * `system` declares them.
 */
export function createDecorationCodecProgram(options: DecorationCodecProgramOptions): CodecProgram {
  const p = hostAbsoluteTechniqueProgram(decorationSchema);
  const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
  const authoredBody = p.compile({
    rect: [inlineOrigin, blockOrigin, fontSize, color.red],
    packed: [p.binding.color, p.binding.flags],
  });
  const { glyphFacts, ...identity } = options.system;
  // The fact lane is the one this program shares with a caller's declaration, so it is checked like a raster's.
  const facts =
    glyphFacts === undefined
      ? undefined
      : normalizeCodecProgramSystemBuffers(decorationSchema.buffers, options.system).glyphFacts;
  const buffers = [
    ...schemaCodecBuffers(decorationSchema),
    { id: options.system.stableGlyphId.id, scalar: 'u32' as const, vectorWidth: 1 as const },
    ...(options.system.transformIndex === undefined
      ? []
      : [{ id: options.system.transformIndex.id, scalar: 'u32' as const, vectorWidth: 1 as const }]),
    ...(facts === undefined ? [] : [{ id: facts.id, scalar: 'f32' as const, vectorWidth: 4 as const }]),
  ];
  const body = attachHostCodecProgramSystemBuffers(authoredBody, decorationSchema, identity);
  return {
    ...createCodecProgram(
      options.techniqueId,
      options.programId,
      facts === undefined
        ? body
        : attachDecorationGlyphFacts(body, decorationSchema, { ...identity, glyphFacts: facts }),
      buffers,
      options.transformMode,
    ),
    primitiveKind: 'decoration',
    resourceKindMask: 0,
  };
}
