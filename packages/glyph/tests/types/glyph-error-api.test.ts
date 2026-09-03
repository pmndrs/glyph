import {
  FontLoadError,
  GlyphEngineStatusError,
  GlyphError,
  type GlyphErrorCode,
} from '../../src/index.js';

declare const loadError: FontLoadError;
declare const engineError: GlyphEngineStatusError;

loadError satisfies GlyphError;
loadError.code satisfies 'resource-unavailable';
loadError.reason satisfies string;
engineError satisfies GlyphError;
engineError.code satisfies 'engine-failed';
engineError.statusCode satisfies import('../../src/engine-error.js').GlyphEngineStatusCode;

const stableCode: GlyphErrorCode = 'artifact-invalid';
void stableCode;

// @ts-expect-error Operational categories are a closed public vocabulary.
const unknownCode: GlyphErrorCode = 'FONT_LOAD_FAILED';
void unknownCode;
