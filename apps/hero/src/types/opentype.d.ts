/**
 * The slice of opentype.js 2.0 the hero uses. The package ships no declarations; only what is called is declared,
 * so a wrong assumption about the library fails to compile here rather than at run time.
 */
declare module 'opentype.js' {
  export interface PathCommand {
    readonly type: 'M' | 'L' | 'C' | 'Q' | 'Z';
    readonly x?: number;
    readonly y?: number;
    readonly x1?: number;
    readonly y1?: number;
    readonly x2?: number;
    readonly y2?: number;
  }

  export interface Path {
    readonly commands: readonly PathCommand[];
  }

  export interface Glyph {
    readonly name?: string;
    readonly advanceWidth?: number;
    /** The outline scaled to `fontSize` per em, in canvas coordinates: y grows downwards. */
    getPath(x: number, y: number, fontSize: number): Path;
  }

  export interface Font {
    readonly unitsPerEm: number;
    charToGlyph(character: string): Glyph;
  }

  export function parse(buffer: ArrayBuffer): Font;
}
