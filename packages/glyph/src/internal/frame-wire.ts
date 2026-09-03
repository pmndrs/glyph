import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type {
  ExclusionId,
  FlowThreadId,
  FontStackHandle,
  InlineObjectId,
  MaterialHandle,
  ParagraphId,
  CodecHandle,
  RegionId,
  ResourceHandle,
  StyleId,
  PlannerHandle,
} from './glyph-id.js';
import { codecCapabilitySetSelectionId, type CodecCapabilitySetSelection } from './codec-capability-selection.js';

const MAX_U32 = 0xffff_ffff;
export const MAX_TEXT_ENGINE_OUTPUT_BYTES: number = 64 * 1024 * 1024;
const encoder = new TextEncoder();

export interface PlannerFrameLimits {
  readonly maxParagraphs: number;
  readonly maxClusters: number;
  readonly maxLines: number;
  readonly maxRegions: number;
  readonly maxExclusions: number;
  readonly maxInlineObjects: number;
  readonly maxSlotsPerBand: number;
  readonly maxOutputBytes: number;
}

export type PlannerParagraphMutation =
  | { readonly opcode: 'upsert'; readonly paragraphId: ParagraphId; readonly order: number }
  | { readonly opcode: 'remove'; readonly paragraphId: ParagraphId };

export interface PlannerTextMutation {
  readonly paragraphId: ParagraphId;
  readonly start: number;
  readonly deleteCount: number;
  readonly insert: string;
}

export interface PlannerFeature {
  readonly tag: string;
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

export interface PlannerDecoration {
  readonly style: 'none' | 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  readonly rgba: number;
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly lineThrough?: boolean;
  readonly skipInk?: boolean;
  readonly thickness: number;
  readonly offset: number;
}

export interface PlannerStyleValue {
  readonly fontStackHandle?: FontStackHandle;
  readonly materialId?: MaterialHandle;
  readonly language?: string;
  readonly features?: readonly PlannerFeature[];
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly wordSpacing?: number;
  readonly baselineShift?: number;
  readonly rasterPixelRatio?: number;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly foregroundRgba?: number;
  readonly opacity?: number;
  readonly outline?: Readonly<{ readonly rgba: number; readonly width: number }>;
  readonly shadow?: Readonly<{ readonly rgba: number; readonly offsetX: number; readonly offsetY: number }>;
  readonly decoration?: PlannerDecoration;
}

export type PlannerStyleMutation =
  | { readonly opcode: 'remove'; readonly paragraphId: ParagraphId; readonly styleId: StyleId }
  | {
      readonly opcode: 'upsert';
      readonly paragraphId: ParagraphId;
      readonly styleId: StyleId;
      readonly cascadeOrder: number;
      readonly start: number;
      readonly end: number;
      readonly root?: boolean;
      readonly value: PlannerStyleValue;
    };

export interface PlannerConstraint {
  readonly paragraphId: ParagraphId;
  readonly flowThreadId: FlowThreadId;
  readonly geometryRevision: number;
  readonly width: number;
  readonly height: number;
  readonly viewportBlockStart: number;
  readonly viewportBlockEnd: number;
  readonly resumeBlockOffset: number;
  readonly maxLines: number;
  readonly regionStart: number;
  readonly resumeCluster: number;
  readonly regionCount: number;
  readonly resumeRegion: number;
  readonly widthMode: 'unconstrained' | 'at-most' | 'exact';
  readonly heightMode: 'unconstrained' | 'at-most' | 'exact';
  readonly wrap: 'none' | 'word' | 'character';
  readonly align: 'start' | 'center' | 'end' | 'justify';
  readonly overflow: 'visible' | 'clip' | 'ellipsis';
  readonly blockAlign: 'start' | 'center' | 'end';
  /** Extra inline offset for the paragraph's first line, in paragraph-local units. */
  readonly firstLineIndent?: number;
  /** Block-axis space inserted before the paragraph's first line. */
  readonly spaceBefore?: number;
  /** Block-axis space added after the paragraph's final line. */
  readonly spaceAfter?: number;
  /**
   * Justification bounds on each word space as multiples of its natural
   * advance. Leave unset for the unclamped distribution; when set, minimum is
   * in (0, 1] and maximum is at least 1. Deficit beyond the maximum spills
   * into letter-space expansion, capped per inter-cluster gap.
   */
  readonly justify?: {
    readonly minWordSpaceRatio?: number;
    readonly maxWordSpaceRatio?: number;
    readonly letterSpaceExpansion?: number;
  };
  /** Whether the final and hard-broken lines also justify. Defaults to 'auto'. */
  readonly lastLine?: 'auto' | 'justify';
}

export interface PlannerFlowVertex {
  readonly inline: number;
  readonly block: number;
}

export interface PlannerRegion {
  readonly id: RegionId;
  readonly geometryRevision: number;
  /** Stable compact slot in the renderer-owned region transform table. */
  readonly transformIndex: number;
  readonly shape: 'rectangle' | 'polygon';
  readonly vertices?: readonly PlannerFlowVertex[];
  readonly exclusionStart: number;
  readonly exclusionCount: number;
  readonly writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr';
  readonly textOrientation: 'mixed' | 'upright' | 'sideways';
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineEnd: number;
  readonly blockEnd: number;
  readonly clipInlineStart: number;
  readonly clipBlockStart: number;
  readonly clipInlineEnd: number;
  readonly clipBlockEnd: number;
}

export interface PlannerExclusion {
  readonly id: ExclusionId;
  readonly regionId: RegionId;
  readonly geometryRevision: number;
  readonly shape: 'rectangle' | 'polygon';
  readonly vertices?: readonly PlannerFlowVertex[];
  readonly wrapSide: 'both' | 'inline-start' | 'inline-end' | 'largest';
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineEnd: number;
  readonly blockEnd: number;
  readonly marginInline: number;
  readonly marginBlock: number;
}

export interface PlannerInlineObject {
  readonly paragraphId: ParagraphId;
  readonly id: InlineObjectId;
  readonly contentRevision: number;
  readonly textOffset: number;
  readonly materialId: MaterialHandle;
  readonly resourceId: ResourceHandle;
  readonly resourceGeneration: number;
  readonly inlineExtent: number;
  readonly blockExtent: number;
  readonly baselineOffset: number;
  readonly marginInlineStart: number;
  readonly marginInlineEnd: number;
  readonly marginBlockStart: number;
  readonly marginBlockEnd: number;
  readonly baselineAlignment: 'alphabetic' | 'text-top' | 'middle' | 'text-bottom';
}

export interface PlannerFrameUpdate {
  readonly plannerId: PlannerHandle;
  readonly codecHandle: CodecHandle;
  /** Opaque multi-profile selection; omit it to use the codec's first profile. */
  readonly capabilitySet?: CodecCapabilitySetSelection;
  readonly expectedEngineRevision: number;
  readonly consumedPlanRevision: number;
  readonly acknowledgedPublicationGeneration: number;
  readonly semanticViewMask?: number;
  readonly compositingIndependent?: boolean;
  readonly limits: PlannerFrameLimits;
  readonly paragraphMutations?: readonly PlannerParagraphMutation[];
  readonly textMutations?: readonly PlannerTextMutation[];
  readonly styleMutations?: readonly PlannerStyleMutation[];
  readonly constraints?: readonly PlannerConstraint[];
  readonly regions?: readonly PlannerRegion[];
  readonly exclusions?: readonly PlannerExclusion[];
  readonly inlineObjects?: readonly PlannerInlineObject[];
}

export type PlannerFrameRecords = Pick<
  PlannerFrameUpdate,
  'paragraphMutations' | 'textMutations' | 'styleMutations' | 'constraints' | 'regions' | 'exclusions' | 'inlineObjects'
>;

/** Validate authored records without serializing a trial frame. */
export function validatePlannerFrameRecords(records: PlannerFrameRecords, limits?: PlannerFrameLimits): void {
  const paragraphMutations = records.paragraphMutations ?? [];
  const textMutations = records.textMutations ?? [];
  const styleMutations = records.styleMutations ?? [];
  const constraints = records.constraints ?? [];
  const regions = records.regions ?? [];
  const exclusions = records.exclusions ?? [];
  const inlineObjects = records.inlineObjects ?? [];
  for (const mutation of paragraphMutations) {
    if (mutation.opcode !== 'upsert' && mutation.opcode !== 'remove') {
      throw new TypeError('paragraph mutation opcode is invalid');
    }
    if (mutation.opcode === 'upsert') u32(mutation.order, 'paragraph order');
  }
  for (const mutation of textMutations) {
    u32(mutation.start, 'text mutation start');
    u32(mutation.deleteCount, 'text mutation delete count');
    if (typeof mutation.insert !== 'string') throw new TypeError('text mutation insert must be a string');
    u32(mutation.insert.length, 'text mutation insert count');
  }
  for (const mutation of styleMutations) validateStyleMutation(mutation);
  for (const constraint of constraints) validateConstraint(constraint, limits);
  for (const region of regions) validateRegion(region);
  for (const exclusion of exclusions) validateExclusion(exclusion);
  for (const object of inlineObjects) validateInlineObject(object);
  validateRecordRelationships(
    paragraphMutations,
    textMutations,
    styleMutations,
    constraints,
    regions,
    exclusions,
    inlineObjects,
    limits,
  );
}

/** @internal Serialize one package-owned frame; shaping, measure, planning, and packing remain Rust-owned. */
export function compilePlannerFrameUpdate(frame: PlannerFrameUpdate): Uint8Array {
  const abi = textShaperAbi;
  const request = abi.layouts.engineUpdateRequest;
  const paragraphMutations = frame.paragraphMutations ?? [];
  const textMutations = frame.textMutations ?? [];
  const styleMutations = frame.styleMutations ?? [];
  const constraints = frame.constraints ?? [];
  const regions = frame.regions ?? [];
  const exclusions = frame.exclusions ?? [];
  const inlineObjects = frame.inlineObjects ?? [];
  let cursor: number = request.size;
  const allocate = (count: number, stride: number, alignment: number, label: string): number => {
    if (count === 0) return 0;
    const offset = align(cursor, alignment);
    cursor = checkedAdd(offset, checkedProduct(count, stride, label), label);
    return offset;
  };
  const paragraphOffset = allocate(
    paragraphMutations.length,
    abi.layouts.engineParagraphMutation.size,
    abi.layouts.engineParagraphMutation.alignment,
    'paragraph mutations',
  );
  const textOffset = allocate(textMutations.length, abi.layouts.engineTextMutation.size, 4, 'text mutations');
  const styleOffset = allocate(styleMutations.length, abi.layouts.engineStyleMutation.size, 4, 'style mutations');
  const constraintOffset = allocate(constraints.length, abi.layouts.engineConstraint.size, 4, 'constraints');
  const regionOffset = allocate(regions.length, abi.layouts.engineRegion.size, 4, 'regions');
  const exclusionOffset = allocate(exclusions.length, abi.layouts.engineExclusion.size, 4, 'exclusions');
  const inlineObjectOffset = allocate(inlineObjects.length, abi.layouts.engineInlineObject.size, 4, 'inline objects');
  const textPayloads = textMutations.map((mutation) => allocate(mutation.insert.length, 2, 2, 'text mutation payload'));
  const languageBytes = styleMutations.map((mutation) =>
    mutation.opcode === 'upsert' && mutation.value.language !== undefined
      ? encoder.encode(mutation.value.language)
      : new Uint8Array(),
  );
  // The engine proves style payloads neither overlap nor alias the record table in one
  // forward pass, so every record's payloads must begin at or after the previous
  // record's payload end. Allocating language and features together per record keeps
  // that order; allocating all languages before all features would place the second
  // record's language behind the first record's features.
  const languageOffsets: number[] = [];
  const featureOffsets: number[] = [];
  for (const [index, mutation] of styleMutations.entries()) {
    languageOffsets.push(allocate(languageBytes[index]!.length, 1, 1, 'style language'));
    featureOffsets.push(
      allocate(
        mutation.opcode === 'upsert' ? (mutation.value.features?.length ?? 0) : 0,
        abi.layouts.feature.size,
        abi.layouts.feature.alignment,
        'style features',
      ),
    );
  }
  const regionVertexOffsets = regions.map((region) =>
    allocate(region.vertices?.length ?? 0, abi.layouts.engineFlowVertex.size, 4, 'region vertices'),
  );
  const exclusionVertexOffsets = exclusions.map((exclusion) =>
    allocate(exclusion.vertices?.length ?? 0, abi.layouts.engineFlowVertex.size, 4, 'exclusion vertices'),
  );
  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);

  writeHeader(view, frame, bytes.length, {
    textOffset,
    paragraphOffset,
    styleOffset,
    constraintOffset,
    regionOffset,
    exclusionOffset,
    inlineObjectOffset,
  });
  writeParagraphMutations(view, paragraphOffset, paragraphMutations);
  writeTextMutations(view, textOffset, textMutations, textPayloads);
  writeStyleMutations(view, bytes, styleOffset, styleMutations, languageBytes, languageOffsets, featureOffsets);
  writeConstraints(view, constraintOffset, constraints);
  writeRegions(view, regionOffset, regions, regionVertexOffsets);
  writeExclusions(view, exclusionOffset, exclusions, exclusionVertexOffsets);
  writeInlineObjects(view, inlineObjectOffset, inlineObjects);
  return bytes;
}

function validateStyleMutation(mutation: PlannerStyleMutation): void {
  if (mutation.opcode === 'remove') return;
  if (mutation.opcode !== 'upsert') throw new TypeError('style mutation opcode is invalid');
  u32(mutation.cascadeOrder, 'style cascade order');
  u32(mutation.start, 'style start');
  u32(mutation.end, 'style end');
  if (mutation.end < mutation.start) throw new RangeError('style end must not precede style start');
  optionalBoolean(mutation.root, 'style root');
  if (mutation.root !== true && mutation.start === mutation.end) {
    throw new RangeError('non-root style ranges must not be empty');
  }
  const value = mutation.value;
  if (value.language !== undefined) {
    if (typeof value.language !== 'string') throw new TypeError('style language must be a string');
    const language = encoder.encode(value.language);
    u16(language.length, 'language byte length');
    if (!validLanguageBytes(language)) throw new RangeError('style language must be a valid language tag');
  }
  if (value.features !== undefined) {
    if (!Array.isArray(value.features)) throw new TypeError('style features must be an array');
    u16(value.features.length, 'feature count');
    for (const feature of value.features) {
      tag(feature.tag);
      u32(feature.value, 'feature value');
      u32(feature.start, 'feature start');
      u32(feature.end, 'feature end');
      if (feature.end < feature.start) throw new RangeError('feature end must not precede feature start');
      if (feature.start < mutation.start || feature.end > mutation.end) {
        throw new RangeError('feature range must stay inside its style range');
      }
    }
  }
  for (const [label, number] of [
    ['letter spacing', value.letterSpacing],
    ['word spacing', value.wordSpacing],
    ['baseline shift', value.baselineShift],
  ] as const) {
    if (number !== undefined) finite(number, label);
  }
  for (const [label, number] of [
    ['font size', value.fontSize],
    ['line height', value.lineHeight],
    ['raster pixel ratio', value.rasterPixelRatio],
  ] as const) {
    if (number !== undefined) positiveFinite(number, label);
  }
  if (value.rasterPixelRatio !== undefined && mutation.root !== true) {
    throw new TypeError('raster pixel ratio may only be stated by a root style');
  }
  if (value.direction !== undefined) direction(value.direction);
  if (value.foregroundRgba !== undefined) u32(value.foregroundRgba, 'foreground RGBA');
  const decoration = value.decoration;
  if (decoration !== undefined) {
    enumValue(textShaperAbi.engine.decorationStyles, decoration.style, 'decoration style');
    u32(decoration.rgba, 'decoration RGBA');
    optionalBoolean(decoration.underline, 'decoration underline');
    optionalBoolean(decoration.overline, 'decoration overline');
    optionalBoolean(decoration.lineThrough, 'decoration lineThrough');
    optionalBoolean(decoration.skipInk, 'decoration skipInk');
    finite(decoration.thickness, 'decoration thickness');
    finite(decoration.offset, 'decoration offset');
    if (decoration.thickness < 0) throw new RangeError('decoration thickness must be nonnegative');
    if (
      decoration.style === 'none' &&
      (decoration.rgba !== 0 ||
        decoration.underline === true ||
        decoration.overline === true ||
        decoration.lineThrough === true ||
        decoration.skipInk === true ||
        decoration.thickness !== 0 ||
        decoration.offset !== 0)
    ) {
      throw new TypeError('a none decoration must not state decoration data');
    }
  }
}

function validateConstraint(value: PlannerConstraint, limits: PlannerFrameLimits | undefined): void {
  for (const [field, number] of [
    ['geometryRevision', value.geometryRevision],
    ['maxLines', value.maxLines],
    ['regionStart', value.regionStart],
    ['resumeCluster', value.resumeCluster],
  ] as const) {
    u32(number, field);
  }
  u16(value.regionCount, 'constraint region count');
  u16(value.resumeRegion, 'constraint resume region');
  for (const [field, number] of [
    ['width', value.width],
    ['height', value.height],
    ['viewportBlockStart', value.viewportBlockStart],
    ['viewportBlockEnd', value.viewportBlockEnd],
    ['resumeBlockOffset', value.resumeBlockOffset],
    ['firstLineIndent', value.firstLineIndent ?? 0],
    ['spaceBefore', value.spaceBefore ?? 0],
    ['spaceAfter', value.spaceAfter ?? 0],
    ['justifyMinWordSpaceRatio', value.justify?.minWordSpaceRatio ?? 0],
    ['justifyMaxWordSpaceRatio', value.justify?.maxWordSpaceRatio ?? 0],
    ['justifyLetterSpaceExpansion', value.justify?.letterSpaceExpansion ?? 0],
  ] as const) {
    finite(number, field);
  }
  axisMode(value.widthMode);
  axisMode(value.heightMode);
  validateAxis(value.widthMode, value.width, 'constraint width');
  validateAxis(value.heightMode, value.height, 'constraint height');
  if (value.viewportBlockStart > value.viewportBlockEnd) {
    throw new RangeError('constraint viewport start must not exceed its end');
  }
  if (limits !== undefined && value.maxLines > limits.maxLines) {
    throw new RangeError('constraint maxLines exceeds the planner limit');
  }
  if (value.resumeRegion > value.regionCount) {
    throw new RangeError('constraint resumeRegion exceeds its selected regions');
  }
  enumValue(textShaperAbi.engine.wrapModes, value.wrap, 'constraint wrap');
  enumValue(textShaperAbi.engine.inlineAlignments, value.align, 'constraint align');
  enumValue(textShaperAbi.engine.overflowModes, value.overflow, 'constraint overflow');
  enumValue(textShaperAbi.engine.blockAlignments, value.blockAlign, 'constraint blockAlign');
  enumValue(textShaperAbi.engine.lastLinePolicies, value.lastLine ?? 'auto', 'constraint lastLine');
  const minimumRatio = value.justify?.minWordSpaceRatio;
  const maximumRatio = value.justify?.maxWordSpaceRatio;
  const expansion = value.justify?.letterSpaceExpansion;
  if ((value.firstLineIndent ?? 0) < 0 || (value.spaceBefore ?? 0) < 0 || (value.spaceAfter ?? 0) < 0) {
    throw new RangeError('paragraph indent and spacing must be nonnegative');
  }
  if (minimumRatio !== undefined && (minimumRatio <= 0 || minimumRatio > 1)) {
    throw new RangeError('minimum word-space ratio must be in (0, 1]');
  }
  if (maximumRatio !== undefined && maximumRatio < 1) {
    throw new RangeError('maximum word-space ratio must be at least 1');
  }
  if (expansion !== undefined && expansion < 0) {
    throw new RangeError('letter-space expansion must be nonnegative');
  }
}

function validateRegion(value: PlannerRegion): void {
  u32(value.geometryRevision, 'region geometry revision');
  u32(value.transformIndex, 'region transform index');
  if (value.transformIndex === 0) throw new RangeError('region transform index must be positive');
  u16(value.vertices?.length ?? 0, 'region vertex count');
  u16(value.exclusionStart, 'region exclusion start');
  u16(value.exclusionCount, 'region exclusion count');
  enumValue(textShaperAbi.engine.flowShapeKinds, value.shape, 'region shape');
  writingMode(value.writingMode);
  textOrientation(value.textOrientation);
  const bounds = validateBounds(value, true);
  const clip = validateClipBounds(value);
  if (clip[0] < bounds[0] || clip[1] < bounds[1] || clip[2] > bounds[2] || clip[3] > bounds[3]) {
    throw new RangeError('region clip must stay inside its bounds');
  }
  validateShape(value.shape, value.vertices ?? [], bounds, value.inlineStart === value.inlineEnd);
}

function validateExclusion(value: PlannerExclusion): void {
  u32(value.geometryRevision, 'exclusion geometry revision');
  u16(value.vertices?.length ?? 0, 'exclusion vertex count');
  enumValue(textShaperAbi.engine.flowShapeKinds, value.shape, 'exclusion shape');
  exclusionWrap(value.wrapSide);
  const bounds = validateBounds(value, false);
  finite(value.marginInline, 'exclusion inline margin');
  finite(value.marginBlock, 'exclusion block margin');
  if (value.marginInline < 0 || value.marginBlock < 0) {
    throw new RangeError('exclusion margins must be nonnegative');
  }
  validateShape(value.shape, value.vertices ?? [], bounds, false);
}

function validateBounds(
  value: PlannerRegion | PlannerExclusion,
  allowEmptyInline: boolean,
): readonly [number, number, number, number] {
  for (const field of ['inlineStart', 'blockStart', 'inlineEnd', 'blockEnd'] as const) {
    finite(value[field], field);
  }
  if (
    (allowEmptyInline ? value.inlineStart > value.inlineEnd : value.inlineStart >= value.inlineEnd) ||
    value.blockStart >= value.blockEnd
  ) {
    throw new RangeError('flow bounds are empty or inverted');
  }
  return [value.inlineStart, value.blockStart, value.inlineEnd, value.blockEnd];
}

function validateClipBounds(value: PlannerRegion): readonly [number, number, number, number] {
  const clip = [value.clipInlineStart, value.clipBlockStart, value.clipInlineEnd, value.clipBlockEnd] as const;
  for (const number of clip) finite(number, 'region clip bound');
  if (clip[0] > clip[2] || clip[1] >= clip[3]) throw new RangeError('region clip is empty or inverted');
  return clip;
}

function validateShape(
  shape: PlannerRegion['shape'],
  vertices: readonly PlannerFlowVertex[],
  bounds: readonly [number, number, number, number],
  emptyInline: boolean,
): void {
  if (!Array.isArray(vertices)) throw new TypeError('flow vertices must be an array');
  if (shape === 'rectangle' && vertices.length !== 0) {
    throw new TypeError('rectangle flow shapes must not carry vertices');
  }
  if (shape === 'polygon' && (vertices.length < 3 || emptyInline)) {
    throw new RangeError('polygon flow shapes need at least three vertices and nonempty bounds');
  }
  for (const vertex of vertices) {
    finite(vertex.inline, 'vertex inline');
    finite(vertex.block, 'vertex block');
    if (
      vertex.inline < bounds[0] ||
      vertex.block < bounds[1] ||
      vertex.inline > bounds[2] ||
      vertex.block > bounds[3]
    ) {
      throw new RangeError('flow vertex must stay inside its declared bounds');
    }
  }
}

function validateInlineObject(value: PlannerInlineObject): void {
  for (const [field, number] of [
    ['id', value.id],
    ['contentRevision', value.contentRevision],
    ['textOffset', value.textOffset],
    ['materialId', value.materialId],
    ['resourceId', value.resourceId],
    ['resourceGeneration', value.resourceGeneration],
  ] as const) {
    u32(number, `inline object ${field}`);
  }
  for (const [field, number] of [
    ['inlineExtent', value.inlineExtent],
    ['blockExtent', value.blockExtent],
    ['baselineOffset', value.baselineOffset],
    ['marginInlineStart', value.marginInlineStart],
    ['marginInlineEnd', value.marginInlineEnd],
    ['marginBlockStart', value.marginBlockStart],
    ['marginBlockEnd', value.marginBlockEnd],
  ] as const) {
    finite(number, `inline object ${field}`);
  }
  if (value.inlineExtent < 0 || value.blockExtent < 0) {
    throw new RangeError('inline object extents must be nonnegative');
  }
  if (value.resourceGeneration === 0) throw new RangeError('inline object resourceGeneration must be positive');
  inlineBaseline(value.baselineAlignment);
}

function validateRecordRelationships(
  paragraphMutations: readonly PlannerParagraphMutation[],
  textMutations: readonly PlannerTextMutation[],
  styleMutations: readonly PlannerStyleMutation[],
  constraints: readonly PlannerConstraint[],
  regions: readonly PlannerRegion[],
  exclusions: readonly PlannerExclusion[],
  inlineObjects: readonly PlannerInlineObject[],
  limits: PlannerFrameLimits | undefined,
): void {
  if (limits !== undefined) {
    if (paragraphMutations.length > limits.maxParagraphs) {
      throw new RangeError('frame paragraph mutations exceed the planner limit');
    }
    if (textMutations.length > limits.maxClusters || styleMutations.length > limits.maxClusters) {
      throw new RangeError('frame semantic mutations exceed the planner limit');
    }
    if (constraints.length > limits.maxRegions || regions.length > limits.maxRegions) {
      throw new RangeError('frame regions exceed the planner limit');
    }
    if (exclusions.length > limits.maxExclusions) throw new RangeError('frame exclusions exceed the planner limit');
    if (inlineObjects.length > limits.maxInlineObjects) {
      throw new RangeError('frame inline objects exceed the planner limit');
    }
  }
  if (
    (constraints.length === 0 || regions.length === 0) &&
    constraints.length + regions.length + exclusions.length + inlineObjects.length !== 0
  ) {
    throw new RangeError('frame geometry needs both constraints and regions');
  }
  const paragraphIds = new Set<number>();
  const paragraphOrders = new Set<number>();
  for (const mutation of paragraphMutations) {
    if (paragraphIds.has(mutation.paragraphId)) throw new RangeError('frame contains duplicate paragraph mutations');
    paragraphIds.add(mutation.paragraphId);
    if (mutation.opcode !== 'upsert') continue;
    if (paragraphOrders.has(mutation.order)) throw new RangeError('frame contains duplicate paragraph orders');
    paragraphOrders.add(mutation.order);
  }
  const flowThreadIds = new Set<number>();
  for (const constraint of constraints) {
    if (flowThreadIds.has(constraint.flowThreadId)) throw new RangeError('frame contains duplicate flow thread IDs');
    flowThreadIds.add(constraint.flowThreadId);
  }
  const regionIds = new Set<number>();
  for (const region of regions) {
    if (regionIds.has(region.id)) throw new RangeError('frame contains duplicate region IDs');
    regionIds.add(region.id);
    const end = region.exclusionStart + region.exclusionCount;
    if (end > exclusions.length) throw new RangeError('region exclusion span is outside the frame');
    for (const exclusion of exclusions.slice(region.exclusionStart, end)) {
      if (exclusion.regionId !== region.id) throw new TypeError('region exclusion span references a foreign region');
    }
  }
  const exclusionIds = new Set<number>();
  for (const exclusion of exclusions) {
    if (exclusionIds.has(exclusion.id)) throw new RangeError('frame contains duplicate exclusion IDs');
    exclusionIds.add(exclusion.id);
    if (!regionIds.has(exclusion.regionId)) throw new RangeError('frame exclusion references an unknown region');
  }
  for (const constraint of constraints) {
    if (constraint.regionCount === 0 || constraint.regionStart + constraint.regionCount > regions.length) {
      throw new RangeError('constraint region span is outside the frame');
    }
  }
  const inlineIds = new Set<number>();
  for (const object of inlineObjects) {
    if (inlineIds.has(object.id)) throw new RangeError('frame contains duplicate inline object IDs');
    inlineIds.add(object.id);
  }
}

interface HeaderOffsets {
  readonly paragraphOffset: number;
  readonly textOffset: number;
  readonly styleOffset: number;
  readonly constraintOffset: number;
  readonly regionOffset: number;
  readonly exclusionOffset: number;
  readonly inlineObjectOffset: number;
}

function writeHeader(view: DataView, frame: PlannerFrameUpdate, byteLength: number, offsets: HeaderOffsets): void {
  const layout = textShaperAbi.layouts.engineUpdateRequest;
  const limits = frame.limits;
  optionalBoolean(frame.compositingIndependent, 'frame compositingIndependent');
  view.setUint32(
    layout.flags,
    frame.compositingIndependent === true ? textShaperAbi.engine.frameFlags.compositingIndependent : 0,
    true,
  );
  for (const [field, value] of [
    ['abiVersion', textShaperAbi.version],
    ['byteLength', byteLength],
    ['plannerId', frame.plannerId],
    ['expectedEngineRevision', frame.expectedEngineRevision],
    ['consumedPlanRevision', frame.consumedPlanRevision],
    ['acknowledgedPublicationGeneration', frame.acknowledgedPublicationGeneration],
    ['codecHandle', frame.codecHandle],
    [
      'capabilitySet',
      frame.capabilitySet === undefined ? 1 : codecCapabilitySetSelectionId(frame.capabilitySet, frame.codecHandle),
    ],
    ['semanticViewMask', frame.semanticViewMask ?? 0],
    ['maxParagraphs', limits.maxParagraphs],
    ['maxClusters', limits.maxClusters],
    ['maxLines', limits.maxLines],
    ['maxRegions', limits.maxRegions],
    ['maxExclusions', limits.maxExclusions],
    ['maxInlineObjects', limits.maxInlineObjects],
    ['maxSlotsPerBand', limits.maxSlotsPerBand],
    ['maxOutputBytes', limits.maxOutputBytes],
    ['paragraphMutationsOffset', offsets.paragraphOffset],
    ['paragraphMutationCount', frame.paragraphMutations?.length ?? 0],
    ['textMutationsOffset', offsets.textOffset],
    ['textMutationCount', frame.textMutations?.length ?? 0],
    ['styleMutationsOffset', offsets.styleOffset],
    ['styleMutationCount', frame.styleMutations?.length ?? 0],
    ['constraintsOffset', offsets.constraintOffset],
    ['constraintCount', frame.constraints?.length ?? 0],
    ['regionsOffset', offsets.regionOffset],
    ['regionCount', frame.regions?.length ?? 0],
    ['exclusionsOffset', offsets.exclusionOffset],
    ['exclusionCount', frame.exclusions?.length ?? 0],
    ['inlineObjectsOffset', offsets.inlineObjectOffset],
    ['inlineObjectCount', frame.inlineObjects?.length ?? 0],
    ['codecParametersOffset', 0],
    ['codecParametersLength', 0],
  ] as const) {
    view.setUint32(layout[field], u32(value, field), true);
  }
}

function writeParagraphMutations(
  view: DataView,
  tableOffset: number,
  mutations: readonly PlannerParagraphMutation[],
): void {
  const layout = textShaperAbi.layouts.engineParagraphMutation;
  const opcodes = textShaperAbi.engine.paragraphMutationOpcodes;
  for (const [index, mutation] of mutations.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint8(offset + layout.opcode, enumValue(opcodes, mutation.opcode, 'paragraph mutation opcode'));
    view.setUint32(offset + layout.paragraphId, u32(mutation.paragraphId, 'paragraph ID'), true);
    if (mutation.opcode === 'upsert') {
      view.setUint32(offset + layout.order, u32(mutation.order, 'paragraph order'), true);
    }
  }
}

function writeTextMutations(
  view: DataView,
  tableOffset: number,
  mutations: readonly PlannerTextMutation[],
  payloadOffsets: readonly number[],
): void {
  const layout = textShaperAbi.layouts.engineTextMutation;
  for (const [index, mutation] of mutations.entries()) {
    const offset = tableOffset + index * layout.size;
    const payloadOffset = payloadOffsets[index]!;
    view.setUint8(offset + layout.opcode, textShaperAbi.engine.textMutationOpcodes.replaceUtf16);
    view.setUint8(offset + layout.encoding, textShaperAbi.engine.textEncodings.utf16Le);
    view.setUint32(offset + layout.paragraphId, u32(mutation.paragraphId, 'paragraph ID'), true);
    view.setUint32(offset + layout.textStart, u32(mutation.start, 'text mutation start'), true);
    view.setUint32(offset + layout.deleteCount, u32(mutation.deleteCount, 'text mutation delete count'), true);
    view.setUint32(offset + layout.insertOffset, payloadOffset, true);
    view.setUint32(offset + layout.insertCount, u32(mutation.insert.length, 'text mutation insert count'), true);
    for (let unit = 0; unit < mutation.insert.length; unit += 1) {
      view.setUint16(payloadOffset + unit * 2, mutation.insert.charCodeAt(unit), true);
    }
  }
}

function writeStyleMutations(
  view: DataView,
  bytes: Uint8Array,
  tableOffset: number,
  mutations: readonly PlannerStyleMutation[],
  languages: readonly Uint8Array[],
  languageOffsets: readonly number[],
  featureOffsets: readonly number[],
): void {
  const layout = textShaperAbi.layouts.engineStyleMutation;
  for (const [index, mutation] of mutations.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.paragraphId, u32(mutation.paragraphId, 'paragraph ID'), true);
    view.setUint32(offset + layout.styleId, u32(mutation.styleId, 'style ID'), true);
    if (mutation.opcode === 'remove') {
      view.setUint8(offset + layout.opcode, textShaperAbi.engine.styleMutationOpcodes.remove);
      continue;
    }
    if (mutation.opcode !== 'upsert') throw new TypeError('style mutation opcode is invalid');
    const value = mutation.value;
    const fields = textShaperAbi.engine.styleFields;
    const fieldMask =
      present(value.fontStackHandle, fields.fontStack) |
      present(value.materialId, fields.material) |
      present(value.language, fields.language) |
      present(value.features, fields.features) |
      present(value.fontSize, fields.fontSize) |
      present(value.lineHeight, fields.lineHeight) |
      present(value.letterSpacing, fields.letterSpacing) |
      present(value.wordSpacing, fields.wordSpacing) |
      present(value.baselineShift, fields.baselineShift) |
      present(value.rasterPixelRatio, fields.rasterPixelRatio) |
      present(value.direction, fields.direction) |
      present(value.foregroundRgba, fields.foreground) |
      present(value.opacity, fields.opacity) |
      present(value.outline, fields.outline) |
      present(value.shadow, fields.shadow) |
      present(value.decoration, fields.decoration);
    view.setUint8(offset + layout.opcode, textShaperAbi.engine.styleMutationOpcodes.upsert);
    view.setUint8(offset + layout.direction, direction(value.direction));
    optionalBoolean(mutation.root, 'style root');
    view.setUint8(offset + layout.flags, mutation.root === true ? textShaperAbi.engine.styleFlags.root : 0);
    view.setUint32(offset + layout.cascadeOrder, u32(mutation.cascadeOrder, 'style cascade order'), true);
    view.setUint32(offset + layout.fieldMask, fieldMask, true);
    view.setUint32(offset + layout.textStart, u32(mutation.start, 'style start'), true);
    view.setUint32(offset + layout.textEnd, u32(mutation.end, 'style end'), true);
    if (mutation.end < mutation.start) throw new RangeError('style end must not precede style start');
    optionalU32(view, offset + layout.fontStackHandle, value.fontStackHandle, 'font stack handle');
    optionalU32(view, offset + layout.materialId, value.materialId, 'material ID');
    const language = languages[index]!;
    view.setUint32(offset + layout.languageOffset, languageOffsets[index]!, true);
    view.setUint16(offset + layout.languageLength, u16(language.length, 'language byte length'), true);
    bytes.set(language, languageOffsets[index]!);
    const features = value.features ?? [];
    const featureOffset = featureOffsets[index]!;
    view.setUint16(offset + layout.featureCount, u16(features.length, 'feature count'), true);
    view.setUint32(offset + layout.featuresOffset, featureOffset, true);
    writeFeatures(view, featureOffset, features);
    optionalF32(view, offset + layout.fontSize, value.fontSize, 'font size');
    optionalF32(view, offset + layout.lineHeight, value.lineHeight, 'line height');
    optionalF32(view, offset + layout.letterSpacing, value.letterSpacing, 'letter spacing');
    optionalF32(view, offset + layout.wordSpacing, value.wordSpacing, 'word spacing');
    optionalF32(view, offset + layout.baselineShift, value.baselineShift, 'baseline shift');
    optionalF32(view, offset + layout.rasterPixelRatio, value.rasterPixelRatio, 'raster pixel ratio');
    optionalU32(view, offset + layout.foregroundRgba, value.foregroundRgba, 'foreground RGBA');
    optionalF32(view, offset + layout.opacity, value.opacity, 'opacity');
    optionalU32(view, offset + layout.outlineRgba, value.outline?.rgba, 'outline RGBA');
    optionalF32(view, offset + layout.outlineWidth, value.outline?.width, 'outline width');
    optionalU32(view, offset + layout.shadowRgba, value.shadow?.rgba, 'shadow RGBA');
    optionalF32(view, offset + layout.shadowOffsetX, value.shadow?.offsetX, 'shadow offset x');
    optionalF32(view, offset + layout.shadowOffsetY, value.shadow?.offsetY, 'shadow offset y');
    writeDecoration(view, offset, value.decoration);
  }
}

function writeFeatures(view: DataView, tableOffset: number, features: readonly PlannerFeature[]): void {
  const layout = textShaperAbi.layouts.feature;
  for (const [index, feature] of features.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.tag, tag(feature.tag), true);
    view.setUint32(offset + layout.value, u32(feature.value, 'feature value'), true);
    view.setUint32(offset + layout.start, u32(feature.start, 'feature start'), true);
    view.setUint32(offset + layout.end, u32(feature.end, 'feature end'), true);
    if (feature.end < feature.start) throw new RangeError('feature end must not precede feature start');
  }
}

function writeDecoration(view: DataView, offset: number, decoration: PlannerDecoration | undefined): void {
  if (decoration === undefined) return;
  const layout = textShaperAbi.layouts.engineStyleMutation;
  const styles = textShaperAbi.engine.decorationStyles;
  const flags = textShaperAbi.engine.decorationFlags;
  view.setUint8(offset + layout.decorationStyle, enumValue(styles, decoration.style, 'decoration style'));
  view.setUint32(offset + layout.decorationRgba, u32(decoration.rgba, 'decoration RGBA'), true);
  view.setUint32(
    offset + layout.decorationFlags,
    (decoration.underline === true ? flags.underline : 0) |
      (decoration.overline === true ? flags.overline : 0) |
      (decoration.lineThrough === true ? flags.lineThrough : 0) |
      (decoration.skipInk === true ? flags.skipInk : 0),
    true,
  );
  optionalBoolean(decoration.underline, 'decoration underline');
  optionalBoolean(decoration.overline, 'decoration overline');
  optionalBoolean(decoration.lineThrough, 'decoration lineThrough');
  optionalBoolean(decoration.skipInk, 'decoration skipInk');
  view.setFloat32(offset + layout.decorationThickness, finite(decoration.thickness, 'decoration thickness'), true);
  view.setFloat32(offset + layout.decorationOffset, finite(decoration.offset, 'decoration offset'), true);
}

function writeConstraints(view: DataView, tableOffset: number, constraints: readonly PlannerConstraint[]): void {
  const layout = textShaperAbi.layouts.engineConstraint;
  const engine = textShaperAbi.engine;
  for (const [index, value] of constraints.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.paragraphId, u32(value.paragraphId, 'paragraph ID'), true);
    for (const [field, number] of [
      ['flowThreadId', value.flowThreadId],
      ['geometryRevision', value.geometryRevision],
      ['maxLines', value.maxLines],
      ['regionStart', value.regionStart],
      ['resumeCluster', value.resumeCluster],
    ] as const) {
      view.setUint32(offset + layout[field], u32(number, field), true);
    }
    view.setUint16(offset + layout.regionCount, u16(value.regionCount, 'constraint region count'), true);
    view.setUint16(offset + layout.resumeRegion, u16(value.resumeRegion, 'constraint resume region'), true);
    for (const [field, number] of [
      ['width', value.width],
      ['height', value.height],
      ['viewportBlockStart', value.viewportBlockStart],
      ['viewportBlockEnd', value.viewportBlockEnd],
      ['resumeBlockOffset', value.resumeBlockOffset],
    ] as const) {
      view.setFloat32(offset + layout[field], finite(number, field), true);
    }
    view.setUint8(offset + layout.widthMode, axisMode(value.widthMode));
    view.setUint8(offset + layout.heightMode, axisMode(value.heightMode));
    view.setUint8(offset + layout.wrap, enumValue(engine.wrapModes, value.wrap, 'constraint wrap'));
    view.setUint8(offset + layout.align, enumValue(engine.inlineAlignments, value.align, 'constraint align'));
    view.setUint8(offset + layout.overflow, enumValue(engine.overflowModes, value.overflow, 'constraint overflow'));
    view.setUint8(
      offset + layout.blockAlign,
      enumValue(engine.blockAlignments, value.blockAlign, 'constraint blockAlign'),
    );
    for (const [field, number] of [
      ['firstLineIndent', value.firstLineIndent ?? 0],
      ['spaceBefore', value.spaceBefore ?? 0],
      ['spaceAfter', value.spaceAfter ?? 0],
      ['justifyMinWordSpaceRatio', value.justify?.minWordSpaceRatio ?? 0],
      ['justifyMaxWordSpaceRatio', value.justify?.maxWordSpaceRatio ?? 0],
      ['justifyLetterSpaceExpansion', value.justify?.letterSpaceExpansion ?? 0],
    ] as const) {
      view.setFloat32(offset + layout[field], finite(number, field), true);
    }
    view.setUint8(
      offset + layout.lastLine,
      enumValue(engine.lastLinePolicies, value.lastLine ?? 'auto', 'constraint lastLine'),
    );
  }
}

function writeRegions(
  view: DataView,
  tableOffset: number,
  regions: readonly PlannerRegion[],
  vertexOffsets: readonly number[],
): void {
  const layout = textShaperAbi.layouts.engineRegion;
  for (const [index, value] of regions.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.id, u32(value.id, 'region ID'), true);
    view.setUint32(offset + layout.geometryRevision, u32(value.geometryRevision, 'region geometry revision'), true);
    view.setUint32(offset + layout.transformIndex, u32(value.transformIndex, 'region transform index'), true);
    view.setUint32(offset + layout.verticesOffset, vertexOffsets[index]!, true);
    view.setUint16(offset + layout.vertexCount, u16(value.vertices?.length ?? 0, 'region vertex count'), true);
    view.setUint16(offset + layout.exclusionStart, u16(value.exclusionStart, 'region exclusion start'), true);
    view.setUint16(offset + layout.exclusionCount, u16(value.exclusionCount, 'region exclusion count'), true);
    view.setUint8(offset + layout.shape, enumValue(textShaperAbi.engine.flowShapeKinds, value.shape, 'region shape'));
    view.setUint8(offset + layout.writingMode, writingMode(value.writingMode));
    view.setUint8(offset + layout.textOrientation, textOrientation(value.textOrientation));
    writeBounds(view, offset, layout, value);
    writeVertices(view, vertexOffsets[index]!, value.vertices ?? []);
  }
}

function writeExclusions(
  view: DataView,
  tableOffset: number,
  exclusions: readonly PlannerExclusion[],
  vertexOffsets: readonly number[],
): void {
  const layout = textShaperAbi.layouts.engineExclusion;
  for (const [index, value] of exclusions.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.id, u32(value.id, 'exclusion ID'), true);
    view.setUint32(offset + layout.regionId, u32(value.regionId, 'exclusion region ID'), true);
    view.setUint32(offset + layout.geometryRevision, u32(value.geometryRevision, 'exclusion geometry revision'), true);
    view.setUint32(offset + layout.verticesOffset, vertexOffsets[index]!, true);
    view.setUint16(offset + layout.vertexCount, u16(value.vertices?.length ?? 0, 'exclusion vertex count'), true);
    view.setUint8(
      offset + layout.shape,
      enumValue(textShaperAbi.engine.flowShapeKinds, value.shape, 'exclusion shape'),
    );
    view.setUint8(offset + layout.wrapSide, exclusionWrap(value.wrapSide));
    writeBounds(view, offset, layout, value);
    view.setFloat32(offset + layout.marginInline, finite(value.marginInline, 'exclusion inline margin'), true);
    view.setFloat32(offset + layout.marginBlock, finite(value.marginBlock, 'exclusion block margin'), true);
    writeVertices(view, vertexOffsets[index]!, value.vertices ?? []);
  }
}

function writeBounds(
  view: DataView,
  offset: number,
  layout: Record<string, number>,
  value: PlannerRegion | PlannerExclusion,
): void {
  for (const field of ['inlineStart', 'blockStart', 'inlineEnd', 'blockEnd'] as const) {
    view.setFloat32(offset + layout[field]!, finite(value[field], field), true);
  }
  if ('clipInlineStart' in value) {
    view.setFloat32(offset + layout.clipInlineStart!, finite(value.clipInlineStart, 'clipInlineStart'), true);
    view.setFloat32(offset + layout.clipBlockStart!, finite(value.clipBlockStart, 'clipBlockStart'), true);
    view.setFloat32(offset + layout.clipInlineEnd!, finite(value.clipInlineEnd, 'clipInlineEnd'), true);
    view.setFloat32(offset + layout.clipBlockEnd!, finite(value.clipBlockEnd, 'clipBlockEnd'), true);
  }
}

function writeVertices(view: DataView, tableOffset: number, vertices: readonly PlannerFlowVertex[]): void {
  const layout = textShaperAbi.layouts.engineFlowVertex;
  for (const [index, vertex] of vertices.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setFloat32(offset + layout.inline, finite(vertex.inline, 'vertex inline'), true);
    view.setFloat32(offset + layout.block, finite(vertex.block, 'vertex block'), true);
  }
}

function writeInlineObjects(view: DataView, tableOffset: number, objects: readonly PlannerInlineObject[]): void {
  const layout = textShaperAbi.layouts.engineInlineObject;
  for (const [index, value] of objects.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.paragraphId, u32(value.paragraphId, 'paragraph ID'), true);
    for (const [field, number] of [
      ['id', value.id],
      ['contentRevision', value.contentRevision],
      ['textOffset', value.textOffset],
      ['materialId', value.materialId],
      ['resourceId', value.resourceId],
      ['resourceGeneration', value.resourceGeneration],
    ] as const) {
      view.setUint32(offset + layout[field], u32(number, `inline object ${field}`), true);
    }
    for (const [field, number] of [
      ['inlineExtent', value.inlineExtent],
      ['blockExtent', value.blockExtent],
      ['baselineOffset', value.baselineOffset],
      ['marginInlineStart', value.marginInlineStart],
      ['marginInlineEnd', value.marginInlineEnd],
      ['marginBlockStart', value.marginBlockStart],
      ['marginBlockEnd', value.marginBlockEnd],
    ] as const) {
      view.setFloat32(offset + layout[field], finite(number, `inline object ${field}`), true);
    }
    view.setUint8(offset + layout.baselineAlignment, inlineBaseline(value.baselineAlignment));
  }
}

function present(value: unknown, bit: number): number {
  return value === undefined ? 0 : bit;
}

function optionalU32(view: DataView, offset: number, value: number | undefined, label: string): void {
  if (value !== undefined) view.setUint32(offset, u32(value, label), true);
}

function optionalF32(view: DataView, offset: number, value: number | undefined, label: string): void {
  if (value !== undefined) view.setFloat32(offset, finite(value, label), true);
}

function direction(value: PlannerStyleValue['direction']): number {
  if (value === undefined || value === 'auto') return 0;
  if (value === 'ltr') return 1;
  if (value === 'rtl') return 2;
  throw new TypeError('style direction is invalid');
}

function axisMode(value: PlannerConstraint['widthMode']): number {
  const modes = textShaperAbi.engine.axisModes;
  if (value === 'at-most') return modes.atMost;
  return enumValue(modes, value, 'constraint axis mode');
}

function writingMode(value: PlannerRegion['writingMode']): number {
  const modes = textShaperAbi.engine.writingModes;
  if (value === 'horizontal-tb') return modes.horizontalTb;
  if (value === 'vertical-rl') return modes.verticalRl;
  if (value === 'vertical-lr') return modes.verticalLr;
  throw new TypeError('region writingMode is invalid');
}

function textOrientation(value: PlannerRegion['textOrientation']): number {
  return enumValue(textShaperAbi.engine.textOrientations, value, 'region textOrientation');
}

function exclusionWrap(value: PlannerExclusion['wrapSide']): number {
  const sides = textShaperAbi.engine.exclusionWrapSides;
  if (value === 'inline-start') return sides.inlineStart;
  if (value === 'inline-end') return sides.inlineEnd;
  return enumValue(sides, value, 'exclusion wrapSide');
}

function inlineBaseline(value: PlannerInlineObject['baselineAlignment']): number {
  const baselines = textShaperAbi.engine.inlineObjectBaselines;
  if (value === 'text-top') return baselines.textTop;
  if (value === 'text-bottom') return baselines.textBottom;
  return enumValue(baselines, value, 'inline object baselineAlignment');
}

function enumValue(values: Readonly<Record<string, number>>, value: string, label: string): number {
  const encoded = values[value];
  if (encoded === undefined) throw new TypeError(`${label} is invalid`);
  return encoded;
}

function optionalBoolean(value: boolean | undefined, label: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

function validateAxis(mode: PlannerConstraint['widthMode'], value: number, label: string): void {
  if ((mode === 'unconstrained' && value !== 0) || (mode !== 'unconstrained' && value < 0)) {
    throw new RangeError(`${label} is incompatible with its axis mode`);
  }
}

function validLanguageBytes(bytes: Uint8Array): boolean {
  const ranges: Array<readonly [number, number]> = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0x2d) continue;
    ranges.push([start, index]);
    start = index + 1;
  }
  const primary = ranges[0];
  if (primary === undefined) return false;
  const primaryLength = primary[1] - primary[0];
  const first = bytes[primary[0]];
  const privateOrGrandfathered =
    primaryLength === 1 && (first === 0x78 || first === 0x58 || first === 0x69 || first === 0x49);
  if ((!privateOrGrandfathered && (primaryLength < 2 || primaryLength > 8)) || !asciiRange(bytes, primary, false)) {
    return false;
  }
  if (privateOrGrandfathered && ranges.length === 1) return false;
  return ranges.slice(1).every((range) => {
    const length = range[1] - range[0];
    return length >= 1 && length <= 8 && asciiRange(bytes, range, true);
  });
}

function asciiRange(bytes: Uint8Array, range: readonly [number, number], digits: boolean): boolean {
  for (let index = range[0]; index < range[1]; index += 1) {
    const byte = bytes[index]!;
    const alphabetic = (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a);
    if (!alphabetic && !(digits && byte >= 0x30 && byte <= 0x39)) return false;
  }
  return true;
}

function tag(value: string): number {
  if (value.length !== 4) throw new RangeError('feature tag must contain exactly four bytes');
  let packed = 0;
  for (let index = 0; index < 4; index += 1) {
    const byte = value.charCodeAt(index);
    if (byte < 0x20 || byte > 0x7e) throw new RangeError('feature tag must contain printable ASCII bytes');
    packed = (packed << 8) | byte;
  }
  return packed >>> 0;
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  return value;
}

function positiveFinite(value: number, label: string): number {
  finite(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function u16(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${label} must be a u16`);
  return value;
}

function u32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} must be a u32`);
  return value;
}

function align(value: number, alignment: number): number {
  return checkedAdd(value, (alignment - (value % alignment)) % alignment, 'aligned frame offset');
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds the frame ABI`);
  return value;
}

function checkedAdd(left: number, right: number, label: string): number {
  const value = left + right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds the frame ABI`);
  return value;
}
