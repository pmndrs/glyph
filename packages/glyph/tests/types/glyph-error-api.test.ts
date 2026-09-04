import { GlyphFontError, GlyphEngineStatusError, GlyphError, type GlyphErrorCode } from '../../src/index.js';

declare const fontError: GlyphFontError;
declare const engineError: GlyphEngineStatusError;

fontError satisfies GlyphError;
fontError.code satisfies 'resource-unavailable';
fontError.reason satisfies string;
engineError satisfies GlyphError;
engineError.code satisfies 'engine-failed';
engineError.statusCode satisfies import('../../src/engine-error.js').GlyphEngineStatusCode;

const stableCode: GlyphErrorCode = 'artifact-invalid';
void stableCode;

// @ts-expect-error Operational categories are a closed public vocabulary.
const unknownCode: GlyphErrorCode = 'FONT_LOAD_FAILED';
void unknownCode;
