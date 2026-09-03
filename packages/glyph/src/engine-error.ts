import { textShaperAbi } from './generated/text-shaper-abi.js';
import type { ParagraphId, StyleId } from './internal/glyph-id.js';

/** Request identities used by an integration to map a rejected frame back to authored state. */
export interface GlyphEngineFault {
  readonly paragraphId: ParagraphId | 0;
  readonly styleId: StyleId | 0;
}

const NO_FAULT: GlyphEngineFault = Object.freeze({ paragraphId: 0, styleId: 0 });

/** Stable semantic classification of a glyph-engine status. */
export type GlyphEngineStatusCode =
  | 'invalid-handle'
  | 'invalid-font'
  | 'invalid-extents'
  | 'handle-conflict'
  | 'font-missing'
  | 'invalid-request'
  | 'result-too-large'
  | 'codec-conflict'
  | 'codec-missing'
  | 'planner-conflict'
  | 'planner-missing'
  | 'revision-conflict'
  | 'font-stack-missing'
  | 'font-in-use'
  | 'style-range-invalid'
  | 'style-splits-cluster'
  | 'style-nesting-invalid'
  | 'style-root-invalid'
  | 'font-metrics-missing'
  | 'registration-in-use'
  | 'unknown';

const GLYPH_ENGINE_STATUS_CODES: ReadonlyMap<number, GlyphEngineStatusCode> = new Map([
  [textShaperAbi.status.invalidHandle, 'invalid-handle'],
  [textShaperAbi.status.invalidFont, 'invalid-font'],
  [textShaperAbi.status.invalidExtents, 'invalid-extents'],
  [textShaperAbi.status.handleConflict, 'handle-conflict'],
  [textShaperAbi.status.fontMissing, 'font-missing'],
  [textShaperAbi.status.invalidRequest, 'invalid-request'],
  [textShaperAbi.status.resultTooLarge, 'result-too-large'],
  [textShaperAbi.status.codecConflict, 'codec-conflict'],
  [textShaperAbi.status.codecMissing, 'codec-missing'],
  [textShaperAbi.status.plannerConflict, 'planner-conflict'],
  [textShaperAbi.status.plannerMissing, 'planner-missing'],
  [textShaperAbi.status.revisionConflict, 'revision-conflict'],
  [textShaperAbi.status.fontStackMissing, 'font-stack-missing'],
  [textShaperAbi.status.fontInUse, 'font-in-use'],
  [textShaperAbi.status.styleRangeInvalid, 'style-range-invalid'],
  [textShaperAbi.status.styleSplitsCluster, 'style-splits-cluster'],
  [textShaperAbi.status.styleNestingInvalid, 'style-nesting-invalid'],
  [textShaperAbi.status.styleRootInvalid, 'style-root-invalid'],
  [textShaperAbi.status.fontMetricsMissing, 'font-metrics-missing'],
  [textShaperAbi.status.registrationInUse, 'registration-in-use'],
]);

/** A synchronous engine call rejected with a stable code and its raw diagnostic status. */
export class GlyphEngineStatusError extends Error {
  readonly code: GlyphEngineStatusCode;
  readonly status: number;

  constructor(operation: string, status: number) {
    super(`${operation} failed with glyph-engine status ${status}`);
    this.name = 'GlyphEngineStatusError';
    this.code = GLYPH_ENGINE_STATUS_CODES.get(status) ?? 'unknown';
    this.status = status;
  }
}

/** Stable diagnostic details associated with a {@link GlyphEngineStatusError}. */
export interface GlyphEngineStatusDetails {
  readonly requiredRequestCapacity: number;
  readonly requiredResultCapacity: number;
  readonly fault: GlyphEngineFault;
}

const glyphEngineStatusDetails = new WeakMap<GlyphEngineStatusError, GlyphEngineStatusDetails>();

/** Reads semantic diagnostic details retained on an engine status error. */
export function glyphEngineStatusErrorDetails(error: GlyphEngineStatusError): GlyphEngineStatusDetails {
  return (
    glyphEngineStatusDetails.get(error) ?? {
      requiredRequestCapacity: 0,
      requiredResultCapacity: 0,
      fault: NO_FAULT,
    }
  );
}

/** @internal Attaches trusted result-header details without exposing mutable fields on the public error. */
export function setGlyphEngineStatusErrorDetails(
  error: GlyphEngineStatusError,
  details: GlyphEngineStatusDetails,
): void {
  glyphEngineStatusDetails.set(error, details);
}
