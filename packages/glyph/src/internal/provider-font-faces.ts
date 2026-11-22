import { isFontFaceSelection, type FontFace, type FontFaceConfig, type FontFaceSource } from '../font-face.js';
import { glyph } from '../glyph.js';
import { fontResourceKey } from './font-resource-key.js';

/** One entry of a framework provider's `fontFaces` table; React and Vue publish the same shape. */
export type ProviderFontFaceDeclaration =
  | FontFaceSource
  | FontFace
  | Readonly<{ src: FontFaceSource; format?: FontFaceConfig['format'] }>;

export type ProviderFontFaceTable = Readonly<Record<string, ProviderFontFaceDeclaration>>;

/** The faces a provider table names, and the subset the provider created and therefore disposes. */
export interface ProviderFontFaceEntries {
  readonly byName: Map<string, FontFace>;
  readonly owned: readonly FontFace[];
}

/**
 * Resolves every table entry to a FontFace. An existing FontFace is borrowed; a source or `{ src, format }` config
 * declares a new face the provider owns. Faces declared before a failure are disposed before it is rethrown.
 */
export function declareProviderFontFaces(table: ProviderFontFaceTable): ProviderFontFaceEntries {
  const byName = new Map<string, FontFace>();
  const owned: FontFace[] = [];
  try {
    for (const [name, declaration] of Object.entries(table)) {
      if (name.trim().length === 0) throw new TypeError('GlyphProvider fontFaces keys must be nonempty strings');
      let face: FontFace;
      if (isFontFaceSelection(declaration)) {
        face = declaration.face;
      } else if (isProviderFontFaceConfig(declaration)) {
        face =
          declaration.format === undefined
            ? glyph.fontFace(declaration.src)
            : glyph.fontFace(declaration.src, { format: declaration.format });
        owned.push(face);
      } else {
        face = glyph.fontFace(declaration);
        owned.push(face);
      }
      byName.set(name, face);
    }
  } catch (error) {
    for (const face of owned) face.dispose();
    throw error;
  }
  return { byName, owned };
}

/** Whether two provider tables declare the same faces, so a re-render may keep the faces it already owns. */
export function sameProviderFontFaceTable(
  left: ProviderFontFaceTable | undefined,
  right: ProviderFontFaceTable | undefined,
): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  const leftNames = Object.keys(left);
  const rightNames = Object.keys(right);
  if (leftNames.length !== rightNames.length) return false;
  return leftNames.every((name) => {
    if (!Object.hasOwn(right, name)) return false;
    return sameProviderFontFaceDeclaration(left[name]!, right[name]!);
  });
}

function sameProviderFontFaceDeclaration(
  left: ProviderFontFaceDeclaration,
  right: ProviderFontFaceDeclaration,
): boolean {
  if (left === right) return true;
  if (isFontFaceSelection(left) || isFontFaceSelection(right)) return false;
  return declarationKey(left) === declarationKey(right);
}

function declarationKey(declaration: Exclude<ProviderFontFaceDeclaration, FontFace>): string {
  return isProviderFontFaceConfig(declaration)
    ? fontResourceKey(declaration.src, declaration.format)
    : fontResourceKey(declaration, undefined);
}

function isProviderFontFaceConfig(value: unknown): value is Readonly<{
  src: FontFaceSource;
  format?: FontFaceConfig['format'];
}> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !(value instanceof URL) &&
    !(typeof Blob !== 'undefined' && value instanceof Blob) &&
    Object.hasOwn(value, 'src') &&
    Object.keys(value).every((key) => key === 'src' || key === 'format')
  );
}
