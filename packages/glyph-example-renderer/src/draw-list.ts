import type { PolicyProgram } from '@pmndrs/glyph';

import type {
  ExampleBufferBinding,
  ExampleInstanceSpanBinding,
  ExampleMaterial,
  ExampleResolvedResource,
  ExampleTransform,
} from './config.js';

/** One retained renderer draw, with engine identities already replaced by config bindings. */
export interface ExampleDraw {
  readonly kind: 'batch' | 'instance';
  readonly program: PolicyProgram;
  readonly programVariant: number;
  readonly material: ExampleMaterial | undefined;
  readonly buffers: readonly ExampleBufferBinding[];
  readonly resources: readonly ExampleResolvedResource[];
  readonly flags: number;
  readonly depthKey: number;
  readonly order: number;
  readonly transform: ExampleTransform | undefined;
  readonly primitive: ExamplePrimitiveRecord;
}

/** One retained primitive span in a renderer draw. */
export type ExamplePrimitiveRecord = Readonly<
  Omit<ExampleInstanceSpanBinding['input'], 'identity' | 'program' | 'buffer'> & {
    readonly buffer: ExampleBufferBinding | undefined;
  }
>;

/** One resolved portable resource selected by the config. */
export type ExampleResourceRecord = ExampleResolvedResource;

/**
 * Accepted renderer state. The hierarchy is walked while borrowed; only renderer bindings
 * and the scalar draw contract are retained after publication.
 */
export interface ExampleDrawList {
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly checkpoint: boolean;
  readonly changed: boolean;
  readonly draws: readonly ExampleDraw[];
}
