import { GlyphError } from '../glyph-error.js';

export class NodeBakeError extends GlyphError<'bake-failed'> {
  readonly reason: string;
  readonly path: string | undefined;

  constructor(reason: string, message: string, path?: string, options?: ErrorOptions) {
    super('bake-failed', message, options);
    this.name = 'NodeBakeError';
    this.reason = reason;
    this.path = path;
  }
}
