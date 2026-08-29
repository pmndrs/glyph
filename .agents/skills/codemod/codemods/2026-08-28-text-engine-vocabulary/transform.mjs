export const metadata = Object.freeze({ id: '2026-08-28-text-engine-vocabulary' });

const DECLARATION_RENAMES = [
  ['/packages/glyph/src/core/backend.ts', 'interface', 'TextEngineFault', 'GlyphEngineFault'],
  ['/packages/glyph/src/core/backend.ts', 'type', 'TextEngineStatusCode', 'GlyphEngineStatusCode'],
  ['/packages/glyph/src/core/backend.ts', 'class', 'TextEngineStatusError', 'GlyphEngineStatusError'],
  ['/packages/glyph/src/core/backend.ts', 'interface', 'TextEngineStatusDetails', 'GlyphEngineStatusDetails'],
  ['/packages/glyph/src/core/backend.ts', 'function', 'textEngineStatusErrorDetails', 'glyphEngineStatusErrorDetails'],
  ['/packages/glyph/src/core/backend.ts', 'function', 'textEngineStatusCode', 'glyphEngineStatusCode'],
  ['/packages/glyph/src/core/backend.ts', 'variable', 'TEXT_ENGINE_STATUS_CODES', 'GLYPH_ENGINE_STATUS_CODES'],
  ['/packages/glyph/src/core/backend.ts', 'variable', 'textEngineStatusDetails', 'glyphEngineStatusDetails'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineRenderPlanReader', 'RenderPlanReader'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'BorrowedTextEngineRenderPlan', 'BorrowedRenderPlan'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'OwnedTextEngineRenderPlan', 'OwnedRenderPlan'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineSpan', 'RetainedTextSpan'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineFormattedText', 'RetainedFormattedText'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'TextEngineTextInput', 'RetainedTextInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'TextEngineRegionInput', 'RetainedTextRegionInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'TextEngineExclusionInput', 'RetainedTextExclusionInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineFlowRegionInput', 'RetainedTextFlowRegionInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineFlowInput', 'RetainedTextFlowInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'TextEngineInlineObjectInput', 'RetainedTextInlineObjectInput'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'TextEngineLimits', 'RenderPlannerLimits'],
  [
    '/packages/glyph/src/core/retained-plan.ts',
    'interface',
    'RetainedPlanPublishOptions',
    'RenderPlannerPublishOptions',
  ],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'RetainedPlanBase', 'RenderPlannerBase'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'SynchronousRetainedPlan', 'RenderPlanner'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'AsyncRetainedPlan', 'AsyncRenderPlanner'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'RetainedPlanFor', 'RenderPlannerFor'],
  ['/packages/glyph/src/core/retained-plan.ts', 'type', 'TextPlanTarget', 'RenderPlanTarget'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'RetainedPlanOptions', 'RenderPlannerOptions'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'MeasurementPlan', 'MeasurementPlanner'],
  ['/packages/glyph/src/core/retained-plan.ts', 'interface', 'MeasurementPlanOptions', 'MeasurementPlannerOptions'],
  ['/packages/glyph/src/core/retained-plan.ts', 'class', 'RetainedPlanDisposedError', 'RenderPlannerDisposedError'],
  ['/packages/glyph/src/core/retained-plan.ts', 'class', 'TextEngineBackpressureError', 'RenderPlannerBackpressureError'],
  ['/packages/glyph/src/core/retained-plan.ts', 'class', 'TextEngineTransportCapacityError', 'PlanTransportCapacityError'],
  ['/packages/glyph/src/core/retained-plan.ts', 'class', 'TextEngineTransportError', 'PlanTransportError'],
  ['/packages/glyph/src/core/retained-plan.ts', 'class', 'RetainedPlanImpl', 'RenderPlannerImpl'],
  ['/packages/glyph/src/core/retained-plan.ts', 'function', 'createRetainedPlanImpl', 'createRenderPlanner'],
  ['/packages/glyph/src/core/retained-plan.ts', 'function', 'createMeasurementPlan', 'createMeasurementPlanner'],
  ['/packages/glyph/src/core/retained-plan.ts', 'function', 'assertRetainedPlanOptions', 'assertRenderPlannerOptions'],
  [
    '/packages/glyph/src/core/retained-plan.ts',
    'function',
    'assertRetainedPlanCapacities',
    'assertRenderPlannerCapacities',
  ],
  ['/packages/glyph/src/core/render-planner.ts', 'type', 'TextPlanTarget', 'RenderPlanTarget'],
  ['/packages/glyph/src/core/plan-view.ts', 'class', 'TextEngineRenderPlanView', 'RenderPlanView'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEngineScalarType', 'RenderPlanScalarType'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEnginePrimitiveKind', 'RenderPlanPrimitiveKind'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEngineResourceAction', 'RenderPlanResourceAction'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEngineRetirementKind', 'RenderPlanRetirementKind'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEnginePatchBase', 'RenderPlanPatchBase'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineAllocatePatch', 'RenderPlanAllocatePatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineWritePatch', 'RenderPlanWritePatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineFillPatch', 'RenderPlanFillPatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineCopyPatch', 'RenderPlanCopyPatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineRetirePatch', 'RenderPlanRetirePatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEnginePatchRecord', 'RenderPlanPatchRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineResourceRecord', 'RenderPlanResourceRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'type', 'TextEngineBufferBinding', 'RenderPlanBufferBinding'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineBufferRecord', 'RenderPlanBufferRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEnginePrimitiveRecord', 'RenderPlanPrimitiveRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineDrawRecord', 'RenderPlanDrawRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'interface', 'TextEngineRetirementRecord', 'RenderPlanRetirementRecord'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEnginePatch', 'readRenderPlanPatch'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEngineResource', 'readRenderPlanResource'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEngineBuffer', 'readRenderPlanBuffer'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEnginePrimitive', 'readRenderPlanPrimitive'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEngineDraw', 'readRenderPlanDraw'],
  ['/packages/glyph/src/core/plan-view.ts', 'function', 'readTextEngineRetirement', 'readRenderPlanRetirement'],
  ['/packages/glyph/src/core/layout-query-view.ts', 'function', 'readTextEngineMeasurements', 'readPlannerMeasurements'],
  ['/packages/glyph/src/core/layout-query-view.ts', 'function', 'readTextEngineLayouts', 'readPlannerLayouts'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineFrameLimits', 'PlannerFrameLimits'],
  ['/packages/glyph/src/core/frame-wire.ts', 'type', 'TextEngineParagraphMutation', 'PlannerParagraphMutation'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineTextMutation', 'PlannerTextMutation'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineFeature', 'PlannerFeature'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineDecoration', 'PlannerDecoration'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineStyleValue', 'PlannerStyleValue'],
  ['/packages/glyph/src/core/frame-wire.ts', 'type', 'TextEngineStyleMutation', 'PlannerStyleMutation'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineConstraint', 'PlannerConstraint'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineFlowVertex', 'PlannerFlowVertex'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineRegion', 'PlannerRegion'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineExclusion', 'PlannerExclusion'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineInlineObject', 'PlannerInlineObject'],
  ['/packages/glyph/src/core/frame-wire.ts', 'interface', 'TextEngineFrameUpdate', 'PlannerFrameUpdate'],
  ['/packages/glyph/src/core/frame-wire.ts', 'type', 'TextEngineFrameRecords', 'PlannerFrameRecords'],
  ['/packages/glyph/src/core/frame-wire.ts', 'function', 'validateTextEngineFrameRecords', 'validatePlannerFrameRecords'],
  ['/packages/glyph/src/core/frame-wire.ts', 'function', 'compileTextEngineFrameUpdate', 'compilePlannerFrameUpdate'],
  [
    '/packages/glyph/src/core/frame-wire.ts',
    'function',
    'compileValidatedTextEngineFrameUpdate',
    'compileValidatedPlannerFrameUpdate',
  ],
  ['/packages/glyph/src/core/frame-wire.ts', 'function', 'validateTextEngineFrameUpdate', 'validatePlannerFrameUpdate'],
  ['/packages/glyph/src/core/render-policy.ts', 'type', 'RetainedPlanHandle', 'PlannerHandle'],
];

const DECLARATION_IDENTIFIER_RENAMES = new Map(
  DECLARATION_RENAMES.map(([, , before, after]) => [before, after]),
);

export function transform({ project, renameSymbol, tsMorph }) {
  const protectedSources = new Map();
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath().replaceAll('\\', '/');
    if (path.includes('/dist/') || path.includes('/node_modules/') || path.includes('/generated/')) {
      protectedSources.set(source, source.getFullText());
    }
  }
  for (const [suffix, kind, before, after] of DECLARATION_RENAMES) {
    const source = sourceBySuffix(project, suffix);
    if (source === undefined) continue;
    const declaration = namedDeclaration(source, kind, before);
    if (declaration !== undefined) renameSymbol(declaration, after);
  }

  const backend = sourceBySuffix(project, '/packages/glyph/src/core/backend.ts');
  const create = backend?.getClass('GlyphBackend')?.getMethod('createRetainedPlan');
  if (create !== undefined) renameSymbol(create, 'createPlanner');
  const detach = backend?.getClass('GlyphBackend')?.getMethod('_detachRetainedPlan');
  if (detach !== undefined) renameSymbol(detach, '_detachPlanner');
  const allocate = backend?.getClass('GlyphBackend')?.getMethod('_allocateRetainedPlanHandle');
  if (allocate !== undefined) renameSymbol(allocate, '_allocatePlannerHandle');

  const policy = sourceBySuffix(project, '/packages/glyph/src/core/render-policy.ts');
  for (const owner of ['BackendIdFactory', 'IdFactory']) {
    const method = policy?.getInterface(owner)?.getMethod('retainedPlan');
    if (method !== undefined) renameSymbol(method, 'planner');
  }

  renamePlannerProperties(project, tsMorph);
  renamePlannerDomainStrings(project, tsMorph);
  const plannerSource = sourceBySuffix(project, '/packages/glyph/src/core/retained-plan.ts');
  if (plannerSource !== undefined) {
    plannerSource.move(`${plannerSource.getDirectoryPath()}/render-planner.ts`);
    preserveNodeNextPlannerSpecifiers(project, tsMorph);
  }
  for (const [source, text] of protectedSources) {
    if (source.getFullText() !== text) source.replaceWithText(text);
  }
}

function sourceBySuffix(project, suffix) {
  const normalized = suffix.replaceAll('\\', '/');
  return project.getSourceFile((source) => source.getFilePath().replaceAll('\\', '/').endsWith(normalized));
}

function namedDeclaration(source, kind, name) {
  if (kind === 'interface') return source.getInterface(name);
  if (kind === 'type') return source.getTypeAlias(name);
  if (kind === 'class') return source.getClass(name);
  if (kind === 'function') return source.getFunction(name);
  if (kind === 'variable') return source.getVariableDeclaration(name);
  throw new TypeError(`unsupported declaration kind ${kind}`);
}

function renamePlannerProperties(project, tsMorph) {
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath().replaceAll('\\', '/');
    if (path.includes('/node_modules/') || path.includes('/generated/')) continue;
    const identifiers = [
      ...source.getDescendantsOfKind(tsMorph.SyntaxKind.Identifier),
      ...source.getDescendantsOfKind(tsMorph.SyntaxKind.PrivateIdentifier),
    ];
    for (const node of identifiers.reverse()) {
      const replacement = plannerIdentifier(node.getText());
      if (replacement === undefined) continue;
      node.replaceWithText(replacement);
    }
  }
}

function plannerIdentifier(value) {
  const declaration = DECLARATION_IDENTIFIER_RENAMES.get(value);
  if (declaration !== undefined) return declaration;
  const direct = new Map([
    ['retainedPlanId', 'plannerId'],
    ['retainedPlanHandle', 'plannerHandle'],
    ['retainedPlanCount', 'plannerCount'],
    ['retainedPlanConflict', 'plannerConflict'],
    ['retainedPlanMissing', 'plannerMissing'],
    ['defaultRetainedPlanTextCapacity', 'defaultPlannerTextCapacity'],
    ['createRetainedPlan', 'createPlanner'],
    ['createMeasurementPlan', 'createMeasurementPlanner'],
    ['reserveRetainedPlan', 'reservePlanner'],
    ['disposeRetainedPlan', 'disposePlanner'],
  ]);
  const explicit = direct.get(value);
  if (explicit !== undefined) return explicit;
  const replacement = value
    .replaceAll('RETAINED_PLAN', 'PLANNER')
    .replaceAll('RetainedPlan', 'Planner')
    .replaceAll('retainedPlan', 'planner');
  return replacement === value ? undefined : replacement;
}

function renamePlannerDomainStrings(project, tsMorph) {
  for (const source of project.getSourceFiles()) {
    const path = source.getFilePath().replaceAll('\\', '/');
    if (path.includes('/generated/')) continue;
    for (const literal of source.getDescendantsOfKind(tsMorph.SyntaxKind.StringLiteral)) {
      if (literal.getLiteralText() !== 'retained-plan') continue;
      if (path.includes('/packages/glyph/src/') || isPlannerKindArgument(literal, tsMorph)) {
        literal.setLiteralValue('planner');
      }
    }
  }
}

function isPlannerKindArgument(literal, tsMorph) {
  const parent = literal.getParent();
  if (!tsMorph.Node.isCallExpression(parent)) return false;
  const index = parent.getArguments().indexOf(literal);
  const callee = parent.getExpression();
  if (tsMorph.Node.isIdentifier(callee)) {
    return (callee.getText() === 'id' && index === 0) || (callee.getText() === 'assertGlyphId' && index === 1);
  }
  return tsMorph.Node.isPropertyAccessExpression(callee) && callee.getName() === 'id' && index === 0;
}

function preserveNodeNextPlannerSpecifiers(project, tsMorph) {
  for (const source of project.getSourceFiles()) {
    for (const literal of source.getDescendantsOfKind(tsMorph.SyntaxKind.StringLiteral)) {
      if (literal.getLiteralText() === './render-planner') literal.setLiteralValue('./render-planner.js');
      if (literal.getLiteralText() === './core/render-planner') literal.setLiteralValue('./core/render-planner.js');
    }
  }
}
