import { textShaperAbi } from '../generated/text-shaper-abi.js';

const MAX_U32 = 0xffff_ffff;
const encoder = new TextEncoder();

export interface TextEngineFrameLimits {
  readonly maxClusters: number;
  readonly maxLines: number;
  readonly maxRegions: number;
  readonly maxExclusions: number;
  readonly maxInlineObjects: number;
  readonly maxSlotsPerBand: number;
  readonly maxOutputBytes: number;
}

export interface TextEngineTextMutation {
  readonly paragraphId: number;
  readonly start: number;
  readonly deleteCount: number;
  readonly insert: string;
}

export interface TextEngineFeature {
  readonly tag: string;
  readonly value: number;
  readonly start: number;
  readonly end: number;
}

export interface TextEngineDecoration {
  readonly style: 'none' | 'solid' | 'double' | 'dotted' | 'dashed' | 'wavy';
  readonly rgba: number;
  readonly underline?: boolean;
  readonly overline?: boolean;
  readonly lineThrough?: boolean;
  readonly skipInk?: boolean;
  readonly thickness: number;
  readonly offset: number;
}

export interface TextEngineStyleValue {
  readonly fontStackHandle?: number;
  readonly materialId?: number;
  readonly language?: string;
  readonly features?: readonly TextEngineFeature[];
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly letterSpacing?: number;
  readonly wordSpacing?: number;
  readonly baselineShift?: number;
  readonly rasterPixelRatio?: number;
  readonly direction?: 'auto' | 'ltr' | 'rtl';
  readonly foregroundRgba?: number;
  readonly decoration?: TextEngineDecoration;
}

export type TextEngineStyleMutation =
  | { readonly opcode: 'remove'; readonly paragraphId: number; readonly styleId: number }
  | {
      readonly opcode: 'upsert';
      readonly paragraphId: number;
      readonly styleId: number;
      readonly cascadeOrder: number;
      readonly start: number;
      readonly end: number;
      readonly root?: boolean;
      readonly value: TextEngineStyleValue;
    };

export interface TextEngineConstraint {
  readonly paragraphId: number;
  readonly flowThreadId: number;
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
}

export interface TextEngineFlowVertex {
  readonly inline: number;
  readonly block: number;
}

export interface TextEngineRegion {
  readonly id: number;
  readonly geometryRevision: number;
  readonly shape: 'rectangle' | 'polygon';
  readonly vertices?: readonly TextEngineFlowVertex[];
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

export interface TextEngineExclusion {
  readonly id: number;
  readonly regionId: number;
  readonly geometryRevision: number;
  readonly shape: 'rectangle' | 'polygon';
  readonly vertices?: readonly TextEngineFlowVertex[];
  readonly wrapSide: 'both' | 'inline-start' | 'inline-end' | 'largest';
  readonly inlineStart: number;
  readonly blockStart: number;
  readonly inlineEnd: number;
  readonly blockEnd: number;
  readonly marginInline: number;
  readonly marginBlock: number;
}

export interface TextEngineInlineObject {
  readonly paragraphId: number;
  readonly id: number;
  readonly contentRevision: number;
  readonly textOffset: number;
  readonly materialId: number;
  readonly resourceId: number;
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

export interface TextEngineFrameUpdate {
  readonly sessionId: number;
  readonly policyHandle: number;
  readonly capabilitySet: number;
  readonly expectedEngineRevision: number;
  readonly consumedPlanRevision: number;
  readonly acknowledgedPublicationGeneration: number;
  readonly semanticViewMask?: number;
  readonly limits: TextEngineFrameLimits;
  readonly textMutations?: readonly TextEngineTextMutation[];
  readonly styleMutations?: readonly TextEngineStyleMutation[];
  readonly constraints?: readonly TextEngineConstraint[];
  readonly regions?: readonly TextEngineRegion[];
  readonly exclusions?: readonly TextEngineExclusion[];
  readonly inlineObjects?: readonly TextEngineInlineObject[];
  readonly policyParameters?: Uint8Array;
}

/** Serialize mutations and constraints only; shaping, layout, planning, and packing remain Rust-owned. */
export function compileTextEngineFrameUpdate(frame: TextEngineFrameUpdate): Uint8Array {
  const abi = textShaperAbi;
  const request = abi.layouts.engineUpdateRequest;
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
  const languageOffsets = languageBytes.map((bytes) => allocate(bytes.length, 1, 1, 'style language'));
  const featureOffsets = styleMutations.map((mutation) =>
    allocate(
      mutation.opcode === 'upsert' ? (mutation.value.features?.length ?? 0) : 0,
      abi.layouts.feature.size,
      abi.layouts.feature.alignment,
      'style features',
    ),
  );
  const regionVertexOffsets = regions.map((region) =>
    allocate(region.vertices?.length ?? 0, abi.layouts.engineFlowVertex.size, 4, 'region vertices'),
  );
  const exclusionVertexOffsets = exclusions.map((exclusion) =>
    allocate(exclusion.vertices?.length ?? 0, abi.layouts.engineFlowVertex.size, 4, 'exclusion vertices'),
  );
  const policyParameters = frame.policyParameters ?? new Uint8Array();
  const policyParametersOffset = allocate(policyParameters.length, 1, 1, 'policy parameters');
  const bytes = new Uint8Array(cursor);
  const view = new DataView(bytes.buffer);

  writeHeader(view, frame, bytes.length, {
    textOffset,
    styleOffset,
    constraintOffset,
    regionOffset,
    exclusionOffset,
    inlineObjectOffset,
    policyParametersOffset,
  });
  writeTextMutations(view, textOffset, textMutations, textPayloads);
  writeStyleMutations(view, bytes, styleOffset, styleMutations, languageBytes, languageOffsets, featureOffsets);
  writeConstraints(view, constraintOffset, constraints);
  writeRegions(view, regionOffset, regions, regionVertexOffsets);
  writeExclusions(view, exclusionOffset, exclusions, exclusionVertexOffsets);
  writeInlineObjects(view, inlineObjectOffset, inlineObjects);
  bytes.set(policyParameters, policyParametersOffset);
  return bytes;
}

interface HeaderOffsets {
  readonly textOffset: number;
  readonly styleOffset: number;
  readonly constraintOffset: number;
  readonly regionOffset: number;
  readonly exclusionOffset: number;
  readonly inlineObjectOffset: number;
  readonly policyParametersOffset: number;
}

function writeHeader(view: DataView, frame: TextEngineFrameUpdate, byteLength: number, offsets: HeaderOffsets): void {
  const layout = textShaperAbi.layouts.engineUpdateRequest;
  const limits = frame.limits;
  for (const [field, value] of [
    ['abiVersion', textShaperAbi.version],
    ['byteLength', byteLength],
    ['sessionId', frame.sessionId],
    ['expectedEngineRevision', frame.expectedEngineRevision],
    ['consumedPlanRevision', frame.consumedPlanRevision],
    ['acknowledgedPublicationGeneration', frame.acknowledgedPublicationGeneration],
    ['policyHandle', frame.policyHandle],
    ['capabilitySet', frame.capabilitySet],
    ['semanticViewMask', frame.semanticViewMask ?? 0],
    ['maxClusters', limits.maxClusters],
    ['maxLines', limits.maxLines],
    ['maxRegions', limits.maxRegions],
    ['maxExclusions', limits.maxExclusions],
    ['maxInlineObjects', limits.maxInlineObjects],
    ['maxSlotsPerBand', limits.maxSlotsPerBand],
    ['maxOutputBytes', limits.maxOutputBytes],
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
    ['policyParametersOffset', offsets.policyParametersOffset],
    ['policyParametersLength', frame.policyParameters?.length ?? 0],
  ] as const) {
    view.setUint32(layout[field], u32(value, field), true);
  }
}

function writeTextMutations(
  view: DataView,
  tableOffset: number,
  mutations: readonly TextEngineTextMutation[],
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
  mutations: readonly TextEngineStyleMutation[],
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
      present(value.decoration, fields.decoration);
    view.setUint8(offset + layout.opcode, textShaperAbi.engine.styleMutationOpcodes.upsert);
    view.setUint8(offset + layout.direction, direction(value.direction));
    view.setUint8(offset + layout.flags, mutation.root === true ? textShaperAbi.engine.styleFlags.root : 0);
    view.setUint32(offset + layout.cascadeOrder, u32(mutation.cascadeOrder, 'style cascade order'), true);
    view.setUint32(offset + layout.fieldMask, fieldMask, true);
    view.setUint32(offset + layout.textStart, u32(mutation.start, 'style start'), true);
    view.setUint32(offset + layout.textEnd, u32(mutation.end, 'style end'), true);
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
    writeDecoration(view, offset, value.decoration);
  }
}

function writeFeatures(view: DataView, tableOffset: number, features: readonly TextEngineFeature[]): void {
  const layout = textShaperAbi.layouts.feature;
  for (const [index, feature] of features.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.tag, tag(feature.tag), true);
    view.setUint32(offset + layout.value, u32(feature.value, 'feature value'), true);
    view.setUint32(offset + layout.start, u32(feature.start, 'feature start'), true);
    view.setUint32(offset + layout.end, u32(feature.end, 'feature end'), true);
  }
}

function writeDecoration(view: DataView, offset: number, decoration: TextEngineDecoration | undefined): void {
  if (decoration === undefined) return;
  const layout = textShaperAbi.layouts.engineStyleMutation;
  const styles = textShaperAbi.engine.decorationStyles;
  const flags = textShaperAbi.engine.decorationFlags;
  view.setUint8(offset + layout.decorationStyle, styles[decoration.style]);
  view.setUint32(offset + layout.decorationRgba, u32(decoration.rgba, 'decoration RGBA'), true);
  view.setUint32(
    offset + layout.decorationFlags,
    (decoration.underline === true ? flags.underline : 0) |
      (decoration.overline === true ? flags.overline : 0) |
      (decoration.lineThrough === true ? flags.lineThrough : 0) |
      (decoration.skipInk === true ? flags.skipInk : 0),
    true,
  );
  view.setFloat32(offset + layout.decorationThickness, finite(decoration.thickness, 'decoration thickness'), true);
  view.setFloat32(offset + layout.decorationOffset, finite(decoration.offset, 'decoration offset'), true);
}

function writeConstraints(view: DataView, tableOffset: number, constraints: readonly TextEngineConstraint[]): void {
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
    view.setUint8(offset + layout.wrap, engine.wrapModes[value.wrap]);
    view.setUint8(offset + layout.align, engine.inlineAlignments[value.align]);
    view.setUint8(offset + layout.overflow, engine.overflowModes[value.overflow]);
    view.setUint8(offset + layout.blockAlign, engine.blockAlignments[value.blockAlign]);
  }
}

function writeRegions(
  view: DataView,
  tableOffset: number,
  regions: readonly TextEngineRegion[],
  vertexOffsets: readonly number[],
): void {
  const layout = textShaperAbi.layouts.engineRegion;
  for (const [index, value] of regions.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setUint32(offset + layout.id, u32(value.id, 'region ID'), true);
    view.setUint32(offset + layout.geometryRevision, u32(value.geometryRevision, 'region geometry revision'), true);
    view.setUint32(offset + layout.verticesOffset, vertexOffsets[index]!, true);
    view.setUint16(offset + layout.vertexCount, u16(value.vertices?.length ?? 0, 'region vertex count'), true);
    view.setUint16(offset + layout.exclusionStart, u16(value.exclusionStart, 'region exclusion start'), true);
    view.setUint16(offset + layout.exclusionCount, u16(value.exclusionCount, 'region exclusion count'), true);
    view.setUint8(offset + layout.shape, textShaperAbi.engine.flowShapeKinds[value.shape]);
    view.setUint8(offset + layout.writingMode, writingMode(value.writingMode));
    view.setUint8(offset + layout.textOrientation, textOrientation(value.textOrientation));
    writeBounds(view, offset, layout, value);
    writeVertices(view, vertexOffsets[index]!, value.vertices ?? []);
  }
}

function writeExclusions(
  view: DataView,
  tableOffset: number,
  exclusions: readonly TextEngineExclusion[],
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
    view.setUint8(offset + layout.shape, textShaperAbi.engine.flowShapeKinds[value.shape]);
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
  value: TextEngineRegion | TextEngineExclusion,
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

function writeVertices(view: DataView, tableOffset: number, vertices: readonly TextEngineFlowVertex[]): void {
  const layout = textShaperAbi.layouts.engineFlowVertex;
  for (const [index, vertex] of vertices.entries()) {
    const offset = tableOffset + index * layout.size;
    view.setFloat32(offset + layout.inline, finite(vertex.inline, 'vertex inline'), true);
    view.setFloat32(offset + layout.block, finite(vertex.block, 'vertex block'), true);
  }
}

function writeInlineObjects(view: DataView, tableOffset: number, objects: readonly TextEngineInlineObject[]): void {
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

function direction(value: TextEngineStyleValue['direction']): number {
  return value === undefined || value === 'auto' ? 0 : value === 'ltr' ? 1 : 2;
}

function axisMode(value: TextEngineConstraint['widthMode']): number {
  const modes = textShaperAbi.engine.axisModes;
  return value === 'at-most' ? modes.atMost : modes[value];
}

function writingMode(value: TextEngineRegion['writingMode']): number {
  const modes = textShaperAbi.engine.writingModes;
  return value === 'horizontal-tb' ? modes.horizontalTb : value === 'vertical-rl' ? modes.verticalRl : modes.verticalLr;
}

function textOrientation(value: TextEngineRegion['textOrientation']): number {
  return textShaperAbi.engine.textOrientations[value];
}

function exclusionWrap(value: TextEngineExclusion['wrapSide']): number {
  const sides = textShaperAbi.engine.exclusionWrapSides;
  return value === 'inline-start' ? sides.inlineStart : value === 'inline-end' ? sides.inlineEnd : sides[value];
}

function inlineBaseline(value: TextEngineInlineObject['baselineAlignment']): number {
  const baselines = textShaperAbi.engine.inlineObjectBaselines;
  return value === 'text-top' ? baselines.textTop : value === 'text-bottom' ? baselines.textBottom : baselines[value];
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
