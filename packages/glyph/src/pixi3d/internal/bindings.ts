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

import type { Pixi3DResolvedResource } from './resource.js';
import type { Pixi3DText } from '../text.js';

export interface Pixi3DProgramBinding {
  readonly kind: 'pixi3d-program';
  readonly program: CodecProgram;
}

export interface Pixi3DBufferBinding {
  readonly kind: 'pixi3d-buffer';
  readonly input: GlyphBufferBindingInput<Pixi3DProgramBinding>;
}

export interface Pixi3DInstanceSpanBinding {
  readonly kind: 'pixi3d-instance-span';
  readonly input: GlyphInstanceSpanBindingInput<Pixi3DResolvedResource, Pixi3DBufferBinding, Pixi3DProgramBinding>;
}

export interface Pixi3DBatchBinding {
  readonly kind: 'pixi3d-batch';
  readonly input: GlyphBatchBindingInput<
    Pixi3DResolvedResource,
    Pixi3DBufferBinding,
    Pixi3DProgramBinding,
    Pixi3DMaterial,
    Pixi3DInstanceSpanBinding
  >;
}

export interface Pixi3DInstanceBinding {
  readonly kind: 'pixi3d-instance';
  readonly input: GlyphRootInstanceBindingInput<
    Pixi3DResolvedResource,
    Pixi3DBufferBinding,
    Pixi3DProgramBinding,
    Pixi3DMaterial,
    Pixi3DText,
    Pixi3DInstanceSpanBinding
  >;
}

export interface Pixi3DMaterial {
  readonly kind: 'pixi3d-material';
}

export interface Pixi3DBindings extends GlyphBindingSet {
  readonly resource: Pixi3DResolvedResource;
  readonly buffer: Pixi3DBufferBinding;
  readonly program: Pixi3DProgramBinding;
  readonly material: Pixi3DMaterial;
  readonly transform: Pixi3DText;
  readonly batch: Pixi3DBatchBinding;
  readonly instance: Pixi3DInstanceBinding;
  readonly instanceSpan: Pixi3DInstanceSpanBinding;
  readonly materialInput: Pixi3DMaterial;
  readonly transformInput: Pixi3DText;
}

export interface Pixi3DRootBoundary {
  readonly name: string | undefined;
}

export const Pixi3DSchema: GlyphSchema<Pixi3DBindings, Pixi3DRootBoundary> = defineGlyphSchema({
  program: (_root, program) => Object.freeze({ kind: 'pixi3d-program', program }),
  buffer: (_root, input) => Object.freeze({ kind: 'pixi3d-buffer', input }),
  material: (_root, material) => material,
  transform: (_root, transform) => transform,
  batch: (_root, input) => Object.freeze({ kind: 'pixi3d-batch', input }),
  instance: (_root, input) => Object.freeze({ kind: 'pixi3d-instance', input }),
  instanceSpan: (_root, input) => Object.freeze({ kind: 'pixi3d-instance-span', input }),
});
