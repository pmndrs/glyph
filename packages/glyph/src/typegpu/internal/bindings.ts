import type {
  CodecProgram,
  GlyphBatchBindingInput,
  GlyphBindingSet,
  GlyphBufferBindingInput,
  GlyphInstanceSpanBindingInput,
  GlyphRootInstanceBindingInput,
  GlyphSchema,
} from '../../index.js';
import { defineGlyphSchema } from '../../config/glyph.js';
import type { TypeGpuResource } from './resources.js';
import type { TypeGpuTransform } from './renderer.js';

export interface BufferBinding {
  readonly input: GlyphBufferBindingInput<CodecProgram>;
}
export interface SpanBinding {
  readonly input: GlyphInstanceSpanBindingInput<TypeGpuResource, BufferBinding, CodecProgram>;
}
export interface BatchBinding {
  readonly input: GlyphBatchBindingInput<TypeGpuResource, BufferBinding, CodecProgram, object, SpanBinding>;
}
export interface InstanceBinding {
  readonly input: GlyphRootInstanceBindingInput<
    TypeGpuResource,
    BufferBinding,
    CodecProgram,
    object,
    TypeGpuTransform,
    SpanBinding
  >;
}
export interface Bindings extends GlyphBindingSet {
  readonly program: CodecProgram;
  readonly resource: TypeGpuResource;
  readonly buffer: BufferBinding;
  readonly material: object;
  readonly transform: TypeGpuTransform;
  readonly batch: BatchBinding;
  readonly instance: InstanceBinding;
  readonly instanceSpan: SpanBinding;
  readonly materialInput: object;
  readonly transformInput: TypeGpuTransform;
}
export const schema: GlyphSchema<Bindings, void> = defineGlyphSchema({
  program: (_, program) => program,
  buffer: (_, input) => ({ input }),
  material: (_, material) => material,
  transform: (_, transform) => transform,
  batch: (_, input) => ({ input }),
  instance: (_, input) => ({ input }),
  instanceSpan: (_, input) => ({ input }),
});
